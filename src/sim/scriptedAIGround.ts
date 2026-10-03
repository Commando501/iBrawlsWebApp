import { hasCoherentSimCarrierState } from './grifballCarrierState';
import type { RosterCombatLearning } from './scriptedCombatLearning';
import * as THREE from 'three';
import { resolveAIGroundState, type AIGroundStateInput } from '../game/aiGroundState';
import { startAIHammerJumpAction } from '../game/aiHammerJump';
import { finishAIHorizontalMotion } from '../game/aiDashMotion';
import { resolveHammerSlamTiming } from '../game/hammerSlamTiming';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import type { AIBehaviorState, UniversalSettings } from '../types';
import type { SimCombatant, SimState } from './simState';
import type { TacticalAIMemory } from './grifballTacticalWeaponChoice';
import { observeSimTacticalWeaponTarget } from './grifballTacticalWeaponChoice';
import { resolveAIGroundAttackOpportunityForCombatant, type AIGroundAttackOpportunityResult } from '../components/grifball/aiGroundAttackOpportunityRuntime';
import { canApplyAITacticalWeaponSwap, resolveAIWeaponSwapTimers } from '../game/aiTacticalWeaponSwap';
import { startSimRosterLunge } from './weapons';

type OpportunityInput = Parameters<typeof resolveAIGroundAttackOpportunityForCombatant>[0];
/** Observations retained from before earlier priorities, plus caller-owned memory
 * effects. Shared range/readiness/navigation locals come from the ground policy. */
export type ScriptedAIGroundOpportunity = Pick<OpportunityInput,
  'targetAirborne' | 'enemyInKillRange' | 'selfGrounded' | 'swordForbidden' |
  'swapLockoutRemaining' | 'swapFeintActive' | 'comboActive' | 'lungeDistanceToTarget' |
  'hasVerticalLungeLine' | 'combatDistanceToTarget' | 'aggressiveLungeMult' | 'tuning' |
  'startWeaponSwapFeintTimer' | 'getTargetPlayerModel' | 'recordCombatantObservation'> & { hammerForbidden: boolean };

type EngineFields = 'settings' | 'frame' | 'target' | 'botHP' | 'botId' | 'dt' | 'savedVelY' |
  'startOffensiveHammerJump' | 'playDash' | 'triggerCombatantAttack';
export type ScriptedAIGroundPolicy = Omit<AIGroundStateInput, EngineFields | 'random'> & { random: () => number };
export interface ScriptedAIGroundRequest {
  targetId: string;
  targetMemory?: TacticalAIMemory;
  /** Current turn's cached decision locals, after earlier priorities and timer tick. */
  memory: Pick<AIGroundStateInput['frame'], 'aiState' | 'timer' | 'weaponState' | 'isSprinting'>;
  policy: ScriptedAIGroundPolicy;
  opportunity?: ScriptedAIGroundOpportunity;
}
export interface ScriptedAIGroundOwner {
  version: 'scripted-ai-ground-v1';
  /** Invoked only after airborne recovery and pending dash travel decline movement.
   * Reads this host's current state; only caller-owned memory/RNG may be mutated. */
  resolve(context: { state: SimState; actorId: string; dt: number; motionPhase: 'after-engagement-recovery' }): ScriptedAIGroundRequest;
}
export interface ScriptedAIGroundFeedback {
  aiState: AIBehaviorState | undefined;
  timer: number | undefined;
  weaponState: AIGroundStateInput['frame']['weaponState'];
  standoffTimer: number;
  actions: ('hammer-jump' | 'attack-hammer' | 'attack-sword' | 'attack-ball' | 'dash' | 'swap-sword' | 'lunge')[];
  opportunity?: AIGroundAttackOpportunityResult;
}

const states = ['APPROACHING', 'SIDE_STEPPING', 'DANCING_FORWARD', 'DANCING_BACKWARD', 'CHARGE_ATTACK',
  'PRESSURING', 'COOLDOWN', 'LUNGING', 'RESPAWNING', 'SPAWN_GUARDING'];
const point = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
/** Ground policy may follow early commands, but cannot supply a second generic
 * movement/input owner. Configuration checks occur before its callback runs. */
