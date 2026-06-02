import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { animateCombatantWeaponMeshes, animateSpartanCombatantModel } from './combatantAnimation';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type RosterTrailStyle = 'current' | 'shockwave' | 'localCube' | 'enemyCube';

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
    style?: RosterTrailStyle
  ) => void;
  applyBotMeleeImpact: (botId: string) => void;
}): void {
  state.otherPlayers.forEach((player, clientId) => {
    const meshes = refs.otherPlayerMeshes.get(clientId);
    if (!meshes?.group) return;

    let weaponState = player.weaponState || 'ready';
    let weaponTimer = player.weaponTimer || 0;

    if (player.isLunging) {
      player.lungeTimer = (player.lungeTimer || 0) + dt;
      const trailPos = new THREE.Vector3(player.pos.x, player.pos.y + 0.825, player.pos.z);
      const trailDir = new THREE.Vector3(player.vel.x, player.vel.y, player.vel.z);
      renderSwordLungeTrailVfx(trailPos, '#ef4444', trailDir, 'shockwave');
      if (player.lungeTimer > 0.8) {
        player.isLunging = false;
      }
    }

    const swingIsSword = player.activeWeapon === 'sword';
    if (weaponState === 'swing_up') {
      weaponTimer += dt;
      const windup = swingIsSword ? (state.settings.swordSlashSpeed ?? 0.22) * 0.5 : 0.28;
      if (weaponTimer >= windup) {
        weaponState = 'swing_down';
        weaponTimer = 0;
        if (swingIsSword) applyBotMeleeImpact(clientId);
      }
    } else if (weaponState === 'swing_down') {
      weaponTimer += dt;
      const strike = swingIsSword ? (state.settings.swordSlashSpeed ?? 0.22) * 0.5 : 0.12;
      if (weaponTimer >= strike) {
        weaponState = 'recovering';
        weaponTimer = 0;
        if (!swingIsSword) applyBotMeleeImpact(clientId);
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
      const reload = state.settings.hammerMeleeReload ?? 0.5;
      if (weaponTimer >= reload) {
        weaponState = 'ready';
        weaponTimer = 0;
      }
    } else if (weaponState === 'recovering') {
      weaponTimer += dt;
      const reload = swingIsSword
        ? (state.settings.swordSlashReload ?? 0.6)
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

    animateSpartanCombatantModel({
      refs,
      mesh: meshes.group,
      vel: playerVelocity,
      yaw: player.yaw,
      hp: player.hp,
      weaponState,
      weaponTimer,
      dt,
      isSliding: isPlayerSliding,
      isSprinting: isPlayerSprinting,
      hammerReloadTime: state.settings.hammerReloadTime ?? 0.6,
      hammerMeleeReload: state.settings.hammerMeleeReload ?? 0.5,
    });

    const isMainAiOffline = clientId === MAIN_AI_ID && !state.isMultiplayer;
    if ((meshes.hammer || meshes.sword) && !isMainAiOffline) {
      animateCombatantWeaponMeshes({
        hammerModel: meshes.hammer,
        swordModel: meshes.sword,
        activeWeapon: player.activeWeapon || 'hammer',
        weaponState,
        weaponTimer,
        isLunging: Boolean(player.isLunging),
        dt,
        settings: state.settings,
      });
    }

    const alive = player.hp > 0 && player.respawnTimer <= 0;
    meshes.group.visible = alive;
    meshes.hammer.visible = alive && player.activeWeapon === 'hammer';
    meshes.sword.visible = alive && player.activeWeapon === 'sword';
    if (meshes.pistol) {
      meshes.pistol.visible = alive && (player.activeWeapon as string) === 'pistol';
    }
  });
}
