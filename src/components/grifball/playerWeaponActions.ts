import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export type PlayerSwappableWeapon = 'hammer' | 'sword' | 'pistol';

type PlayerWeaponSyncPayload =
  | { type: 'sync'; action: 'swing_hammer' | 'melee_hammer' | 'slash_sword' }
  | { type: 'sync'; action: 'lunge_sword'; dir: { x: number; y: number; z: number } };

type PlayerSwordLockTarget = {
  pos: THREE.Vector3;
};

export type PlayerSwordLungeHitTarget = {
  id: string;
  pos: THREE.Vector3;
  hp: number;
  name: string;
};

const canStartPlayerWeaponAction = (state: GrifballRuntimeState): boolean =>
  state.swapCooldownTimer <= 0 && state.playerDashRemaining <= 0;

export function triggerPlayerHammerSwingForState({
  state,
  recordHammerAttack,
  playSwing,
  sendSync,
}: {
  state: GrifballRuntimeState;
  recordHammerAttack: () => void;
  playSwing: () => void;
  sendSync: (payload: PlayerWeaponSyncPayload) => void;
}): void {
  if (!canStartPlayerWeaponAction(state)) return;
  state.pWeaponState = 'swing_up';
  state.pWeaponTimer = 0;
  state.pWeaponReady = false;
  state.lastPlayerHammerAttackTime = Date.now();
  recordHammerAttack();
  playSwing();
  sendSync({ type: 'sync', action: 'swing_hammer' });
}

export function triggerPlayerHammerMeleeForState({
  state,
  playSwing,
  sendSync,
}: {
  state: GrifballRuntimeState;
  playSwing: () => void;
  sendSync: (payload: PlayerWeaponSyncPayload) => void;
}): void {
  if (!canStartPlayerWeaponAction(state)) return;
  state.pWeaponState = 'melee_swing';
  state.pWeaponTimer = 0;
  state.pWeaponReady = false;
  state.lastPlayerHammerAttackTime = Date.now();
  playSwing();
  sendSync({ type: 'sync', action: 'melee_hammer' });
}

export function triggerPlayerSwordSlashForState({
  state,
  playSwing,
  sendSync,
}: {
  state: GrifballRuntimeState;
  playSwing: () => void;
  sendSync: (payload: PlayerWeaponSyncPayload) => void;
}): void {
  if (!canStartPlayerWeaponAction(state)) return;
  state.pSwordState = 'slashing';
  state.pSwordTimer = 0;
  state.pSwordReady = false;
  state.lastPlayerSwordAttackTime = Date.now();
  playSwing();
  sendSync({ type: 'sync', action: 'slash_sword' });
}

export function triggerPlayerSwordLungeForState({
  state,
  lockTarget,
  recordLungeStart,
  playDash,
  sendSync,
}: {
  state: GrifballRuntimeState;
  lockTarget: PlayerSwordLockTarget | null;
  recordLungeStart: (lungeDistance: number) => void;
  playDash: () => void;
  sendSync: (payload: PlayerWeaponSyncPayload) => void;
}): void {
  if (!canStartPlayerWeaponAction(state)) return;
  if (!lockTarget) return;
  const lungeDir = lockTarget.pos.clone().sub(state.playerPos);
  lungeDir.y = 0;
  if (lungeDir.lengthSq() <= 0.0001) return;
  const lungeDistance = lungeDir.length();

  state.isLunging = true;
  state.lungeTimer = 0;
  state.lungeStartPos.copy(state.playerPos);
  state.lungeTargetDir.copy(lungeDir).normalize();
  recordLungeStart(lungeDistance);
  state.pSwordState = 'ready';
  state.lastPlayerSwordAttackTime = Date.now();
  playDash();
  sendSync({
    type: 'sync',
    action: 'lunge_sword',
    dir: { x: state.lungeTargetDir.x, y: state.lungeTargetDir.y, z: state.lungeTargetDir.z },
  });
}

export function finishPlayerSwordLungeRecoveryForState({
  state,
  hit,
  recordLungeEnd,
}: {
  state: GrifballRuntimeState;
  hit: boolean;
  recordLungeEnd: (hit: boolean) => void;
}): void {
  state.isLunging = false;
  recordLungeEnd(hit);
  state.pSwordState = 'recovering';
  state.pSwordTimer = 0;
  state.pSwordReady = false;
  state.pSwordRecoverDuration = state.settings.swordLungeReload ?? 1.2;
}

export function findPlayerSwordLungeHitTargetForState({
  state,
  mainAi,
  isMultiplayer,
  areCombatantsHostile,
}: {
  state: GrifballRuntimeState;
  mainAi: Combatant | undefined;
  isMultiplayer: boolean;
  areCombatantsHostile: (attackerId: string, victimId: string) => boolean;
}): {
  closestTarget: PlayerSwordLungeHitTarget | null;
  distance: number;
} {
  let closestTarget: PlayerSwordLungeHitTarget | null = null;
  let distance = Infinity;

  if (
    !isMultiplayer &&
    mainAi &&
    mainAi.hp > 0 &&
    mainAi.aiState !== 'RESPAWNING' &&
    areCombatantsHostile('player', MAIN_AI_ID)
  ) {
    closestTarget = { id: MAIN_AI_ID, pos: mainAi.pos, hp: mainAi.hp, name: 'Red (AI)' };
    distance = state.playerPos.distanceTo(mainAi.pos);
  }

  state.otherPlayers.forEach((other) => {
    if (
      other.hp > 0 &&
      !other.isObserver &&
      other.respawnTimer <= 0 &&
      areCombatantsHostile('player', other.id)
    ) {
      const otherPos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
      const candidateDistance = state.playerPos.distanceTo(otherPos);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        closestTarget = { id: other.id, pos: otherPos, hp: other.hp, name: other.playerName };
      }
    }
  });

  return { closestTarget, distance };
}

export function swapPlayerWeaponForState({
  state,
  refs,
  type,
  isPaused,
  isPlaying,
  recordWeaponSwap,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  type: PlayerSwappableWeapon;
  isPaused: boolean;
  isPlaying: boolean;
  recordWeaponSwap: (type: Exclude<PlayerSwappableWeapon, 'pistol'>) => void;
  pushStatsUpdate: () => void;
}): void {
  if (state.playerHP <= 0 || isPaused || !isPlaying) return;
  if (state.isLunging) return;
  if (state.swapLockoutTimer > 0) return;

  if (state.activeWeapon !== type) {
    state.activeWeapon = type;
    if (type !== 'pistol') {
      recordWeaponSwap(type);
    }
    if (state.settings.weaponReadyTime > 0) {
      state.swapCooldownTimer = state.settings.weaponReadyTime;
      state.swapCooldownDuration = state.settings.weaponReadyTime;
      state.pWeaponReady = false;
      state.pSwordReady = false;
      state.pWeaponCooldown = 0.0;
      state.pSwordCooldown = 0.0;
    }
    if (state.settings.weaponSwapLockout > 0) {
      state.swapLockoutTimer = state.settings.weaponSwapLockout;
    }
  }

  const hammer = refs.playerHammer;
  const sword = refs.playerSword;
  const pistol = refs.playerPistol;
  if (hammer && sword) {
    if (type === 'hammer') {
      hammer.visible = true;
      sword.visible = false;
      if (pistol) pistol.visible = false;
    } else if (type === 'pistol') {
      hammer.visible = false;
      sword.visible = false;
      if (pistol) pistol.visible = true;
    } else {
      hammer.visible = false;
      sword.visible = true;
      if (pistol) pistol.visible = false;
    }
  }
  pushStatsUpdate();
}
