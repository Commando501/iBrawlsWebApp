import { updateRainyWeather } from './rainyWeather';
import { updateGlacierWeather } from './glacierWeather';
import * as THREE from 'three';
import { getSkyboxTexture } from '../../game/skyboxTextures';
import { getPrimaryRemoteOpponent } from '../../game/roster';
import { type Combatant, type CustomMapData, type ReplayFile, type UniversalSettings } from '../../types';
import { resolveActiveCustomMap } from './mapSelection';
import { type GrifballRuntimeState } from './runtimeState';
import { syncSkyAtmosphereForRefs } from './skyAtmosphereRuntime';
import { type SpectateTargetData } from './spectateTargets';
import { type GrifballThreeRefs } from './threeRefs';
import { updateCanyonSkyMaterial } from './canyonLighting';
import { updateCyberSkyMaterial } from './cyberLighting';
import { updateJungleSkyMaterial } from './jungleLighting';
import { updateAsteroidSkyMaterial } from './asteroidLighting';
import { updateNeonSkyMaterial } from './neonLighting';
import { updateRainySkyMaterial } from './rainyLighting';
import { updateGlacierSkyMaterial } from './glacierLighting';
import { updateCircleSkyMaterial } from './circleLighting';
import { syncStadiumVisualStateForRefs } from './stadiumVisualState';

export const whiteBlinkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

export interface WeatherParticleFrameState {
  lastRainTime?: number;
  lastSnowTime?: number;
  lastAtmosphereTime?: number;
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
      !state.hideLocalObserverAvatar && (state.observerCamMode !== 'first' || state.observerTarget !== 'host') && hostData.hp > 0;

