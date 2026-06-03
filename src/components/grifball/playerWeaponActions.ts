import * as THREE from 'three';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export type PlayerSwappableWeapon = 'hammer' | 'sword' | 'pistol';

type PlayerWeaponSyncPayload =
  | { type: 'sync'; action: 'swing_hammer' | 'melee_hammer' | 'slash_sword' }
  | { type: 'sync'; action: 'lunge_sword'; dir: { x: number; y: number; z: number } };

type PlayerSwordLockTarget = {
  pos: THREE.Vector3;
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
  if (state.activeWeapon === 'pistol') return;
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
