/**
 * Combat (deathmatch) vec-env for the **generalist** combat policy.
 *
 * Unlike the grifball `VecEnv` (fixed roster, learner-vs-opponent split), this holds a set
 * of independent **worlds of fixed-but-different sizes** — e.g. several 2-player worlds
 * (true 1v1), some 4- and 8-player worlds (FFA / teams). All worlds' agents are flattened
 * into one fixed-size batch (the sum of world sizes), so the batch dimension is constant
 * even though match sizes differ — no "empty seat" masking needed.
 *
 * Every episode, each world re-randomizes its **team partition** (FFA / 2 teams / 4 teams,
 * whatever its size allows) and its **kill target**. A single shared policy controls every
 * agent (pure self-play), so it learns to play 1v1, FFA, and team deathmatch — and any kill
 * total — all at once. To the Python client this looks like one flat batch of self-play
 * agents (`numEnvs = 1`, `numAgents = totalAgents`).
 */

import { type UniversalSettings } from '../../types';
import { type TeamId } from '../../game/teamScoring';
import { createMatch, resolveSimSettings } from '../factory';
import { stepSimulation } from '../step';
import { type SimState } from '../simState';
import { createRng, type Rng } from '../rng';
import { encodeObservationForVersion, obsDimForVersion } from '../env/observation';
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
import { randomizeSettings, type RandomizeSpec } from '../env/randomize';
import { type VecStepResult } from './vecEnv';
import { passiveBaitPolicyFor, type PassiveBaitProfile } from '../harness/passiveBaitPolicy';
import { type Policy } from '../harness/policy';

export interface CombatVecEnvConfig {
  /** Fixed size of each world. Their sum is the (constant) agent batch. */
  worldSizes?: number[];
  /** Fixed team-size layouts per world, e.g. [1, 3] = one lone combatant vs three. */
  worldLayouts?: number[][];
  baseSeed?: number;
  settings?: Partial<UniversalSettings>;
  reward?: Partial<RewardConfig>;
  /** Per-episode kill target is sampled uniformly from this inclusive range. */
  killTargetRange?: [number, number];
  /** Randomize team partition + kill target each episode (default true). */
  randomizeLayout?: boolean;
  /** Per-episode domain randomization of the dynamics settings. */
  randomize?: RandomizeSpec;
  /** Safety cap per match; exceeding it truncates (and bootstraps if enabled downstream). */
  maxTicks?: number;
  /** Sim ticks per policy decision (frame-skip); see {@link VecEnvConfig.decisionInterval}. */
  decisionInterval?: number;
  /** Multiplier for singleton-team rewards in asymmetric combat layouts. */
  loneWolfRewardScale?: number;
  /** Observation contract version: 1 keeps old checkpoints, 2 adds combat pressure context. */
  observationVersion?: number;
  /** Optional scripted policy for non-team-0 combatants in fixed-layout curriculum worlds. */
  scriptedOpponentProfile?: PassiveBaitProfile;
}

interface World {
  index: number;
  size: number;
  offset: number; // start index in the flat batch
  baseSeed: number;
  episode: number;
  state: SimState;
  memory: RewardMemory;
  settings: UniversalSettings; // effective (possibly randomized) settings this episode
  layoutRng: Rng; // drives partition + kill-target randomization
  fixedTeamSizes?: number[];
}

const DEFAULT_WORLD_SIZES = [2, 2, 2, 2, 4, 4, 8];

/** Integer partitions of `size` we allow as team layouts (FFA + even splits). */
function allowedPartitions(size: number): number[][] {
  const parts: number[][] = [Array(size).fill(1)]; // FFA
  if (size % 2 === 0 && size >= 4) parts.push([size / 2, size / 2]); // 2 teams
  if (size % 4 === 0 && size >= 8) parts.push(Array(4).fill(size / 4)); // 4 teams
  return parts;
}

export class CombatVecEnv {
  readonly mode = 'combat' as const;
  readonly obsDim: number;
  readonly observationVersion: number;
  readonly actDim = ACTION_DIM;
  /** Presented to Python as one flat env of `numAgents` self-play agents. */
  readonly numEnvs = 1;
  readonly numAgents: number;
  readonly agentIds: string[];
  readonly agentTeams: string[];
  readonly learnerAgentIndices: number[];

  private readonly settings: UniversalSettings;
  private readonly reward: RewardConfig;
  private readonly killTargetRange: [number, number];
  private readonly randomizeLayout: boolean;
  private readonly dr: RandomizeSpec;
  private readonly maxTicks: number;
  readonly decisionInterval: number;
  private readonly loneWolfRewardScale: number;
  private readonly scriptedOpponentPolicy: Policy | null;
  private readonly worlds: World[] = [];

  private readonly obsBuf: Float32Array;
  private readonly rewardBuf: Float32Array;
  private readonly doneBuf: Uint8Array;
  private readonly truncatedBuf: Uint8Array;
  private readonly terminalObs: (Float32Array | null)[];
  private readonly rewardComponentBuf: Float32Array;

