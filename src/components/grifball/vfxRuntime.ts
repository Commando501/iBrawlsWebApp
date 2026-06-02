import {
  updateBurnDecalsForThreeRefs,
  updateExplosionParticlesForThreeRefs,
  updateHammerSplashFlashesForThreeRefs,
  updateSwordLungeSpeedLinesForThreeRefs,
  updateTracersForThreeRefs,
} from './vfxSystems';
import { type GrifballThreeRefs } from './threeRefs';

export function updateTransientVfxForFrame(refs: GrifballThreeRefs, dt: number): void {
  updateExplosionParticlesForThreeRefs(refs, dt);
  updateTracersForThreeRefs(refs, dt);
  updateHammerSplashFlashesForThreeRefs(refs, dt);
  updateSwordLungeSpeedLinesForThreeRefs(refs, dt);
  updateBurnDecalsForThreeRefs(refs, dt);
}
