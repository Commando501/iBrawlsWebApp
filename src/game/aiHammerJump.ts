import type { Combatant, UniversalSettings } from '../types';
import { MAIN_AI_ID } from './roster';

type Vector = { x: number; y: number; z: number };
export type AIHammerJumpType = 'offensive' | 'defensive';
export type HammerJumpSettings = Pick<UniversalSettings, 'hammerJumpAirLimit' | 'hammerJumpPower'>;
type JumpActor = Pick<Combatant, 'id' | 'weaponState' | 'weaponTimer' | 'isJumping' | 'aiHammerJumpsInAir' | 'hammerJumpPlanned' | 'hammerJumpType'>;

export function canStartAIHammerJump(self: Pick<JumpActor, 'weaponState' | 'aiHammerJumpsInAir'>, settings: HammerJumpSettings): boolean {
  const limit = settings.hammerJumpAirLimit ?? 1;
  return limit > 0 && (limit === 10 || (self.aiHammerJumpsInAir ?? 0) < limit) && self.weaponState === 'ready';
}

/** Ordinary bots launch immediately. Main AI commits a swing and consumes its
 * plan at impact; a rejected swing must not leave a latent jump. No RNG or clocks. */
export function startAIHammerJumpAction({ self, settings, vel, horizontalHeading, jumpType = 'offensive',
  onMainAIHammerSwing, playSwing, playJump }: {
  self: JumpActor; settings: HammerJumpSettings; vel: Vector; horizontalHeading?: Vector; jumpType?: AIHammerJumpType;
  onMainAIHammerSwing: () => void; playSwing: () => void; playJump: () => void;
}): boolean {
  if (!canStartAIHammerJump(self, settings)) return false;
  if (self.id === MAIN_AI_ID) {
    self.hammerJumpPlanned = true; self.hammerJumpType = jumpType;
    onMainAIHammerSwing();
    if (self.weaponState !== 'swing_up') {
      self.hammerJumpPlanned = false; self.hammerJumpType = undefined;
      return false;
    }
  } else {
    self.weaponState = 'swing_up'; self.weaponTimer = 0;
    vel.y = 7.2 + (settings.hammerJumpPower ?? 6.5);
    self.isJumping = true; self.aiHammerJumpsInAir = (self.aiHammerJumpsInAir ?? 0) + 1;
    if (horizontalHeading) {
      const { x, y, z } = horizontalHeading, lengthSq = x * x + y * y + z * z;
      if (lengthSq > .0001) {
        const inverse = 1 / Math.sqrt(lengthSq);
        vel.x = x * inverse * 6.5; vel.z = z * inverse * 6.5;
      }
    }
    playSwing(); playJump();
  }
  return true;
}

/** Consume a queued main-AI jump at hammer contact in either animation owner. */
export function applyAIHammerJumpAtImpact(
  self: Pick<Combatant, 'hp' | 'respawnTimer' | 'activeWeapon' | 'hammerJumpWindowTimer' | 'hammerJumpPlanned' |
    'hammerJumpType' | 'aiHammerJumpsInAir' | 'isJumping'> & { pos: Vector; vel: Vector },
  settings: Pick<UniversalSettings, 'hammerJumpTriggerRadius' | 'hammerJumpWindow' | 'hammerJumpAirLimit' | 'hammerJumpPower'>,
  impactPos: Vector,
): boolean {
  let launched = false;
  const dx = impactPos.x - self.pos.x, dy = impactPos.y - self.pos.y, dz = impactPos.z - self.pos.z;
  if (self.hp > 0 && (self.respawnTimer ?? 0) <= 0 && self.activeWeapon === 'hammer' &&
    Math.sqrt(dx * dx + dy * dy + dz * dz) <= (settings.hammerJumpTriggerRadius ?? 3.5)) {
    self.hammerJumpWindowTimer = settings.hammerJumpWindow ?? .6;
    const limit = settings.hammerJumpAirLimit ?? 1;
    if (self.hammerJumpPlanned && limit > 0 && (limit === 10 || (self.aiHammerJumpsInAir ?? 0) < limit)) {
      self.isJumping = true; self.vel.y = 7.2 + (settings.hammerJumpPower ?? 6.5);
      self.aiHammerJumpsInAir = (self.aiHammerJumpsInAir ?? 0) + 1; launched = true;
    }
  }
  self.hammerJumpPlanned = false; self.hammerJumpType = undefined;
  return launched;
}
