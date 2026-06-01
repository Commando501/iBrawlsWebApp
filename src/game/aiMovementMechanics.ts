/**
 * Pure decision logic for the AI's use of the optional locomotion mechanics
 * (sprint and slide) that the player can toggle and tune in the Gameplay /
 * Mechanics Options menu. The orchestrator in GrifballGame.tsx feeds live
 * `settings` values in here every frame, so any change the player makes to the
 * toggles, speeds, distances or cooldowns is honoured immediately.
 */

export type AIMovementState = string;

/** Ground speed (m/s) the player walks at; used to scale AI sprint/slide so the AI keeps pace. */
export const AI_BASE_GROUND_SPEED = 5.8;
/** AI must be at least this far beyond its engage range before it bothers sprinting to close. */
export const SPRINT_ENGAGE_GAP = 5.0;
/** A target receding at or above this speed (m/s) triggers a chase sprint even at shorter gaps. */
export const SPRINT_CHASE_TARGET_SPEED = 4.5;
/** Behaviour states during which sprinting forward is sensible. */
export const SPRINT_STATES = new Set<AIMovementState>(['APPROACHING', 'DANCING_FORWARD', 'PRESSURING']);

/** Slide is only considered as a committed gap-closer inside this band beyond the engage range. */
export const SLIDE_MIN_GAP = 4.0;
export const SLIDE_MAX_GAP = 13.0;
/** Minimum strafe/evade complexity for the AI to bother sliding. */
export const SLIDE_MIN_COMPLEXITY = 40;
/** Per-frame probability of committing to a slide while eligible (~one every ~0.8s at 60fps). */
export const SLIDE_TRIGGER_CHANCE = 0.02;

/**
 * Component of the target's velocity directed straight away from the AI.
 * Positive means the target is fleeing; negative means closing.
 */
export function getTargetRecedingSpeed(
  aiX: number,
  aiZ: number,
  targetX: number,
  targetZ: number,
  targetVelX: number,
  targetVelZ: number,
): number {
  const dx = targetX - aiX;
  const dz = targetZ - aiZ;
  const len = Math.hypot(dx, dz);
  if (len <= 1e-4) {
    return 0;
  }
  return (targetVelX * dx + targetVelZ * dz) / len;
}

export interface SprintDecisionInput {
  enableSprint: boolean;
  state: AIMovementState;
  distanceToTarget: number;
  engageRange: number;
  isCrouching: boolean;
  isDashing: boolean;
  isSliding: boolean;
  /** Target's recede speed from getTargetRecedingSpeed; >0 means fleeing. */
  targetRecedingSpeed: number;
  /** Tuning overrides (default to module constants). */
  engageGap?: number;
  chaseTargetSpeed?: number;
}

/**
 * Sprint when the mechanic is enabled and the AI needs to cover ground: either it
 * is well outside its engage range, or the target is actively fleeing. Mirrors the
 * player's sprint preconditions (not crouching, not dashing/sliding).
 */
export function shouldAISprint(input: SprintDecisionInput): boolean {
  if (!input.enableSprint || input.isCrouching || input.isDashing || input.isSliding) {
    return false;
  }
  if (!SPRINT_STATES.has(input.state)) {
    return false;
  }
  const engageGap = input.engageGap ?? SPRINT_ENGAGE_GAP;
  const chaseTargetSpeed = input.chaseTargetSpeed ?? SPRINT_CHASE_TARGET_SPEED;
  const farEnough = input.distanceToTarget > input.engageRange + engageGap;
  const targetFleeing =
    input.targetRecedingSpeed >= chaseTargetSpeed &&
    input.distanceToTarget > input.engageRange + 1.0;
  return farEnough || targetFleeing;
}

/** Sprint forward-speed multiplier, scaled from the live `speedSprint` percentage. */
export function getSprintSpeedMultiplier(speedSprint: number | undefined): number {
  return Math.max(0.2, (speedSprint ?? 100) / 100);
}

export interface SlideStartInput {
  enableSlide: boolean;
  slideCooldownRemaining: number;
  state: AIMovementState;
  distanceToTarget: number;
  engageRange: number;
  movementComplexity: number;
  isDashing: boolean;
  isSliding: boolean;
  targetProtected: boolean;
  rng?: number;
  /** Tuning overrides (default to module constants). */
  minComplexity?: number;
  minGap?: number;
  maxGap?: number;
  triggerChance?: number;
}

/**
 * Decide whether to begin a slide. Slides are a committed ground burst, so they
 * are only started while approaching at medium range, off cooldown, and with
 * enough movement complexity to justify the flourish.
 */
export function shouldStartAISlide(input: SlideStartInput): boolean {
  if (!input.enableSlide || input.isDashing || input.isSliding) {
    return false;
  }
  if (input.slideCooldownRemaining > 0 || input.targetProtected) {
    return false;
  }
  if (input.movementComplexity < (input.minComplexity ?? SLIDE_MIN_COMPLEXITY)) {
    return false;
  }
  if (input.state !== 'APPROACHING') {
    return false;
  }
  const gap = input.distanceToTarget - input.engageRange;
  if (gap < (input.minGap ?? SLIDE_MIN_GAP) || gap > (input.maxGap ?? SLIDE_MAX_GAP)) {
    return false;
  }
  const rng = input.rng ?? Math.random();
  return rng < (input.triggerChance ?? SLIDE_TRIGGER_CHANCE);
}

/** Slide ground speed (m/s), scaled from the live `speedSlide` percentage. */
export function getSlideSpeed(speedSlide: number | undefined, baseGroundSpeed: number = AI_BASE_GROUND_SPEED): number {
  return baseGroundSpeed * Math.max(0.2, (speedSlide ?? 100) / 100);
}

export interface SlideAdvanceInput {
  distanceTraveled: number;
  slideSpeed: number;
  dt: number;
  maxSlideDistance: number;
}

export interface SlideAdvanceResult {
  distanceTraveled: number;
  finished: boolean;
}

/** Accumulate slide distance for the frame and report whether the slide should end. */
export function advanceAISlide(input: SlideAdvanceInput): SlideAdvanceResult {
  const distanceTraveled = input.distanceTraveled + input.slideSpeed * Math.max(0, input.dt);
  return {
    distanceTraveled,
    finished: distanceTraveled >= input.maxSlideDistance,
  };
}
