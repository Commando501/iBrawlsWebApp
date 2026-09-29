import type * as THREE from 'three';
import type { Combatant, UniversalSettings } from '../../types';

/** Consume a queued main-AI jump at hammer contact in either animation owner. */
export function applyAIHammerJumpAtImpact(
  self: Combatant,
  settings: Pick<UniversalSettings, 'hammerJumpTriggerRadius' | 'hammerJumpWindow' | 'hammerJumpAirLimit' | 'hammerJumpPower'>,
  impactPos: THREE.Vector3,
): boolean {
  let launched = false;
  if (self.hp > 0 && (self.respawnTimer ?? 0) <= 0 && self.activeWeapon === 'hammer' &&
    impactPos.distanceTo(self.pos) <= (settings.hammerJumpTriggerRadius ?? 3.5)) {
    self.hammerJumpWindowTimer = settings.hammerJumpWindow ?? .6;
    const limit = settings.hammerJumpAirLimit ?? 1;
    if (self.hammerJumpPlanned && limit > 0 && (limit === 10 || (self.aiHammerJumpsInAir ?? 0) < limit)) {
      self.isJumping = true;
      self.vel.y = 7.2 + (settings.hammerJumpPower ?? 6.5);
      self.aiHammerJumpsInAir = (self.aiHammerJumpsInAir ?? 0) + 1;
      launched = true;
    }
  }
  self.hammerJumpPlanned = false;
  self.hammerJumpType = undefined;
  return launched;
}
