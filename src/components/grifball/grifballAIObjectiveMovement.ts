import * as THREE from 'three';
import { resolveGrifballCarrierDecision, resolveGrifballSupportSteering } from '../../game/aiGrifballObjectiveSteering';
import { selectGrifballAssignmentThreat } from '../../game/aiGrifballTeamPlan';
import { getGrifballSpaceWaypoint } from '../../game/aiGrifballSpace';
import { resolveDirectionalSpeedMultiplier, resolvePunchCooldown, resolveRunnerThrustAllowed } from '../../game/runnerBallSettings';
import { getYawForHeading } from '../../game/yaw';
import { type AIBehaviorState, type WeaponState, type Combatant } from '../../types';
import { type GrifballAwarenessPoint } from './grifballAITeamAwareness';
import { type GrifballCombatantRef } from './grifballObjectiveRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { observeLiveRunnerSwordThreat } from './runnerClashObservation';
import { getModelTargetRadiusBonus } from './modelHitbox';
import type { RunnerSwordThreat } from '../../game/aiGrifballRunnerClash';
import { resolveGrifballPlayerStyle } from '../../game/grifballPlayerStyles';
import { observeLiveGrifballHammerDefense } from './grifballHammerDefense';
import { resolveScaledAIWeaponReloadTime } from '../../game/aiWeaponTiming';

export interface GrifballAIObjectiveFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: AIBehaviorState | undefined;
  timer: number;
  dashRemaining: number;
  slideActive: boolean;
  weaponState: WeaponState | string;
  pickupRequested: boolean;
}

type CombatantLike = any;
type GroundConstraint = (pos: THREE.Vector3, vel: THREE.Vector3) => void;

export type GrifballAIObjectiveState = Pick<GrifballRuntimeState, 'settings' | 'grifball' |
  'playerHP' | 'playerRespawnTimer' | 'isObserverMode' | 'localPlayerTeam' | 'playerPos' | 'playerInvulnerabilityTimer'> &
  Partial<Pick<GrifballRuntimeState, 'isMultiplayer' | 'playerVel' | 'activeWeapon' | 'pSwordState' | 'pSwordTimer' | 'isLunging' | 'lungeTimer' | 'isCrouching' | 'playerModelType'>> & {
  aiMatchContext: Pick<GrifballRuntimeState['aiMatchContext'], 'grifballTeamPlan'>;
  otherPlayers: ReadonlyMap<string, Pick<Combatant, 'id' | 'hp' | 'respawnTimer' | 'team' | 'pos' | 'invulnerabilityTimer'> &
    Partial<Pick<Combatant, 'vel' | 'activeWeapon' | 'weaponState' | 'weaponTimer' | 'isLunging' | 'lungeTimer' | 'isCrouching' | 'modelType'>>>;
};

const settleAsApproaching = (
  frame: GrifballAIObjectiveFrame,
  resetMobility: boolean,
  dt: number,
): void => {
  frame.pos.y = 0;
  // Objective movement must not erase an attack's reload when returning from combat.
  if (frame.aiState === 'COOLDOWN' && frame.timer > 0) {
    frame.timer = Math.max(0, frame.timer - dt);
  } else {
    frame.aiState = 'APPROACHING';
    frame.timer = 0;
  }
  if (resetMobility) {
    frame.dashRemaining = 0;
    frame.slideActive = false;
  }
};

