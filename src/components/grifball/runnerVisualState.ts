import * as THREE from 'three';

export const RUNNER_ARMOR_ORANGE = new THREE.Color('#f97316');
export const RUNNER_DAMAGE_RED = new THREE.Color('#ef4444');
export const RUNNER_HEAL_BLUE = new THREE.Color('#38bdf8');

const DAMAGE_FLASH_DURATION_MS = 850;
const HEAL_WAVE_DURATION_MS = 900;
const RUNNER_HEAL_WAVE_NAME = 'runner-heal-wave';

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
};

type RunnerVisualState = {
  vertexColors: VertexColorSnapshot[];
  materials: MaterialSnapshot[];
  lastHp?: number;
  damageStartMs?: number;
  damageUntilMs?: number;
  healWaveStartMs?: number;
  wave?: THREE.Mesh;
};

export type RunnerVisualUpdateInput = {
  group: THREE.Group | null | undefined;
  carrying: boolean;
  hp: number;
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
    if (!(child instanceof THREE.Mesh) || child.userData.teamOutlineMesh === true) return;

    const colorAttribute = child.geometry.getAttribute('color');
    if (
      colorAttribute instanceof THREE.BufferAttribute &&
      !state.vertexColors.some((entry) => entry.attribute === colorAttribute)
    ) {
      state.vertexColors.push({
        attribute: colorAttribute,
        colors: new Float32Array(colorAttribute.array as ArrayLike<number>),
      });
    }

    materialList(child.material).forEach((material) => {
      findMaterialSnapshot(state, material);
    });
  });
};

const setVertexColors = (state: RunnerVisualState, color: THREE.Color): void => {
  state.vertexColors.forEach(({ attribute }) => {
    for (let i = 0; i < attribute.count; i += 1) {
      attribute.setXYZ(i, color.r, color.g, color.b);
    }
    attribute.needsUpdate = true;
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
    material.needsUpdate = true;
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
    if (snapshot.transparent !== undefined) material.transparent = snapshot.transparent;
    if (snapshot.opacity !== undefined) material.opacity = snapshot.opacity;
    material.needsUpdate = true;
  });
};

const createHealWave = (): THREE.Mesh => {
  const geometry = new THREE.TorusGeometry(0.78, 0.035, 8, 48);
  const material = new THREE.MeshBasicMaterial({
    color: RUNNER_HEAL_BLUE,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const wave = new THREE.Mesh(geometry, material);
  wave.name = RUNNER_HEAL_WAVE_NAME;
  wave.rotation.x = Math.PI / 2;
  wave.renderOrder = 6;
  return wave;
};

const syncHealWave = (
  group: THREE.Group,
  state: RunnerVisualState,
  nowMs: number
): void => {
  if (state.healWaveStartMs === undefined) {
    if (state.wave) state.wave.visible = false;
    return;
  }

  const elapsed = nowMs - state.healWaveStartMs;
  if (elapsed >= HEAL_WAVE_DURATION_MS) {
    state.healWaveStartMs = undefined;
    if (state.wave) state.wave.visible = false;
    return;
  }

  if (!state.wave) {
    state.wave = createHealWave();
    group.add(state.wave);
  } else if (state.wave.parent !== group) {
    group.add(state.wave);
  }

  const progress = THREE.MathUtils.clamp(elapsed / HEAL_WAVE_DURATION_MS, 0, 1);
  state.wave.visible = true;
  state.wave.position.set(0, THREE.MathUtils.lerp(-0.75, 1.25, progress), 0);
  state.wave.scale.setScalar(THREE.MathUtils.lerp(0.75, 1.12, Math.sin(progress * Math.PI)));
  const material = state.wave.material as THREE.MeshBasicMaterial;
  material.opacity = 0.78 * (1 - progress);
};

const clearHealWave = (group: THREE.Group, state: RunnerVisualState): void => {
  const wave = state.wave ?? group.children.find((child) => child.name === RUNNER_HEAL_WAVE_NAME);
  if (wave) {
    group.remove(wave);
    if (wave instanceof THREE.Mesh) {
      wave.geometry.dispose();
      materialList(wave.material).forEach((material) => material.dispose());
    }
  }
  state.wave = undefined;
  state.healWaveStartMs = undefined;
};

export const clearRunnerVisualStateForGroup = (group: THREE.Group | null | undefined): void => {
  if (!group) return;
  const state = getRunnerVisualState(group);
  restoreVertexColors(state);
  restoreMaterials(state);
  clearHealWave(group, state);
  state.lastHp = undefined;
  state.damageStartMs = undefined;
  state.damageUntilMs = undefined;
};

export const updateRunnerVisualStateForGroup = ({
  group,
  carrying,
  hp,
  alive,
  nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(),
}: RunnerVisualUpdateInput): void => {
  if (!group) return;
  const state = getRunnerVisualState(group);
  captureVisualState(group, state);

  if (!carrying || !alive || hp <= 0) {
    clearRunnerVisualStateForGroup(group);
    return;
  }

  if (state.lastHp !== undefined) {
    if (hp < state.lastHp) {
      state.damageStartMs = nowMs;
      state.damageUntilMs = nowMs + DAMAGE_FLASH_DURATION_MS;
    } else if (hp > state.lastHp) {
      state.healWaveStartMs = nowMs;
    }
  }
  state.lastHp = hp;

  setVertexColors(state, RUNNER_ARMOR_ORANGE);

  const damageActive = state.damageUntilMs !== undefined && nowMs < state.damageUntilMs;
  if (damageActive) {
    const damageElapsed = nowMs - (state.damageStartMs ?? nowMs);
    const pulse = 0.45 + Math.max(0, Math.sin(damageElapsed * 0.035)) * 1.55;
    applyMaterialGlow(state, RUNNER_DAMAGE_RED, pulse);
  } else {
    state.damageStartMs = undefined;
    state.damageUntilMs = undefined;
    applyMaterialGlow(state, null, 0);
  }

  syncHealWave(group, state, nowMs);
};
