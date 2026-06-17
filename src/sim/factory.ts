/**
 * Match construction. `createMatch` builds a fully-initialized {@link SimState} from
 * a seed, settings, map, and team sizes — reusing the live defaults
 * (`DEFAULT_ADMIN_SETTINGS`), the championship Grifball arena (`premadeMaps`), and
 * the pure objective modules so the sim starts from the same configuration the real
 * game does.
 */

import { type CustomMapData, type UniversalSettings } from '../types';
import { type Vec3, BALL_REST_Y } from '../game/grifballBall';
import { type TeamId, PLAYER_TEAM, DEFAULT_AI_TEAM, createEmptyTeamScores } from '../game/teamScoring';
import { createInitialGrifballMatchState } from '../game/grifballMatch';
import { getGoalPlates, type GoalPlate } from '../game/grifballGoals';
import { resolveGrifballTeam } from '../game/grifballTeams';
import { toGrifballArena } from '../game/grifballMaps';
import { PREMADE_MAPS } from '../game/premadeMaps';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { createRng, normalizeSeed } from './rng';
import {
  type SimState,
  type SimCombatant,
  type SimWeapon,
  type SimMode,
} from './simState';

/** Default kill target for a combat match (mirrors the tournament default). */
export const DEFAULT_KILL_TARGET = 25;

export interface CreateMatchOptions {
  seed: number;
  /** Combatants per team. Default 4v4. blue includes the human-slot id 'player'. */
  teamSizes?: { blue: number; red: number };
  /** Settings override; merged over `DEFAULT_ADMIN_SETTINGS` (grifball forced). */
  settings?: Partial<UniversalSettings>;
  /** Map override; defaults to the Championship Stadium Grifball arena. */
  map?: CustomMapData;
  /** Initial weapon for every combatant. Default 'hammer'. */
  startWeapon?: SimWeapon;
  /** Game mode. Default 'grifball'. */
  mode?: SimMode;
  /** Combat-mode layout (ignored for grifball). */
  combat?: CombatLayout;
}

/**
 * Deathmatch layout. `teamSizes` is one entry per team: `[1,1]` = 1v1, `[1,1,1,1]` =
 * 4-player free-for-all, `[4,4]` = 4v4 team deathmatch. First team to `killTarget` wins.
 */
export interface CombatLayout {
  teamSizes: number[];
  killTarget?: number;
  map?: CustomMapData;
}

/** The default Grifball arena (Championship Stadium — goal plates + team spawns). */
export function defaultGrifballMap(): CustomMapData {
  const base =
    PREMADE_MAPS.find((m) => m.id === 'championship_stadium') ??
    PREMADE_MAPS.find((m) => m.theme === 'grifball_stadium');
  if (!base) {
    throw new Error('factory: no grifball_stadium premade map found');
  }
  return toGrifballArena(base);
}

/** A rectangular non-grifball arena for combat matches (deathmatch). */
export function defaultCombatMap(): CustomMapData {
  const base =
    PREMADE_MAPS.find((m) => m.id === 'synthwave_grid_arena') ??
    PREMADE_MAPS.find((m) => m.mapShape === 'rectangular' && m.theme !== 'grifball_stadium') ??
    PREMADE_MAPS[0];
  if (!base) throw new Error('factory: no premade map found for combat');
  return base;
}

/** Resolve effective settings for a sim match. `gameMode` follows the sim mode. */
export function resolveSimSettings(
  override?: Partial<UniversalSettings>,
  mode: SimMode = 'grifball'
): UniversalSettings {
  return {
    ...DEFAULT_ADMIN_SETTINGS,
    ...override,
    gameMode: mode === 'combat' ? 'sandbox' : 'grifball',
  };
}

/**
 * Build the stable, ordered combatant id list for a match. Mirrors the live
 * Grifball roster ids ('player', 'main_ai', 'bot_2'…) so `resolveGrifballTeam`
 * assigns the same teams the real game would.
 */
export function buildCombatantIds(teamSizes: { blue: number; red: number }): string[] {
  const total = teamSizes.blue + teamSizes.red;
  const ids: string[] = ['player'];
  // main_ai is AI slot 0; bot_2 onwards follow. resolveGrifballTeam splits them.
  const aiIds = ['main_ai'];
  for (let i = 2; aiIds.length < total - 1; i++) aiIds.push(`bot_${i}`);
  return [...ids, ...aiIds];
}

/** Spawn clusters keyed by team, pulled from the (grifball-shaped) map. */
function resolveSpawns(map: CustomMapData): Record<TeamId, Vec3[]> {
  const toVec = (p: { x: number; y: number; z: number }): Vec3 => ({ x: p.x, y: p.y, z: p.z });
  const spawns: Record<TeamId, Vec3[]> = {} as Record<TeamId, Vec3[]>;
  if (map.teamSpawns) {
    for (const [team, pts] of Object.entries(map.teamSpawns)) {
      spawns[team] = pts.map(toVec);
    }
  }
  if (!spawns[PLAYER_TEAM]?.length) spawns[PLAYER_TEAM] = map.spawnPoints.map(toVec);
  if (!spawns[DEFAULT_AI_TEAM]?.length) spawns[DEFAULT_AI_TEAM] = map.spawnPoints.map(toVec);
  return spawns;
}