export function resolvePrimaryGrifballAIObjectiveMovementForCombatant({
  state,
  botId,
  self,
  frame,
  alliesList,
  enemiesList,
  dt,
  canStartWeaponAction,
  triggerCombatantAttack,
  constrainCombatantToArena,
  getEnemyGoalPos,
  tryRunnerEvasion,
}: {
  state: GrifballAIObjectiveState;
  botId: string;
  self: CombatantLike;
  frame: GrifballAIObjectiveFrame;
  alliesList: GrifballAwarenessPoint[];
  enemiesList: GrifballAwarenessPoint[];
  dt: number;
  canStartWeaponAction: boolean;
  triggerCombatantAttack: (self: CombatantLike, weapon: 'hammer' | 'sword', melee?: boolean) => void;
  constrainCombatantToArena: GroundConstraint;
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null;
  /** Commit only the launch; false from this objective function then hands the
   * same frame to the caller's existing committed-dash execution owner. */
  tryRunnerEvasion?: (movement: { x: number; z: number }) => boolean;
}): boolean {
  const hammerDefense = observeLiveGrifballHammerDefense(state, self, frame, canStartWeaponAction, dt);
  if (hammerDefense && hammerDefense.action !== 'continue') {
    frame.pickupRequested = false; frame.vel.set(0, 0, 0);
    frame.yaw = getYawForHeading(hammerDefense.heading!.x, hammerDefense.heading!.z);
    if (hammerDefense.action === 'strike') {
      frame.aiState = 'COOLDOWN'; frame.timer = resolveScaledAIWeaponReloadTime(state.settings, 'hammer', 1);
      triggerCombatantAttack(self, 'hammer'); frame.weaponState = 'swing_up';
    } else frame.timer = Math.max(0, frame.timer - dt);
    return true;
  }
  if (state.settings.gameMode !== 'grifball') return false;
  if (state.grifball.phase !== 'playing') return false;
  if (self.isLunging || self.isJumping || frame.pos.y > 0.01 || frame.vel.y !== 0 || frame.dashRemaining > 0 || frame.slideActive) return false;

  const ball = state.grifball.ball;
  const heldByMe = ball.state === 'held' && ball.holderId === botId;
  const heldByAnyone = ball.state === 'held' && !!ball.holderId;
  const assignment = state.aiMatchContext.grifballTeamPlan.assignments.get(botId);
  if (!heldByMe && assignment && assignment.role !== 'runner') {
    const movement = resolveGrifballSupportSteering({ assignment, pos: frame.pos, allies: alliesList,
      players: state.aiMatchContext.grifballTeamPlan.snapshot?.players ?? [], ball: ball.pos, heldByAnyone,
      separation: state.settings.grifballEscortSpacing ?? 4, speed: 5.2 * (state.settings.speedForward / 100),
      retrySpeed: 5.2 * resolveDirectionalSpeedMultiplier(state.settings, 'forward', false), dt });
    if (!movement) return false;
    frame.pickupRequested = movement.pickupRequested;
    frame.vel.set(movement.velocity.x, 0, movement.velocity.z);
    frame.pos.x += frame.vel.x * dt; frame.pos.z += frame.vel.z * dt;
    if (movement.heading && frame.weaponState === 'ready') frame.yaw = getYawForHeading(movement.heading.x, movement.heading.z);
    settleAsApproaching(frame, true, dt);
    self.isLunging = false;
    constrainCombatantToArena(frame.pos, frame.vel);
    return true;
  }
  if (heldByMe) {
    const threats: { id: string; pos: THREE.Vector3; invulnerabilityTimer?: number }[] = [];
    const clashThreats: RunnerSwordThreat[] = [];
    const clashEnabled = assignment?.tuning?.runnerClashEnabled;
    if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && !state.isObserverMode && state.localPlayerTeam !== self.team) {
      threats.push({ id: 'player', pos: state.playerPos, invulnerabilityTimer: state.playerInvulnerabilityTimer });
      const observed = clashEnabled && observeLiveRunnerSwordThreat('player', {
        pos: state.playerPos, vel: state.playerVel, activeWeapon: state.activeWeapon, weaponState: state.pSwordState,
        weaponTimer: state.pSwordTimer, isLunging: state.isLunging, lungeTimer: state.lungeTimer,
        isCrouching: state.isCrouching, modelType: state.playerModelType, invulnerabilityTimer: state.playerInvulnerabilityTimer,
      }, state.settings);
      if (observed) clashThreats.push(observed);
    }
    state.otherPlayers.forEach(other => {
      if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && other.team !== self.team) {
        threats.push(other);
        const observed = clashEnabled && observeLiveRunnerSwordThreat(other.id, other, state.settings);
        if (observed) clashThreats.push(observed);
      }
    });
    const decision = resolveGrifballCarrierDecision({ assignment, pos: frame.pos,
      players: state.aiMatchContext.grifballTeamPlan.snapshot?.players ?? [], threats, avoidanceEnemies: enemiesList,
      goal: getEnemyGoalPos(self.team), weaponState: frame.weaponState, canStartWeaponAction, settings: state.settings, dt,
      clashThreats, runnerRadiusBonus: getModelTargetRadiusBonus(self.modelType), runnerBodyHeight: self.isCrouching ? .52 : .825,
      playerStyle: resolveGrifballPlayerStyle(state.aiMatchContext.grifballTeamPlan.snapshot?.tactics?.botStyles, botId) });
    if (!decision) return false;
    if (assignment) {
      if (decision.clash) assignment.runnerClash = decision.clash; else delete assignment.runnerClash;
      if (decision.clash && ['track', 'punch'].includes(decision.clash.action) && assignment.pass) {
        assignment.pass.selected = null; state.aiMatchContext.grifballTeamPlan.passCharge = null;
      }
    }
    if (decision.kind === 'move' && frame.weaponState === 'ready' && canStartWeaponAction &&
      resolveRunnerThrustAllowed(state.settings) && tryRunnerEvasion?.(decision.velocity)) return false;
    frame.vel.set(decision.velocity.x, 0, decision.velocity.z);
    if (decision.kind === 'move') { frame.pos.x += frame.vel.x * dt; frame.pos.z += frame.vel.z * dt; }
    if (decision.heading && frame.weaponState === 'ready') frame.yaw = getYawForHeading(decision.heading.x, decision.heading.z);
    if (decision.kind === 'punch') {
      frame.aiState = 'COOLDOWN'; frame.timer = resolvePunchCooldown(state.settings);
      triggerCombatantAttack(self, 'hammer'); frame.weaponState = 'swing_up';
      return true;
    }
    if (decision.kind === 'blocked') frame.pickupRequested = false;
    settleAsApproaching(frame, true, dt);
    if (decision.kind === 'move') self.isLunging = false;
    if (decision.kind !== 'pass' && decision.kind !== 'wait') constrainCombatantToArena(frame.pos, frame.vel);
    return true;
  }
  const geometry = assignment?.geometry;
  const space = assignment?.space;
  const waypoint = geometry && space ? getGrifballSpaceWaypoint(geometry, frame.pos, space) : null;
  if (space && !waypoint) {
    if (assignment && selectGrifballAssignmentThreat(assignment, frame.pos, state.aiMatchContext.grifballTeamPlan.snapshot?.players ?? [])) return false;
    frame.vel.x = 0; frame.vel.z = 0;
    frame.pickupRequested = !heldByAnyone && assignment?.role === 'retriever';
    settleAsApproaching(frame, true, dt);
    constrainCombatantToArena(frame.pos, frame.vel);
    return true;
  }
  return false;
}

export function resolveSupportGrifballAIObjectiveMovementForCombatant({
  state,
  botId,
  self,
  frame,
  alliesList,
  dt,
  constrainCombatantToArena,
  getCombatantTeam,
  getCombatantRef,
  getEnemyGoalPos,
}: {
  state: GrifballAIObjectiveState;
  botId: string;
  self: CombatantLike;
  frame: GrifballAIObjectiveFrame;
  alliesList: GrifballAwarenessPoint[];
  dt: number;
  constrainCombatantToArena: GroundConstraint;
  getCombatantTeam: (id: string) => string | undefined;
  getCombatantRef: (id: string) => GrifballCombatantRef | null;
  getEnemyGoalPos: (team: string | undefined) => { x: number; z: number } | null;
}): boolean {
  if (state.settings.gameMode !== 'grifball') return false;

  const ball = state.grifball.ball;
  if (ball.state !== 'held' || !ball.holderId || ball.holderId === botId) return false;

  return resolvePrimaryGrifballAIObjectiveMovementForCombatant({
    state, botId, self, frame, alliesList, enemiesList: [], dt,
    canStartWeaponAction: false,
    triggerCombatantAttack: () => {},
    constrainCombatantToArena, getEnemyGoalPos,
  });
}