export function validateScriptedAIGroundOwner(owner: ScriptedAIGroundOwner, prepared: boolean, conflicting: boolean): ScriptedAIGroundOwner {
  if (!prepared || conflicting || !owner || owner.version !== 'scripted-ai-ground-v1' || typeof owner.resolve !== 'function')
    throw new Error('Ground policy requires exclusive prepared AI movement');
  return { version: owner.version, resolve: owner.resolve };
}

function validateRequest(state: SimState, actor: SimCombatant, request: ScriptedAIGroundRequest) {
  const p = request?.policy, m = request?.memory;
  const o = request?.opportunity;
  if (o) {
    for (const key of ['targetAirborne', 'enemyInKillRange', 'selfGrounded', 'swordForbidden', 'hammerForbidden',
      'swapFeintActive', 'comboActive', 'hasVerticalLungeLine'] as const)
      if (typeof o[key] !== 'boolean') throw new Error(`Invalid ground opportunity flag: ${key}`);
    for (const key of ['swapLockoutRemaining', 'lungeDistanceToTarget', 'combatDistanceToTarget', 'aggressiveLungeMult'] as const)
      if (!Number.isFinite(o[key]) || o[key] < 0) throw new Error(`Invalid ground opportunity observation: ${key}`);
    for (const key of ['startWeaponSwapFeintTimer', 'getTargetPlayerModel', 'recordCombatantObservation'] as const)
      if (typeof o[key] !== 'function') throw new Error(`Invalid ground opportunity callback: ${key}`);
    for (const key of ['weaponSwapFeintDelay', 'lungeChanceAirborneBase', 'lungeChanceAirborneAnticipation',
      'lungeChanceGroundBase', 'lungeChanceGroundAnticipation', 'lungeFakeoutForwardTimer'] as const)
      if (!o.tuning || !Number.isFinite(o.tuning[key])) throw new Error(`Invalid ground opportunity tuning: ${key}`);
  }
  if (!p || !m || typeof m.isSprinting !== 'boolean' || m.aiState !== undefined && !states.includes(m.aiState) || !Number.isFinite(m.timer) ||
    !['ready', 'swing_up', 'swing_down', 'melee_up', 'melee_down', 'melee_recover', 'slashing', 'recovering'].includes(m.weaponState))
    throw new Error('Invalid ground decision memory');
  for (const key of ['distanceToTarget', 'attackDistanceToTarget', 'resolvedDangerZone', 'resolvedAiReach', 'guaranteedKillRange',
    'maxLungeRange', 'minLungeRange', 'stationarySwingReach', 'movementComplexity', 'playstyleFactor', 'tunedAnticipationFactor',
    'effectiveReactionLatency', 'effectivePressureAggression', 'cooldownMult', 'swayTimer', 'totalApproachLateral', 'sprintMult', 'feintChance'] as const)
    if (!Number.isFinite(p[key])) throw new Error(`Invalid ground observation: ${key}`);
  for (const key of ['canStartWeaponAction', 'targetIsProtected', 'isCrouching', 'feintLungeFakeout', 'psychEnabled'] as const)
    if (typeof p[key] !== 'boolean') throw new Error(`Invalid ground flag: ${key}`);
  for (const key of ['random', 'tryFeintRoll', 'commitFeint', 'isTargetOnCooldown', 'isCoordAttackBlocked', 'clearPressureTarget'] as const)
    if (typeof p[key] !== 'function') throw new Error(`Invalid ground callback: ${key}`);
  if (p.selectDefensiveDashDirection !== undefined && typeof p.selectDefensiveDashDirection !== 'function')
    throw new Error('Invalid ground callback: selectDefensiveDashDirection');
  for (const key of ['lookHeading', 'spatialLookHeading', 'sidewayHeading'] as const)
    if (!p[key] || ![p[key].x, p[key].y, p[key].z].every(Number.isFinite)) throw new Error(`Invalid ground heading: ${key}`);
  for (const [object, keys] of [
    [p.spatialBias, ['aggressionMult']], [p.psychState, ['standoffTimer']],
    [p.matchMultipliers, ['aggressionMult', 'cooldownMult', 'spacingMult', 'iqGateBonus', 'matchPointCommitBias', 'pressureDurationMult']],
    [p.tuning, ['slideMinComplexity', 'slideMinGap', 'slideMaxGap', 'slideTriggerChance', 'aiBaseGroundSpeed', 'reactChanceBase',
      'reactChanceAnticipation', 'approachFeintBackTimer', 'chargeAbortSidestepTimer']],
  ] as const) if (!object || keys.some(key => !Number.isFinite((object as Record<string, unknown>)[key])))
    throw new Error('Invalid ground tuning or memory');
  if (typeof p.matchMultipliers.avoidCoinFlipTrades !== 'boolean' || typeof p.difficulty !== 'string' ||
    p.activeWeapon !== actor.weapon || !['hammer', 'sword', 'ball'].includes(p.activeWeapon)) throw new Error('Invalid ground weapon/tuning');
  if (request.targetMemory && (!Number.isFinite(request.targetMemory.timer) || !Number.isFinite(request.targetMemory.cooldownMultiplier) ||
    request.targetMemory.aiState !== undefined && !states.includes(request.targetMemory.aiState))) throw new Error('Invalid ground target memory');
  const targets = state.combatants.filter(c => c.id === request.targetId), target = targets[0];
  if (targets.length !== 1 || target.id === actor.id || target.team === actor.team ||
    target.controller === 'ai' && target.id !== state.localPlayerId && !request.targetMemory)
    throw new Error('Ground policy requires an observed hostile target');
  return target;
}

