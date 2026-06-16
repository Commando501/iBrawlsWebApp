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
  computeStepRewardDetails,
  computeActionDisciplineRewards,
  mergeRewardDetails,
  initRewardMemory,
  DEFAULT_REWARD_CONFIG,
  REWARD_COMPONENT_KEYS,
  type RewardConfig,
  type RewardMemory,
} from '../env/reward';
import { heuristicPolicy } from '../harness/heuristicPolicy';
import { randomPolicy } from '../harness/randomPolicy';
import { type Policy } from '../harness/policy';
import { randomizeSettings, type RandomizeSpec } from '../env/randomize';
import { idleAction, type ActionInput } from '../actions';
import {
  MECHANICS_COVERAGE_FIELDS,
  MechanicsCoverageTracker,
  mechanicsBaseValues as buildMechanicsBaseValues,
  mechanicsCoverageKeys as buildMechanicsCoverageKeys,
} from './mechanicsCoverage';

export interface VecEnvConfig {
  numEnvs: number;
  /** Base RNG seed; env e starts at `baseSeed + e`, re-seeded forward on auto-reset. */
  baseSeed?: number;
  teamSizes?: { blue: number; red: number };
  settings?: Partial<UniversalSettings>;
  reward?: Partial<RewardConfig>;
  /** Agent indices (0-based, roster order) driven by a built-in opponent policy. */
  builtinAgents?: number[];
  /** Which built-in policy drives `builtinAgents`. Default 'heuristic'. */
  builtinPolicy?: 'heuristic' | 'random';
  /** Per-episode domain randomization of the dynamics settings. */
  randomize?: RandomizeSpec;
  /** Safety cap; a match exceeding this many ticks is force-reset (counts as draw). */
  maxTicks?: number;
  /**
   * Sim ticks advanced per policy decision (frame-skip). Each `step()` repeats the action
   * block for this many ticks, accumulating rewards. >1 is both a big throughput lever
   * (fewer round-trips + smaller rollout buffers per sim-second) and a human-likeness one:
   * 60Hz decisions are super-human twitch; 4–6 (≈10–15 decisions/sec) is a human cadence.
   */
  decisionInterval?: number;
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
  /** Signed aggregate reward components for this vec-env step, in REWARD_COMPONENT_KEYS order. */
  rewardComponents: Float32Array;
  /** Aggregate mechanics coverage as [count, min, max, sum] per header.mechanicsCoverageKeys. */
  mechanicsCoverage: Float32Array;
}

export class VecEnv {
  readonly mode = 'grifball' as const;
  readonly numEnvs: number;
  readonly numAgents: number;
  readonly obsDim = OBS_DIM;
  readonly actDim = ACTION_DIM;
  readonly agentIds: string[];
  /** Team of each agent (roster order), so the trainer can pick learner vs opponent. */
  readonly agentTeams: string[];
  readonly mechanicsCoverageKeys: string[];
  readonly mechanicsCoverageFields: string[] = [...MECHANICS_COVERAGE_FIELDS];
  readonly mechanicsBaseValues: Record<string, number>;

  private readonly settings: UniversalSettings;
  private readonly reward: RewardConfig;
  private readonly teamSizes: { blue: number; red: number };
  private readonly builtin: Set<number>;
  private readonly builtinPolicy: Policy;
  private readonly maxTicks: number;
  readonly decisionInterval: number;

  private readonly randomize: RandomizeSpec;
  private readonly mechanicsKeys: (keyof UniversalSettings)[];
  private readonly mechanicsCoverage: MechanicsCoverageTracker;
  private states: SimState[] = [];
  private memories: RewardMemory[] = [];
  private rngs: Rng[] = [];
  /** Effective (possibly randomized) settings for each env's current episode. */
  private envSettings: UniversalSettings[] = [];
  private episode: number[] = [];
  private readonly baseSeed: number;

  // Reused output buffers.
  private readonly obsBuf: Float32Array;
  private readonly rewardBuf: Float32Array;
  private readonly doneBuf: Uint8Array;
  private readonly truncatedBuf: Uint8Array;
  private readonly terminalObs: (Float32Array | null)[];
  private readonly rewardComponentBuf: Float32Array;