  constructor(config: CombatVecEnvConfig) {
    const layouts = normalizeWorldLayouts(config.worldLayouts);
    const sizes = layouts?.map((layout) => layout.reduce((n, size) => n + size, 0))
      ?? (config.worldSizes?.length ? config.worldSizes : DEFAULT_WORLD_SIZES);
    this.settings = resolveSimSettings(config.settings, 'combat');
    this.reward = { ...DEFAULT_REWARD_CONFIG, ...(config.reward ?? {}) };
    this.killTargetRange = config.killTargetRange ?? [10, 25];
    this.randomizeLayout = config.randomizeLayout ?? true;
    this.dr = config.randomize ?? { enabled: false, pct: 0 };
    this.maxTicks = config.maxTicks ?? 60 * 60 * 8;
    this.decisionInterval = Math.max(1, Math.trunc(config.decisionInterval ?? 1));
    this.observationVersion = Math.max(1, Math.trunc(config.observationVersion ?? 1));
    this.obsDim = obsDimForVersion(this.observationVersion);
    this.loneWolfRewardScale = Math.max(0, Number.isFinite(config.loneWolfRewardScale ?? 1)
      ? Number(config.loneWolfRewardScale ?? 1)
      : 1);
    this.scriptedOpponentPolicy = config.scriptedOpponentProfile
      ? passiveBaitPolicyFor(config.scriptedOpponentProfile)
      : null;
    const baseSeed = config.baseSeed ?? 1;

    let offset = 0;
    sizes.forEach((size, i) => {
      this.worlds.push({
        index: i,
        size,
        offset,
        baseSeed: baseSeed + i * 100003,
        episode: 0,
        state: null as unknown as SimState,
        memory: null as unknown as RewardMemory,
        settings: this.settings,
        layoutRng: createRng(baseSeed + i * 100003),
        fixedTeamSizes: layouts?.[i],
      });
      offset += size;
    });
    this.numAgents = offset;

    // Stable global ids; teams are filled after the first build.
    this.agentIds = [];
    for (const w of this.worlds) {
      for (let j = 0; j < w.size; j++) this.agentIds.push(`w${w.index}_c${j}`);
    }
    this.learnerAgentIndices = inferLearnerAgentIndices(this.worlds, Boolean(this.scriptedOpponentPolicy));

    const n = this.numAgents;
    this.obsBuf = new Float32Array(n * this.obsDim);
    this.rewardBuf = new Float32Array(n);
    this.doneBuf = new Uint8Array(n);
    this.truncatedBuf = new Uint8Array(n);
    this.terminalObs = new Array(n).fill(null);
    this.rewardComponentBuf = new Float32Array(REWARD_COMPONENT_KEYS.length);
    this.agentTeams = inferAgentTeams(this.worlds);
  }

  getWorldTeamSizes(): number[][] {
    return this.worlds.map((w) => w.state.combatants.reduce((sizes, combatant) => {
      const idx = Number(combatant.team.slice(1));
      sizes[idx] = (sizes[idx] ?? 0) + 1;
      return sizes;
    }, [] as number[]));
  }

  /** Sample a layout for a world from its layout RNG (or a fixed default). */
  private sampleLayout(w: World): { teamSizes: number[]; killTarget: number } {
    if (w.fixedTeamSizes) {
      const killTarget = this.randomizeLayout
        ? w.layoutRng.int(this.killTargetRange[0], this.killTargetRange[1])
        : this.killTargetRange[1];
      return { teamSizes: w.fixedTeamSizes, killTarget };
    }
    if (!this.randomizeLayout) {
      return { teamSizes: Array(w.size).fill(1), killTarget: this.killTargetRange[1] };
    }
    const parts = allowedPartitions(w.size);
    const teamSizes = parts[w.layoutRng.int(0, parts.length - 1)];
    const killTarget = w.layoutRng.int(this.killTargetRange[0], this.killTargetRange[1]);
    return { teamSizes, killTarget };
  }

  /** (Re)create a world's match with a freshly sampled layout. */
  private makeWorld(w: World): void {
    const { teamSizes, killTarget } = this.sampleLayout(w);
    const seed = w.baseSeed + w.episode * 999983;
    w.settings = randomizeSettings(this.settings, this.dr, createRng(seed ^ 0x85ebca6b));
    w.state = createMatch({
      seed,
      mode: 'combat',
      combat: { teamSizes, killTarget },
      settings: w.settings,
    });
    w.memory = initRewardMemory(w.state);
    // Record current teams for the header (informational only; self-play ignores them).
    for (let j = 0; j < w.size; j++) this.agentTeams[w.offset + j] = w.state.combatants[j].team as TeamId;
  }

  private encodeWorldObs(w: World): void {
    for (let j = 0; j < w.size; j++) {
      encodeObservationForVersion(
        w.state,
        w.state.combatants[j].id,
        this.obsBuf,
        (w.offset + j) * this.obsDim,
        this.observationVersion
      );
    }
  }