/** Only called at the exclusive ground boundary, never for player/RL actions.
 * Action callbacks run immediately at their actual position in the shared FSM;
 * skeletal animation/damage still belongs to the later roster animation pass. */
export function executeScriptedAIGround(state: SimState, actor: SimCombatant, settings: UniversalSettings,
  dt: number, savedVelY: number, owner: ScriptedAIGroundOwner, readyFromThisTurn = false, learning?: RosterCombatLearning): ScriptedAIGroundFeedback {
  if (state.mode !== 'grifball' || state.combatExecution !== 'live-mixed-v1' || state.match.phase !== 'playing' ||
    actor.id === state.localPlayerId || actor.controller !== 'ai' || !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0 ||
    actor.isLunging || !hasCoherentSimCarrierState(state, actor) || actor.dashRemaining > 0 || actor.isJumping || actor.pos.y > .01)
    throw new Error('Ground execution requires a recovered armed AI');
  const view = settings === state.settings ? state : { ...state, settings };
  const request = owner.resolve({ state: view, actorId: actor.id, dt, motionPhase: 'after-engagement-recovery' });
  const target = validateRequest(state, actor, request), policy = { ...request.policy };
  if (!readyFromThisTurn && request.memory.weaponState === 'ready' && actor.weaponState !== 'idle')
    throw new Error('Ground readiness cannot replace a pre-existing attack');
  const observed = observeSimTacticalWeaponTarget(state, target, request.targetMemory);
  const frame = { ...request.memory, pos: point(actor.pos), vel: point(actor.vel), dashDir: point(actor.dashDir),
    dashRemaining: actor.dashRemaining, dashCooldownTimer: actor.dashCooldownTimer,
    slideActive: actor.slideActive, slideDistanceTraveled: actor.aiSlideDistanceTraveled ?? 0,
    slideCooldownTimer: actor.slideCooldownTimer, isSprinting: request.memory.isSprinting };
  const actions: ScriptedAIGroundFeedback['actions'] = [];
  // Live pos/vel are shared references, while dash/AI fields are cached locals
  // until the final sync. Callbacks must see movement already performed here.
  const syncPose = () => { Object.assign(actor.pos, frame.pos); Object.assign(actor.vel, frame.vel); };
  const atPose = <A extends unknown[], R>(callback: (...args: A) => R) => (...args: A): R => {
    syncPose(); return callback(...args);
  };
  // Live generic attack callbacks reset their animation; cached readiness was
  // already arbitrated by the policy. They do not spend another AI/weapon clock.
  const swing = (timestampWeapon?: 'hammer' | 'sword' | 'ball', observeAttack = true) => {
    actor.weaponState = 'windup'; actor.weaponPhaseElapsed = 0;
    actor.attackKind = actor.weapon === 'sword' ? 'slash' : actor.weapon === 'ball' ? 'punch' : 'strike';
    actor.weaponTimer = actor.weapon === 'sword' ? (settings.swordSlashSpeed ?? .22) * .5 : actor.weapon === 'ball' ? (settings.hammerMeleeSpeed ?? .24) : resolveHammerSlamTiming(settings).windupTime;
    if (timestampWeapon) {
      actor.lastAttackTick = state.tick;
      const now = state.combatTimeMs ?? state.tick * 1000 / 60;
      if (timestampWeapon !== 'sword') {
        actor.lastHammerAttackTimeMs = now;
        if (observeAttack) learning?.hammerAttack(actor);
      } else actor.lastSwordAttackTimeMs = now;
    }
  };
  let opportunity: AIGroundAttackOpportunityResult | undefined;
  if (request.opportunity) {
    const o = request.opportunity;
    opportunity = resolveAIGroundAttackOpportunityForCombatant({ ...o, state: { settings }, self: actor, frame,
      botId: actor.id, target: { ...observed, pos: point(target.pos), vel: point(target.vel), maxHp: target.maxHp,
        isCrouching: target.isCrouching, playerName: target.id, modelType: target.modelType },
      activeWeapon: policy.activeWeapon, canStartWeaponAction: policy.canStartWeaponAction,
      targetProtected: policy.targetIsProtected, slideActive: frame.slideActive, cooldownMultiplier: policy.cooldownMult,
      feintChance: policy.feintChance, minLungeRange: policy.minLungeRange, maxLungeRange: policy.maxLungeRange,
      distanceToTarget: policy.distanceToTarget, resolvedAiReach: policy.resolvedAiReach,
      tunedAnticipationFactor: policy.tunedAnticipationFactor, playstyleFactor: policy.playstyleFactor,
      random: atPose(policy.random), tryFeintRoll: atPose(policy.tryFeintRoll), commitFeint: atPose(policy.commitFeint),
      startWeaponSwapFeintTimer: atPose(o.startWeaponSwapFeintTimer), getTargetPlayerModel: atPose(o.getTargetPlayerModel),
      recordCombatantObservation: atPose(o.recordCombatantObservation),
      constrainCombatantToArena: () => {
        actor.grounded = constrainCombatantToArenaBounds({ pos: frame.pos, vel: frame.vel,
          activeCustomMap: state.map, arenaRadius: state.map.arenaRadius }).grounded || frame.pos.y <= .0001;
      },
      triggerCombatantAttack: (_self, weapon) => { syncPose(); actions.push(`attack-${weapon}`); swing(weapon); },
      applyTacticalWeapon: requestedWeapon => {
        if (canApplyAITacticalWeaponSwap({ activeWeapon: policy.activeWeapon, requestedWeapon,
          weaponState: frame.weaponState, swapLockoutTimer: actor.swapLockoutTimer,
          swordForbidden: o.swordForbidden, hammerForbidden: o.hammerForbidden })) {
          actor.weapon = requestedWeapon; policy.activeWeapon = requestedWeapon; frame.weaponState = 'ready';
          if (actor.weaponState === 'recovering' && actor.attackKind !== 'swipe') actor.attackKind = requestedWeapon === 'sword' ? 'slash' : 'strike';
          const timers = resolveAIWeaponSwapTimers(settings, actor.swapLockoutTimer, actor.weaponReadyTimer);
          actor.swapLockoutTimer = timers.lockout; actor.weaponReadyTimer = timers.readiness;
          if (settings.weaponReadyTime > 0) policy.canStartWeaponAction = false;
          learning?.weaponSwap(actor, requestedWeapon);
          actions.push('swap-sword');
        }
        return { activeWeapon: policy.activeWeapon, canStartWeaponAction: policy.canStartWeaponAction, weaponState: frame.weaponState };
      },
      triggerCombatantLunge: (_self, direction) => {
        syncPose(); startSimRosterLunge(state, actor, settings, target.id, direction);
        frame.vel.copy(point(actor.vel)); actions.push('lunge');
      },
    });
    if (opportunity.mode !== 'continue') {
      syncPose();
      // Live stationary commits sync decision locals; lunge returns leave the
      // remaining FSM and horizontal finish untouched, including launch velocity.
      if (opportunity.mode === 'sync_return') actor.isSprinting = frame.isSprinting;
      return { aiState: opportunity.aiState, timer: opportunity.timer, weaponState: opportunity.weaponState,
        standoffTimer: policy.psychState.standoffTimer, actions, opportunity };
    }
    policy.activeWeapon = opportunity.activeWeapon; policy.canStartWeaponAction = opportunity.canStartWeaponAction;
    policy.feintLungeFakeout = opportunity.feintLungeFakeout;
  }
  const result = resolveAIGroundState({ ...policy, settings, frame, target: observed,
    botId: actor.id, botHP: actor.hp, dt, savedVelY,
    random: atPose(policy.random), tryFeintRoll: atPose(policy.tryFeintRoll), commitFeint: atPose(policy.commitFeint),
    isCoordAttackBlocked: atPose(policy.isCoordAttackBlocked), isTargetOnCooldown: atPose(policy.isTargetOnCooldown),
    clearPressureTarget: atPose(policy.clearPressureTarget),
    selectDefensiveDashDirection: policy.selectDefensiveDashDirection ? atPose(policy.selectDefensiveDashDirection) : undefined,
    lookHeading: point(policy.lookHeading), spatialLookHeading: point(policy.spatialLookHeading), sidewayHeading: point(policy.sidewayHeading),
    startOffensiveHammerJump: heading => {
      syncPose();
      actions.push('hammer-jump');
      const jump: Parameters<typeof startAIHammerJumpAction>[0]['self'] = { id: actor.id, weaponState: actor.weaponState === 'idle' ? 'ready' : actor.weaponState === 'windup' ? 'swing_up' : 'recovering',
        weaponTimer: actor.weaponPhaseElapsed ?? 0, isJumping: actor.isJumping, aiHammerJumpsInAir: actor.hammerJumpsInAir,
        hammerJumpPlanned: actor.hammerJumpPlanned, hammerJumpType: actor.hammerJumpType };
      const started = startAIHammerJumpAction({ self: jump, settings, vel: frame.vel, horizontalHeading: heading,
        jumpType: 'offensive', playJump: () => {}, playSwing: () => {}, onMainAIHammerSwing: () => {
          if (actor.weaponReadyTimer > 0 || actor.dashRemaining > 0) return;
          swing('hammer', false); jump.weaponState = 'swing_up'; jump.weaponTimer = 0;
        } });
      if (jump.hammerJumpPlanned !== undefined) actor.hammerJumpPlanned = jump.hammerJumpPlanned;
      if (jump.hammerJumpType !== undefined) actor.hammerJumpType = jump.hammerJumpType; else delete actor.hammerJumpType;
      if (started) { swing(); actor.isJumping = jump.isJumping; actor.hammerJumpsInAir = jump.aiHammerJumpsInAir; }
      return started;
    },
    playDash: () => { syncPose(); actions.push('dash'); },
    triggerCombatantAttack: weapon => { syncPose(); actions.push(`attack-${weapon}`); swing(weapon); },
  });
  Object.assign(actor.pos, frame.pos); Object.assign(actor.vel, frame.vel); Object.assign(actor.dashDir, frame.dashDir);
  // Directions persist after a dash ends; JSON restores signed zero as +0.
  for (const axis of ['x', 'y', 'z'] as const) if (actor.dashDir[axis] === 0) actor.dashDir[axis] = 0;
  actor.dashRemaining = frame.dashRemaining; actor.dashCooldownTimer = frame.dashCooldownTimer;
  actor.slideActive = frame.slideActive; actor.aiSlideDistanceTraveled = frame.slideDistanceTraveled;
  actor.slideCooldownTimer = frame.slideCooldownTimer; actor.isSprinting = frame.isSprinting;
  actor.grounded = constrainCombatantToArenaBounds({ pos: frame.pos, vel: frame.vel, activeCustomMap: state.map,
    arenaRadius: state.map.arenaRadius }).grounded || frame.pos.y <= .0001;
  finishAIHorizontalMotion(actor, frame);
  Object.assign(actor.pos, frame.pos); Object.assign(actor.vel, frame.vel);
  return { aiState: result.aiState, timer: result.timer, weaponState: result.weaponState,
    standoffTimer: policy.psychState.standoffTimer, actions, ...(opportunity ? { opportunity } : {}) };
}
