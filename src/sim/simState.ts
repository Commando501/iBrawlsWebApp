/**
 * Serializable simulation state. A `SimState` plus a seed and an action sequence
 * fully determines a match — it carries no THREE objects, DOM refs, or React state,
 * only plain numbers / strings / {@link Vec3}, so it can be hashed, snapshotted, and
 * compared byte-for-byte for the determinism tests.
 *
 * `SimCombatant` is a Vec3-based mirror of the live {@link Combatant} (src/types.ts)
 * stripped of React/THREE coupling and rendering-only fields (camera, VFX, nameplates).
 */

import { type CustomMapData, type UniversalSettings } from '../types';
import { type Vec3 } from '../game/grifballBall';
import { type TeamId, type TeamScoresState } from '../game/teamScoring';
import { type GrifballMatchState } from '../game/grifballMatch';
import { type GoalPlate } from '../game/grifballGoals';

export type SimWeapon = 'hammer' | 'sword' | 'ball';

/**
 * Game mode the match is running. `grifball` = carry the ball to the enemy plate;
 * `combat` = deathmatch (1v1 / team / FFA), first team to the kill target wins. Both
 * share the engine (movement, weapons, collision, respawns); only the objective +
 * win condition + a couple of observation/reward terms differ.
 */
export type SimMode = 'grifball' | 'combat';

/**
 * Weapon FSM phase. Mirrors the subset of the live `WeaponState` the headless
 * weapon step needs; rendering-only sub-phases are collapsed.
 */
export type SimWeaponState = 'idle' | 'windup' | 'active' | 'recovering' | 'swapping';

export interface SimCombatant {
  // Identity / teams
  id: string;
  team: TeamId;
  /** 'ai' | 'remote' in the live game; here it is just bookkeeping for policies. */
  controller: 'ai' | 'remote';

  // Physics / pose
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  isCrouching: boolean;
  isJumping: boolean;
  /** Vertical velocity tracked separately from the planar move for jump/gravity. */
  grounded: boolean;

  // Vitals
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  invulnerabilityTimer: number;

  // Weapon
  weapon: SimWeapon;
  weaponState: SimWeaponState;
  /** Seconds remaining in the current weaponState phase. */
  weaponTimer: number;
  /** Seconds remaining before a weapon swap is permitted again. */
  swapLockoutTimer: number;
  /** Seconds remaining before this combatant can attack again (cooldown). */
  attackCooldown: number;

  // Movement mechanics
  dashCooldownTimer: number;
  dashRemaining: number;
  dashDir: Vec3;
  slideActive: boolean;
  slideCooldownTimer: number;
  isSprinting: boolean;

  // Which attack is mid-swing, resolved on the active frame.
  //  strike = hammer primary AoE · swipe = hammer alt · slash = sword primary · punch = ball
  attackKind: 'none' | 'strike' | 'swipe' | 'slash' | 'punch';
  /** Tick of this combatant's last landed attack (for the weapon-trade window). */
  lastAttackTick: number;
  /** Seconds left before a freshly-swapped/spawned weapon can attack (`weaponReadyTime`). */
  weaponReadyTimer: number;

  // Hammer-jump: a hammer strike near self opens a window; jumping in it launches high.
  hammerJumpWindowTimer: number;
  hammerJumpsInAir: number;

  // Grifball pass charge: held to wind up a throw (`grifballChargeMax`).
  passChargeTimer: number;
  /** Runner healing delay timer while this combatant carries the ball. */
  runnerHealDelayTimer: number;
  /** Last observed runner HP, used to detect damage and restart healing delay. */
  runnerLastHp: number;

  // Sword lunge flight
  isLunging: boolean;
  lungeTimer: number;
  lungeDir: Vec3;

  // Objective
  /** True while this combatant carries the Grifball (mirror of ball.holderId). */
  hasBall: boolean;
}

export interface SimState {
  /** Which game mode this match is. */
  mode: SimMode;
  /** Fixed-order combatant list. Order is stable for the life of the match. */
  combatants: SimCombatant[];
  /**
   * Phase machine + ball. Reused for both modes: in combat the ball is inert and
   * `goalTarget` is interpreted as the kill target.
   */
  match: GrifballMatchState;
  /** Per-team score / kills / goals (reused live module). */
  scores: TeamScoresState;
  /** Effective (possibly domain-randomized) settings for this match — drives the
   * mechanics-aware observation so the policy can condition on the current balance. */
  settings: UniversalSettings;
  /** Map geometry + goal plates (resolved once at match creation). */
  map: CustomMapData;
  goalPlates: GoalPlate[];
  /** Team spawn clusters, resolved from the map at creation. */
  spawns: Record<TeamId, Vec3[]>;
  /** Monotonic tick counter (fixed 1/60 s steps). */
  tick: number;
  /** Seed the match was created with (for snapshot / reproduction). */
  seed: number;
  /** Current RNG internal state, snapshotted alongside everything else. */
  rngState: number;
}

/** Look up a combatant by id (linear scan — rosters are tiny, ≤8). */
export function findCombatant(state: SimState, id: string): SimCombatant | undefined {
  return state.combatants.find((c) => c.id === id);
}

/** Live (alive, not awaiting respawn) combatants. */
export function aliveCombatants(state: SimState): SimCombatant[] {
  return state.combatants.filter((c) => c.alive);
}

/** Combatants on a given team. */
export function teamCombatants(state: SimState, team: TeamId): SimCombatant[] {
  return state.combatants.filter((c) => c.team === team);
}
