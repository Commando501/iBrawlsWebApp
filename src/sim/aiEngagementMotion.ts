import * as THREE from 'three';
import type { UniversalSettings } from '../types';
import { integrateTargetEngagementGravityForCombatant } from '../components/grifball/aiEngagementFrameRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../components/grifball/aiAirborneRecoveryRuntime';
import { recoverCombatantAltitude } from '../components/grifball/altitudeRecovery';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { GRAVITY_ACCELERATION } from '../components/grifball/combatGeometry';
import type { SimCombatant, SimState } from './simState';

/** Mechanical projection only; decision/reload state stays with the policy owner. */
function motionFrame(state: SimState, actor: SimCombatant, settings: UniversalSettings) {
  const pos = new THREE.Vector3(actor.pos.x, actor.pos.y, actor.pos.z);
  const vel = new THREE.Vector3(actor.vel.x, actor.vel.y, actor.vel.z);
  const self = { id: actor.id, isLunging: actor.isLunging, isJumping: actor.isJumping,
    aiHammerJumpsInAir: actor.hammerJumpsInAir, aiHammerJumpCooldownTimer: actor.aiHammerJumpCooldownTimer,
    hammerJumpWindowTimer: actor.hammerJumpWindowTimer };
  let recovered = false, grounded = false;
  const recover = () => {
    const result = recoverCombatantAltitude(settings, self, pos, vel);
    recovered ||= result;
    return result;
  };
  const constrain = () => { grounded = constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: state.map, arenaRadius: state.map.arenaRadius }).grounded; };
  const adopt = () => {
    Object.assign(actor.pos, pos); Object.assign(actor.vel, vel);
    actor.isJumping = self.isJumping; actor.hammerJumpsInAir = self.aiHammerJumpsInAir;
    actor.hammerJumpWindowTimer = self.hammerJumpWindowTimer;
    if (self.aiHammerJumpCooldownTimer !== undefined) actor.aiHammerJumpCooldownTimer = self.aiHammerJumpCooldownTimer;
    if (recovered) {
      actor.weaponState = 'idle'; actor.weaponPhaseElapsed = actor.weaponTimer = 0; actor.attackKind = 'none';
    }
    actor.grounded = grounded || actor.pos.y <= .0001;
  };
  return { self, pos, vel, recover, constrain, adopt };
}

/** After objective handoff and before target/combat policy. Flights retain their
 * existing integration owner. The caller must finish recovery before walking. */
export function prepareSimAIEngagementMotion(state: SimState, actor: SimCombatant, settings: UniversalSettings, dt: number): void {
  if (actor.isLunging) return;
  const f = motionFrame(state, actor, settings);
  integrateTargetEngagementGravityForCombatant({ self: f.self,
    frame: { pos: f.pos, vel: f.vel, aiState: undefined, timer: undefined,
      dashCooldownTimer: actor.dashCooldownTimer, slideCooldownTimer: actor.slideCooldownTimer,
      hammerJumpCooldownTimer: actor.aiHammerJumpCooldownTimer },
    dt, gravityAcceleration: GRAVITY_ACCELERATION, recoverCombatantAltitude: f.recover, constrainCombatantToArena: f.constrain });
  f.adopt();
}

/** Returns true when airborne recovery owns movement and walking must stop.
 * Gravity has already advanced; this stage damps and constrains, never re-integrates. */
export function finishSimAIEngagementMotion(state: SimState, actor: SimCombatant, settings: UniversalSettings, dt: number): boolean {
  if (actor.isLunging) return false;
  const f = motionFrame(state, actor, settings);
  const mode = resolvePreGroundMovementRecoveryForCombatant({ self: f.self, pos: f.pos, vel: f.vel, dt,
    // The grounded branch pins vertical velocity before its dormant air-sway
    // check. No movement-personality defaults are being selected here.
    movementComplexity: 0, swayTimer: 0, toTarget: new THREE.Vector3(),
    recoverCombatantAltitude: f.recover, constrainCombatantToArena: f.constrain });
  f.adopt();
  return mode === 'sync_return';
}
