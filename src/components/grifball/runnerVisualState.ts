import * as THREE from 'three';
import { getCombatantTeamArmorState, RUNNER_ARMOR_COLOR, syncCombatantRunnerArmor } from './combatantTeamArmor';
import { syncRunnerShieldRipple } from './runnerShieldRipple';

export const RUNNER_ARMOR_ORANGE = new THREE.Color(RUNNER_ARMOR_COLOR);
export const RUNNER_DAMAGE_RED = new THREE.Color('#ff2448');
export const RUNNER_HEAL_BLUE = new THREE.Color('#259dff');

// Bridge the gaps between network snapshots without restarting the recharge sweep.
const HEAL_SAMPLE_GRACE_MS = 500;

type MaterialSnapshot = {
  material: THREE.Material;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
};

type VertexColorSnapshot = {
  attribute: THREE.BufferAttribute;
  colors: Float32Array;
  painted: boolean;
};

type RunnerVisualState = {
  vertexColors: VertexColorSnapshot[];
  materials: MaterialSnapshot[];
  lastHp?: number;
  lastHealMs?: number;
  healWaveStartMs?: number;
  worldPosition: THREE.Vector3;
};

export type RunnerVisualUpdateInput = {
  group: THREE.Group | null | undefined;
  carrying: boolean;
  hp: number;
  maxHp?: number;
  alive: boolean;
  nowMs?: number;
};

const getRunnerVisualState = (group: THREE.Group): RunnerVisualState => {
  const existing = group.userData.runnerVisualState;
  if (existing && typeof existing === 'object') {
    return existing as RunnerVisualState;
  }

  const state: RunnerVisualState = {
    vertexColors: [],
    materials: [],
    worldPosition: new THREE.Vector3(),
  };
  group.userData.runnerVisualState = state;
  return state;
};

const materialList = (material: THREE.Material | THREE.Material[]): THREE.Material[] =>
  Array.isArray(material) ? material : [material];

const findMaterialSnapshot = (
  state: RunnerVisualState,
  material: THREE.Material
): MaterialSnapshot => {
  let snapshot = state.materials.find((entry) => entry.material === material);
  if (snapshot) return snapshot;

  const maybeColored = material as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    opacity?: number;
    transparent?: boolean;
  };
  snapshot = {
    material,
    color: maybeColored.color?.clone(),
    emissive: maybeColored.emissive?.clone(),
    emissiveIntensity: maybeColored.emissiveIntensity,
    transparent: maybeColored.transparent,
    opacity: maybeColored.opacity,
  };
  state.materials.push(snapshot);
  return snapshot;
};

const captureVisualState = (group: THREE.Group, state: RunnerVisualState): void => {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.userData.teamArmorMesh === true) return;

    const colorAttribute = child.geometry.getAttribute('color');
    if (
      colorAttribute instanceof THREE.BufferAttribute &&
      !state.vertexColors.some((entry) => entry.attribute === colorAttribute)
    ) {
      state.vertexColors.push({
        attribute: colorAttribute,
        colors: new Float32Array(colorAttribute.array as ArrayLike<number>),
        painted: false,
      });
    }

    materialList(child.material).forEach((material) => {
      findMaterialSnapshot(state, material);
    });
  });
};

const setVertexColors = (state: RunnerVisualState, color: THREE.Color): void => {
  state.vertexColors.forEach((snapshot) => {
    if (snapshot.painted) return;
    const { attribute } = snapshot;
    for (let i = 0; i < attribute.count; i += 1) {
      attribute.setXYZ(i, color.r, color.g, color.b);
    }
    attribute.needsUpdate = true;
    snapshot.painted = true;
  });
};

const restoreVertexColors = (state: RunnerVisualState): void => {
  state.vertexColors.forEach(({ attribute, colors }) => {
    (attribute.array as Float32Array).set(colors);
    attribute.needsUpdate = true;
  });
};

