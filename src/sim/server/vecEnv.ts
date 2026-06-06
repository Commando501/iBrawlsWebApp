/**
 * `VecEnv` — N parallel Grifball matches behind one batched step. Agents are flattened
 * into the batch dimension (`numEnvs × numAgents`) for shared-policy self-play. `obs`,
 * `reward`, and `done` are contiguous typed arrays reused across calls (zero per-step
 * allocation). A finished match auto-resets, its terminal observation stashed in `info`
 * per the Gymnasium convention; the fresh reset obs is written into the obs slot.
 *
 * Optionally, a subset of agent slots is driven by the built-in {@link heuristicPolicy}
 * (a fixed opponent), so the trainer can request "learner vs heuristic" without shipping
 * a policy across the wire — those slots ignore the incoming action block.
 */

import { type UniversalSettings } from '../../types';
import { createMatch, resolveSimSettings, buildCombatantIds } from '../factory';
import { resolveGrifballTeam } from '../../game/grifballTeams';
import { stepSimulation } from '../step';
import { type SimState } from '../simState';
import { createRng, type Rng } from '../rng';
import { encodeObservation, OBS_DIM } from '../env/observation';
import { ACTION_DIM, decodeAction } from '../env/action';
import {
  computeStepRewards,
  initRewardMemory,
  DEFAULT_REWARD_CONFIG,
  type RewardConfig,
  type RewardMemory,
} from '../env/reward';
import { heuristicPolicy } from '../harness/heuristicPolicy';
import { randomPolicy } from '../harness/randomPolicy';
import { type Policy } from '../harness/policy';
import { idleAction, type ActionInput } from '../actions';

export interface VecEnvConfig {
  numEnvs: number;
  /** Base RNG seed; env e starts at `baseSeed + e`, re-seeded forward on auto-reset. */
  baseSeed?: number;
  teamSizes?: { blue: number; red: number };
  settings?: Partial<UniversalSettings>;
  reward?: RewardConfig;
  /** Agent indices (0-based, roster order) driven by a built-in opponent policy. */
  builtinAgents?: number[];
  /** Which built-in policy drives `builtinAgents`. Default 'heuristic'. */
  builtinPolicy?: 'heuristic' | 'random';
  /** Safety cap; a match exceeding this many ticks is force-reset (counts as draw). */
  maxTicks?: number;
}

export interface StepInfo {
  /** Per (env, agent) terminal observation captured the tick a match ended, else null. */
  terminalObs: (Float32Array | null)[];
}

export interface VecStepResult {
  obs: Float32Array;
  reward: Float32Array;
  done: Uint8Array;
  /** 1 where a `done` was a maxTicks truncation (not a real match end) — bootstrap these. */
  truncated: Uint8Array;
  info: StepInfo;
}

export class VecEnv {
  readonly numEnvs: number;
  readonly numAgents: number;
  readonly obsDim = OBS_DIM;
  readonly actDim = ACTION_DIM;
  readonly agentIds: string[];
  /** Team of each agent (roster order), so the trainer can pick learner vs opponent. */
  readonly agentTeams: string[];

  private readonly settings: UniversalSettings;
  private readonly reward: RewardConfig;
  private readonly teamSizes: { blue: number; red: number };
  private readonly builtin: Set<number>;
  private readonly builtinPolicy: Policy;
  private readonly maxTicks: number;

  private states: SimState[] = [];
  private memories: RewardMemory[] = [];
  private rngs: Rng[] = [];
  private episode: number[] = [];
  private readonly baseSeed: number;

  // Reused output buffers.
  private readonly obsBuf: Float32Array;
  private readonly rewardBuf: Float32Array;
  private readonly doneBuf: Uint8Array;
  private readonly truncatedBuf: Uint8Array;
  private readonly terminalObs: (Float32Array | null)[];

  constructor(config: VecEnvConfig) {
    this.numEnvs = config.numEnvs;
    this.teamSizes = config.teamSizes ?? { blue: 4, red: 4 };
    this.agentIds = buildCombatantIds(this.teamSizes);
    this.agentTeams = this.agentIds.map((id) => resolveGrifballTeam(id));
    this.numAgents = this.agentIds.length;
    this.settings = resolveSimSettings(config.settings);
    this.reward = config.reward ?? DEFAULT_REWARD_CONFIG;
    this.builtin = new Set(config.builtinAgents ?? []);
    this.builtinPolicy = config.builtinPolicy === 'random' ? randomPolicy : heuristicPolicy;
    this.maxTicks = config.maxTicks ?? 60 * 60 * 30;
    this.baseSeed = config.baseSeed ?? 1;

    const n = this.numEnvs * this.numAgents;
    this.obsBuf = new Float32Array(n * this.obsDim);
    this.rewardBuf = new Float32Array(n);
    this.doneBuf = new Uint8Array(n);
    this.truncatedBuf = new Uint8Array(n);
    this.terminalObs = new Array(n).fill(null);
  }

