import * as THREE from 'three';
import {
  recoverAIFromRunawayAltitude as applyAIAltitudeRecovery,
  type RecoverableBotState,
} from '../../game/aiAltitude';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { MAIN_AI_ID } from '../../game/roster';
import { type UniversalSettings } from '../../types';
import { AI_HAMMER_JUMP_COOLDOWN } from './combatGeometry';

type RecoverableCombatantAltitudeState = RecoverableBotState & {
  id?: string;
  isJumping?: boolean;
  hammerJumpPlanned?: boolean;
  hammerJumpType?: unknown;
  hammerJumpWindowTimer?: number;
};

export const recoverAICombatantFromRunawayAltitude = (
  settings: UniversalSettings,
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  botState?: RecoverableBotState
): boolean => {
  const tuning = resolveBehaviorTuning(settings);
  return applyAIAltitudeRecovery(pos, vel, botState, {
    maxAirborneHeight: tuning.maxAirborneHeight,
    forcedDescentSpeed: tuning.forcedDescentSpeed,
    hammerJumpCooldown: AI_HAMMER_JUMP_COOLDOWN,
  });
};

// Main AI retains a few legacy flat-state fields that must be reset alongside
// the shared altitude clamp while the roster migration remains in progress.
export const recoverCombatantAltitude = (
  settings: UniversalSettings,
  self: RecoverableCombatantAltitudeState,
  pos: THREE.Vector3,
  vel: THREE.Vector3
): boolean => {
  const recovered = recoverAICombatantFromRunawayAltitude(settings, pos, vel, self);
  if (recovered && self.id === MAIN_AI_ID) {
    self.isJumping = true;
    self.hammerJumpPlanned = false;
    self.hammerJumpType = undefined;
    self.hammerJumpWindowTimer = 0;
  }
  return recovered;
};
