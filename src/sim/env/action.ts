/**
 * Factorized **discrete** action space and its decode into the engine's `ActionInput`.
 * Each agent emits one small int per factor; `decodeAction` resolves the context-relative
 * factors (aim toward ball / enemy goal, ego-relative 8-way move) against `SimState`.
 *
 * `ACTION_FACTORS` / `ACTION_NVEC` are the single source of truth for the action shape
 * and are mirrored on the Python side via the handshake header.
 */

import { type SimState, type SimCombatant } from '../simState';
import { type ActionInput, idleAction } from '../actions';
import { enemyGoalForTeam } from '../../game/aiGrifballRoles';

/** One discrete factor: a name and its number of choices. */
export interface ActionFactor {
  name: string;
  n: number;
}

/**
 * Factors (order is the wire order):
 *  - move: idle + 8 ego-relative directions (forward..forward-left)
 *  - aim: hold / toward-ball / toward-enemy-goal / nearest hostile
 *  - attack: none / primary / secondary / pickup
 *  - jump / dash / swap: off / on
 */
export const ACTION_FACTORS: ActionFactor[] = [
  { name: 'move', n: 9 },
  { name: 'aim', n: 4 },
  { name: 'attack', n: 4 },
  { name: 'jump', n: 2 },
  { name: 'dash', n: 2 },
  { name: 'swap', n: 2 },
];

/** MultiDiscrete nvec — choices per factor. */
export const ACTION_NVEC: number[] = ACTION_FACTORS.map((f) => f.n);
/** Number of discrete factors per agent (= int32s per agent on the wire). */
export const ACTION_DIM = ACTION_FACTORS.length;

/** Ego-relative move table: [forwardComponent, rightComponent]. Index 0 = idle. */
const MOVE_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],           // forward
  [Math.SQRT1_2, Math.SQRT1_2],   // forward-right
  [0, 1],           // right
  [-Math.SQRT1_2, Math.SQRT1_2],  // back-right
  [-1, 0],          // back
  [-Math.SQRT1_2, -Math.SQRT1_2], // back-left
  [0, -1],          // left
  [Math.SQRT1_2, -Math.SQRT1_2],  // forward-left
];

const enum AimMode {
  Hold = 0,
  TowardBall = 1,
  TowardEnemyGoal = 2,
  TowardNearestEnemy = 3,
}

const enum AttackMode {
  None = 0,
  Primary = 1,
  Secondary = 2,
  Pickup = 3,
}

/**
 * Yaw whose forward axis points along world (dx, dz).
 * Engine forward = (sin yaw, cos yaw), so facing (dx,dz) ⇒ yaw = atan2(dx, dz)
 * (the live game's facing convention).
 */
export function yawToFace(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/** Clamp a factor int into its valid range (defensive against malformed input). */
function clampFactor(v: number, n: number): number {
  if (!Number.isFinite(v)) return 0;
  const i = Math.trunc(v);
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Decode one agent's `factors` (length {@link ACTION_DIM}) into an `ActionInput`,
 * resolving context-relative aim/move against `state`. Dead agents decode to idle.
 */
export function decodeAction(
  factors: ArrayLike<number>,
  state: SimState,
  agentId: string,
  offset = 0
): ActionInput {
  const self = state.combatants.find((c) => c.id === agentId);
  if (!self || !self.alive) return idleAction();

  const move = clampFactor(factors[offset], 9);
  const aim = clampFactor(factors[offset + 1], 4);
  const attack = clampFactor(factors[offset + 2], 4);
  const jump = clampFactor(factors[offset + 3], 2) === 1;
  const dash = clampFactor(factors[offset + 4], 2) === 1;
  const swap = clampFactor(factors[offset + 5], 2) === 1;

  const a = idleAction();
  const [mf, mr] = MOVE_TABLE[move];
  a.moveZ = mf; // forward component
  a.moveX = mr; // right component

  a.aim = resolveAim(aim, self, state);
  a.attackPrimary = attack === AttackMode.Primary;
  a.attackSecondary = attack === AttackMode.Secondary;
  a.pickup = attack === AttackMode.Pickup;
  // A full-charge pass when the carrier uses secondary.
  a.passCharge = a.attackSecondary && self.hasBall ? 1 : 0;
  a.jump = jump;
  a.dash = dash;
  a.crouch = false;
  a.swapWeapon = swap;
  return a;
}

function resolveAim(mode: number, self: SimCombatant, state: SimState): number {
  if (mode === AimMode.TowardBall) {
    const b = state.match.ball;
    return yawToFace(b.pos.x - self.pos.x, b.pos.z - self.pos.z);
  }
  if (mode === AimMode.TowardEnemyGoal) {
    const g = enemyGoalForTeam(self.team, state.goalPlates);
    if (g) return yawToFace(g.position.x - self.pos.x, g.position.z - self.pos.z);
  }
  if (mode === AimMode.TowardNearestEnemy) {
    const enemy = nearestEnemy(self, state);
    if (enemy) return yawToFace(enemy.pos.x - self.pos.x, enemy.pos.z - self.pos.z);
  }
  return self.yaw; // hold
}

function nearestEnemy(self: SimCombatant, state: SimState): SimCombatant | null {
  let best: SimCombatant | null = null;
  let bestDist = Infinity;
  for (const c of state.combatants) {
    if (!c.alive || c.team === self.team) continue;
    const d = Math.hypot(c.pos.x - self.pos.x, c.pos.z - self.pos.z);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Decode a flat `Int32`-style block of `numAgents × ACTION_DIM` factors (the wire layout)
 * into an `ActionsById` for `agentIds` (roster order). Used by the vec-env / server.
 */
export function decodeActionBlock(
  block: ArrayLike<number>,
  agentIds: string[],
  state: SimState
): Record<string, ActionInput> {
  const out: Record<string, ActionInput> = {};
  for (let i = 0; i < agentIds.length; i++) {
    out[agentIds[i]] = decodeAction(block, state, agentIds[i], i * ACTION_DIM);
  }
  return out;
}
