import * as THREE from 'three';
import { resolveGrifballTeam } from '../../game/grifballTeams';
import { type ReplayFile, type UniversalSettings } from '../../types';
import { animateCombatantWeaponMeshes } from './combatantAnimation';
import { createCombatantMeshRig } from './combatantModels';
import { syncCombatantTeamOutline } from './combatantTeamOutlines';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { type ReplayInterpolatedPlayer } from './replayHelpers';
import { resolveReplayCombatantVisualLoadout } from './replayVisualMetadata';
import { type GrifballThreeRefs } from './threeRefs';
import type { V3RenderOptions } from '../v3/v3QualityTiers';

export function updateReplayCombatantVisualsForFrame({
  refs,
  replayData,
  updatedPlayers,
  targetId,
  observerCamMode,
  replayPlayerName,
  dt,
  v3Options = { v3QualityTier: 'desktop' },
  animateSpartanModel,
  renderSwordLungeTrailVfx,
  updateBlinking,
  settings,
}: {
  refs: GrifballThreeRefs;
  replayData: ReplayFile | null;
  updatedPlayers: Map<string, ReplayInterpolatedPlayer>;
  targetId: string;
  observerCamMode: string;
  replayPlayerName: string;
  dt: number;
  v3Options?: V3RenderOptions;
  animateSpartanModel: (
    mesh: THREE.Group | null,
    vel: THREE.Vector3,
    yaw: number,
    hp: number,
    weaponState: string,
    weaponTimer: number,
    dt: number,
    isSliding?: boolean,
    isSprinting?: boolean,
    activeWeapon?: string,
    isLunging?: boolean,
    lookPitch?: number
  ) => void;
  renderSwordLungeTrailVfx: (
    pos: THREE.Vector3,
    color: string,
    dir: THREE.Vector3,
    style?: SwordLungeCurrentTrailStyle
  ) => void;
  updateBlinking: (group: THREE.Group | null, active: boolean) => void;
  settings?: Partial<UniversalSettings>;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  updatedPlayers.forEach((player, id) => {
    let meshes = refs.otherPlayerMeshes.get(id);
    const teamOutlineTeam = replayData?.gameMode === 'grifball'
      ? player.team ?? resolveGrifballTeam(id)
      : null;
    const visualLoadout = resolveReplayCombatantVisualLoadout(replayData, id);
    const visualLoadoutKey = JSON.stringify(visualLoadout);
    const qualityChanged = visualLoadout.modelSystem === 'v3' && (
      meshes?.group.userData.appliedV3QualityTier !== v3Options.v3QualityTier ||
      meshes?.group.userData.appliedV3Distance !== v3Options.v3Distance
    );
    if (!meshes || meshes.group.userData.appliedHue !== player.hue || meshes.group.userData.appliedLoadoutKey !== visualLoadoutKey || qualityChanged) {
      if (meshes?.group) scene.remove(meshes.group);
      meshes = createCombatantMeshRig(scene, player.hue, false, visualLoadout, v3Options, teamOutlineTeam);
      meshes.group.userData.appliedHue = player.hue;
      meshes.group.userData.appliedLoadoutKey = visualLoadoutKey;
      refs.otherPlayerMeshes.set(id, meshes);
    }

    const { group, hammer, sword, pistol } = meshes;
    syncCombatantTeamOutline(group, teamOutlineTeam);
    group.position.copy(player.pos);
    group.rotation.y = player.yaw;
    group.scale.set(1, player.crouchScaleY, 1);

    animateSpartanModel(
      group,
      player.vel,
      player.yaw,
      player.hp,
      player.weaponState,
      player.weaponTimer || 0,
      dt,
      player.isSliding || false,
      player.isSprinting || false,
      player.activeWeapon,
      Boolean(player.isLunging),
      player.pitch
    );

    const alive = player.hp > 0 && player.respawnTimer <= 0;
    const isSpectatedInFirstPerson = observerCamMode === 'first' && targetId === id;
    group.visible = alive && !isSpectatedInFirstPerson;
    hammer.visible = alive && player.activeWeapon === 'hammer';
    sword.visible = alive && player.activeWeapon === 'sword';
    if (pistol) pistol.visible = alive && player.activeWeapon === 'pistol';

    if (settings) {
      animateCombatantWeaponMeshes({
        hammerModel: hammer,
        swordModel: sword,
        pistolModel: pistol,
        activeWeapon: player.activeWeapon,
        weaponState: player.weaponState,
        weaponTimer: player.weaponTimer || 0,
        isLunging: Boolean(player.isLunging),
        dt,
        settings,
        combatantModel: group,
      });
      hammer.visible = alive && player.activeWeapon === 'hammer';
      sword.visible = alive && player.activeWeapon === 'sword';
      if (pistol) pistol.visible = alive && player.activeWeapon === 'pistol';
    } else if (player.weaponState !== 'ready') {
      if (player.activeWeapon === 'hammer') {
        if (player.weaponState === 'swing_up') {
          hammer.rotation.set(Math.PI / 3, 0, 0);
        } else if (player.weaponState === 'swing_down') {
          hammer.rotation.set(Math.PI / 1.1, 0, 0);
        } else if (player.weaponState === 'recovering') {
          hammer.rotation.set(Math.PI / 1.8, 0, 0);
        } else if (player.weaponState === 'melee_swing') {
          hammer.rotation.set(Math.PI / 2, 0, Math.PI / 4);
        }
      } else if (player.activeWeapon === 'sword') {
        if (player.weaponState === 'slashing') {
          sword.rotation.set(Math.PI / 3, 0, -Math.PI / 4);
        } else if (player.weaponState === 'recovering') {
          sword.rotation.set(Math.PI / 1.8, 0, -Math.PI / 8);
        }
      }
    } else {
      hammer.rotation.set(Math.PI / 2, 0, 0);
      sword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
    }

    if (player.isLunging && alive && dt > 0) {
      const trailPos = player.pos.clone();
      trailPos.y += 0.825;
      const trailDir = player.vel.clone();
      const style: 'localCube' | 'enemyCube' = (id === 'player' || player.playerName === replayPlayerName) ? 'localCube' : 'enemyCube';
      const color = (id === 'player' || player.playerName === replayPlayerName) ? '#22d3ee' : '#ef4444';
      renderSwordLungeTrailVfx(trailPos, color, trailDir, style);
    }

    if (player.isDashing && alive && dt > 0 && Math.random() > 0.15) {
      const trailPos = player.pos.clone();
      trailPos.y += 0.5;
      const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
      const colorHex = (id === 'player' || player.playerName === replayPlayerName)
        ? '#38bdf8'
        : (player.activeWeapon === 'hammer' ? '#f97316' : '#ef4444');
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex),
        transparent: true,
        opacity: 0.75,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(trailPos);
      mesh.position.x += (Math.random() - 0.5) * 0.3;
      mesh.position.y += (Math.random() - 0.5) * 0.5;
      mesh.position.z += (Math.random() - 0.5) * 0.3;
      scene.add(mesh);
      refs.damageExplosionParticles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
        life: 0.0,
        maxLife: 0.25 + Math.random() * 0.15,
      });
    }

    updateBlinking(group, player.invulnerabilityTimer > 0);
  });

  refs.otherPlayerMeshes.forEach((meshes, id) => {
    if (!updatedPlayers.has(id)) {
      meshes.group.visible = false;
    }
  });

  if (refs.enemyGroup) refs.enemyGroup.visible = false;
  if (refs.hostGroup) refs.hostGroup.visible = false;
}
