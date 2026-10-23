import { advancePunch, beginPunch, findPunchHitTarget, findPunchLockTarget, type PunchActor, type PunchBody } from '../../game/ballPunch';
import { areGrifballCombatantsHostileForState } from './grifballObjectiveRuntime';
import type { Combatant } from '../../types';
import type { GrifballRuntimeState } from './runtimeState';

export function punchActorForState(state: GrifballRuntimeState, id: string, fallback?: Combatant): PunchActor {
  const other = id === 'player' ? undefined : state.otherPlayers.get(id) ?? fallback;
  const human = !other || other.controller === 'remote';
  const yaw = other?.yaw ?? state.yaw, pitch = human ? (other ? other.pitch ?? 0 : state.pitch) : 0;
  const crouching = other ? !!other.isCrouching : state.isCrouching;
  return { id, pos: other?.pos ?? state.playerPos, modelType: other?.modelType ?? state.playerModelType,
    isCrouching: crouching,
    eyeHeight: human ? 1.65 - (other ? crouching ? .72 : 0 : state.crouchAmount) : crouching ? .9 : 1.2,
    heading: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) } };
}

export function punchTargetsForState(state: GrifballRuntimeState, id: string, fallback?: Combatant, includeTeammates = false): PunchBody[] {
  const targets: PunchBody[] = [];
  if (id !== 'player' && !state.isObserverMode && state.playerHP > 0 && state.playerRespawnTimer <= 0 &&
    state.playerInvulnerabilityTimer <= 0 && (includeTeammates || areGrifballCombatantsHostileForState(state, id, 'player')))
    targets.push({ id: 'player', pos: state.playerPos, modelType: state.playerModelType, isCrouching: state.isCrouching });
  const consider = (other: Combatant) => {
    if (other.id === id || other.hp <= 0 || other.isObserver || other.aiState === 'RESPAWNING' ||
      other.respawnTimer > 0 || (other.invulnerabilityTimer ?? 0) > 0 || (!includeTeammates && !areGrifballCombatantsHostileForState(state, id, other.id))) return;
    targets.push(other);
  };
  state.otherPlayers.forEach(consider);
  if (fallback && !state.otherPlayers.has(fallback.id)) consider(fallback);
  return targets;
}

export function getPlayerPunchLockTarget(state: GrifballRuntimeState, mainAI?: Combatant): PunchBody | null {
  if (state.playerHP <= 0 || state.isObserverMode || state.activeWeapon !== 'ball' ||
    !state.pWeaponReady || state.pWeaponState !== 'ready' || state.swapCooldownTimer > 0 || state.playerDashRemaining > 0) return null;
  return findPunchLockTarget(punchActorForState(state, 'player'), punchTargetsForState(state, 'player', mainAI), state.settings, state.punchMap);
}

export function startPlayerPunchForState(state: GrifballRuntimeState): void {
  state.playerPunchAttack = beginPunch(punchActorForState(state, 'player'), punchTargetsForState(state, 'player'), state.settings, state.punchMap);
}

export function advancePunchForState(state: GrifballRuntimeState, id: string, dt: number, fallback?: Combatant): void {
  const other = id === 'player' ? undefined : state.otherPlayers.get(id) ?? fallback;
  if (other?.controller === 'remote') return; // Remote owners move and resolve their own punches.
  const phase = other?.weaponState ?? state.pWeaponState;
  const weapon = other?.activeWeapon ?? state.activeWeapon;
  if (weapon !== 'ball' || (other?.hp ?? state.playerHP) <= 0 || !['swing_up', 'swing_down'].includes(phase)) {
    if (other) delete other.punchAttack; else delete state.playerPunchAttack;
    return;
  }
  const actor = punchActorForState(state, id, fallback), targets = punchTargetsForState(state, id, fallback);
  let attack = other ? other.punchAttack : state.playerPunchAttack;
  if (!attack) {
    attack = beginPunch(actor, targets, state.settings, state.punchMap);
    if (other) other.punchAttack = attack; else state.playerPunchAttack = attack;
  }
  advancePunch(actor, attack, targets, state.settings, dt, state.punchMap);
}

export function punchHitTargetForState(state: GrifballRuntimeState, id: string, fallback?: Combatant): string | null {
  const actor = punchActorForState(state, id, fallback);
  const attack = id === 'player' ? state.playerPunchAttack : (state.otherPlayers.get(id) ?? fallback)?.punchAttack;
  if (attack?.targetId) actor.heading = attack.direction;
  return findPunchHitTarget(actor, punchTargetsForState(state, id, fallback, true), state.punchMap)?.id ?? null;
}
