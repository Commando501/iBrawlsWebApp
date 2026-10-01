import * as THREE from 'three';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { resolveAIDashMovementForCombatant } from '../../src/components/grifball/aiDashMovementRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { idleAction } from '../../src/sim/actions';
import type { SimCombatant } from '../../src/sim/simState';
import type { Combatant } from '../../src/types';
import type { createBotParityFixture } from './grifballBotExecutionParity';

type Direction = { x: number; z: number };
/** Authored intent boundaries, never positions copied from the other engine. */
export interface GroundMotion {
  walk?: { tick: number; direction: Direction }[];
  dash?: { tick: number; direction: Direction };
}
const directionAt = (motion: GroundMotion, tick: number) =>
  motion.walk?.filter(s => s.tick <= tick).at(-1)?.direction ?? { x: 0, z: 0 };
const unit = (d: Direction) => {
  const length = Math.hypot(d.x, d.z);
  return length ? { x: d.x / length, z: d.z / length } : { x: 0, z: 0 };
};
/** Authored world-space intent for the explicit scripted objective contract. */
export const groundMotionIntent = (motion: GroundMotion, tick: number) => unit(directionAt(motion, tick));

export function stepLiveGroundMotion(f: ReturnType<typeof createBotParityFixture>, c: Combatant, motion: GroundMotion, tick: number) {
  if (c.hp <= 0 || c.isLunging) return;
  if (motion.dash?.tick === tick) {
    const d = unit(motion.dash.direction);
    c.aiDashDir = { x: d.x, y: 0, z: d.z };
    c.aiDashRemaining = f.state.settings.dashDuration || .25;
    c.aiDashCooldownTimer = f.state.settings.dashCooldown || 2;
  }
  c.aiDashCooldownTimer = Math.max(0, (c.aiDashCooldownTimer ?? 0) - 1 / 60);
  const constrain = (pos: THREE.Vector3, vel: THREE.Vector3) => {
    constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: f.map.arenaRadius });
  };
  if ((c.aiDashRemaining ?? 0) > 0) {
    const frame = { pos: c.pos, vel: c.vel, dashDir: new THREE.Vector3(c.aiDashDir?.x ?? 0, 0, c.aiDashDir?.z ?? 0),
      aiState: c.aiState, dashRemaining: c.aiDashRemaining!, slideActive: false, slideCooldownTimer: 0,
      pendingPostEvasionCharge: false, isSprinting: false };
    resolveAIDashMovementForCombatant({ state: f.state, refs: f.refs, frame, dt: 1 / 60,
      activeWeapon: c.activeWeapon, targetWeaponState: 'ready', attackDistanceToTarget: 20,
      resolvedAiReach: 3, targetProtected: false, spatialIQ: 0, weaponReady: c.weaponState === 'ready' });
    c.aiDashRemaining = frame.dashRemaining;
    constrain(c.pos, c.vel);
    return;
  }
  const d = unit(directionAt(motion, tick));
  const destination = { x: c.pos.x + d.x * 100, z: c.pos.z + d.z * 100 };
  f.state.aiMatchContext.grifballTeamPlan.assignments.set(c.id, {
    botId: c.id, team: c.team!, role: 'safety', slot: 0, destination, anchor: destination,
    carrierId: null, reason: 'Authored acceptance movement',
  });
  const frame = { pos: c.pos, vel: c.vel, yaw: c.yaw, aiState: c.aiState, timer: c.aiTimer ?? 0,
    dashRemaining: 0, slideActive: false, weaponState: c.weaponState ?? 'ready', pickupRequested: false };
  // Suppress autonomous attack/route choices; exercise the actual assigned-area walk.
  const moved = resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state: f.state, botId: c.id, self: c, frame,
    alliesList: [], enemiesList: [], dt: 1 / 60, canStartWeaponAction: false,
    triggerCombatantAttack: () => {}, constrainCombatantToArena: constrain, getEnemyGoalPos: () => null });
  if (!moved) throw new Error('Ground motion fixture requires a grounded, non-carrier roster actor');
  c.yaw = frame.yaw;
}

export function groundMotionAction(c: SimCombatant, motion: GroundMotion, tick: number, aim: number,
  settings: ReturnType<typeof createBotParityFixture>['sim']['settings']) {
  if (c.alive && !c.isLunging && motion.dash?.tick === tick) {
    const d = unit(motion.dash.direction);
    c.dashDir = { x: d.x, y: 0, z: d.z };
    c.dashRemaining = settings.dashDuration || .25;
    c.dashCooldownTimer = settings.dashCooldown || 2;
  }
  const d = unit(directionAt(motion, tick));
  // The objective walker travels at 5.2; generic input travel is 5.8. Rotate the
  // same world intent into the simulator's aim-relative axes, with analog magnitude.
  const scale = 5.2 / 5.8;
  return { ...idleAction(), aim, moveX: (d.x * Math.cos(aim) - d.z * Math.sin(aim)) * scale,
    moveZ: (d.x * Math.sin(aim) + d.z * Math.cos(aim)) * scale };
}
