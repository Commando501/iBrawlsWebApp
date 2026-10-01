import type { AIBehaviorState, UniversalSettings } from '../types';
import { shouldCommitChargeAfterEvasion, type PostEvasionCommitInput } from './aiSpatialStrategy';

type Point = { x: number; y: number; z: number };
export interface AIDashMotionFrame {
  pos: Point;
  vel: Point;
  dashDir: Point;
  aiState: AIBehaviorState | undefined;
  dashRemaining: number;
  slideActive: boolean;
  slideCooldownTimer: number;
  pendingPostEvasionCharge: boolean;
  isSprinting: boolean;
}

/** Mechanical dash travel and its end-of-dash decision. Call only after
 * engagement gravity and the airborne-recovery early return. */
export function advanceAIDashMotion(settings: Pick<UniversalSettings, 'dashDistance' | 'dashDuration' | 'slideCooldown'>,
  frame: AIDashMotionFrame, dt: number, target: PostEvasionCommitInput): void {
  if (frame.slideActive) {
    frame.slideActive = false;
    frame.slideCooldownTimer = settings.slideCooldown ?? 1.5;
  }
  frame.isSprinting = false;
  frame.dashRemaining = Math.max(0, frame.dashRemaining - dt);
  const speed = settings.dashDistance / (settings.dashDuration || .25);
  frame.vel.x = frame.dashDir.x * speed;
  frame.vel.y = frame.dashDir.y * speed;
  frame.vel.z = frame.dashDir.z * speed;
  frame.pos.x += frame.vel.x * dt;
  frame.pos.y += frame.vel.y * dt;
  frame.pos.z += frame.vel.z * dt;
  if (frame.dashRemaining <= 0 && frame.pendingPostEvasionCharge) {
    if (shouldCommitChargeAfterEvasion(target)) frame.aiState = 'CHARGE_ATTACK';
    frame.pendingPostEvasionCharge = false;
  }
}

/** Spatial dodge initiation has no grounded-only player-dash gate. A selected
 * airborne dodge waits for recovery before its duration can advance. */
export function startAISpatialDodgeMotion(settings: Pick<UniversalSettings, 'dashDuration' | 'dashCooldown'>,
  frame: { dashDir: Point; dashRemaining: number; dashCooldownTimer: number }, direction: { x: number; z: number }): void {
  const inverseLength = 1 / (Math.sqrt(direction.x * direction.x + direction.z * direction.z) || 1);
  frame.dashDir.x = direction.x * inverseLength; frame.dashDir.y = 0; frame.dashDir.z = direction.z * inverseLength;
  frame.dashRemaining = settings.dashDuration || .25;
  frame.dashCooldownTimer = settings.dashCooldown || 2;
}

/** Final live engagement velocity handling, after arena constraints. */
export function finishAIHorizontalMotion(self: { isJumping?: boolean }, frame: Pick<AIDashMotionFrame, 'pos' | 'vel' | 'aiState'>): void {
  if (frame.aiState !== 'LUNGING' && !(self.isJumping || frame.pos.y > .01)) {
    frame.vel.y = 0;
    self.isJumping = false;
  }
  const airborne = self.isJumping || frame.pos.y > .01 || Math.abs(frame.vel.y) > .01;
  if (airborne && frame.aiState !== 'LUNGING') {
    frame.vel.x *= .05;
    frame.vel.z *= .05;
  }
}
