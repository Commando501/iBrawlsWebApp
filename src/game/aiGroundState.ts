import type * as THREE from 'three';
import type { AIBehaviorState, UniversalSettings, WeaponState } from '../types';
import type { AICombatWeapon, AITacticalTargetSnapshot } from './aiCombatDecision';
import type { AIBehaviorTuning } from './aiBehaviorTuning';
import { simulationRandom } from './simulationRandom';
import { advanceAISlide, AI_CROUCH_SPEED_MULTIPLIER, getSlideSpeed, shouldStartAISlide } from './aiMovementMechanics';
import { canAttemptChargeAbortFeint, getApproachFeintWindow } from './aiFeints';
import { shouldForceStandoffCommit } from './aiPsychologicalPressure';
import { shouldAvoidCoinFlipTrade, type MatchStateMultipliers } from './aiTuning';
import { resolveScaledAIWeaponReloadTime } from './aiWeaponTiming';
import { resolveAIPressureState } from './aiPressureState';

export interface AIGroundStateFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dashDir: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: WeaponState | 'slashing' | 'recovering';
  dashRemaining: number | undefined;
  dashCooldownTimer: number | undefined;
  slideActive: boolean;
  slideDistanceTraveled: number;
  slideCooldownTimer: number;
  isSprinting: boolean;
}

export interface AIGroundStateInput {
  settings: UniversalSettings;
  frame: AIGroundStateFrame;
  target: Pick<AITacticalTargetSnapshot, 'id' | 'hp' | 'weaponState' | 'invulnerabilityTimer'>;
  botId: string;
  botHP: number;
  pressureTargetId: string | undefined;
  distanceToTarget: number;
  attackDistanceToTarget: number;
  resolvedDangerZone: number;
  resolvedAiReach: number;
  guaranteedKillRange: number;
  maxLungeRange: number;
  minLungeRange: number;
  stationarySwingReach: number;
  activeWeapon: AICombatWeapon | 'ball';
  canStartWeaponAction: boolean;
  targetIsProtected: boolean;
  difficulty: string;
  movementComplexity: number;
  playstyleFactor: number;
  tunedAnticipationFactor: number;
  effectiveReactionLatency: number;
  effectivePressureAggression: number;
  cooldownMult: number;
  dt: number;
  swayTimer: number;
  savedVelY: number;
  lookHeading: THREE.Vector3;
  spatialLookHeading: THREE.Vector3;
  sidewayHeading: THREE.Vector3;
  spatialBias: { aggressionMult: number };
  totalApproachLateral: number;
  sprintMult: number;
  isCrouching: boolean;
  feintChance: number;
  feintLungeFakeout: boolean;
  psychEnabled: boolean;
  psychState: { standoffTimer: number };
  matchMultipliers: MatchStateMultipliers;
  tuning: Pick<AIBehaviorTuning, 'slideMinComplexity' | 'slideMinGap' | 'slideMaxGap' | 'slideTriggerChance' |
    'aiBaseGroundSpeed' | 'reactChanceBase' | 'reactChanceAnticipation' | 'approachFeintBackTimer' | 'chargeAbortSidestepTimer'>;
  startOffensiveHammerJump: (heading: THREE.Vector3) => boolean;
  playDash: () => void;
  tryFeintRoll: (scale: number) => boolean;
  commitFeint: () => void;
  isTargetOnCooldown: () => boolean;
  isCoordAttackBlocked: () => boolean;
  clearPressureTarget: (id: string) => void;
  triggerCombatantAttack: (weapon: AICombatWeapon | 'ball') => void;
  selectDefensiveDashDirection?: (origin: { x: number; z: number }, fallback: { x: number; z: number }) => { x: number; z: number };
  random?: () => number;
}

/** Existing ground FSM after ground opportunities, before arena constraints.
 * Caller owns timer advancement, dash travel, navigation, memory and action effects.
 * All branch RNG (including slide/pressure) draws lazily from one caller stream. */