  /** Seed for env `e`'s current episode. */
  private seedFor(e: number): number {
    return this.baseSeed + e + this.episode[e] * this.numEnvs * 7919;
  }

  /** (Re)create env `e` from its current episode seed. */
  private makeEnv(e: number): void {
    const seed = this.seedFor(e);
    const state = createMatch({ seed, teamSizes: this.teamSizes, settings: this.settings });
    this.states[e] = state;
    this.memories[e] = initRewardMemory(state);
    this.rngs[e] = createRng(seed ^ 0x2545f491);
  }

  /** Reset all envs and return the initial observation buffer. */
  reset(): Float32Array {
    this.episode = new Array(this.numEnvs).fill(0);
    for (let e = 0; e < this.numEnvs; e++) {
      this.makeEnv(e);
      this.encodeEnvObs(e, this.obsBuf);
    }
    return this.obsBuf;
  }

  /** Encode every agent of env `e` into `dst` at the env's base offset. */
  private encodeEnvObs(e: number, dst: Float32Array): void {
    const base = e * this.numAgents * this.obsDim;
    for (let i = 0; i < this.numAgents; i++) {
      encodeObservation(this.states[e], this.agentIds[i], dst, base + i * this.obsDim);
    }
  }

  /**
   * Advance every env by one tick using `actions` (`numEnvs × numAgents × actDim` int32s).
   * Built-in opponent slots ignore their action block.
   */
  step(actions: Int32Array): VecStepResult {
    for (let e = 0; e < this.numEnvs; e++) {
      const state = this.states[e];
      const actionBase = e * this.numAgents * this.actDim;

      const byId: Record<string, ActionInput> = {};
      for (let i = 0; i < this.numAgents; i++) {
        const id = this.agentIds[i];
        if (this.builtin.has(i)) {
          byId[id] = this.builtinPolicy(state, id, this.rngs[e]);
        } else {
          byId[id] = decodeAction(actions, state, id, actionBase + i * this.actDim);
        }
      }

      const events = stepSimulation(state, byId, { settings: this.settings });
      const rewards = computeStepRewards(state, events, this.reward, this.memories[e]);

      // A real match end is a true terminal (no bootstrap); a maxTicks cut-off is a
      // truncation (bootstrap from the terminal obs). Early-training matches truncate
      // often (weak policies rarely score), so this distinction matters.
      const truncated = !events.matchEnded && state.tick >= this.maxTicks;
      const done = events.matchEnded || truncated;
      const rBase = e * this.numAgents;
      for (let i = 0; i < this.numAgents; i++) {
        this.rewardBuf[rBase + i] = rewards[this.agentIds[i]] ?? 0;
        this.doneBuf[rBase + i] = done ? 1 : 0;
        this.truncatedBuf[rBase + i] = truncated ? 1 : 0;
        this.terminalObs[rBase + i] = null;
      }

      if (done) {
        // Capture terminal obs, then reset and write the fresh obs into the slot.
        const obsBase = e * this.numAgents * this.obsDim;
        for (let i = 0; i < this.numAgents; i++) {
          const term = new Float32Array(this.obsDim);
          encodeObservation(state, this.agentIds[i], term, 0);
          this.terminalObs[rBase + i] = term;
        }
        this.episode[e] += 1;
        this.makeEnv(e);
        this.encodeEnvObs(e, this.obsBuf);
        void obsBase;
      } else {
        this.encodeEnvObs(e, this.obsBuf);
      }
    }

    return {
      obs: this.obsBuf,
      reward: this.rewardBuf,
      done: this.doneBuf,
      truncated: this.truncatedBuf,
      info: { terminalObs: this.terminalObs },
    };
  }

  /** Read-only access to an env's live state (debug / eval). */
  getState(e: number): SimState {
    return this.states[e];
  }
}

export { idleAction };
