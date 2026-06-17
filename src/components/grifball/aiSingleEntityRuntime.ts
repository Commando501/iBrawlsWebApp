import * as THREE from 'three';
import { type AILungeOutcome } from '../../game/aiCombatDecision';
import {
  getPincerApproachOffset,
  registerBotEngagement,
} from '../../game/aiBotCoordinator';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import {
  canAttemptChargeAbortFeint,
  getApproachFeintWindow,
  getPlayerFeintMultiplier,
  rollFeintAttempt,
  rollFeintCooldownDuration,
} from '../../game/aiFeints';
import {
  getFeintCooldownRemaining,
  isWeaponSwapFeintActive,
  startFeintCooldown,
  startWeaponSwapFeint,
  tickFeintCooldown,
  tickWeaponSwapFeintTimer,
} from '../../game/aiMatchContext';
import {
  advanceAISlide,
  getSlideSpeed,
  shouldStartAISlide,
} from '../../game/aiMovementMechanics';
import {
  accumulateStandoffTimer,
  isInStandoffBand,
  shouldForceStandoffCommit,
} from '../../game/aiPsychologicalPressure';
import {
  applyCalibrationMultipliers,
  tickCalibrationPendingCounter,
  tickCalibrationPendingDodge,
} from '../../game/aiSkillCalibration';
import { shouldAvoidCoinFlipTrade } from '../../game/aiTuning';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import { type LoadedNeuralBrain } from '../../game/neuralBrainLoader';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant } from '../../types';
import { resolveAIAirborneHammerOpportunityForCombatant } from './aiAirborneHammerOpportunityRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from './aiAirborneRecoveryRuntime';
import { syncAICombatantFrameToState, syncAICombatantPoseAndState } from './aiCombatantFrameSync';
import { resolveAICombatRangeFrame } from './aiCombatRangeRuntime';
import { resolveAICombatTuningPreludeForCombatant } from './aiCombatTuningPreludeRuntime';
import { resolveAIComboOrchestrationForCombatant } from './aiComboOrchestrationRuntime';
import { shouldBlockCoordinatedAttackForFrame } from './aiCoordinationRuntime';
import { resolveAIDashMovementForCombatant } from './aiDashMovementRuntime';
import {
  integrateTargetEngagementGravityForCombatant,
  normalizeTargetEngagementFrameState,
  resolveCombatantCrouchPose,
  tickAIEngagementCooldowns,
} from './aiEngagementFrameRuntime';
import {
  applyAIEngagementFrameToLocals,
  applyAIPostKillPressureFrameToLocals,
  applyGrifballAIObjectiveFrameToLocals,
  createAIEngagementFrameFromLocals,
  createAIPostKillPressureFrameFromLocals,
  createGrifballAIObjectiveFrameFromLocals,
} from './aiFrameAdapters';
import { resolveAIGroundAttackOpportunityForCombatant } from './aiGroundAttackOpportunityRuntime';
import { resolveAIGroundMovementPreludeForCombatant } from './aiGroundMovementPreludeRuntime';
import { resolveAILungeEvasionForCombatant } from './aiLungeEvasionRuntime';
import { resolveNoTargetAIFrameForCombatant } from './aiNoTargetRuntime';
import { resolvePostKillPressureForCombatant } from './aiPostKillPressureRuntime';
import { resolveAIPressureStateForCombatant } from './aiPressureStateRuntime';
import { finishAISwordLungeFrameForCombatant } from './aiSwordLungeFinishRuntime';
import { resolveAISwordLungeFlightForCombatant } from './aiSwordLungeFlightRuntime';
import { resolveAITargetPredictionFrame } from './aiTargetPredictionRuntime';
import {
  initializeCombatantAITickDefaults,
  tickCombatantInvulnerability,
} from './aiTickState';
import {
  canStartAIWeaponAction,
  resolveScaledAIWeaponReloadTime,
} from './aiWeaponTimingRuntime';
import { getCombatantMesh } from './combatantMeshLookup';
import { GRAVITY_ACCELERATION } from './combatGeometry';
import { buildGrifballTeamAwarenessForCombatant } from './grifballAITeamAwareness';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from './grifballAIObjectiveMovement';
import {
  getApproachLateralOffset,
  recordAIEngagementApproachObservations,
} from './playerModelObservations';
import { type GrifballRuntimeState } from './runtimeState';
import {
  advanceNeuralLiveCooldowns,
  buildNeuralLiveFrameTelemetry,
  liveForwardVectorForYaw,
  liveYawToSimYaw,
  nextNeuralCombatantDecision,
  recordNeuralLiveFrameTelemetry,
  resolveNeuralPlanarVelocity,
  safeIdleNeuralAction,
  shouldSuppressNeuralLiveAction,
  simYawToLiveYaw,
} from './neuralLiveAdapter';
import { type GrifballThreeRefs } from './threeRefs';
import { type CombatTradeReason } from './tradeRuntime';

type MutableRef<T> = { current: T };

type AISingleEntityUpdaterOptions = {
  stateRef: MutableRef<GrifballRuntimeState>;
  threeRef: MutableRef<GrifballThreeRefs>;
  playDash: () => void;
  playJump: () => void;
  playExplosion: () => void;
  playDeath: () => void;
  getNeuralBrainRuntime?: () => LoadedNeuralBrain | null;
  [key: string]: any;
};