  reset(): Float32Array {
    for (const w of this.worlds) {
      w.episode = 0;
      this.makeWorld(w);
      this.encodeWorldObs(w);
    }
    return this.obsBuf;
  }

  step(actions: Int32Array): VecStepResult {
    this.rewardComponentBuf.fill(0);
    for (const w of this.worlds) {
      for (let j = 0; j < w.size; j++) {
        const g = w.offset + j;
        this.rewardBuf[g] = 0;
        this.doneBuf[g] = 0;
        this.truncatedBuf[g] = 0;
        this.terminalObs[g] = null;
      }

      // Repeat the action block for decisionInterval ticks (re-decoded each tick so
      // relative aim tracks and dead agents idle); a match ending mid-interval stops early.
      for (let k = 0; k < this.decisionInterval; k++) {
        const state = w.state;
        const byId: Record<string, ReturnType<typeof decodeAction>> = {};
        for (let j = 0; j < w.size; j++) {
          const combatant = state.combatants[j];
          const id = combatant.id;
          byId[id] = this.scriptedOpponentPolicy && combatant.team !== 't0'
            ? this.scriptedOpponentPolicy(state, id, w.layoutRng)
            : decodeAction(actions, state, id, (w.offset + j) * this.actDim);
        }

        const details = computeActionDisciplineRewards(state, this.reward, w.memory, byId);
        const events = stepSimulation(state, byId, { settings: w.settings });
        mergeRewardDetails(details, computeStepRewardDetails(state, events, this.reward, w.memory));
        const rewards = details.rewards;
        for (let j = 0; j < w.size; j++) {
          const c = state.combatants[j];
          const scale = this.rewardScaleFor(w, c.team);
          this.rewardBuf[w.offset + j] += (rewards[c.id] ?? 0) * scale;
        }
        REWARD_COMPONENT_KEYS.forEach((key, i) => {
          this.rewardComponentBuf[i] += details.components[key];
        });

        const truncated = !events.matchEnded && state.tick >= this.maxTicks;
        const done = events.matchEnded || truncated;
        if (done) {
          for (let j = 0; j < w.size; j++) {
            const g = w.offset + j;
            const term = new Float32Array(this.obsDim);
            encodeObservationForVersion(state, state.combatants[j].id, term, 0, this.observationVersion);
            this.terminalObs[g] = term;
            this.doneBuf[g] = 1;
            this.truncatedBuf[g] = truncated ? 1 : 0;
          }
          w.episode += 1;
          this.makeWorld(w);
          break;
        }
      }
      this.encodeWorldObs(w);
    }

    return {
      obs: this.obsBuf,
      reward: this.rewardBuf,
      done: this.doneBuf,
      truncated: this.truncatedBuf,
      info: { terminalObs: this.terminalObs },
      rewardComponents: this.rewardComponentBuf,
    };
  }

  /** Read-only access to a world's live state (Watch tab / debug). */
  getState(index: number): SimState {
    return this.worlds[index].state;
  }

  private rewardScaleFor(w: World, team: TeamId): number {
    if (this.loneWolfRewardScale === 1) return 1;
    const teamSizes = w.fixedTeamSizes;
    if (!teamSizes || teamSizes.length < 2) return 1;
    const singletonTeams = teamSizes.filter((size) => size === 1).length;
    if (singletonTeams !== 1) return 1;
    const idx = Number(team.slice(1));
    return teamSizes[idx] === 1 ? this.loneWolfRewardScale : 1;
  }
}

function normalizeWorldLayouts(layouts: number[][] | undefined): number[][] | undefined {
  if (!layouts?.length) return undefined;
  return layouts
    .map((layout) => layout.map((size) => Math.max(1, Math.trunc(size))))
    .filter((layout) => layout.length >= 2 && layout.reduce((n, size) => n + size, 0) >= 2);
}

function inferLearnerAgentIndices(worlds: World[], scriptedOpponents: boolean): number[] {
  const out: number[] = [];
  for (const w of worlds) {
    const learnerCount = scriptedOpponents && w.fixedTeamSizes?.length
      ? Math.max(1, w.fixedTeamSizes[0])
      : w.size;
    for (let j = 0; j < learnerCount; j++) out.push(w.offset + j);
  }
  return out;
}

function inferAgentTeams(worlds: World[]): string[] {
  const teams: string[] = [];
  for (const w of worlds) {
    if (w.fixedTeamSizes?.length) {
      let cursor = w.offset;
      for (let t = 0; t < w.fixedTeamSizes.length; t++) {
        for (let i = 0; i < w.fixedTeamSizes[t]; i++) teams[cursor++] = `t${t}`;
      }
      continue;
    }
    for (let j = 0; j < w.size; j++) teams[w.offset + j] = 't0';
  }
  return teams;
}
