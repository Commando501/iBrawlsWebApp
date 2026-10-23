import * as THREE from 'three';
import { isTeamAimAttackPending, planTeamSafeAim, teamAimImpactDelay } from '../game/aiTeamSafeAim';
import { beginPunch } from '../game/ballPunch';
import { AI_CROUCH_SPEED_MULTIPLIER } from '../game/aiMovementMechanics';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import type { SimCombatant, SimState } from './simState';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';

export interface TeamAimTurnStart { x: number; z: number; vy: number; lunging: boolean }

/** Autonomous owner only. Authored weapon tests, player inputs and already
 * committed flight collisions still use the unmodified damage implementation. */
export function applySimTeamSafeAim(state: SimState, actor: SimCombatant, memory: SimCombatPriorityMemory,
  start: TeamAimTurnStart, dt: number, isObserverMode: boolean, targetId?: string) {
  if (actor.isLunging && start.lunging || !actor.alive || actor.hp <= 0 || state.match.phase !== 'playing') return false;
  const phase = actor.weaponState === 'windup' || actor.weaponState === 'active'
    ? `${actor.attackKind === 'swipe' ? 'melee' : 'swing'}_${actor.weaponState === 'windup' ? 'up' : 'down'}` : 'ready';
  const attacking = isTeamAimAttackPending(actor.weapon, phase);
  const plan = planTeamSafeAim({ self: actor, bodies: state.combatants.filter(c => c.alive && c.hp > 0 && c.respawnTimer <= 0 &&
    !(isObserverMode && c.id === state.localPlayerId)), settings: state.settings, weapon: actor.weapon,
    heading: actor.isLunging ? actor.lungeDir : { x: Math.sin(actor.yaw), y: 0, z: Math.cos(actor.yaw) },
    targetId, attacking, lunge: actor.isLunging, downward: !!actor.hammerJumpPlanned, punchAttack: actor.punchAttack,
    impactIn: teamAimImpactDelay(state.settings, actor.weapon, phase, actor.weaponPhaseElapsed ?? 0),
    map: state.map, arenaRadius: state.map.arenaRadius });
  if (plan.kind === 'aim') {
    actor.yaw = Math.atan2(plan.heading.x, plan.heading.z);
    if (actor.isLunging) actor.lungeDir = { ...plan.heading };
    else if (actor.weapon === 'ball' && attacking) {
      actor.punchAttack = beginPunch({ ...actor, heading: plan.heading, eyeHeight: actor.isCrouching ? .9 : 1.2 }, [], state.settings);
    }
  } else if (plan.kind === 'hold' || plan.kind === 'reposition') {
    const cancelled = actor.isLunging || attacking;
    if (cancelled) {
      if (actor.isLunging) { actor.vel.y = Math.min(actor.vel.y, start.vy); actor.isJumping = actor.pos.y > .01 || actor.vel.y > .01; }
      actor.isLunging = false; actor.lungeTimer = 0;
      actor.weaponState = 'idle'; actor.weaponTimer = actor.weaponPhaseElapsed = 0; actor.attackKind = 'none';
      actor.hammerJumpPlanned = false; delete actor.punchAttack;
      memory.aiState = 'SIDE_STEPPING'; memory.timer = .15;
    }
    if (!start.lunging && !actor.isJumping && actor.pos.y <= .01 && actor.dashRemaining <= 0 && !actor.slideActive) {
      const dx = plan.kind === 'reposition' ? plan.destination.x - actor.pos.x : 0;
      const dz = plan.kind === 'reposition' ? plan.destination.z - actor.pos.z : 0;
      const length = Math.hypot(dx, dz);
      const speed = Math.min(3.5 * state.settings.speedSide / 100 * (actor.isCrouching ? AI_CROUCH_SPEED_MULTIPLIER : 1), length / Math.max(dt, .001));
      actor.vel.x = length > .001 ? dx / length * speed : 0;
      actor.vel.z = length > .001 ? dz / length * speed : 0;
      actor.pos.x = start.x + actor.vel.x * dt; actor.pos.z = start.z + actor.vel.z * dt;
      const pos = new THREE.Vector3(actor.pos.x, actor.pos.y, actor.pos.z), vel = new THREE.Vector3(actor.vel.x, actor.vel.y, actor.vel.z);
      constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: state.map, arenaRadius: state.map.arenaRadius });
      Object.assign(actor.pos, pos); Object.assign(actor.vel, vel); actor.isSprinting = false;
    }
    return cancelled;
  }
  return false;
}