export function createAISingleEntityUpdaterForState({
  stateRef,
  threeRef,
  mai,
  resolveBotKnobs,
  resolveBotDerived,
  resolveBotFlags,
  getMatchScoreContext,
  recordCombatantObservation,
  recordBotDamageTag,
  tryEnterPressureState,
  tryStartComboOnHit,
  recoverCombatantAltitude,
  constrainCombatantToArena,
  swapCombatantWeapon,
  triggerCombatantAttack,
  grifballEnemyGoalPos,
  getBestTacticalTarget,
  getTacticalTargetById,
  getActiveCustomMap,
  getOptimalSpawnPoint,
  grifballTeamOf,
  grifballCombatantRef,
  getTargetPlayerModel,
  evaluateTacticalWeaponChoice,
  startAIHammerJump,
  triggerCombatantLunge,
  spawnVoxelShockwaveParticles,
  areCombatantsHostile,
  executeCustomBotTrade,
  renderSwordLungeTrailVfx,
  recordPlayerDamageTaken,
  recordDeathEvent,
  recordBotPsychKill,
  recordBotCalibrationDeath,
  pushStatsUpdate,
  isTargetOnCooldown,
  clearPressureTarget,
  getNeuralBrainRuntime,
  playDash,
  playJump,
  playExplosion,
  playDeath,
}: AISingleEntityUpdaterOptions) {
  const sfx = {
    playDash,
    playJump,
    playExplosion,
    playDeath,
  };

  return (botId: string, dt: number) => {
      const s = stateRef.current;
      const tuning = resolveBehaviorTuning(s.settings);
  
      const self: any = s.otherPlayers.get(botId);
      if (!self || self.controller !== 'ai') return;
  
      const botMesh = getCombatantMesh(threeRef.current, botId);
      if (!botMesh) return;
  
      const hp = self.hp;
      if (hp <= 0) return;
      tickCombatantInvulnerability(self, dt);
      initializeCombatantAITickDefaults(self);
  
      const { alliesList, enemiesList } = s.settings.gameMode === 'grifball'
        ? buildGrifballTeamAwarenessForCombatant(s, botId, self.team)
        : { alliesList: [], enemiesList: [] };
  
      let pendingPostEvasionCharge = self.aiPendingPostEvasionCharge ?? false;
  
      // pos/vel keep the working-copy vs live-ref distinction: the main AI mutates its
      // flat vectors in place (self.pos/self.vel alias mai()!.pos/mai()!.vel), while a bot edits
      // a copy of self.pos/self.vel that syncStateAndMesh writes back.
      const pos = self.pos;
      const vel = self.vel;
      let yaw = self.yaw;
      let activeWeapon = self.activeWeapon;
      let weaponState = self.weaponState || 'ready';
  
      // Declare local state variables and sync them from the combatant state
      let state = self.aiState;
      let timer = self.aiTimer;
      let swayTimer = self.aiSwayTimer;
      let dashCooldownTimer = self.aiDashCooldownTimer;
      let dashRemaining = self.aiDashRemaining;
      let slideActive = self.aiSlideActive ?? false;
      let slideDistanceTraveled = self.aiSlideDistanceTraveled ?? 0;
      let slideCooldownTimer = self.aiSlideCooldownTimer ?? 0;
      let isSprinting = false;
      let coordCommitTimer = self.aiCoordCommitTimer ?? 0;
      let hammerJumpCooldownTimer = self.aiHammerJumpCooldownTimer;
      const dashDir = new THREE.Vector3(self.aiDashDir.x, self.aiDashDir.y, self.aiDashDir.z);
  
      const cooldownMult = 1;
      const neuralControlled = isNeuralNetDifficulty(self.difficulty) || isNeuralNetDifficulty(s.settings.aiDifficulty);

      if (neuralControlled) {
        const cooldownFrame = advanceNeuralLiveCooldowns({
          aiState: state,
          aiTimer: timer,
          dashCooldownTimer,
          slideCooldownTimer,
          hammerJumpCooldownTimer,
          swapLockoutTimer: self.swapLockoutTimer,
          swapCooldownTimer: self.swapCooldownTimer,
          dt,
          tickSwapTimers: true,
        });
        state = cooldownFrame.aiState;
        timer = cooldownFrame.aiTimer;
        dashCooldownTimer = cooldownFrame.dashCooldownTimer;
        slideCooldownTimer = cooldownFrame.slideCooldownTimer;
        hammerJumpCooldownTimer = cooldownFrame.hammerJumpCooldownTimer;
        self.swapLockoutTimer = cooldownFrame.swapLockoutTimer;
        self.swapCooldownTimer = cooldownFrame.swapCooldownTimer;
      }
  
      // Single source of truth for AI attack reloads. Always the player's configured
      // mechanic settings (mirrors the player exactly) so no attack path can ever swing
      // faster than the user's gameplay dials.
      // Hammer side-swipe (melee) reloads on hammerMeleeReload; the wide
      // overhead/level hammer and sword use hammerReloadTime / swordSlashReload.
      // The swap-ready cooldown (weaponReadyTime) gates attacking after a weapon swap,
      // exactly as it does for the player. `let` so a same-tick tactical swap can revoke it.
      let canStartWeaponAction = canStartAIWeaponAction({
        aiState: state,
        timer,
        swapCooldownTimer: self.swapCooldownTimer,
      });
  
      // Write the frame's working state back to the combatant through `self`. For the
      // main AI `self.pos`/`self.vel` already alias mai()!.pos/mai()!.vel (so copy is a no-op
      // self-copy); for a bot they copy the working vectors into the stored object. The
      // aiDashDir setter copies into the main AI's Vector3 but assigns a fresh object on
      // a bot â€” matching each backing store's representation.
      const syncStateAndMesh = () => {
        syncAICombatantFrameToState({
          self,
          mesh: botMesh,
          pos,
          vel,
          yaw,
          aiState: state,
          timer,
          swayTimer,
          dashCooldownTimer,
          dashRemaining,
          dashDir,
          slideActive,
          slideDistanceTraveled,
          slideCooldownTimer,
          isSprinting,
          hammerJumpCooldownTimer,
          pendingPostEvasionCharge,
          coordCommitTimer,
        });
      };
  
      const finishSwordLunge = (cooldownMultiplier = 1, outcome: AILungeOutcome = 'miss_timeout', targetId?: string) => {
        const lungeFinishFrame = finishAISwordLungeFrameForCombatant({
          state: s,
          self,
          pos,
          vel,
          aiState: state,
          timer,
          weaponState,
          botId,
          cooldownMultiplier,
          outcome,
          targetId,
          recordCombatantObservation,
          recordBotDamageTag,
          tryEnterPressureState,
          tryStartComboOnHit,
        });
  
        state = lungeFinishFrame.aiState;
        timer = lungeFinishFrame.timer;
        weaponState = lungeFinishFrame.weaponState;
      };

      if (neuralControlled) {
        const brain = getNeuralBrainRuntime?.() ?? null;
        if (!brain || brain.telemetry.status !== 'ready') {
          if (brain) brain.telemetry.blockedFrames += 1;
          vel.x = 0;
          vel.z = 0;
          state = 'COOLDOWN';
          timer = 0.1;
          syncStateAndMesh();
          return;
        }

        if (self.isLunging) {
          const target = getBestTacticalTarget(botId, pos, 'nightmare');
          if (target) {
            const lungeFlightResult = resolveAISwordLungeFlightForCombatant({
              state: s,
              self,
              target,
              mainAi: target.id === MAIN_AI_ID ? mai() : undefined,
              botId,
              botMesh,
              pos,
              vel,
              dt,
              cooldownMult,
              activeCustomMap: getActiveCustomMap(),
              gravityAcceleration: GRAVITY_ACCELERATION,
              recoverCombatantAltitude,
              constrainCombatantToArena,
              areCombatantsHostile,
              finishSwordLunge,
              executeCustomBotTrade: (
                attackerBot: Combatant,
                tradeTarget: { id: string },
                reason: CombatTradeReason
              ) => executeCustomBotTrade(attackerBot, tradeTarget, reason),
              renderSwordLungeTrailVfx,
              recordPlayerDamageTaken,
              playExplosion: () => sfx.playExplosion(),
              playDeath: () => sfx.playDeath(),
              spawnVoxelShockwaveParticles,
              recordDeathEvent,
              recordBotPsychKill,
              recordBotCalibrationDeath,
              pushStatsUpdate,
            });
            if (lungeFlightResult === 'trade_return') {
              return;
            }
          } else {
            finishSwordLunge(1, 'target_dead', undefined);
          }
          syncStateAndMesh();
          return;
        }

        if (shouldSuppressNeuralLiveAction(s)) {
          const action = safeIdleNeuralAction();
          const policyYaw = liveYawToSimYaw(yaw);
          vel.x = 0;
          vel.z = 0;
          if (self.isJumping || pos.y > 0.01) {
            vel.y -= GRAVITY_ACCELERATION * dt;
            pos.y += vel.y * dt;
            if (pos.y <= 0) {
              pos.y = 0;
              vel.y = 0;
              self.isJumping = false;
              self.aiHammerJumpsInAir = 0;
            }
          } else {
            vel.y = 0;
          }
          constrainCombatantToArena(pos, vel);
          syncStateAndMesh();
          recordNeuralLiveFrameTelemetry(brain, buildNeuralLiveFrameTelemetry({
            state: s,
            self,
            action,
            decisionReused: false,
            policyYaw,
            liveYaw: yaw,
            planarSpeed: 0,
            canStartWeaponAction: false,
            jumpApplied: false,
            dashStarted: false,
            attackStarted: false,
            swapStarted: false,
          }));
          return;
        }

        const decision = nextNeuralCombatantDecision({
          brain,
          state: s,
          botId,
          activeCustomMap: getActiveCustomMap(),
        });
        const action = decision?.action ?? safeIdleNeuralAction();
        let swapStarted = false;
        let dashStarted = false;
        let jumpApplied = false;
        let attackStarted = false;

        const policyYaw = Number.isFinite(action.aim) ? action.aim : liveYawToSimYaw(yaw);
        yaw = simYawToLiveYaw(policyYaw);
        botMesh.rotation.y = yaw;
        const neuralCrouching = action.crouch;
        self.isCrouching = neuralCrouching;
        botMesh.scale.set(1, neuralCrouching ? 0.65 : 1, 1);

        if (
          action.swapWeapon &&
          activeWeapon !== 'ball' &&
          weaponState === 'ready' &&
          (self.swapLockoutTimer ?? 0) <= 0
        ) {
          const nextWeapon = activeWeapon === 'hammer' ? 'sword' : 'hammer';
          swapCombatantWeapon(self, nextWeapon, true);
          activeWeapon = nextWeapon;
          weaponState = 'ready';
          canStartWeaponAction = false;
          swapStarted = true;
        }

        if (dashRemaining > 0) {
          dashRemaining = Math.max(0, dashRemaining - dt);
          const dashDuration = s.settings.dashDuration || 0.25;
          const dashSpeed = s.settings.dashDistance / dashDuration;
          vel.x = dashDir.x * dashSpeed;
          vel.z = dashDir.z * dashSpeed;
          pos.addScaledVector(vel, dt);
        } else {
          if (action.dash && dashCooldownTimer <= 0) {
            const moveVelocity = resolveNeuralPlanarVelocity(action, policyYaw, s.settings, activeWeapon, neuralCrouching);
            if (moveVelocity.lengthSq() > 0.0001) {
              dashDir.copy(moveVelocity).normalize();
            } else {
              dashDir.copy(liveForwardVectorForYaw(yaw)).normalize();
            }
            dashRemaining = s.settings.dashDuration || 0.25;
            dashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
            dashStarted = true;
          }

          const planarVelocity = resolveNeuralPlanarVelocity(action, policyYaw, s.settings, activeWeapon, neuralCrouching);
          vel.x = planarVelocity.x;
          vel.z = planarVelocity.z;
          pos.addScaledVector(vel, dt);
        }

        if (action.jump && !self.isJumping && pos.y <= 0.01) {
          self.isJumping = true;
          vel.y = 7.2;
          sfx.playJump();
          jumpApplied = true;
        }
        if (self.isJumping || pos.y > 0.01) {
          vel.y -= GRAVITY_ACCELERATION * dt;
          pos.y += vel.y * dt;
          if (pos.y <= 0) {
            pos.y = 0;
            vel.y = 0;
            self.isJumping = false;
            self.aiHammerJumpsInAir = 0;
          }
        } else {
          vel.y = 0;
        }

        if (canStartWeaponAction && weaponState === 'ready') {
          if (action.attackSecondary && activeWeapon === 'sword') {
            const lungeDir = liveForwardVectorForYaw(yaw).normalize();
            triggerCombatantLunge(self, lungeDir, pos, vel);
            state = 'LUNGING';
            weaponState = 'ready';
            attackStarted = true;
          } else if (action.attackSecondary && activeWeapon === 'hammer') {
            state = 'COOLDOWN';
            timer = resolveScaledAIWeaponReloadTime(s.settings, activeWeapon, cooldownMult, true);
            triggerCombatantAttack(self, activeWeapon, true);
            weaponState = 'melee_up';
            attackStarted = true;
          } else if (action.attackPrimary && (activeWeapon === 'hammer' || activeWeapon === 'sword')) {
            state = 'COOLDOWN';
            timer = resolveScaledAIWeaponReloadTime(s.settings, activeWeapon, cooldownMult);
            triggerCombatantAttack(self, activeWeapon);
            weaponState = 'swing_up';
            attackStarted = true;
          }
        }

        constrainCombatantToArena(pos, vel);
        syncStateAndMesh();
        recordNeuralLiveFrameTelemetry(brain, buildNeuralLiveFrameTelemetry({
          state: s,
          self,
          action,
          decisionReused: decision?.reused ?? false,
          policyYaw,
          liveYaw: yaw,
          planarSpeed: Math.hypot(vel.x, vel.z),
          canStartWeaponAction,
          jumpApplied,
          dashStarted,
          attackStarted,
          swapStarted,
        }));
        return;
      }
  
      const {
        difficulty,
        movementComplexity,
        weaponSwapIQ,
        weaponPrioritization,
        swordForbidden,
        hammerForbidden,
        derivedParams,
        personalityFlags,
        matchMultipliers,
        effectivePressureAggression,
        playstyleFactor,
        calibrationEnabled,
        calibrationMultipliers,
        tunedAnticipationFactor,
        psychEnabled,
        psychState,
        effectiveReactionLatency,
        postKillPressure,
      } = resolveAICombatTuningPreludeForCombatant({
        state: s,
        self,
        botId,
        dt,
        tuning,
        resolveBotKnobs,
        resolveBotDerived,
        resolveBotFlags,
        getMatchScoreContext,
      });
  
      if (postKillPressure) {
        const postKillPressureFrame = createAIPostKillPressureFrameFromLocals({
          pos,
          vel,
          yaw,
          aiState: state,
          timer,
          swayTimer,
          activeWeapon,
        });
        const postKillPressureMode = resolvePostKillPressureForCombatant({
          state: s,
          self,
          frame: postKillPressureFrame,
          pressure: postKillPressure,
          spatialIQ: derivedParams.spatialIQ,
          effectivePressureAggression,
          swordForbidden,
          dt,
          gravityAcceleration: GRAVITY_ACCELERATION,
          recoverCombatantAltitude,
          constrainCombatantToArena,
          swapCombatantWeapon,
        });
        ({ yaw, aiState: state, timer, swayTimer, activeWeapon } =
          applyAIPostKillPressureFrameToLocals(postKillPressureFrame));
  
        if (postKillPressureMode === 'airborne') {
          syncStateAndMesh();
          return;
        }
  
        syncAICombatantPoseAndState({
          self,
          mesh: botMesh,
          pos,
          vel,
          yaw,
          aiState: state,
          timer,
          activeWeapon,
          swayTimer,
        });
        return;
      }
  
      const primaryGrifballFrame = createGrifballAIObjectiveFrameFromLocals({
        pos,
        vel,
        yaw,
        aiState: state,
        timer,
        dashRemaining,
        slideActive,
        weaponState,
      });
      if (resolvePrimaryGrifballAIObjectiveMovementForCombatant({
        state: s,
        botId,
        self,
        frame: primaryGrifballFrame,
        alliesList,
        enemiesList,
        dt,
        canStartWeaponAction,
        triggerCombatantAttack,
        constrainCombatantToArena,
        getEnemyGoalPos: grifballEnemyGoalPos,
      })) {
        ({ yaw, aiState: state, timer, dashRemaining, slideActive, weaponState } =
          applyGrifballAIObjectiveFrameToLocals(primaryGrifballFrame));
        syncStateAndMesh();
        return;
      }
  
  
      let target = getBestTacticalTarget(botId, pos, difficulty);
      const pressureTargetId = self.aiPressureTargetId;
      if (state === 'PRESSURING' && pressureTargetId) {
        const lockedTarget = getTacticalTargetById(botId, pressureTargetId);
        if (lockedTarget) {
          target = lockedTarget;
        }
      }
  
      if (!target) {
        const noTargetFrame = createGrifballAIObjectiveFrameFromLocals({
          pos,
          vel,
          yaw,
          aiState: state,
          timer,
          dashRemaining,
          slideActive,
          weaponState,
        });
        const noTargetMode = resolveNoTargetAIFrameForCombatant({
          state: s,
          botId,
          self,
          frame: noTargetFrame,
          mainAI: mai(),
          alliesList,
          spatialIQ: derivedParams.spatialIQ,
          edgeInset: tuning.arenaEdgeInset,
          dt,
          activeCustomMap: getActiveCustomMap(),
          gravityAcceleration: GRAVITY_ACCELERATION,
          finishSwordLungeTargetDead: () => {
            // Reload/recovery mirrors the player's configured mechanic settings exactly
            // (multiplier 1) - see cooldownMult below.
            finishSwordLunge(1, 'target_dead', undefined);
          },
          recoverCombatantAltitude,
          constrainCombatantToArena,
          getOptimalSpawnPoint,
          getCombatantTeam: grifballTeamOf,
          getCombatantRef: grifballCombatantRef,
          getEnemyGoalPos: grifballEnemyGoalPos,
        });
        ({ yaw, aiState: state, timer, dashRemaining, slideActive, weaponState } =
          applyGrifballAIObjectiveFrameToLocals(noTargetFrame));
  
        if (noTargetMode === 'airborne' || noTargetMode === 'support_objective') {
          syncStateAndMesh();
          return;
        }
  
        syncAICombatantPoseAndState({
          self,
          mesh: botMesh,
          pos,
          vel,
          yaw,
          aiState: state,
          timer: 0,
        });
        return;
      }
  
      registerBotEngagement(s.aiMatchContext.coordinator, botId, target.id);
  
      // SPAWN_GUARDING is only driven by the post-kill-pressure / no-target early-return
      // paths above. If we reach here we have a live target and those holds have expired,
      // but the bottom combat state machine has no SPAWN_GUARDING branch â€” so a stale value
      // would leave the AI frozen with no movement or transition (notably after a lunge
      // kill in low-HP modes). Reset it back into normal engagement.
      const engagementFrame = createAIEngagementFrameFromLocals({
        pos,
        vel,
        aiState: state,
        timer,
        dashCooldownTimer,
        slideCooldownTimer,
        hammerJumpCooldownTimer,
      });
      normalizeTargetEngagementFrameState(engagementFrame);
      ({ aiState: state, timer, dashCooldownTimer, slideCooldownTimer, hammerJumpCooldownTimer } =
        applyAIEngagementFrameToLocals(engagementFrame));
  
      // Gravity Integration (main AI + bots, unified in-tick model)
      integrateTargetEngagementGravityForCombatant({
        self,
        frame: engagementFrame,
        dt,
        gravityAcceleration: GRAVITY_ACCELERATION,
        recoverCombatantAltitude,
        constrainCombatantToArena,
      });
  
      const activeCustomMap = getActiveCustomMap();
      const {
        predictedTargetPos,
        targetAirborne,
        movementTargetPos,
        toTarget,
        distanceToTarget,
        yaw: targetYaw,
      } = resolveAITargetPredictionFrame({
        botPos: pos,
        target,
        effectiveReactionLatency,
        tunedAnticipationFactor,
        predictionAnticipationBonus: tuning.predictionAnticipationBonus,
        predictionLandingWeight: tuning.predictionLandingWeight,
        movementComplexity,
        activeCustomMap,
        arenaRadius: s.arenaRadius,
      });
  
      yaw = targetYaw;
      botMesh.rotation.y = yaw;
  
      const playerDangerZone = s.settings.attackRange + s.settings.attackRadius * 0.85;
      const aiReach = s.settings.attackRange + s.settings.attackRadius * 0.75;
  
      // Playstyle combat spacing adjustments
      const spacingFactor =
        (1.35 - 0.60 * playstyleFactor) *
        matchMultipliers.spacingMult *
        personalityFlags.spacingBand;
      const resolvedDangerZone = playerDangerZone * spacingFactor;
      const resolvedAiReach = aiReach * (0.8 + 0.4 * playstyleFactor);
      const minLungeRange = resolvedDangerZone * 0.85;
      const maxLungeRange = Math.min(18.0, s.settings.swordLungeDistance ?? 14.5);
  
      // Evasion, lunge and recovery/cooldown playstyle modifiers
      const defensiveEvasionMult = difficulty !== 'easy' ? (1.5 - Math.abs(playstyleFactor - 0.5) * 1.0) : 1.0;
      const baseAggressiveLungeMult = 0.4 + 1.6 * playstyleFactor;
      const aggressiveLungeMult = applyCalibrationMultipliers({
        reactionLatency: 1,
        anticipationFactor: 1,
        aggressiveLungeMult: baseAggressiveLungeMult,
        multipliers: calibrationMultipliers,
      }).aggressiveLungeMult;
      const targetIsProtected = target.invulnerabilityTimer > 0;
      const targetIsLunging = target.isLunging;
  
      if (calibrationEnabled) {
        tickCalibrationPendingDodge(s.aiMatchContext, botId, dt, targetIsLunging, tuning.dodgeResolveDelay, tuning.calibrationWindowSize);
        tickCalibrationPendingCounter(s.aiMatchContext, botId, dt, targetIsLunging, tuning.counterResolveDelay, tuning.calibrationWindowSize);
      }
  
      // Sliding forces a crouch posture, like the player's slide.
      const isCrouching = resolveCombatantCrouchPose({
        aiState: state,
        swayTimer,
        slideActive,
        movementComplexity,
      });
  
      if (isCrouching) {
        botMesh.scale.set(1, 0.65, 1);
      } else {
        botMesh.scale.set(1, 1, 1);
      }
      self.isCrouching = isCrouching;
  
      // Resolve weapon-aware body distance and stationary swing commit bands.
      const {
        combatDistanceToTarget,
        verticalDeltaToTarget,
        attackDistanceToTarget,
        guaranteedKillRange,
        enemyInKillRange,
        selfGrounded,
        stationarySwingReach,
      } = resolveAICombatRangeFrame({
        botPos: pos,
        botVel: vel,
        botIsCrouching: isCrouching,
        botIsJumping: self.isJumping,
        targetIsCrouching: target.isCrouching,
        targetHp: target.hp,
        targetProtected: targetIsProtected,
        predictedTargetPos,
        distanceToTarget,
        activeWeapon,
        attackRange: s.settings.attackRange,
        attackRadius: s.settings.attackRadius,
        resolvedAiReach,
      });
  
      const inCoordCommitBand =
        attackDistanceToTarget <= resolvedAiReach + 0.5 &&
        weaponState === 'ready' &&
        !targetIsProtected &&
        target.hp > 0;
      if (inCoordCommitBand) {
        coordCommitTimer += dt;
      } else {
        coordCommitTimer = 0;
      }
  
      if (psychEnabled) {
        psychState.standoffTimer = accumulateStandoffTimer(
          psychState.standoffTimer,
          isInStandoffBand(distanceToTarget, resolvedDangerZone, tuning.standoffRangeMinOffset, tuning.standoffRangeMaxOffset),
          dt
        );
      }
  
      // Adaptive learning: sample this acting combatant's OWN position (edge proximity) and
      // approach speed into its own model, so opponents that target it can read those
      // tendencies. Both samplers self-throttle (position rate-limits to ~0.25s).
      recordAIEngagementApproachObservations({
        state: s,
        botId,
        botPos: pos,
        botVel: vel,
        targetId: target.id,
        distanceToTarget,
        nowSeconds: performance.now() / 1000,
        mapShape: activeCustomMap?.mapShape,
      });
  
      const cooldownFrame = createAIEngagementFrameFromLocals({
        pos,
        vel,
        aiState: state,
        timer,
        dashCooldownTimer,
        slideCooldownTimer,
        hammerJumpCooldownTimer,
      });
      tickAIEngagementCooldowns({
        frame: cooldownFrame,
        self,
        botId,
        mainAIId: MAIN_AI_ID,
        dt,
      });
      ({ aiState: state, timer, dashCooldownTimer, slideCooldownTimer, hammerJumpCooldownTimer } =
        applyAIEngagementFrameToLocals(cooldownFrame));
  
      const aiContext = s.aiMatchContext;
      tickFeintCooldown(aiContext, botId, dt);
  
      const coordRoleInput = {
        coordinator: aiContext.coordinator,
        botId,
        targetId: target.id,
        difficulty,
      };
  
      const isCoordAttackBlocked = () =>
        shouldBlockCoordinatedAttackForFrame({
          coordinator: aiContext.coordinator,
          botId,
          targetId: target.id,
          difficulty,
          commitTimer: coordCommitTimer,
          attackStaggerStep: tuning.attackStaggerStep,
          targetWeaponState: target.weaponState,
          targetRecovering: target.weaponState === 'recovering',
          mainAI: mai(),
          otherPlayers: s.otherPlayers,
        });
  
      const feintPlayerMult = getPlayerFeintMultiplier(getTargetPlayerModel(target.id));
      const feintChance = derivedParams.feintChance;
      const swapFeintActive = isWeaponSwapFeintActive(aiContext, botId);
      const swapLockoutRemaining = self.swapLockoutTimer ?? 0;
  
      const commitFeint = () => {
        startFeintCooldown(aiContext, botId, rollFeintCooldownDuration(undefined, tuning.feintCooldownMin, tuning.feintCooldownMax));
      };
  
      const tryFeintRoll = (rollScale = 1) => rollFeintAttempt({
        feintChance,
        feintCooldownRemaining: getFeintCooldownRemaining(aiContext, botId),
        playerModelMultiplier: feintPlayerMult,
        rollScale,
      });
  
      const recentLungeMemory = self.aiLastLungeOutcome ? {
        outcome: self.aiLastLungeOutcome,
        targetId: self.aiLastLungeTargetId,
        timeRemaining: self.aiPostLungeDecisionTimer || 0,
      } : null;
  
      const applyTacticalWeapon = (tacticalWeapon: 'hammer' | 'sword', force = false) => {
        if (tacticalWeapon === activeWeapon) return;
        if (tacticalWeapon === 'sword' && swordForbidden) return;
        if (tacticalWeapon === 'hammer' && hammerForbidden) return;
        if (!force && (self.swapLockoutTimer ?? 0) > 0) return;
        swapCombatantWeapon(self, tacticalWeapon, true);
        activeWeapon = tacticalWeapon;
        weaponState = 'ready';
        // Just swapped: the weaponReadyTime gate applies immediately, so no attack can
        // fire this tick (mirrors the player's post-swap swapCooldownTimer).
        if (s.settings.weaponReadyTime > 0) canStartWeaponAction = false;
      };
  
      const revertWeaponSwapFeint = () => {
        if (activeWeapon !== 'sword') return;
        if (hammerForbidden) return;
        self.swapLockoutTimer = 0;
        swapCombatantWeapon(self, 'hammer');
        activeWeapon = 'hammer';
        weaponState = 'ready';
      };
  
      if (tickWeaponSwapFeintTimer(aiContext, botId, dt)) {
        revertWeaponSwapFeint();
      }
  
      const tacticalDecision = evaluateTacticalWeaponChoice(botId, target, difficulty, {
        distanceToTarget,
        combatDistanceToTarget,
        canStartWeaponAction,
        weaponState,
        weaponSwapIQ,
        recentLungeMemory,
        weaponPrioritization,
        playerModel: getTargetPlayerModel(target.id),
      });
  
      const comboFrame = resolveAIComboOrchestrationForCombatant({
        state: s,
        self,
        aiContext,
        botId,
        target,
        frame: {
          pos,
          vel,
          aiState: state,
          timer,
          weaponState,
        },
        activeWeapon,
        canStartWeaponAction,
        tacticalWeapon: tacticalDecision.weapon,
        swapFeintActive,
        targetProtected: targetIsProtected,
        targetAirborne,
        hasVerticalLungeLine: !targetAirborne || movementComplexity >= 60,
        targetIsLunging,
        dt,
        difficulty,
        weaponSwapIQ,
        weaponPrioritization,
        attackDistanceToTarget,
        combatDistanceToTarget,
        distanceToTarget,
        minLungeRange,
        maxLungeRange,
        resolvedAiReach,
        stationarySwingReach,
        swapLockoutRemaining,
        cooldownMultiplier: cooldownMult,
        getTargetPlayerModel,
        applyTacticalWeapon: (tacticalWeapon) => {
          applyTacticalWeapon(tacticalWeapon);
          return {
            activeWeapon,
            canStartWeaponAction,
            weaponState,
          };
        },
        triggerCombatantLunge,
        triggerCombatantAttack,
        recordCombatantObservation,
      });
      activeWeapon = comboFrame.activeWeapon;
      canStartWeaponAction = comboFrame.canStartWeaponAction;
      state = comboFrame.aiState;
      timer = comboFrame.timer;
      weaponState = comboFrame.weaponState;
      const comboActive = comboFrame.comboActive;
      if (comboFrame.mode === 'sync_return') {
        syncStateAndMesh();
        return;
      }
  
      if (tacticalDecision.postMissSpacing && !targetIsLunging && state !== 'COOLDOWN' && state !== 'PRESSURING') {
        state = 'DANCING_BACKWARD';
        timer = Math.max(timer, 0.45);
      }
  
      const spatialIQ = derivedParams.spatialIQ;
      const lungeEvasionFrame = resolveAILungeEvasionForCombatant({
        state: s,
        self,
        frame: {
          pos,
          vel,
          dashDir,
          aiState: state,
          timer,
          dashRemaining,
          dashCooldownTimer,
          pendingPostEvasionCharge,
          weaponState,
        },
        botId,
        target,
        toTarget,
        distanceToTarget,
        combatDistanceToTarget,
        resolvedAiReach,
        targetIsProtected,
        targetIsLunging,
        dt,
        difficulty,
        defensiveEvasionMult,
        spatialIQ,
        swayTimer,
        activeWeapon,
        canStartWeaponAction,
        cooldownMultiplier: cooldownMult,
        calibrationEnabled,
        bulltrueCounter: tacticalDecision.bulltrueCounter,
        getTargetPlayerModel,
        mainAI: mai(),
        triggerCombatantAttack,
        startAIHammerJump,
        spawnVoxelShockwaveParticles,
        recordCombatantObservation,
        playDash: () => sfx.playDash(),
        playJump: () => sfx.playJump(),
        tuning,
      });
      state = lungeEvasionFrame.aiState;
      timer = lungeEvasionFrame.timer;
      dashRemaining = lungeEvasionFrame.dashRemaining;
      dashCooldownTimer = lungeEvasionFrame.dashCooldownTimer;
      pendingPostEvasionCharge = lungeEvasionFrame.pendingPostEvasionCharge;
      weaponState = lungeEvasionFrame.weaponState;
      const isEvadingLunge = lungeEvasionFrame.isEvadingLunge;
  
      const airborneHammerFrame = resolveAIAirborneHammerOpportunityForCombatant({
        state: s,
        self,
        frame: {
          pos,
          vel,
          aiState: state,
          timer,
          weaponState,
        },
        target,
        toTarget,
        targetAirborne,
        targetProtected: targetIsProtected,
        difficulty,
        movementComplexity,
        canStartWeaponAction,
        activeWeapon,
        distanceToTarget,
        resolvedDangerZone,
        combatDistanceToTarget,
        resolvedAiReach,
        tunedAnticipationFactor,
        enemyInKillRange,
        verticalDeltaToTarget,
        cooldownMultiplier: cooldownMult,
        tuning,
        triggerCombatantAttack,
        startAIHammerJump,
      });
      state = airborneHammerFrame.aiState;
      timer = airborneHammerFrame.timer;
      weaponState = airborneHammerFrame.weaponState;
  
      timer -= dt;
      swayTimer += dt;
  
      const savedVelY = vel.y;
  
      // Sword-lunge flight. Shared by the main AI and additional bots through the
      // `self` accessor â€” previously the main AI ran a separate copy of this in
      // updateAI() while bots ran this block, which let the two drift apart.
      if (self.isLunging) {
        const lungeFlightResult = resolveAISwordLungeFlightForCombatant({
          state: s,
          self,
          target,
          mainAi: target.id === MAIN_AI_ID ? mai() : undefined,
          botId,
          botMesh,
          pos,
          vel,
          dt,
          cooldownMult,
          activeCustomMap: getActiveCustomMap(),
          gravityAcceleration: GRAVITY_ACCELERATION,
          recoverCombatantAltitude,
          constrainCombatantToArena,
          areCombatantsHostile,
          finishSwordLunge,
          executeCustomBotTrade: (
            attackerBot: Combatant,
            tradeTarget: { id: string },
            reason: CombatTradeReason
          ) => executeCustomBotTrade(attackerBot, tradeTarget, reason),
          renderSwordLungeTrailVfx,
          recordPlayerDamageTaken,
          playExplosion: () => sfx.playExplosion(),
          playDeath: () => sfx.playDeath(),
          spawnVoxelShockwaveParticles,
          recordDeathEvent,
          recordBotPsychKill,
          recordBotCalibrationDeath,
          pushStatsUpdate,
        });
  
        if (lungeFlightResult === 'trade_return') {
          return;
        }
      } else {
        if (resolvePreGroundMovementRecoveryForCombatant({
          self,
          pos,
          vel,
          dt,
          movementComplexity,
          swayTimer,
          toTarget,
          recoverCombatantAltitude,
          constrainCombatantToArena,
        }) === 'sync_return') {
          syncStateAndMesh();
          return;
        }
  
      if (isEvadingLunge && dashRemaining <= 0) {
        syncStateAndMesh();
        return;
      }
  
      const isAIDashing = dashRemaining > 0;
      if (isAIDashing) {
        const dashMovementFrame = {
          pos,
          vel,
          dashDir,
          aiState: state,
          dashRemaining,
          slideActive,
          slideCooldownTimer,
          pendingPostEvasionCharge,
          isSprinting,
        };
        resolveAIDashMovementForCombatant({
          state: s,
          refs: threeRef.current,
          frame: dashMovementFrame,
          dt,
          activeWeapon,
          targetWeaponState: target.weaponState,
          attackDistanceToTarget: combatDistanceToTarget,
          resolvedAiReach,
          targetProtected: targetIsProtected,
          spatialIQ,
          weaponReady: weaponState === 'ready',
        });
        state = dashMovementFrame.aiState;
        dashRemaining = dashMovementFrame.dashRemaining;
        slideActive = dashMovementFrame.slideActive;
        slideCooldownTimer = dashMovementFrame.slideCooldownTimer;
        pendingPostEvasionCharge = dashMovementFrame.pendingPostEvasionCharge;
        isSprinting = dashMovementFrame.isSprinting;
      } else {
        // Air-sway (unified, unreachable past the floor-pin above â€” see the matching note
        // in the non-dashing branch). Kept in case the pin is ever relaxed.
        if (vel.y > 0) {
          if (movementComplexity >= 45) {
            const lookHeading = toTarget.clone().normalize();
            const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
            const sideDir = Math.sin(swayTimer * 3.0) > 0 ? 1 : -1;
            vel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
            vel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
          }
        }
  
        const groundMovementPrelude = resolveAIGroundMovementPreludeForCombatant({
          state: s,
          refs: threeRef.current,
          pos,
          movementTargetPos,
          target,
          predictedTargetPos,
          activeCustomMap: getActiveCustomMap(),
          spatialIQ,
          edgeInset: tuning.arenaEdgeInset,
          aiState: state,
          distanceToTarget,
          resolvedDangerZone,
          isCrouching,
          slideActive,
          sprintEngageGap: tuning.sprintEngageGap,
          sprintChaseTargetSpeed: tuning.sprintChaseTargetSpeed,
        });
        const lookHeading = groundMovementPrelude.lookHeading;
        const spatialBias = groundMovementPrelude.spatialBias;
        const spatialLookHeading = groundMovementPrelude.spatialLookHeading;
        const sidewayHeading = groundMovementPrelude.sidewayHeading;
        isSprinting = groundMovementPrelude.isSprinting;
        const sprintMult = groundMovementPrelude.sprintMult;
  
        // Sword Lunge Opportunity
        const lungeDistanceToTarget = targetAirborne ? combatDistanceToTarget : distanceToTarget;
        const hasVerticalLungeLine = !targetAirborne || movementComplexity >= 60;
  
        const groundAttackOpportunity = resolveAIGroundAttackOpportunityForCombatant({
          state: s,
          self,
          frame: {
            pos,
            vel,
            aiState: state,
            timer,
            weaponState,
          },
          botId,
          target,
          targetAirborne,
          targetProtected: targetIsProtected,
          activeWeapon,
          canStartWeaponAction,
          enemyInKillRange,
          selfGrounded,
          slideActive,
          cooldownMultiplier: cooldownMult,
          swordForbidden,
          swapLockoutRemaining,
          swapFeintActive: isWeaponSwapFeintActive(aiContext, botId),
          comboActive,
          feintChance,
          lungeDistanceToTarget,
          hasVerticalLungeLine,
          minLungeRange,
          maxLungeRange,
          combatDistanceToTarget,
          distanceToTarget,
          resolvedAiReach,
          aggressiveLungeMult,
          tunedAnticipationFactor,
          playstyleFactor,
          tuning,
          constrainCombatantToArena,
          triggerCombatantAttack,
          applyTacticalWeapon: (tacticalWeapon) => {
            applyTacticalWeapon(tacticalWeapon);
            return {
              activeWeapon,
              canStartWeaponAction,
              weaponState,
            };
          },
          startWeaponSwapFeintTimer: () => startWeaponSwapFeint(aiContext, botId, tuning.weaponSwapFeintDelay),
          commitFeint,
          tryFeintRoll,
          getTargetPlayerModel,
          triggerCombatantLunge,
          recordCombatantObservation,
        });
        activeWeapon = groundAttackOpportunity.activeWeapon;
        canStartWeaponAction = groundAttackOpportunity.canStartWeaponAction;
        state = groundAttackOpportunity.aiState;
        timer = groundAttackOpportunity.timer;
        weaponState = groundAttackOpportunity.weaponState;
        const feintLungeFakeout = groundAttackOpportunity.feintLungeFakeout;
        if (groundAttackOpportunity.mode === 'sync_return') {
          syncStateAndMesh();
          return;
        }
        if (groundAttackOpportunity.mode === 'return') {
          return;
        }
  
  
        const playerModel = getTargetPlayerModel(target.id);
        const approachLateral = getApproachLateralOffset(playerModel);
        const coordLateral = getPincerApproachOffset(coordRoleInput);
        const totalApproachLateral = approachLateral + coordLateral;
  
        if (weaponState === 'ready' && distanceToTarget > (resolvedDangerZone + 1.5) && distanceToTarget <= (resolvedDangerZone + 5.5) && Math.random() < 0.015 && (movementComplexity >= 40) && !targetIsProtected) {
          if (startAIHammerJump(self, pos, vel, lookHeading, 'offensive')) {
            weaponState = 'swing_up';
          }
        }
  
        if (state === 'APPROACHING') {
          // Begin a slide as a committed ground gap-closer when conditions allow.
          if (!slideActive && shouldStartAISlide({
            enableSlide: s.settings.enableSlide,
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
          })) {
            slideActive = true;
            slideDistanceTraveled = 0;
            isSprinting = false;
            sfx.playDash();
          }
  
          if (slideActive) {
            const slideSpeed = getSlideSpeed(s.settings.speedSlide, tuning.aiBaseGroundSpeed);
            vel.copy(spatialLookHeading).multiplyScalar(slideSpeed);
            pos.addScaledVector(vel, dt);
            const advanced = advanceAISlide({
              distanceTraveled: slideDistanceTraveled,
              slideSpeed,
              dt,
              maxSlideDistance: s.settings.slideDistance ?? 8.0,
            });
            slideDistanceTraveled = advanced.distanceTraveled;
            // End the slide if it is exhausted, the toggle was turned off, or we have
            // closed into engage range.
            if (advanced.finished || !s.settings.enableSlide || distanceToTarget <= (resolvedDangerZone + 1.5)) {
              slideActive = false;
              slideCooldownTimer = s.settings.slideCooldown ?? 1.5;
            }
          } else {
            vel.copy(spatialLookHeading).multiplyScalar(4.0 * (s.settings.speedForward / 100) * spatialBias.aggressionMult * sprintMult);
            if (totalApproachLateral !== 0) {
              vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.9);
            }
            pos.addScaledVector(vel, dt);
          }
  
          if (!slideActive && distanceToTarget <= (resolvedDangerZone + 3.2)) {
            state = 'SIDE_STEPPING';
            timer = Math.random() * 0.7 + 0.3;
          }
        }
        else if (state === 'SIDE_STEPPING') {
          const dir = Math.sin(swayTimer * 2.2) > 0 ? 1 : -1;
          vel.copy(sidewayHeading).multiplyScalar(3.2 * (s.settings.speedSide / 100) * dir);
          
          // Hold inside our own weapon's hit range, not just outside the enemy danger
          // zone. With a hammer, resolvedDangerZone + 1.2 (~8.6m default) sits *beyond*
          // the hammer's own ~7m sphere reach, so two hammer bots would otherwise park
          // where neither can land a blow and circle forever. Capping to just inside
          // guaranteedKillRange makes them close until a swing actually connects.
          const desiredDist = activeWeapon === 'sword'
            ? (maxLungeRange * 0.7)
            : Math.min(resolvedDangerZone + 1.2, guaranteedKillRange - 0.6);
          const approachBias = distanceToTarget > desiredDist ? 0.35 : -0.45;
          const approachSpeed = approachBias * 1.5 * (approachBias > 0 ? (s.settings.speedForward / 100) : (s.settings.speedBackward / 100));
          const approachAggression = approachBias > 0 ? spatialBias.aggressionMult : 1;
          vel.addScaledVector(spatialLookHeading, approachSpeed * approachAggression);
          if (totalApproachLateral !== 0) {
            vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.35);
          }
          
          if (isCrouching) {
            vel.multiplyScalar(0.45);
          }
          pos.addScaledVector(vel, dt);
  
          if (dashCooldownTimer <= 0 && distanceToTarget < (resolvedDangerZone + 2.0) && Math.random() < 0.015 && (movementComplexity >= 40)) {
            const sideDir = Math.random() > 0.5 ? 1 : -1;
            dashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
            dashRemaining = s.settings.dashDuration || 0.25;
            dashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
          }
  
          if (target.weaponState === 'swing_up' && !targetIsProtected) {
            const reactChance = tuning.reactChanceBase + (tunedAnticipationFactor * tuning.reactChanceAnticipation);
            
            const myHP = self.hp;
            const targetHP = target.hp;
            const shouldAvoidTrade = shouldAvoidCoinFlipTrade({
              difficulty,
              playstyleFactor,
              botHP: myHP,
              targetHP,
              multipliers: matchMultipliers,
            });
  
            if (shouldAvoidTrade || Math.random() < reactChance) {
              state = 'DANCING_BACKWARD';
              timer = effectiveReactionLatency + 0.35;
  
              if (dashCooldownTimer <= 0) {
                dashDir.copy(lookHeading).multiplyScalar(-1).normalize();
                dashRemaining = s.settings.dashDuration || 0.25;
                dashCooldownTimer = s.settings.dashCooldown || 2.0;
                sfx.playDash();
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
              Math.random()
            );
            if (forceStandoffCommit && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
              state = 'CHARGE_ATTACK';
              psychState.standoffTimer = 0;
            } else if (attackDistanceToTarget <= (resolvedAiReach + 0.5) && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
              state = 'CHARGE_ATTACK';
            } else {
              state = 'DANCING_FORWARD';
              timer = Math.random() * 0.5 + 0.25;
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
            vel.copy(lookHeading).multiplyScalar(-6.2 * (s.settings.speedBackward / 100));
            pos.addScaledVector(vel, dt);
          } else {
          const forwardSpeed = feintLungeFakeout ? 6.2 : 5.0;
          vel.copy(lookHeading).multiplyScalar(forwardSpeed * (s.settings.speedForward / 100) * sprintMult);
          if (totalApproachLateral !== 0) {
            vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.5);
          }
          pos.addScaledVector(vel, dt);
  
          if (target.weaponState === 'swing_up' && !targetIsProtected) {
            state = 'DANCING_BACKWARD';
            timer = 0.65;
            if (dashCooldownTimer <= 0 && Math.random() < 0.7) {
              dashDir.copy(lookHeading).multiplyScalar(-1).normalize();
              dashRemaining = s.settings.dashDuration || 0.25;
              dashCooldownTimer = s.settings.dashCooldown || 2.0;
              sfx.playDash();
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
            timer = Math.random() * 0.7 + 0.3;
          }
          }
        } 
        else if (state === 'DANCING_BACKWARD') {
          vel.copy(lookHeading).multiplyScalar(-6.2 * (s.settings.speedBackward / 100));
          pos.addScaledVector(vel, dt);
  
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
            const sideDir = Math.random() > 0.5 ? 1 : -1;
            dashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
            dashRemaining = s.settings.dashDuration || 0.25;
            dashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
            state = 'SIDE_STEPPING';
            timer = tuning.chargeAbortSidestepTimer;
            commitFeint();
          } else {
          if (dashCooldownTimer <= 0 && (movementComplexity >= 40) && !targetIsProtected) {
            dashDir.copy(lookHeading).normalize();
            dashRemaining = s.settings.dashDuration || 0.25;
            dashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
          }
  
          vel.copy(lookHeading).multiplyScalar(6.5 * (s.settings.speedForward / 100));
          pos.addScaledVector(vel, dt);
  
          if (attackDistanceToTarget <= stationarySwingReach && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
            if (isCoordAttackBlocked()) {
              state = 'SIDE_STEPPING';
              timer = 0.25;
            } else {
            const myHP = self.hp;
            const targetHP = target.hp;
            const shouldAvoidTrade = shouldAvoidCoinFlipTrade({
              difficulty,
              playstyleFactor,
              botHP: myHP,
              targetHP,
              multipliers: matchMultipliers,
              requireTargetOnCooldown: true,
              targetOnCooldown: isTargetOnCooldown(target),
            });
            const targetIsSwinging = target.weaponState === 'swing_up' || target.weaponState === 'swing_down';
  
            if (shouldAvoidTrade && targetIsSwinging) {
              state = 'DANCING_BACKWARD';
              timer = 0.6;
              if (dashCooldownTimer <= 0) {
                dashDir.copy(lookHeading).multiplyScalar(-1).normalize();
                dashRemaining = s.settings.dashDuration || 0.25;
                dashCooldownTimer = s.settings.dashCooldown || 2.0;
                sfx.playDash();
              }
            } else {
              state = 'COOLDOWN';
              timer = resolveScaledAIWeaponReloadTime(s.settings, activeWeapon, cooldownMult);
              triggerCombatantAttack(self, activeWeapon);
            }
            }
          } else if (attackDistanceToTarget > (resolvedAiReach + 2.0) || targetIsProtected) {
            state = 'SIDE_STEPPING';
            timer = 0.4;
          }
          }
        }
        else if (state === 'PRESSURING') {
          const pressureFrame = resolveAIPressureStateForCombatant({
            state: s,
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
            activeWeapon,
            stationarySwingReach,
            minLungeRange,
            targetProtected: targetIsProtected,
            canStartWeaponAction,
            cooldownMultiplier: cooldownMult,
            playstyleFactor,
            clearPressureTarget,
            isCoordAttackBlocked,
            triggerCombatantAttack: (weapon) => triggerCombatantAttack(self, weapon),
            playDash: () => sfx.playDash(),
          });
          state = pressureFrame.aiState;
          timer = pressureFrame.timer;
          dashRemaining = pressureFrame.dashRemaining;
          dashCooldownTimer = pressureFrame.dashCooldownTimer;
          weaponState = pressureFrame.weaponState;
        }
        else if (state === 'COOLDOWN') {
          vel.copy(lookHeading).multiplyScalar(-1.5 * (s.settings.speedBackward / 100));
          if (isCrouching) {
            vel.multiplyScalar(0.45);
          }
          pos.addScaledVector(vel, dt);
  
          if (timer <= 0) {
            state = 'SIDE_STEPPING';
            timer = 0.7;
          }
        }
  
        // Restore vertical velocity after FSM horizontal movement calculations
        vel.y = savedVelY;
      }
  
      constrainCombatantToArena(pos, vel);
  
      // Unified vertical handling for every combatant: while airborne we keep the
      // integrated vel.y; once grounded (and not lunging) we zero it and clear the jump
      // flag. (For the main AI vel === mai()!.vel, so this is the same data either way.)
      if (state !== 'LUNGING' && !(self.isJumping || pos.y > 0.01)) {
        vel.y = 0;
        self.isJumping = false;
      }
  
      const isAirborne = self.isJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01;
  
      if (isAirborne && state !== 'LUNGING') {
        // Heavily restrict horizontal movement in the air so they don't "walk across the air"
        vel.x *= 0.05;
        vel.z *= 0.05;
      }
  
      syncStateAndMesh();
    };
    };
}
