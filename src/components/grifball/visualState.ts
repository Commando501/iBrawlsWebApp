import * as THREE from 'three';
import { getSkyboxTexture } from '../../game/skyboxTextures';
import { getPrimaryRemoteOpponent } from '../../game/roster';
import { type Combatant, type CustomMapData, type ReplayFile, type UniversalSettings } from '../../types';
import { resolveActiveCustomMap } from './mapSelection';
import { type GrifballRuntimeState } from './runtimeState';
import { type SpectateTargetData } from './spectateTargets';
import { type GrifballThreeRefs } from './threeRefs';

export const whiteBlinkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

export interface WeatherParticleFrameState {
  lastRainTime?: number;
  lastSnowTime?: number;
}

export const updateInvulnerabilityBlinking = ({
  group,
  active,
  skipMeshes = [],
  blinkMaterial = whiteBlinkMaterial,
  blinkCycle = Math.floor(performance.now() / 120) % 2 === 0,
}: {
  group: THREE.Group | null;
  active: boolean;
  skipMeshes?: readonly (THREE.Mesh | null | undefined)[];
  blinkMaterial?: THREE.Material;
  blinkCycle?: boolean;
}) => {
  if (!group) return;

  const isAlreadyBlinking = group.userData.isBlinking === true;
  const shouldShowBlink = active && blinkCycle;

  if (!active && !isAlreadyBlinking) {
    return;
  }

  group.userData.isBlinking = active;

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (skipMeshes.includes(child)) {
        return;
      }

      if (!child.userData.originalMaterial) {
        child.userData.originalMaterial = child.material;
      }

      if (shouldShowBlink) {
        child.material = blinkMaterial;
      } else {
        child.material = child.userData.originalMaterial;
      }
    }
  });
};

export const updateLiveInvulnerabilityBlinkingForState = ({
  state,
  refs,
  opponentClientId,
  replayActive,
  blinkCycle = Math.floor(performance.now() / 120) % 2 === 0,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  opponentClientId: string;
  replayActive: boolean;
  blinkCycle?: boolean;
}): void => {
  const skipMeshes = [refs.debugPlayerSphere, refs.debugEnemySphere];

  if (state.isObserverMode && !replayActive) {
    const remote = getPrimaryRemoteOpponent(state.otherPlayers, opponentClientId);
    updateInvulnerabilityBlinking({
      group: refs.enemyGroup,
      active: (remote?.invulnerabilityTimer ?? 0) > 0,
      skipMeshes,
      blinkCycle,
    });
  }

  updateInvulnerabilityBlinking({
    group: refs.playerHammer,
    active: state.playerInvulnerabilityTimer > 0,
    skipMeshes,
    blinkCycle,
  });

  refs.otherPlayerMeshes.forEach((meshes, id) => {
    const player = state.otherPlayers.get(id);
    if (!player) return;

    updateInvulnerabilityBlinking({
      group: meshes.group,
      active: (player.invulnerabilityTimer || 0) > 0,
      skipMeshes,
      blinkCycle,
    });
  });
};

export const updateLiveSpectatorModelVisibilityForState = ({
  state,
  refs,
  replayActive,
  hostData,
  clientData,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  replayActive: boolean;
  hostData: SpectateTargetData;
  clientData: SpectateTargetData;
}): void => {
  if (!state.isObserverMode || replayActive) return;

  if (refs.hostGroup) {
    refs.hostGroup.visible =
      (state.observerCamMode !== 'first' || state.observerTarget !== 'host') && hostData.hp > 0;

    if (refs.hostHammer && refs.hostSword) {
      refs.hostHammer.visible = hostData.activeWeapon === 'hammer';
      refs.hostSword.visible = hostData.activeWeapon === 'sword';
    }
  }

  if (refs.enemyGroup) {
    refs.enemyGroup.visible =
      (state.observerCamMode !== 'first' || state.observerTarget !== 'client') && clientData.hp > 0;

    if (refs.enemyHammer && refs.enemySword) {
      refs.enemyHammer.visible = clientData.activeWeapon === 'hammer';
      refs.enemySword.visible = clientData.activeWeapon === 'sword';
    }
  }
};

