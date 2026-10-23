import { syncCombatantTeamArmor, resolveFriendlyArmorTeam } from './combatantTeamArmor';
import * as THREE from 'three';
import { resolveHammerSlamTiming } from '../../game/hammerSlamTiming';
import { resolvePunchCooldown } from '../../game/runnerBallSettings';
import { advancePunchForState } from './ballPunchRuntime';
import { animateCombatantWeaponMeshes, animateSpartanCombatantModel } from './combatantAnimation';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { updateRunnerVisualStateForGroup } from './runnerVisualState';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import { syncV3DeathVoxelBurstForCombatant } from './v3DeathVoxelBurstRuntime';

export function updateRosterCombatantVisualsForState({
  refs,
  state,
  dt,
  renderSwordLungeTrailVfx,
  applyBotMeleeImpact,
}: {
  refs: GrifballThreeRefs;
  state: GrifballRuntimeState;
  dt: number;
  renderSwordLungeTrailVfx: (
    pos: THREE.Vector3,
    color: string,
    dir: THREE.Vector3,
    style?: SwordLungeCurrentTrailStyle
  ) => void;
  applyBotMeleeImpact: (botId: string) => void;
}): void {
  const animationClockMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  state.otherPlayers.forEach((player, clientId) => {
    const meshes = refs.otherPlayerMeshes.get(clientId);
    if (!meshes?.group) return;
    syncCombatantTeamArmor(meshes.group, state.settings.gameMode === 'grifball' ? player.team : null, resolveFriendlyArmorTeam(state));

    let weaponState = player.weaponState || 'ready';
    let weaponTimer = player.weaponTimer || 0;
    let alive = player.hp > 0 && (player.respawnTimer ?? 0) <= 0;
    if (!alive) {
      weaponState = 'ready'; weaponTimer = 0;
      player.isLunging = false;
    }

    if (player.isLunging) {
      // Offline AI flight owns its clock; only network visual extrapolation ticks here.
      if (player.controller !== 'ai') player.lungeTimer = (player.lungeTimer || 0) + dt;
      const trailPos = new THREE.Vector3(player.pos.x, player.pos.y + 0.825, player.pos.z);
      const trailDir = new THREE.Vector3(player.vel.x, player.vel.y, player.vel.z);
      renderSwordLungeTrailVfx(trailPos, '#ef4444', trailDir, 'shockwave');
      if (player.controller !== 'ai' && player.lungeTimer > 0.8) {
        player.isLunging = false;
      }
    }

    const swingIsSword = player.activeWeapon === 'sword';
    advancePunchForState(state, clientId, dt);
    const swingIsBall = player.activeWeapon === 'ball';
    const hammerSlamTiming = resolveHammerSlamTiming(state.settings);
    if (weaponState === 'swing_up') {
      weaponTimer += dt;
      const windup = swingIsSword
        ? (state.settings.swordSlashSpeed ?? 0.22) * 0.5
        : swingIsBall
          ? (state.settings.hammerMeleeSpeed ?? 0.24)
          : hammerSlamTiming.windupTime;
      if (weaponTimer >= windup) {
        weaponState = 'swing_down';
        weaponTimer = 0;
        if (swingIsSword) {
          applyBotMeleeImpact(clientId);
          // A runner's reciprocal punch can cancel or kill this sword user
          // inside the impact callback. Do not restore the pending slash.
          if (player.hp <= 0 || (player.respawnTimer ?? 0) > 0) {
            alive = false;
            weaponState = 'ready'; weaponTimer = 0;
          } else if (player.weaponState === 'recovering') {
            weaponState = player.weaponState; weaponTimer = player.weaponTimer ?? 0;
          }
        }
      }
    } else if (weaponState === 'swing_down') {
      weaponTimer += dt;
      const strike = swingIsSword
        ? (state.settings.swordSlashSpeed ?? 0.22) * 0.5
        : swingIsBall
          ? Math.max(0.03, (state.settings.hammerMeleeSpeed ?? 0.24) * 0.5)
          : hammerSlamTiming.attackTime;
      if (weaponTimer >= strike) {
        weaponState = 'recovering';
        weaponTimer = 0;
        if (!swingIsSword) applyBotMeleeImpact(clientId);
      }
    } else if (weaponState === 'melee_up') {
      weaponTimer += dt;
      const windup = state.settings.hammerMeleeSpeed ? state.settings.hammerMeleeSpeed * 0.4 : 0.1;
      if (weaponTimer >= windup) { weaponState = 'melee_down'; weaponTimer = 0; }
    } else if (weaponState === 'melee_down') {
      weaponTimer += dt;
      const strike = state.settings.hammerMeleeSpeed ? state.settings.hammerMeleeSpeed * 0.6 : 0.14;
      if (weaponTimer >= strike) {
        weaponState = 'melee_recover'; weaponTimer = 0;
        applyBotMeleeImpact(clientId);
      }
    } else if (weaponState === 'melee_swing') {
      weaponTimer += dt;
      const speed = state.settings.hammerMeleeSpeed ?? 0.24;
      if (weaponTimer >= speed) {
        weaponState = 'melee_recover';
        weaponTimer = 0;
        applyBotMeleeImpact(clientId);
      }
    } else if (weaponState === 'melee_recover') {
      weaponTimer += dt;
      const reload = swingIsBall ? resolvePunchCooldown(state.settings) : (state.settings.hammerMeleeReload ?? 0.5);
      if (weaponTimer >= reload) {
        weaponState = 'ready';
        weaponTimer = 0;
      }
    } else if (weaponState === 'recovering') {
      weaponTimer += dt;
      const reload = swingIsSword
        ? (state.settings.swordSlashReload ?? 0.6)
        : swingIsBall
          ? resolvePunchCooldown(state.settings)
          : (state.settings.hammerReloadTime ?? 0.6);
      if (weaponTimer >= reload) {
        weaponState = 'ready';
        weaponTimer = 0;
      }
    }
    player.weaponState = weaponState;
    player.weaponTimer = weaponTimer;

    const playerVelocity = new THREE.Vector3(player.vel.x, player.vel.y, player.vel.z);
    const playerSpeed = playerVelocity.length();
    const isPlayerSprinting =
      state.settings.enableSprint &&
      (player.aiIsSprinting ?? (playerSpeed > 5.5 && !(player.isCrouching || false)));
    const isPlayerSliding =
      state.settings.enableSlide &&
      (player.aiSlideActive ?? (playerSpeed > 2.5 && (player.isCrouching || false)));

    const didAnimate = animateSpartanCombatantModel({
      isCrouching: !!player.isCrouching,
      isJumping: player.isJumping,
      refs,
      mesh: meshes.group,
      vel: playerVelocity,
      yaw: player.yaw,
      lookPitch: player.pitch,
      hp: player.hp,
      activeWeapon: player.activeWeapon || 'hammer',
      weaponState,
      weaponTimer,
      dt,
      isSliding: isPlayerSliding,
      isSprinting: isPlayerSprinting,
      isLunging: Boolean(player.isLunging),
      lungeHit: player.swordLungeHit,
      lungeTime: player.isLunging ? player.lungeTimer : undefined,
      hammerReloadTime: state.settings.hammerReloadTime ?? 0.6,
      hammerMeleeReload: state.settings.hammerMeleeReload ?? 0.5,
      hammerSlamWindupTime: hammerSlamTiming.windupTime,
      hammerSlamAttackTime: hammerSlamTiming.attackTime,
      settings: state.settings,
      v3QualityTier: meshes.group.userData.appliedV3QualityTier,
      isLocalV3Animation: false,
      animationClockMs,
    });

    if ((didAnimate || meshes.group.userData.modelSystem === 'v3') && (meshes.hammer || meshes.sword || meshes.pistol)) {
      animateCombatantWeaponMeshes({
        hammerModel: meshes.hammer,
        swordModel: meshes.sword,
        pistolModel: meshes.pistol,
        activeWeapon: player.activeWeapon || 'hammer',
        weaponState,
        weaponTimer,
        isLunging: Boolean(player.isLunging),
        dt,
        settings: state.settings,
        combatantModel: meshes.group,
      });
    }

    syncV3DeathVoxelBurstForCombatant({
      refs,
      id: `combatant:${clientId}`,
      model: meshes.group,
      weapons: [meshes.hammer, meshes.sword, meshes.pistol],
      alive,
      dt,
      qualityTier: meshes.group.userData.appliedV3QualityTier,
    });
    meshes.group.visible = alive;
    meshes.hammer.visible = alive && player.activeWeapon === 'hammer';
    meshes.sword.visible = alive && player.activeWeapon === 'sword';
    if (meshes.pistol) {
      meshes.pistol.visible = alive && (player.activeWeapon as string) === 'pistol';
    }
    updateRunnerVisualStateForGroup({
      group: meshes.group,
      carrying: state.grifball.ball.state === 'held' && state.grifball.ball.holderId === clientId,
      hp: player.hp,
      maxHp: player.maxHp,
      alive,
    });
  });
}