const applyMaterialGlow = (
  state: RunnerVisualState,
  color: THREE.Color | null,
  intensity: number
): void => {
  state.materials.forEach((snapshot) => {
    const material = snapshot.material as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
    };
    if (snapshot.color && !state.vertexColors.length && material.color) {
      material.color.copy(RUNNER_ARMOR_ORANGE);
    }
    if (material.emissive && snapshot.emissive) {
      material.emissive.copy(color ?? snapshot.emissive);
      material.emissiveIntensity = color ? intensity : (snapshot.emissiveIntensity ?? 0);
    }
    // Color and emissive values are uniforms, not shader configuration changes.
  });
};

const restoreMaterials = (state: RunnerVisualState): void => {
  state.materials.forEach((snapshot) => {
    const material = snapshot.material as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
    };
    if (snapshot.color && material.color) material.color.copy(snapshot.color);
    if (snapshot.emissive && material.emissive) material.emissive.copy(snapshot.emissive);
    if (snapshot.emissiveIntensity !== undefined) material.emissiveIntensity = snapshot.emissiveIntensity;
    if (snapshot.transparent !== undefined && material.transparent !== snapshot.transparent) {
      material.transparent = snapshot.transparent;
      material.needsUpdate = true;
    }
    if (snapshot.opacity !== undefined) material.opacity = snapshot.opacity;
  });
};

export const clearRunnerVisualStateForGroup = (group: THREE.Group | null | undefined): void => {
  if (!group) return;
  syncCombatantRunnerArmor(group, false);
  const state = group.userData.runnerVisualState as RunnerVisualState | undefined;
  if (!state || typeof state !== 'object') return;
  restoreVertexColors(state);
  restoreMaterials(state);
  state.materials.forEach(({ material }) => syncRunnerShieldRipple(material, null, 0, 0));
  const armor = getCombatantTeamArmorState(group);
  if (armor) syncRunnerShieldRipple(armor.material, null, 0, 0);
  // Release the old buffers and capture current customization on the next pickup.
  delete group.userData.runnerVisualState;
};

export const updateRunnerVisualStateForGroup = ({
  group,
  carrying,
  hp,
  maxHp = 2,
  alive,
  nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(),
}: RunnerVisualUpdateInput): void => {
  if (!group) return;
  if (!carrying || !alive || hp <= 0) {
    clearRunnerVisualStateForGroup(group);
    return;
  }
  syncCombatantRunnerArmor(group, true);
  const state = getRunnerVisualState(group);
  captureVisualState(group, state);

  // Reset the sweep if the caller's visual clock moves backwards.
  if (state.lastHealMs !== undefined && nowMs < state.lastHealMs) {
    state.lastHealMs = undefined;
    state.healWaveStartMs = undefined;
  }
  if (state.lastHp !== undefined) {
    if (hp < state.lastHp) {
      state.lastHealMs = undefined;
      state.healWaveStartMs = undefined;
    } else if (hp > state.lastHp) {
      state.lastHealMs = nowMs;
      state.healWaveStartMs ??= nowMs;
    }
  }
  state.lastHp = hp;

  setVertexColors(state, RUNNER_ARMOR_ORANGE);

  const damaged = hp < maxHp - 0.0001;
  const healing = damaged && state.lastHealMs !== undefined && nowMs - state.lastHealMs <= HEAL_SAMPLE_GRACE_MS;
  const rippleColor = healing ? RUNNER_HEAL_BLUE : damaged ? RUNNER_DAMAGE_RED : null;
  if (!healing) state.healWaveStartMs = undefined;
  const pulse = 0.12 + (0.5 + 0.5 * Math.sin(nowMs * 0.007)) * 0.18;
  applyMaterialGlow(state, rippleColor, pulse);
  group.getWorldPosition(state.worldPosition);
  const elapsedSeconds = (nowMs - (state.healWaveStartMs ?? 0)) / 1000;
  state.materials.forEach(({ material }) =>
    syncRunnerShieldRipple(material, rippleColor, elapsedSeconds, state.worldPosition.y));
  const armor = getCombatantTeamArmorState(group);
  if (armor) syncRunnerShieldRipple(armor.material, rippleColor, elapsedSeconds, state.worldPosition.y);
};