    if (refs.hostHammer && refs.hostSword) {
      refs.hostHammer.visible = hostData.activeWeapon === 'hammer' && (refs.hostGroup.userData.characterAsset !== 'iron-vanguard' || refs.hostGroup.userData.vanguardBallThrowTime === undefined);
      refs.hostSword.visible = hostData.activeWeapon === 'sword' && (refs.hostGroup.userData.characterAsset !== 'iron-vanguard' || refs.hostGroup.userData.vanguardBallThrowTime === undefined);
    }
  }

  if (refs.enemyGroup) {
    refs.enemyGroup.visible =
      (state.observerCamMode !== 'first' || state.observerTarget !== 'client') && clientData.hp > 0;

    if (refs.enemyHammer && refs.enemySword) {
      refs.enemyHammer.visible = clientData.activeWeapon === 'hammer' && (refs.enemyGroup.userData.characterAsset !== 'iron-vanguard' || refs.enemyGroup.userData.vanguardBallThrowTime === undefined);
      refs.enemySword.visible = clientData.activeWeapon === 'sword' && (refs.enemyGroup.userData.characterAsset !== 'iron-vanguard' || refs.enemyGroup.userData.vanguardBallThrowTime === undefined);
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
  const updateGlow = createEmissivePulseVisitor(blinkMaterial, elapsed);
  scene.traverse(updateGlow);
};

/** Materials remain live: loadouts, blink swaps and effects can change between ticks. */
const createEmissivePulseVisitor = (blinkMaterial: THREE.Material, elapsed: number) => {
  const intensity = 2.0 + Math.sin(elapsed * 4.0) * 0.8;
  const visited = new Set<THREE.Material>();
  const updateMaterial = (material: THREE.Material): void => {
    if (visited.has(material)) return;
    visited.add(material);
    if (material === blinkMaterial || material.userData.preserveEmissiveIntensity === true) return;
    if ('emissive' in material && material.emissive) {
      const emissive = material.emissive as THREE.Color;
      if (emissive.r > 0 || emissive.g > 0 || emissive.b > 0) {
        (material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
      }
    }
  };
  return (child: THREE.Object3D): void => {
    if (!(child instanceof THREE.Mesh) || !child.material) return;
    if (Array.isArray(child.material)) {
      for (const material of child.material) updateMaterial(material);
    } else updateMaterial(child.material);
  };
};

interface WeatherTargets {
  rainy?: THREE.Object3D;
  glacier?: THREE.Object3D;
  rain?: THREE.Object3D;
  snow?: THREE.Object3D;
}

const collectWeatherTarget = (targets: WeatherTargets, object: THREE.Object3D): void => {
  // Keep getObjectByName's depth-first/first-match semantics, including foreign
  // objects with these names. Do not cache: editors and late loads may replace them.
  if (object.name === 'rainy_weather') targets.rainy ??= object;
  else if (object.name === 'glacier_weather') targets.glacier ??= object;
  else if (object.name === 'rain_particles') targets.rain ??= object;
  else if (object.name === 'snow_particles') targets.snow ??= object;
};

/** One walk replaces the glow walk plus four recursive weather searches. */
export const updateEnvironmentVisualFrameForScene = ({
  scene,
  frameState,
  now = performance.now(),
  blinkMaterial = whiteBlinkMaterial,
  updateAtmosphere,
}: {
  scene: THREE.Scene;
  frameState: WeatherParticleFrameState;
  now?: number;
  blinkMaterial?: THREE.Material;
  updateAtmosphere?: () => void;
}): void => {
  const targets: WeatherTargets = {};
  const updateGlow = createEmissivePulseVisitor(blinkMaterial, now / 1000);
  scene.traverse((child) => {
    updateGlow(child);
    collectWeatherTarget(targets, child);
  });
  // Retain the original glow -> atmosphere -> weather ordering in the render loop.
  updateAtmosphere?.();
  updateWeatherTargets(targets, frameState, now);
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

  const skyControlsChanged = state.settings.skyboxHue !== adminSettings.skyboxHue
    || state.settings.skyboxBrightness !== adminSettings.skyboxBrightness;
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

  let skyType = 'cyberpunk';
  const activeCustomMap = resolveActiveCustomMap({
    customMap,
    replayData,
    selectedMap,
    gameMode: adminSettings.gameMode,
  });
  const effectiveMapId = replayData ? replayData.mapType : selectedMap;
  const isHangar = effectiveMapId === 'hangar';

  if (effectiveMapId === 'circle' && !activeCustomMap) {
    refs.scene.background = new THREE.Color('#17232f');
    refs.scene.fog?.color.set('#17232f');
    if (refs.skyboxMesh) {
      refs.skyboxMesh.visible = adminSettings.showSkybox !== false;
      if (skyControlsChanged && refs.skyboxMesh.material instanceof THREE.ShaderMaterial) {
        updateCircleSkyMaterial(refs.skyboxMesh.material, hue, brightness);
      }
    }
    return;
  }

  if (isHangar && !activeCustomMap) {
    // The enclosed hangar owns its lighting. Explicit sky controls still work,
    // but unrelated settings must not recreate the old laser/shaft atmosphere.
    if (refs.skyboxMesh) {
      refs.skyboxMesh.visible = adminSettings.showSkybox !== false;
      if (skyControlsChanged && refs.skyboxMesh.material instanceof THREE.MeshBasicMaterial) {
        refs.skyboxMesh.material.map = getSkyboxTexture('hangar', hue, brightness, colorString);
        refs.skyboxMesh.material.needsUpdate = true;
      }
    }
    if (skyControlsChanged) {
      refs.scene.background = finalColor;
      refs.scene.fog?.color.copy(finalColor);
    }
    return;
  }

  if (syncStadiumVisualStateForRefs({ refs, activeCustomMap, adminSettings, skyControlsChanged })) return;

  refs.scene.background = finalColor;
  if (refs.scene.fog) refs.scene.fog.color.copy(finalColor);

  if (activeCustomMap?.id === 'forerunner_canyon' || activeCustomMap?.id === 'cyber_hex_arena' || activeCustomMap?.id === 'botanical_outpost' || activeCustomMap?.id === 'vanguard_starbase' || activeCustomMap?.id === 'synthwave_grid_arena' || activeCustomMap?.id === 'rainy_industrial_streets' || activeCustomMap?.id === 'winter_glacier_rink') {
    // This scene owns its outdoor sky; updating settings must not resurrect the
    // legacy yellow backdrop/laser atmosphere or replace the shader with a map.
    const isCyber = activeCustomMap.id === 'cyber_hex_arena';
    const isJungle = activeCustomMap.id === 'botanical_outpost';
    const isAsteroid = activeCustomMap.id === 'vanguard_starbase';
    const isNeon = activeCustomMap.id === 'synthwave_grid_arena';
    const isRainy = activeCustomMap.id === 'rainy_industrial_streets';
    const isGlacier = activeCustomMap.id === 'winter_glacier_rink';
    const fogColor = isGlacier ? '#9bafbc' : isRainy ? '#101c28' : isNeon ? '#323747' : isAsteroid ? '#101824' : isJungle ? '#7e9187' : isCyber ? '#182333' : '#9a7c66';
    refs.scene.background = new THREE.Color(fogColor);
    if (refs.scene.fog) refs.scene.fog.color.set(fogColor);
    if (refs.skyboxMesh) {
      refs.skyboxMesh.visible = adminSettings.showSkybox !== false;
      const material = refs.skyboxMesh.material;
      if (skyControlsChanged && material instanceof THREE.ShaderMaterial) {
        if (isGlacier) updateGlacierSkyMaterial(material, hue, brightness);
        else if (isRainy) updateRainySkyMaterial(material, hue, brightness);
        else if (isNeon) updateNeonSkyMaterial(material, hue, brightness);
        else if (isAsteroid) updateAsteroidSkyMaterial(material, hue, brightness);
        else if (isJungle) updateJungleSkyMaterial(material, hue, brightness);
        else if (isCyber) updateCyberSkyMaterial(material, hue, brightness);
        else updateCanyonSkyMaterial(material, hue, brightness);
      }
    }
    return;
  }

  if (activeCustomMap) {
    skyType = activeCustomMap.skyboxTexture || activeCustomMap.theme || 'cyberpunk';
    if (skyType === 'matched') {
      skyType = activeCustomMap.theme || 'cyberpunk';
    }
  } else if (isHangar) {
    skyType = 'hangar';
  }

  if (refs.skyboxMesh && refs.skyboxMesh.material) {
    refs.skyboxMesh.visible = adminSettings.showSkybox !== false;

    try {
      const newTex = getSkyboxTexture(skyType, hue, brightness, colorString);
      const mat = refs.skyboxMesh.material as THREE.MeshBasicMaterial;
      mat.map = newTex;
      mat.needsUpdate = true;
    } catch (err) {
      console.error('Failed to update skybox texture:', err);
    }
  }

  syncSkyAtmosphereForRefs({
    refs,
    skyboxTexture: skyType,
    atmosphere: activeCustomMap?.atmosphere,
    visible: adminSettings.showSkybox !== false,
  });
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
  const targets: WeatherTargets = {};
  scene.traverse(object => collectWeatherTarget(targets, object));
  updateWeatherTargets(targets, frameState, now);
};

const updateWeatherTargets = (targets: WeatherTargets, frameState: WeatherParticleFrameState, now: number): void => {
  updateRainyWeather(targets.rainy, now);
  updateGlacierWeather(targets.glacier, now);
  const rainObj = targets.rain;
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

  const snowObj = targets.snow;
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