export function resolveAIGroundState(input: AIGroundStateInput): AIGroundStateFrame {
  const { settings, frame, target, botId, botHP, pressureTargetId, distanceToTarget,
    attackDistanceToTarget, resolvedDangerZone, resolvedAiReach, guaranteedKillRange, maxLungeRange,
    minLungeRange, stationarySwingReach, activeWeapon, canStartWeaponAction, targetIsProtected,
    difficulty, movementComplexity, playstyleFactor, tunedAnticipationFactor, effectiveReactionLatency,
    effectivePressureAggression, cooldownMult, dt, swayTimer, savedVelY, lookHeading, spatialLookHeading,
    sidewayHeading, spatialBias, totalApproachLateral, sprintMult, isCrouching, feintChance,
    feintLungeFakeout, psychEnabled, psychState, matchMultipliers, tuning, startOffensiveHammerJump,
    playDash, tryFeintRoll, commitFeint, isTargetOnCooldown, isCoordAttackBlocked, clearPressureTarget,
    triggerCombatantAttack, random = simulationRandom } = input;
  const { pos, vel, dashDir } = frame;
  // Apply posture before moving or invoking attack callbacks. Slides and dashes
  // have their own committed travel and must not use the walking slowdown.
  const advanceWalk = () => {
    if (isCrouching) {
      vel.multiplyScalar(AI_CROUCH_SPEED_MULTIPLIER);
    }
    pos.addScaledVector(vel, dt);
  };
  let { aiState: state, timer, weaponState, dashRemaining, dashCooldownTimer, slideActive,
    slideDistanceTraveled, slideCooldownTimer, isSprinting } = frame;
  let groundJumpVelocity: number | undefined;
  const directDefensiveDash = () => {
    dashDir.copy(lookHeading).multiplyScalar(-1).normalize();
    if (input.selectDefensiveDashDirection) {
      const direction = input.selectDefensiveDashDirection({ x: pos.x, z: pos.z }, { x: dashDir.x, z: dashDir.z });
      if (direction.x !== dashDir.x || direction.z !== dashDir.z) dashDir.set(direction.x, 0, direction.z);
    }
  };
  if (activeWeapon === 'hammer' && weaponState === 'ready' && distanceToTarget > (resolvedDangerZone + 1.5) && distanceToTarget <= (resolvedDangerZone + 5.5) && random() < 0.015 && (movementComplexity >= 40) && !targetIsProtected) {
    const previousVerticalVelocity = vel.y;
    if (startOffensiveHammerJump(lookHeading)) {
      // Ordinary bots launch immediately. Main AI only schedules its impulse
      // for impact, so retain the existing vertical motion when it did not change.
      if (vel.y !== previousVerticalVelocity) groundJumpVelocity = vel.y;
      weaponState = 'swing_up';
    }
  }

  if (state === 'APPROACHING') {
    // Begin a slide as a committed ground gap-closer when conditions allow.
    if (!slideActive && shouldStartAISlide({
      enableSlide: settings.enableSlide,
      slideCooldownRemaining: slideCooldownTimer,
      state,
      distanceToTarget,
      engageRange: resolvedDangerZone,
      movementComplexity,
      isDashing: false,
      isSliding: slideActive,
      targetProtected: targetIsProtected,
      minComplexity: tuning.slideMinComplexity,
      minGap: tuning.slideMinGap,
      maxGap: tuning.slideMaxGap,
      triggerChance: tuning.slideTriggerChance,
      random,
    })) {
      slideActive = true;
      slideDistanceTraveled = 0;
      isSprinting = false;
      playDash();
    }

    if (slideActive) {
      const slideSpeed = getSlideSpeed(settings.speedSlide, tuning.aiBaseGroundSpeed);
      vel.copy(spatialLookHeading).multiplyScalar(slideSpeed);
      pos.addScaledVector(vel, dt);
      const advanced = advanceAISlide({
        distanceTraveled: slideDistanceTraveled,
        slideSpeed,
        dt,
        maxSlideDistance: settings.slideDistance ?? 8.0,
      });
      slideDistanceTraveled = advanced.distanceTraveled;
      // End the slide if it is exhausted, the toggle was turned off, or we have
      // closed into engage range.
      if (advanced.finished || !settings.enableSlide || distanceToTarget <= (resolvedDangerZone + 1.5)) {
        slideActive = false;
        slideCooldownTimer = settings.slideCooldown ?? 1.5;
      }
    } else {
      vel.copy(spatialLookHeading).multiplyScalar(4.0 * (settings.speedForward / 100) * spatialBias.aggressionMult * sprintMult);
      if (totalApproachLateral !== 0) {
        vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.9);
      }
      advanceWalk();
    }

    if (!slideActive && distanceToTarget <= (resolvedDangerZone + 3.2)) {
      state = 'SIDE_STEPPING';
      timer = random() * 0.7 + 0.3;
    }
  }
  else if (state === 'SIDE_STEPPING') {
    const dir = Math.sin(swayTimer * 2.2) > 0 ? 1 : -1;
    vel.copy(sidewayHeading).multiplyScalar(3.2 * (settings.speedSide / 100) * dir);

    // Hold inside our own weapon's hit range, not just outside the enemy danger
    // zone. With a hammer, resolvedDangerZone + 1.2 (~8.6m default) sits *beyond*
    // the hammer's own ~7m sphere reach, so two hammer bots would otherwise park
    // where neither can land a blow and circle forever. Capping to just inside
    // guaranteedKillRange makes them close until a swing actually connects.
    const desiredDist = activeWeapon === 'sword'
      ? (maxLungeRange * 0.7)
      : Math.min(resolvedDangerZone + 1.2, guaranteedKillRange - 0.6);
    const approachBias = distanceToTarget > desiredDist ? 0.35 : -0.45;
    const approachSpeed = approachBias * 1.5 * (approachBias > 0 ? (settings.speedForward / 100) : (settings.speedBackward / 100));
    const approachAggression = approachBias > 0 ? spatialBias.aggressionMult : 1;
    vel.addScaledVector(spatialLookHeading, approachSpeed * approachAggression);
    if (totalApproachLateral !== 0) {
      vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.35);
    }

    advanceWalk();

    if (dashCooldownTimer <= 0 && distanceToTarget < (resolvedDangerZone + 2.0) && random() < 0.015 && (movementComplexity >= 40)) {
      const sideDir = random() > 0.5 ? 1 : -1;
      dashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
      dashRemaining = settings.dashDuration || 0.25;
      dashCooldownTimer = settings.dashCooldown || 2.0;
      playDash();
    }

    if (target.weaponState === 'swing_up' && !targetIsProtected) {
      const reactChance = tuning.reactChanceBase + (tunedAnticipationFactor * tuning.reactChanceAnticipation);

      const myHP = botHP;
      const targetHP = target.hp;
      const shouldAvoidTrade = shouldAvoidCoinFlipTrade({
        difficulty,
        playstyleFactor,
        botHP: myHP,
        targetHP,
        multipliers: matchMultipliers,
      });

      if (shouldAvoidTrade || random() < reactChance) {
        state = 'DANCING_BACKWARD';
        timer = effectiveReactionLatency + 0.35;

        if (dashCooldownTimer <= 0) {
          directDefensiveDash();
          dashRemaining = settings.dashDuration || 0.25;
          dashCooldownTimer = settings.dashCooldown || 2.0;
          playDash();
        }
      }
    }

    if (targetIsProtected) {
      state = 'DANCING_BACKWARD';
      timer = 0.5;
    }

    if (timer <= 0) {
      const forceStandoffCommit = psychEnabled && shouldForceStandoffCommit(
        psychState.standoffTimer,
        playstyleFactor,
        matchMultipliers,
        random()
      );
      if (forceStandoffCommit && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
        state = 'CHARGE_ATTACK';
        psychState.standoffTimer = 0;
      } else if (attackDistanceToTarget <= (resolvedAiReach + 0.5) && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
        state = 'CHARGE_ATTACK';
      } else {
        state = 'DANCING_FORWARD';
        timer = random() * 0.5 + 0.25;
      }
    }
  }
  else if (state === 'DANCING_FORWARD') {
    const approachFeintWindow = getApproachFeintWindow({
      timerRemaining: timer,
      targetProtected: targetIsProtected,
      feintEligible: feintChance > 0,
    });
    if (approachFeintWindow !== null && tryFeintRoll(approachFeintWindow)) {
      state = 'DANCING_BACKWARD';
      timer = tuning.approachFeintBackTimer;
      commitFeint();
      vel.copy(lookHeading).multiplyScalar(-6.2 * (settings.speedBackward / 100));
      advanceWalk();
    } else {
    const forwardSpeed = feintLungeFakeout ? 6.2 : 5.0;
    vel.copy(lookHeading).multiplyScalar(forwardSpeed * (settings.speedForward / 100) * sprintMult);
    if (totalApproachLateral !== 0) {
      vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.5);
    }
    advanceWalk();

    if (target.weaponState === 'swing_up' && !targetIsProtected) {
      state = 'DANCING_BACKWARD';
      timer = 0.65;
      if (dashCooldownTimer <= 0 && random() < 0.7) {
        directDefensiveDash();
        dashRemaining = settings.dashDuration || 0.25;
        dashCooldownTimer = settings.dashCooldown || 2.0;
        playDash();
      }
    } else if (attackDistanceToTarget <= resolvedAiReach && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
      state = 'CHARGE_ATTACK';
    }

    if (targetIsProtected) {
      state = 'DANCING_BACKWARD';
      timer = 0.5;
    }

    if (timer <= 0) {
      state = 'SIDE_STEPPING';
      timer = random() * 0.7 + 0.3;
    }
    }
  }
  else if (state === 'DANCING_BACKWARD') {
    vel.copy(lookHeading).multiplyScalar(-6.2 * (settings.speedBackward / 100));
    advanceWalk();

    if (target.weaponState === 'recovering' && attackDistanceToTarget <= (resolvedAiReach + 2.5) && !targetIsProtected) {
      state = 'CHARGE_ATTACK';
    }

    if (timer <= 0) {
      state = 'SIDE_STEPPING';
      timer = 0.4;
    }
  }
  else if (state === 'CHARGE_ATTACK') {
    if (
      canAttemptChargeAbortFeint({
        targetWeaponState: target.weaponState,
        dashCooldownRemaining: dashCooldownTimer,
        targetProtected: targetIsProtected,
        feintEligible: feintChance > 0,
      }) &&
      tryFeintRoll(0.7)
    ) {
      const sideDir = random() > 0.5 ? 1 : -1;
      dashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
      dashRemaining = settings.dashDuration || 0.25;
      dashCooldownTimer = settings.dashCooldown || 2.0;
      playDash();
      state = 'SIDE_STEPPING';
      timer = tuning.chargeAbortSidestepTimer;
      commitFeint();
    } else {
    if (dashCooldownTimer <= 0 && (movementComplexity >= 40) && !targetIsProtected) {
      dashDir.copy(lookHeading).normalize();
      dashRemaining = settings.dashDuration || 0.25;
      dashCooldownTimer = settings.dashCooldown || 2.0;
      playDash();
    }

    vel.copy(lookHeading).multiplyScalar(6.5 * (settings.speedForward / 100));
    advanceWalk();

    if (attackDistanceToTarget <= stationarySwingReach && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
      if (isCoordAttackBlocked()) {
        state = 'SIDE_STEPPING';
        timer = 0.25;
      } else {
      const myHP = botHP;
      const targetHP = target.hp;
      const shouldAvoidTrade = shouldAvoidCoinFlipTrade({
        difficulty,
        playstyleFactor,
        botHP: myHP,
        targetHP,
        multipliers: matchMultipliers,
        requireTargetOnCooldown: true,
        targetOnCooldown: isTargetOnCooldown(),
      });
      const targetIsSwinging = target.weaponState === 'swing_up' || target.weaponState === 'swing_down';

      if (shouldAvoidTrade && targetIsSwinging) {
        state = 'DANCING_BACKWARD';
        timer = 0.6;
        if (dashCooldownTimer <= 0) {
          directDefensiveDash();
          dashRemaining = settings.dashDuration || 0.25;
          dashCooldownTimer = settings.dashCooldown || 2.0;
          playDash();
        }
      } else {
        state = 'COOLDOWN';
        timer = resolveScaledAIWeaponReloadTime(settings, activeWeapon, cooldownMult);
        triggerCombatantAttack(activeWeapon);
      }
      }
    } else if (attackDistanceToTarget > (resolvedAiReach + 2.0) || targetIsProtected) {
      state = 'SIDE_STEPPING';
      timer = 0.4;
    }
    }
  }
  else if (state === 'PRESSURING') {
    const pressureFrame = resolveAIPressureState({
      settings,
      frame: {
        pos,
        vel,
        dashDir,
        aiState: state,
        timer,
        dashRemaining,
        dashCooldownTimer,
        weaponState,
      },
      botId,
      target,
      pressureTargetId,
      attackDistanceToTarget,
      resolvedAiReach,
      maxLungeRange,
      effectivePressureAggression,
      lookHeading,
      sidewayHeading,
      totalApproachLateral,
      dt,
      sprintMult,
      isCrouching,
      activeWeapon,
      stationarySwingReach,
      minLungeRange,
      targetProtected: targetIsProtected,
      canStartWeaponAction,
      cooldownMultiplier: cooldownMult,
      playstyleFactor,
      clearPressureTarget,
      isCoordAttackBlocked,
      triggerCombatantAttack: (weapon) => triggerCombatantAttack(weapon),
      playDash,
      random,
    });
    state = pressureFrame.aiState;
    timer = pressureFrame.timer;
    dashRemaining = pressureFrame.dashRemaining;
    dashCooldownTimer = pressureFrame.dashCooldownTimer;
    weaponState = pressureFrame.weaponState;
  }
  else if (state === 'COOLDOWN') {
    vel.copy(lookHeading).multiplyScalar(-1.5 * (settings.speedBackward / 100));
    advanceWalk();

    if (timer <= 0) {
      state = 'SIDE_STEPPING';
      timer = 0.7;
    }
  }

  // Horizontal steering must not erase a launch selected during this ground turn.
  vel.y = groundJumpVelocity ?? savedVelY;

  return Object.assign(frame, { aiState: state, timer, weaponState, dashRemaining, dashCooldownTimer,
    slideActive, slideDistanceTraveled, slideCooldownTimer, isSprinting });
}
