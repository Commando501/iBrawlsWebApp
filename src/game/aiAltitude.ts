export const AI_MAX_AIRBORNE_HEIGHT = 14.0;
export const AI_FORCED_DESCENT_SPEED = -12.0;

export interface MutableVector3Like {
  x: number;
  y: number;
  z: number;
}

export interface RecoverableBotState {
  weaponState?: string;
  weaponTimer?: number;
  aiHammerJumpCooldownTimer?: number;
}

export interface AltitudeRecoveryConfig {
  maxAirborneHeight?: number;
  forcedDescentSpeed?: number;
  hammerJumpCooldown: number;
}

export function recoverAIFromRunawayAltitude(
  pos: MutableVector3Like,
  vel: MutableVector3Like,
  botState: RecoverableBotState | undefined,
  config: AltitudeRecoveryConfig
): boolean {
  const maxAirborneHeight = config.maxAirborneHeight ?? AI_MAX_AIRBORNE_HEIGHT;
  if (pos.y <= maxAirborneHeight) return false;

  pos.y = maxAirborneHeight;
  vel.y = Math.min(vel.y, config.forcedDescentSpeed ?? AI_FORCED_DESCENT_SPEED);
  vel.x *= 0.25;
  vel.z *= 0.25;

  if (botState) {
    botState.weaponState = 'ready';
    botState.weaponTimer = 0;
    botState.aiHammerJumpCooldownTimer = config.hammerJumpCooldown;
  }

  return true;
}
