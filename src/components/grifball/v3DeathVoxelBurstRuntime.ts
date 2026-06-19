import * as THREE from 'three';
import type { V3QualityTier } from '../v3/v3ModelTypes';
import type { GrifballThreeRefs } from './threeRefs';
import {
  createV3DeathVoxelBurst,
  disposeV3DeathVoxelBurst,
  updateV3DeathVoxelBurst,
} from './v3DeathVoxelBurst';

export interface V3DeathVoxelBurstSyncOptions {
  refs: GrifballThreeRefs;
  id: string;
  model: THREE.Object3D | null | undefined;
  weapons?: readonly (THREE.Object3D | null | undefined)[];
  alive: boolean;
  dt?: number;
  qualityTier?: V3QualityTier;
  seed?: number;
}

const isV3Model = (model: THREE.Object3D | null | undefined): model is THREE.Object3D =>
  Boolean(model && model.userData.modelSystem === 'v3');

const hideObjects = (objects: readonly (THREE.Object3D | null | undefined)[] = []): void => {
  for (const object of objects) {
    if (object) object.visible = false;
  }
};

const ensureBurstState = (refs: GrifballThreeRefs): void => {
  refs.v3DeathVoxelBursts ??= new Map();
  refs.v3DeathAliveState ??= new Map();
};

export function clearV3DeathVoxelBurstForCombatant(refs: GrifballThreeRefs, id: string): void {
  ensureBurstState(refs);
  const instance = refs.v3DeathVoxelBursts.get(id);
  if (instance) {
    disposeV3DeathVoxelBurst(instance);
    refs.v3DeathVoxelBursts.delete(id);
  }
  refs.v3DeathAliveState.delete(id);
}

export function clearAllV3DeathVoxelBursts(refs: GrifballThreeRefs): void {
  ensureBurstState(refs);
  for (const id of refs.v3DeathVoxelBursts.keys()) {
    clearV3DeathVoxelBurstForCombatant(refs, id);
  }
  refs.v3DeathAliveState.clear();
}

export function syncV3DeathVoxelBurstForCombatant({
  refs,
  id,
  model,
  weapons = [],
  alive,
  dt = 0,
  qualityTier,
  seed,
}: V3DeathVoxelBurstSyncOptions): boolean {
  ensureBurstState(refs);
  if (!isV3Model(model) || !refs.scene) {
    clearV3DeathVoxelBurstForCombatant(refs, id);
    refs.v3DeathAliveState.set(id, alive);
    return false;
  }

  if (alive) {
    clearV3DeathVoxelBurstForCombatant(refs, id);
    refs.v3DeathAliveState.set(id, true);
    model.userData.v3DeathBurstActive = false;
    return false;
  }

  const wasAlive = refs.v3DeathAliveState.get(id);
  let instance = refs.v3DeathVoxelBursts.get(id);
  if (wasAlive === true && !instance) {
    instance = createV3DeathVoxelBurst(refs.scene, model, {
      qualityTier: qualityTier ?? model.userData.appliedV3QualityTier ?? model.userData.v3QualityTier,
      seed,
    }) ?? undefined;
    if (instance) {
      refs.v3DeathVoxelBursts.set(id, instance);
    }
  }

  refs.v3DeathAliveState.set(id, false);
  model.visible = false;
  model.userData.v3DeathBurstActive = Boolean(instance);
  hideObjects(weapons);

  if (instance) {
    const active = updateV3DeathVoxelBurst(instance, dt);
    if (!active) {
      disposeV3DeathVoxelBurst(instance);
      refs.v3DeathVoxelBursts.delete(id);
      model.userData.v3DeathBurstActive = false;
      return false;
    }
  }

  return Boolean(instance);
}