/**
 * Inward spawn facing — the live game's `getInwardSpawnYaw = atan2(x, z)`. With
 * forward = (sin yaw, cos yaw) this points the combatant from its spawn toward field
 * center (and thus the enemy goal beyond it).
 */
export function inwardSpawnYaw(spawn: Vec3): number {
  return Math.atan2(spawn.x, spawn.z);
}

function createCombatant(
  id: string,
  team: TeamId,
  spawn: Vec3,
  settings: UniversalSettings,
  weapon: SimWeapon
): SimCombatant {
  const maxHp = settings.maxHP ?? 1;
  return {
    id,
    team,
    controller: id === 'player' ? 'remote' : 'ai',
    pos: { x: spawn.x, y: 0, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: inwardSpawnYaw(spawn),
    isCrouching: false,
    isJumping: false,
    grounded: true,
    hp: maxHp,
    maxHp,
    alive: true,
    respawnTimer: 0,
    invulnerabilityTimer: 0,
    weapon,
    weaponState: 'idle',
    weaponTimer: 0,
    swapLockoutTimer: 0,
    attackCooldown: 0,
    dashCooldownTimer: 0,
    dashRemaining: 0,
    dashDir: { x: 0, y: 0, z: 0 },
    slideActive: false,
    slideCooldownTimer: 0,
    isSprinting: false,
    attackKind: 'none',
    lastAttackTick: -100000,
    weaponReadyTimer: 0,
    hammerJumpWindowTimer: 0,
    hammerJumpsInAir: 0,
    passChargeTimer: 0,
    runnerHealDelayTimer: 0,
    runnerLastHp: maxHp,
    isLunging: false,
    lungeTimer: 0,
    lungeDir: { x: 0, y: 0, z: 0 },
    hasBall: false,
  };
}

export function createMatch(options: CreateMatchOptions): SimState {
  if (options.mode === 'combat') return buildCombatMatch(options);

  const seed = normalizeSeed(options.seed);
  const teamSizes = options.teamSizes ?? { blue: 4, red: 4 };
  const settings = resolveSimSettings(options.settings);
  const map = options.map ?? defaultGrifballMap();
  const startWeapon = options.startWeapon ?? 'hammer';

  const goalPlates: GoalPlate[] = getGoalPlates(map);
  const spawns = resolveSpawns(map);
  const ids = buildCombatantIds(teamSizes);

  // Per-team running index into the spawn cluster.
  const spawnCursor: Record<TeamId, number> = {} as Record<TeamId, number>;
  const combatants: SimCombatant[] = ids.map((id) => {
    const team = resolveGrifballTeam(id);
    const cluster = spawns[team] ?? [];
    const idx = (spawnCursor[team] = (spawnCursor[team] ?? 0)) % Math.max(1, cluster.length);
    spawnCursor[team] = idx + 1;
    const spawn = cluster[idx] ?? { x: 0, y: 0, z: 0 };
    return createCombatant(id, team, spawn, settings, startWeapon);
  });

  // Ball home is map center on the floor.
  const home: Vec3 = { x: 0, y: BALL_REST_Y, z: 0 };
  const match = createInitialGrifballMatchState(settings, home);
  const scores = createEmptyTeamScores();

  const rng = createRng(seed);

  return {
    mode: 'grifball',
    combatants,
    match,
    scores,
    settings,
    map,
    goalPlates,
    spawns,
    tick: 0,
    seed,
    rngState: rng.getState(),
  };
}

/** Stable combat team ids: 't0', 't1', … (one per entry in `teamSizes`). */
export function combatTeamId(i: number): TeamId {
  return `t${i}`;
}

function buildCombatMatch(options: CreateMatchOptions): SimState {
  const seed = normalizeSeed(options.seed);
  const layout = options.combat ?? { teamSizes: [1, 1] };
  const settings = resolveSimSettings(options.settings, 'combat');
  const map = layout.map ?? options.map ?? defaultCombatMap();
  const startWeapon = options.startWeapon ?? 'hammer';
  const killTarget = layout.killTarget ?? DEFAULT_KILL_TARGET;

  const allSpawns: Vec3[] = map.spawnPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const spawns: Record<TeamId, Vec3[]> = {} as Record<TeamId, Vec3[]>;
  const combatants: SimCombatant[] = [];

  let spawnIdx = 0;
  let memberIdx = 0;
  layout.teamSizes.forEach((size, t) => {
    const team = combatTeamId(t);
    spawns[team] = [];
    for (let k = 0; k < size; k++) {
      const spawn = allSpawns.length ? allSpawns[spawnIdx % allSpawns.length] : { x: 0, y: 0, z: 0 };
      spawnIdx++;
      spawns[team].push(spawn);
      combatants.push(createCombatant(`c${memberIdx}`, team, spawn, settings, startWeapon));
      memberIdx++;
    }
  });

  const home: Vec3 = { x: 0, y: BALL_REST_Y, z: 0 };
  const match = createInitialGrifballMatchState(settings, home);
  match.goalTarget = killTarget; // interpreted as the kill target in combat

  const teamIds = layout.teamSizes.map((_, t) => combatTeamId(t));
  const scores = createEmptyTeamScores(teamIds);

  const rng = createRng(seed);
  return {
    mode: 'combat',
    combatants,
    match,
    scores,
    settings,
    map,
    goalPlates: [],
    spawns,
    tick: 0,
    seed,
    rngState: rng.getState(),
  };
}