export const updateDebugStrikeVisualsForState = ({
  state,
  playerSphere,
  enemySphere,
}: {
  state: GrifballRuntimeState;
  playerSphere: THREE.Mesh | null;
  enemySphere: THREE.Mesh | null;
}): void => {
  if (playerSphere) {
    if (state.debugMode && state.lastStrikePos && state.lastStrikeTick > 0) {
      playerSphere.visible = true;
      playerSphere.position.copy(state.lastStrikePos);

      const fade = Math.max(0, state.lastStrikeTick);
      const mat = playerSphere.material as THREE.MeshBasicMaterial;
      mat.opacity = fade * 0.45;

      const scaleFactor = state.settings.attackRadius / 4.5;
      playerSphere.scale.setScalar(scaleFactor);
    } else {
      playerSphere.visible = false;
    }
  }

  if (enemySphere) {
    if (state.debugMode && state.lastAIStrikePos && state.lastAIStrikeTick > 0) {
      enemySphere.visible = true;
      enemySphere.position.copy(state.lastAIStrikePos);

      const fade = Math.max(0, state.lastAIStrikeTick);
      const mat = enemySphere.material as THREE.MeshBasicMaterial;
      mat.opacity = fade * 0.45;

      const scaleFactor = state.settings.attackRadius / 4.5;
      enemySphere.scale.setScalar(scaleFactor);
    } else {
      enemySphere.visible = false;
    }
  }
};

export const updateHammerJumpZoneVisualizerForState = ({
  state,
  jumpZoneMesh,
  now = performance.now(),
}: {
  state: GrifballRuntimeState;
  jumpZoneMesh: THREE.Mesh | null;
  now?: number;
}): void => {
  if (!jumpZoneMesh) return;

  if (state.settings.visualizeJumpZone && state.playerHP > 0) {
    jumpZoneMesh.visible = true;
    jumpZoneMesh.position.set(state.playerPos.x, 0.02, state.playerPos.z);

    const triggerRad = state.settings.hammerJumpTriggerRadius ?? 3.5;
    jumpZoneMesh.scale.set(triggerRad, 1, triggerRad);

    const mat = jumpZoneMesh.material as THREE.MeshBasicMaterial;
    if (state.pHammerJumpWindowTimer > 0) {
      const flash = 0.6 + Math.sin(now * 0.016) * 0.25;
      mat.opacity = flash;
      mat.color.setHex(0xfca5a5);
    } else {
      const pulse = 0.22 + Math.sin(now * 0.003) * 0.07;
      mat.opacity = pulse;
      mat.color.setHex(0xf59e0b);
    }
  } else {
    jumpZoneMesh.visible = false;
  }
};

export const updateEmissiveGlowPulseForScene = ({
  scene,
  blinkMaterial = whiteBlinkMaterial,
  elapsed = performance.now() / 1000,
}: {
  scene: THREE.Scene;
  blinkMaterial?: THREE.Material;
  elapsed?: number;
}): void => {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (
          'emissive' in mat &&
          mat.emissive &&
          ((mat.emissive as THREE.Color).r > 0 ||
            (mat.emissive as THREE.Color).g > 0 ||
            (mat.emissive as THREE.Color).b > 0)
        ) {
          const standardMat = mat as THREE.MeshStandardMaterial;
          if (mat !== blinkMaterial) {
            standardMat.emissiveIntensity = 2.0 + Math.sin(elapsed * 4.0) * 0.8;
          }
        }
      });
    }
  });
};