  constructor(config: VecEnvConfig) {
    this.numEnvs = config.numEnvs;
    this.teamSizes = config.teamSizes ?? { blue: 4, red: 4 };
    this.agentIds = buildCombatantIds(this.teamSizes);
    this.agentTeams = this.agentIds.map((id) => resolveGrifballTeam(id));
    this.numAgents = this.agentIds.length;
    this.settings = resolveSimSettings(config.settings);
    // Merge over defaults so a partial reward config can't leave a weight undefined (NaN).
    this.reward = { ...DEFAULT_REWARD_CONFIG, ...(config.reward ?? {}) };
    this.builtin = new Set(config.builtinAgents ?? []);
    this.builtinPolicy = config.builtinPolicy === 'random' ? randomPolicy : heuristicPolicy;
    this.maxTicks = config.maxTicks ?? 60 * 60 * 30;
    this.decisionInterval = Math.max(1, Math.trunc(config.decisionInterval ?? 1));
    this.randomize = config.randomize ?? { enabled: false, pct: 0 };
    this.baseSeed = config.baseSeed ?? 1;
    this.mechanicsKeys = buildMechanicsCoverageKeys(this.randomize);
    this.mechanicsCoverageKeys = this.mechanicsKeys.map(String);
    this.mechanicsBaseValues = buildMechanicsBaseValues(this.settings, this.mechanicsKeys);
    this.mechanicsCoverage = new MechanicsCoverageTracker(this.mechanicsKeys);

    const n = this.numEnvs * this.numAgents;
    this.obsBuf = new Float32Array(n * this.obsDim);
    this.rewardBuf = new Float32Array(n);
    this.doneBuf = new Uint8Array(n);
    this.truncatedBuf = new Uint8Array(n);
    this.terminalObs = new Array(n).fill(null);
    this.rewardComponentBuf = new Float32Array(REWARD_COMPONENT_KEYS.length);
  }

  /** Seed for env `e`'s current episode. */
  private seedFor(e: number): number {
    return this.baseSeed + e + this.episode[e] * this.numEnvs * 7919;
  }

  /** (Re)create env `e` from its current episode seed (with fresh randomized settings). */
  private makeEnv(e: number): void {
    const seed = this.seedFor(e);
    const settings = randomizeSettings(this.settings, this.randomize, createRng(seed ^ 0x85ebca6b));
    this.envSettings[e] = settings;
    this.mechanicsCoverage.record(settings);
    const state = createMatch({ seed, teamSizes: this.teamSizes, settings });
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
   * Advance every env by `decisionInterval` ticks using `actions` (`numEnvs × numAgents ×
   * actDim` int32s), accumulating rewards. Built-in opponent slots ignore their action
   * block. Actions are re-decoded each tick so context-relative factors (aim toward ball /
   * enemy goal) track the live state and dead agents idle out; a match that ends mid-interval
   * stops early (the fresh episode starts on the next decision).
   */
  step(actions: Int32Array): VecStepResult {
    this.rewardComponentBuf.fill(0);
    for (let e = 0; e < this.numEnvs; e++) {
      const rBase = e * this.numAgents;
      const actionBase = rBase * this.actDim;
      for (let i = 0; i < this.numAgents; i++) {
        this.rewardBuf[rBase + i] = 0;
        this.doneBuf[rBase + i] = 0;
        this.truncatedBuf[rBase + i] = 0;
        this.terminalObs[rBase + i] = null;
      }

      for (let k = 0; k < this.decisionInterval; k++) {
        const state = this.states[e];
        const byId: Record<string, ActionInput> = {};
        for (let i = 0; i < this.numAgents; i++) {
          const id = this.agentIds[i];
          if (this.builtin.has(i)) {
            byId[id] = this.builtinPolicy(state, id, this.rngs[e]);
          } else {
            byId[id] = decodeAction(actions, state, id, actionBase + i * this.actDim);
          }
        }

        const details = computeActionDisciplineRewards(state, this.reward, this.memories[e], byId);
        const events = stepSimulation(state, byId, { settings: this.envSettings[e] });
        mergeRewardDetails(details, computeStepRewardDetails(state, events, this.reward, this.memories[e]));
        const rewards = details.rewards;
        for (let i = 0; i < this.numAgents; i++) {
          this.rewardBuf[rBase + i] += rewards[this.agentIds[i]] ?? 0;
        }
        REWARD_COMPONENT_KEYS.forEach((key, i) => {
          this.rewardComponentBuf[i] += details.components[key];
        });

        // A real match end is a true terminal (no bootstrap); a maxTicks cut-off is a
        // truncation (bootstrap from the terminal obs). Early-training matches truncate
        // often (weak policies rarely score), so this distinction matters.
        const truncated = !events.matchEnded && state.tick >= this.maxTicks;
        const done = events.matchEnded || truncated;
        if (done) {
          // Capture terminal obs, then reset; the fresh obs is encoded below.
          for (let i = 0; i < this.numAgents; i++) {
            const term = new Float32Array(this.obsDim);
            encodeObservation(state, this.agentIds[i], term, 0);
            this.terminalObs[rBase + i] = term;
            this.doneBuf[rBase + i] = 1;
            this.truncatedBuf[rBase + i] = truncated ? 1 : 0;
          }
          this.episode[e] += 1;
          this.makeEnv(e);
          break;
        }
      }
      this.encodeEnvObs(e, this.obsBuf);
    }

    return {
      obs: this.obsBuf,
      reward: this.rewardBuf,
      done: this.doneBuf,
      truncated: this.truncatedBuf,
      info: { terminalObs: this.terminalObs },
      rewardComponents: this.rewardComponentBuf,
      mechanicsCoverage: this.mechanicsCoverage.drain(),
    };
  }

  /** Read-only access to an env's live state (debug / eval). */
  getState(e: number): SimState {
    return this.states[e];
  }
}

export { idleAction };
