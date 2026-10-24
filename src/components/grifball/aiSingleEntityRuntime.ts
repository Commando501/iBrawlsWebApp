import type { CustomMapData } from '../../types';
import { planLiveTeamSafeAim } from './aiTeamSafeAimRuntime';
import { isTeamAimAttackPending } from '../../game/aiTeamSafeAim';
import { beginPunch } from '../../game/ballPunch';
import { punchTargetsForState } from './ballPunchRuntime';
import { AI_CROUCH_SPEED_MULTIPLIER } from '../../game/aiMovementMechanics';
import { observeLiveGrifballSwordGuard } from './grifballSwordGuard';
import { resolveAIGroundState } from '../../game/aiGroundState';
import { selectGrifballEscortEvasion } from '../../game/aiGrifballEvasion';
import { selectGrifballRunnerEvasion } from '../../game/aiGrifballRunnerEvasion';
import { createLiveGrifballTacticalSnapshot } from './grifballTeamPlanRuntime';
import { finishAIHorizontalMotion, startAISpatialDodgeMotion } from '../../game/aiDashMotion';
import { simulationRandom, simulationSeconds } from '../../game/simulationRandom';
import { canApplyAITacticalWeaponSwap } from '../../game/aiTacticalWeaponSwap';
import * as THREE from 'three';
import { resolveAICombatDangerZone, type AILungeOutcome } from '../../game/aiCombatDecision';
import {
  getPincerApproachOffset,
  registerBotEngagement,
} from '../../game/aiBotCoordinator';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import {
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
  advanceAIWeaponSwapFeint,
} from '../../game/aiMatchContext';
import {
  applyCalibrationMultipliers,
  tickCalibrationPendingCounter,
  tickCalibrationPendingDodge,
} from '../../game/aiSkillCalibration';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import { selectGrifballAssignmentThreat } from '../../game/aiGrifballTeamPlan';
import { type LoadedNeuralBrain } from '../../game/neuralBrainLoader';
import { MAIN_AI_ID } from '../../game/roster';
import { type Combatant } from '../../types';
import { resolveAIAirborneHammerOpportunityForCombatant } from './aiAirborneHammerOpportunityRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from './aiAirborneRecoveryRuntime';
import { syncAICombatantFrameToState, syncAICombatantPoseAndState } from './aiCombatantFrameSync';
import { resolveAIEngagementPreparation } from '../../game/aiEngagementPreparation';
import { selectAIEngagementTarget } from '../../game/aiEngagementTarget';
import { resolveAICombatTuningPreludeForCombatant } from './aiCombatTuningPreludeRuntime';
import { resolveAIComboOrchestrationForCombatant } from './aiComboOrchestrationRuntime';
import { shouldBlockCoordinatedAttackForFrame } from './aiCoordinationRuntime';
import { resolveAIDashMovementForCombatant } from './aiDashMovementRuntime';
import {
  integrateTargetEngagementGravityForCombatant,
  normalizeTargetEngagementFrameState,
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
import { resolveGrifballRunnerPursuitLaunch } from '../../game/aiGrifballRunnerPursuitLaunch';
import { resolveAIGroundMovementPreludeForCombatant } from './aiGroundMovementPreludeRuntime';
import { resolveAILungeEvasionForCombatant } from './aiLungeEvasionRuntime';
import { resolveNoTargetAIFrameForCombatant } from './aiNoTargetRuntime';
import { resolvePostKillPressureForCombatant } from './aiPostKillPressureRuntime';
import { finishAISwordLungeFrameForCombatant, finishTradedAISwordLungeForCombatant } from './aiSwordLungeFinishRuntime';
import { resolveAISwordLungeFlightForCombatant } from './aiSwordLungeFlightRuntime';
import { resolveAITargetPredictionFrame } from './aiTargetPredictionRuntime';
import {
  initializeCombatantAITickDefaults,
  pauseInactiveGrifballAI,
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
  getActiveCustomMap: () => CustomMapData | null;
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
  canCombatantsDamage,
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
      let newlyCommittedAimTarget: THREE.Vector3 | null = null;
      let teamAimTargetId: string | undefined;
      const teamAimStart = { x: pos.x, z: pos.z, vy: vel.y, lunging: !!self.isLunging };
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
        // Decisions may start a strike after the prediction prelude. Aim that
        // first committed frame at the observed target, as later frames do.
        if (newlyCommittedAimTarget && ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(self.weaponState ?? '')) {
          const dx = newlyCommittedAimTarget.x - pos.x, dz = newlyCommittedAimTarget.z - pos.z;
          if (dx !== 0 || dz !== 0) yaw = Math.atan2(-dx, -dz);
        }
        // Final autonomous intent, before the roster animation can deal damage.
        // Re-evaluate during windup as neighbours move; committed flights keep
        // their launch direction and the normal friendly-fire collision rules.
        if (s.settings.gameMode === 'grifball' && s.grifball.phase === 'playing' && self.activeWeapon === 'ball' &&
          isTeamAimAttackPending('ball', self.weaponState) && !self.punchAttack) {
          // Lock assistance at commitment, as the simulator does, before later
          // roster turns can move the target out of the acquisition envelope.
          self.punchAttack = beginPunch({ ...self, heading: { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
            eyeHeight: self.isCrouching ? .9 : 1.2 }, punchTargetsForState(s, botId), s.settings, getActiveCustomMap());
        }
        const aimPlan = planLiveTeamSafeAim(s, self, yaw, teamAimStart.lunging, getActiveCustomMap(), teamAimTargetId);
        if (aimPlan.kind === 'aim') {
          yaw = Math.atan2(-aimPlan.heading.x, -aimPlan.heading.z);
          if (self.isLunging) self.lungeTargetDir = { ...aimPlan.heading };
          else if (self.activeWeapon === 'ball' && isTeamAimAttackPending('ball', self.weaponState)) {
            // Do not let punch assistance steer a deliberately offset jab back
            // through a teammate on the following animation tick.
            self.punchAttack = beginPunch({ ...self, heading: aimPlan.heading, eyeHeight: self.isCrouching ? .9 : 1.2 }, [], s.settings);
          }
        } else if (aimPlan.kind === 'hold' || aimPlan.kind === 'reposition') {
          if (self.isLunging || isTeamAimAttackPending(self.activeWeapon === 'sword' ? 'sword' : self.activeWeapon === 'ball' ? 'ball' : 'hammer', self.weaponState ?? '')) {
            if (self.isLunging) { vel.y = Math.min(vel.y, teamAimStart.vy); self.isJumping = pos.y > .01 || vel.y > .01; }
            self.isLunging = false; self.lungeTimer = 0;
            self.weaponState = weaponState = 'ready'; self.weaponTimer = 0;
            self.hammerJumpPlanned = false; delete self.punchAttack;
            s.aiMatchContext.comboState.delete(botId);
            state = 'SIDE_STEPPING'; timer = .15;
          }
          if (!teamAimStart.lunging && !self.isJumping && pos.y <= .01 && dashRemaining <= 0 && !slideActive) {
            const dx = aimPlan.kind === 'reposition' ? aimPlan.destination.x - pos.x : 0;
            const dz = aimPlan.kind === 'reposition' ? aimPlan.destination.z - pos.z : 0;
            const length = Math.hypot(dx, dz);
            const speed = Math.min(3.5 * s.settings.speedSide / 100 * (self.isCrouching ? AI_CROUCH_SPEED_MULTIPLIER : 1), length / Math.max(dt, .001));
            vel.x = length > .001 ? dx / length * speed : 0;
            vel.z = length > .001 ? dz / length * speed : 0;
            pos.x = teamAimStart.x + vel.x * dt; pos.z = teamAimStart.z + vel.z * dt;
            isSprinting = false; constrainCombatantToArena(pos, vel);
          }
        }
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
  
      const finishSwordLunge = (cooldownMultiplier = 1, outcome: AILungeOutcome = 'miss_timeout', targetId?: string, damageAlreadyRecorded = false) => {
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
          damageAlreadyRecorded,
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
              canCombatantsDamage,
              finishSwordLunge,
              finishTradedTargetLunge: (other, attackerId) => finishTradedAISwordLungeForCombatant({
                state: s, self: other, botId: other.id, targetId: attackerId,
                recordCombatantObservation, recordBotDamageTag, tryEnterPressureState, tryStartComboOnHit,
              }),
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
              // Trade deaths retain this turn's completed AI clocks for respawn.
              // Sync does not overwrite the death callback's HP or weapon state.
              syncStateAndMesh();
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
        botMesh.scale.set(1, neuralCrouching && botMesh.userData.modelSystem !== 'v3' ? 0.65 : 1, 1);

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
  
      if (pauseInactiveGrifballAI(s, self)) {
        syncStateAndMesh();
        return;
      }

      // Tick mobility/swap cooldowns even when team positioning returns before combat.
      const advanceCombatCooldowns = () => {
        const cooldownFrame = createAIEngagementFrameFromLocals({
          pos, vel, aiState: state, timer, dashCooldownTimer, slideCooldownTimer, hammerJumpCooldownTimer,
        });
        tickAIEngagementCooldowns({ frame: cooldownFrame, self, botId, mainAIId: MAIN_AI_ID, dt });
        ({ aiState: state, timer, dashCooldownTimer, slideCooldownTimer, hammerJumpCooldownTimer } =
          applyAIEngagementFrameToLocals(cooldownFrame));
      };
      if (s.settings.gameMode === 'grifball') {
        advanceCombatCooldowns();
        canStartWeaponAction = canStartAIWeaponAction({ aiState: state, timer, swapCooldownTimer: self.swapCooldownTimer });
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
  
      if (postKillPressure && s.settings.gameMode !== 'grifball') {
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
        tryRunnerEvasion: s.settings.gameMode === 'grifball' && !s.isMultiplayer ? movement => {
          if (!(dashCooldownTimer <= 0)) return false;
          const direction = selectGrifballRunnerEvasion({
            snapshot: createLiveGrifballTacticalSnapshot(s, grifballEnemyGoalPos, getActiveCustomMap()),
            assignment: s.aiMatchContext.grifballTeamPlan.assignments.get(botId), botId,
            origin: pos, movement, distance: s.settings.dashDistance, duration: s.settings.dashDuration || .25,
          });
          if (!direction) return false;
          const launch = { dashDir, dashRemaining, dashCooldownTimer };
          startAISpatialDodgeMotion(s.settings, launch, direction);
          ({ dashRemaining, dashCooldownTimer } = launch);
          sfx.playDash();
          return true;
        } : undefined,
        alliesList,
        enemiesList,
        dt,
        canStartWeaponAction,
        triggerCombatantAttack,
        constrainCombatantToArena,
        getEnemyGoalPos: grifballEnemyGoalPos,
      })) {
        let pickupRequested = false;
        ({ yaw, aiState: state, timer, dashRemaining, slideActive, weaponState, pickupRequested } =
          applyGrifballAIObjectiveFrameToLocals(primaryGrifballFrame));
        self.pickupRequested = pickupRequested;
        syncStateAndMesh();
        return;
      }
  
  
      const teamAssignment = s.aiMatchContext.grifballTeamPlan.assignments.get(botId);
      const assignmentThreat = teamAssignment
        ? selectGrifballAssignmentThreat(teamAssignment, pos, s.aiMatchContext.grifballTeamPlan.snapshot?.players ?? [])
        : null;
      self.pickupRequested = false;
      const finishingMovement = self.isLunging || dashRemaining > 0 || slideActive;
      const pressureTargetId = self.aiPressureTargetId;
      const target = selectAIEngagementTarget({ hasAssignment: !!teamAssignment, assignmentThreat, finishingMovement,
        aiState: state, pressureTargetId,
        getById: id => getTacticalTargetById(botId, id),
        getBest: () => getBestTacticalTarget(botId, pos, difficulty) });
  
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
        resolveNoTargetAIFrameForCombatant({
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
            // The no-target frame was captured before cancellation. Retain the
            // new reload locals through airborne/support recovery and final sync.
            Object.assign(noTargetFrame, { aiState: state, timer, weaponState });
          },
          recoverCombatantAltitude,
          constrainCombatantToArena,
          getOptimalSpawnPoint,
          getCombatantTeam: grifballTeamOf,
          getCombatantRef: grifballCombatantRef,
          getEnemyGoalPos: grifballEnemyGoalPos,
        });
        let pickupRequested = false;
        ({ yaw, aiState: state, timer, dashRemaining, slideActive, weaponState, pickupRequested } =
          applyGrifballAIObjectiveFrameToLocals(noTargetFrame));
        self.pickupRequested = pickupRequested;
  
        // Spawn guarding must also retain this frame's mobility cooldowns and
        // cancelled commitment, just like airborne and objective recovery.
        syncStateAndMesh();
        return;
      }
  
      registerBotEngagement(s.aiMatchContext.coordinator, botId, target.id);
      teamAimTargetId = target.id;
      if (!['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(weaponState)) newlyCommittedAimTarget = target.pos;
  
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
        aimAtCurrentTarget: ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(weaponState),
        movementComplexity,
        activeCustomMap,
        arenaRadius: s.arenaRadius,
      });
  
      yaw = targetYaw;
      botMesh.rotation.y = yaw;
  
      const playerDangerZone = resolveAICombatDangerZone(s.settings, target.activeWeapon);
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
  
      const engagementPreparation = resolveAIEngagementPreparation({
        aiState: state, swayTimer, slideActive, movementComplexity, weaponState, coordCommitTimer,
        psychEnabled, standoffTimer: psychState.standoffTimer, resolvedDangerZone, dt,
        standoffRangeMinOffset: tuning.standoffRangeMinOffset, standoffRangeMaxOffset: tuning.standoffRangeMaxOffset,
        range: { botPos: pos, botVel: vel, botIsJumping: self.isJumping, targetIsCrouching: target.isCrouching,
          targetHp: target.hp, targetProtected: targetIsProtected, predictedTargetPos, distanceToTarget,
          activeWeapon, attackRange: s.settings.attackRange, attackRadius: s.settings.attackRadius, resolvedAiReach },
      });
      const { isCrouching } = engagementPreparation;
      if (isCrouching && botMesh.userData.modelSystem !== 'v3') botMesh.scale.set(1, 0.65, 1);
      else botMesh.scale.set(1, 1, 1);
      self.isCrouching = isCrouching;
      const { combatDistanceToTarget, verticalDeltaToTarget, attackDistanceToTarget, guaranteedKillRange,
        enemyInKillRange, selfGrounded, stationarySwingReach } = engagementPreparation.range;
      coordCommitTimer = engagementPreparation.coordCommitTimer;
      psychState.standoffTimer = engagementPreparation.standoffTimer;

      const swordGuard = observeLiveGrifballSwordGuard(s, self, target.id, canStartWeaponAction, dt, activeCustomMap);
      if (swordGuard?.action === 'space') {
        vel.x = swordGuard.velocity!.x; vel.z = swordGuard.velocity!.z;
        pos.x += vel.x * dt; pos.z += vel.z * dt;
        timer = (timer ?? 0) - dt; swayTimer += dt;
        constrainCombatantToArena(pos, vel);
        syncStateAndMesh();
        return;
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
        nowSeconds: simulationSeconds(),
        mapShape: activeCustomMap?.mapShape,
      });
  
      if (s.settings.gameMode !== 'grifball') advanceCombatCooldowns();
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
  
      const carrierInterception = s.settings.gameMode === 'grifball' && !!s.grifball.ball.holderId &&
        teamAssignment?.tuning?.enabled === true && teamAssignment.defense?.targetId === s.grifball.ball.holderId &&
        (teamAssignment.defense.mode === 'intercept' || teamAssignment.defense.mode === 'last-defender' || teamAssignment.defense.emergency);
      const applyTacticalWeapon = (tacticalWeapon: 'hammer' | 'sword', force = false) => {
        if (!canApplyAITacticalWeaponSwap({ activeWeapon, requestedWeapon: tacticalWeapon, weaponState,
          swordForbidden, hammerForbidden, force, isLunging: self.isLunging, swapLockoutTimer: self.swapLockoutTimer ?? 0 })) return;
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
  
      if (advanceAIWeaponSwapFeint(aiContext, botId, dt, activeWeapon, weaponState, hammerForbidden, !!self.isLunging).revert) {
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
        preserveReadyStrike: carrierInterception && target.id === s.grifball.ball.holderId &&
          enemyInKillRange && selfGrounded && !slideActive && dashRemaining <= 0,
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
          canCombatantsDamage,
          finishSwordLunge,
          finishTradedTargetLunge: (other, attackerId) => finishTradedAISwordLungeForCombatant({
            state: s, self: other, botId: other.id, targetId: attackerId,
            recordCombatantObservation, recordBotDamageTag, tryEnterPressureState, tryStartComboOnHit,
          }),
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
          // Trade deaths retain this turn's completed AI clocks for respawn.
          // Sync does not overwrite the death callback's HP or weapon state.
          syncStateAndMesh();
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
          resolveRunnerPursuitLaunch: () => {
            const assignment = s.aiMatchContext.grifballTeamPlan.assignments.get(botId);
            if (s.isMultiplayer || s.settings.gameMode !== 'grifball' || !assignment?.defense?.pursuit) return { kind: 'ordinary' };
            return resolveGrifballRunnerPursuitLaunch(assignment,
              createLiveGrifballTacticalSnapshot(s, grifballEnemyGoalPos, getActiveCustomMap()), target.id);
          },
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
          // Launch skips further movement, but must retain this turn's AI clocks.
          syncStateAndMesh();
          return;
        }
  
  
        const playerModel = getTargetPlayerModel(target.id);
        const approachLateral = getApproachLateralOffset(playerModel);
        const coordLateral = getPincerApproachOffset(coordRoleInput);
        const totalApproachLateral = approachLateral + coordLateral;
  
        const groundStateFrame = resolveAIGroundState({
          settings: s.settings,
          frame: { pos, vel, dashDir, aiState: state, timer, weaponState, dashRemaining, dashCooldownTimer,
            slideActive, slideDistanceTraveled, slideCooldownTimer, isSprinting },
          target, botId, botHP: self.hp, pressureTargetId, distanceToTarget, attackDistanceToTarget,
          resolvedDangerZone, resolvedAiReach, guaranteedKillRange, maxLungeRange, minLungeRange,
          stationarySwingReach, activeWeapon, canStartWeaponAction, targetIsProtected, difficulty,
          movementComplexity, playstyleFactor, tunedAnticipationFactor, effectiveReactionLatency,
          effectivePressureAggression, cooldownMult, dt, swayTimer, savedVelY, lookHeading,
          spatialLookHeading, sidewayHeading, spatialBias, totalApproachLateral, sprintMult,
          isCrouching, feintChance, feintLungeFakeout, psychEnabled, psychState, matchMultipliers, tuning,
          startOffensiveHammerJump: heading => startAIHammerJump(self, pos, vel, heading, 'offensive'),
          playDash: () => sfx.playDash(), tryFeintRoll, commitFeint,
          isTargetOnCooldown: () => isTargetOnCooldown(target), isCoordAttackBlocked, clearPressureTarget,
          triggerCombatantAttack: weapon => triggerCombatantAttack(self, weapon),
          selectDefensiveDashDirection: s.settings.gameMode === 'grifball' && !s.isMultiplayer ? (origin, fallback) =>
            selectGrifballEscortEvasion({ snapshot: createLiveGrifballTacticalSnapshot(s, grifballEnemyGoalPos, getActiveCustomMap()),
              assignment: s.aiMatchContext.grifballTeamPlan.assignments.get(botId), botId, origin, fallback,
              distance: s.settings.dashDistance, duration: s.settings.dashDuration || .25 }) : undefined,
        });
        ({ aiState: state, timer, weaponState, dashRemaining, dashCooldownTimer, slideActive,
          slideDistanceTraveled, slideCooldownTimer, isSprinting } = groundStateFrame);
      }
  
      }
      constrainCombatantToArena(pos, vel);

      finishAIHorizontalMotion(self, { pos, vel, aiState: state });

      // Flight completion also writes back its reload, pressure and AI clocks.
      syncStateAndMesh();
    };
}