export const syncAdminSettingsVisualStateForState = ({
  state,
  refs,
  adminSettings,
  mainAI,
  customMap,
  replayData,
  selectedMap,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  adminSettings: UniversalSettings;
  mainAI: Combatant | undefined;
  customMap?: CustomMapData;
  replayData?: ReplayFile | null;
  selectedMap: string;
}): void => {
  const prevMax = state.playerMaxHP;
  state.playerMaxHP = adminSettings.maxHP;
  if (state.playerHP === prevMax) {
    state.playerHP = adminSettings.maxHP;
  } else {
    state.playerHP = Math.min(state.playerHP, adminSettings.maxHP);
  }

  if (mainAI) {
    mainAI.maxHp = adminSettings.maxHP;
    if (mainAI.hp === prevMax) {
      mainAI.hp = adminSettings.maxHP;
    } else {
      mainAI.hp = Math.min(mainAI.hp, adminSettings.maxHP);
    }
  }

  state.settings = adminSettings;

  if (refs.ambientLight) {
    refs.ambientLight.intensity =
      adminSettings.ambientLightIntensity !== undefined ? adminSettings.ambientLightIntensity : 0.82;
  }
  if (refs.dirLight) {
    refs.dirLight.intensity =
      adminSettings.directLightIntensity !== undefined ? adminSettings.directLightIntensity : 1.6;
  }
  if (!refs.scene) return;

  const hue = adminSettings.skyboxHue !== undefined ? adminSettings.skyboxHue : 224;
  const brightness = adminSettings.skyboxBrightness !== undefined ? adminSettings.skyboxBrightness : 4;
  const colorString = `hsl(${hue}, 70%, ${brightness}%)`;
  const finalColor = new THREE.Color(colorString);
  refs.scene.background = finalColor;
  if (refs.scene.fog) {
    refs.scene.fog.color.copy(finalColor);
  }

  if (refs.skyboxMesh && refs.skyboxMesh.material) {
    refs.skyboxMesh.visible = adminSettings.showSkybox !== false;
    let skyType = 'cyberpunk';
    const activeCustomMap = resolveActiveCustomMap({
      customMap,
      replayData,
      selectedMap,
      gameMode: adminSettings.gameMode,
    });
    const effectiveMapId = replayData ? replayData.mapType : selectedMap;
    const isHangar = effectiveMapId === 'hangar';

    if (activeCustomMap) {
      skyType = activeCustomMap.skyboxTexture || activeCustomMap.theme || 'cyberpunk';
      if (skyType === 'matched') {
        skyType = activeCustomMap.theme || 'cyberpunk';
      }
    } else if (isHangar) {
      skyType = 'hangar';
    }

    try {
      const newTex = getSkyboxTexture(skyType, hue, brightness, colorString);
      const mat = refs.skyboxMesh.material as THREE.MeshBasicMaterial;
      mat.map = newTex;
      mat.needsUpdate = true;
    } catch (err) {
      console.error('Failed to update skybox texture:', err);
    }
  }
};

const updateFallingWeatherParticleSystem = ({
  points,
  dt,
  resetRadiusX,
  resetRadiusZ,
}: {
  points: THREE.Points;
  dt: number;
  resetRadiusX: number;
  resetRadiusZ: number;
}): void => {
  const positions = points.geometry.attributes.position.array as Float32Array;
  const velocities = points.userData.velocities;
  const arenaRadius = points.userData.arenaRadius || 20;
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    positions[i * 3] += velocities[i].x * dt;
    positions[i * 3 + 1] += velocities[i].y * dt;
    positions[i * 3 + 2] += velocities[i].z * dt;

    if (positions[i * 3 + 1] <= 0.05) {
      positions[i * 3] = (Math.random() - 0.5) * arenaRadius * resetRadiusX;
      positions[i * 3 + 1] = 25;
      positions[i * 3 + 2] = (Math.random() - 0.5) * arenaRadius * resetRadiusZ;
    }
  }

  points.geometry.attributes.position.needsUpdate = true;
};

export const updateWeatherParticlesForScene = ({
  scene,
  frameState,
  now = performance.now(),
}: {
  scene: THREE.Scene;
  frameState: WeatherParticleFrameState;
  now?: number;
}): void => {
  const rainObj = scene.getObjectByName('rain_particles');
  if (rainObj && rainObj instanceof THREE.Points) {
    if (frameState.lastRainTime === undefined) {
      frameState.lastRainTime = now;
    }
    const rainDt = Math.min(0.1, (now - frameState.lastRainTime) / 1000);
    frameState.lastRainTime = now;

    updateFallingWeatherParticleSystem({
      points: rainObj,
      dt: rainDt,
      resetRadiusX: 3,
      resetRadiusZ: 2,
    });
  }

  const snowObj = scene.getObjectByName('snow_particles');
  if (snowObj && snowObj instanceof THREE.Points) {
    if (frameState.lastSnowTime === undefined) {
      frameState.lastSnowTime = now;
    }
    const snowDt = Math.min(0.1, (now - frameState.lastSnowTime) / 1000);
    frameState.lastSnowTime = now;

    updateFallingWeatherParticleSystem({
      points: snowObj,
      dt: snowDt,
      resetRadiusX: 3.2,
      resetRadiusZ: 2.2,
    });
  }
};
