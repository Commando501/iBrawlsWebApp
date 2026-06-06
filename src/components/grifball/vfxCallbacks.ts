import * as THREE from 'three';
import { type SwordLungeCurrentTrailStyle } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import {
  disposeTransientVfxRefs,
  renderHammerSplashVfxForThreeRefs,
  renderSwordLungeTrailVfxForThreeRefs,
  resetTransientVfxRefs,
  spawnBurnDecalForThreeRefs,
  spawnVoxelShockwaveParticlesForThreeRefs,
} from './vfxSystems';

export function createVfxCallbacksForState({
  getState,
  getRefs,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
}) {
  const spawnBurnDecal = (pos: THREE.Vector3, radius: number) =>
    spawnBurnDecalForThreeRefs(getRefs(), pos, radius);

  const resetTransientVfx = () =>
    resetTransientVfxRefs(getRefs());

  const disposeTransientVfx = () =>
    disposeTransientVfxRefs(getRefs());

  const spawnVoxelShockwaveParticles = (impactCenter: THREE.Vector3, color: string) => {
    spawnVoxelShockwaveParticlesForThreeRefs(getRefs(), impactCenter, color);
  };

  const renderHammerSplashVfx = (impactCenter: THREE.Vector3, color: string, radius: number) => {
    const state = getState();
    renderHammerSplashVfxForThreeRefs({
      refs: getRefs(),
      impactCenter,
      color,
      radius,
      splashVfx: state.settings.hammerSplashVfx ?? 'current',
      enableBurnDecals: !!state.settings.enableBurnDecals,
    });
  };

  const renderSwordLungeTrailVfx = (
    trailPos: THREE.Vector3,
    color: string,
    direction?: THREE.Vector3,
    currentStyle: SwordLungeCurrentTrailStyle = 'localCube'
  ) => {
    renderSwordLungeTrailVfxForThreeRefs({
      refs: getRefs(),
      trailPos,
      color,
      direction,
      currentStyle,
      swordLungeVfx: getState().settings.swordLungeVfx ?? 'current',
    });
  };

  return {
    spawnBurnDecal,
    resetTransientVfx,
    disposeTransientVfx,
    spawnVoxelShockwaveParticles,
    renderHammerSplashVfx,
    renderSwordLungeTrailVfx,
  };
}
