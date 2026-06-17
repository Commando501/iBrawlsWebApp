/**
 * Scripted Grifball baseline — a faithful thin re-derivation of the live FSM AI's intent
 * (the real `aiCombatDecision`/`aiGrifballRoles` brain is too coupled to the React/runtime
 * state to lift directly, per the plan). It plays real objective Grifball:
 *
 *   - carry the ball to the enemy goal;
 *   - the closest teammate chases a free ball, others push toward the enemy goal;
 *   - chase the enemy carrier;
 *   - swing at any hostile inside melee reach.
 *
 * It is the bootstrap opponent and the benchmark the learner must beat (Verification #6/#7),
 * and it is the built-in opponent the vec-env exposes so Python can request "play vs
 * heuristic" without shipping a policy.
 */

import { type Policy } from './policy';
import { type SimState, type SimCombatant } from '../simState';
import { type ActionInput, idleAction } from '../actions';
import { yawToFace } from '../env/action';
import { enemyGoalForTeam } from '../../game/aiGrifballRoles';
import { MELEE_HAMMER_SWIPE_REACH } from '../../components/grifball/combatGeometry';

/** Engage hostiles inside this planar distance. */
const ATTACK_RANGE = MELEE_HAMMER_SWIPE_REACH;
/** Close long gaps with a dash when this far from the objective. */
const DASH_GAP = 10;

function dist2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function nearestHostile(state: SimState, self: SimCombatant): SimCombatant | null {
  let best: SimCombatant | null = null;
  let bestD = Infinity;
  for (const c of state.combatants) {
    if (!c.alive || c.team === self.team) continue;
    const d = dist2D(self.pos, c.pos);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Closest living teammate (incl. self) to a point — decides who chases a free ball. */
function isClosestToPoint(state: SimState, self: SimCombatant, p: { x: number; z: number }): boolean {
  const myD = dist2D(self.pos, p);
  for (const c of state.combatants) {
    if (!c.alive || c.team !== self.team || c.id === self.id) continue;
    if (dist2D(c.pos, p) < myD) return false;
  }
  return true;
}

export const heuristicPolicy: Policy = (state, agentId, rng) => {
  const self = state.combatants.find((c) => c.id === agentId);
  if (!self || !self.alive) return idleAction();

  const a = idleAction();
  const ball = state.match.ball;
  const enemyGoal = enemyGoalForTeam(self.team, state.goalPlates);
  const enemyGoalPos = enemyGoal ? enemyGoal.position : { x: 0, z: 0 };
  const holder = ball.holderId ? state.combatants.find((c) => c.id === ball.holderId) : null;

  // --- Choose a navigation target by role ---
  let nav: { x: number; z: number };
  if (self.hasBall) {
    nav = enemyGoalPos; // carry to score
  } else if (!holder) {
    // Free ball: closest teammate fetches it; others advance to set up.
    const fetcher = isClosestToPoint(state, self, ball.pos);
    nav = fetcher ? ball.pos : enemyGoalPos;
    a.pickup = fetcher;
  } else if (holder.team !== self.team) {
    nav = holder.pos; // chase the enemy carrier
  } else {
    nav = enemyGoalPos; // escort our carrier toward the goal
  }

  // --- Combat overlay: a hostile in reach takes priority for facing + a swing ---
  const enemy = nearestHostile(state, self);
  const enemyD = enemy ? dist2D(self.pos, enemy.pos) : Infinity;
  let aimTarget = nav;
  if (enemy && enemyD <= ATTACK_RANGE) {
    aimTarget = enemy.pos; // face the threat so the swing connects
    a.attackPrimary = true;
  } else if (self.hasBall && enemy && enemyD <= ATTACK_RANGE + 1) {
    // Carrier punches a blocker without turning fully away from the goal.
    a.attackPrimary = true;
  }

  a.aim = yawToFace(aimTarget.x - self.pos.x, aimTarget.z - self.pos.z);
  // Advance toward whatever we're facing.
  a.moveZ = 1;
  a.moveX = 0;

  // Dash to close large gaps to the objective (when ready), with a little jitter.
  const navD = dist2D(self.pos, nav);
  if (navD > DASH_GAP && self.dashCooldownTimer <= 0 && rng.chance(0.15)) {
    a.dash = true;
  }

  return a;
};
