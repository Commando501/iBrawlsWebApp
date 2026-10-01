import { executeScriptedAIGround, type ScriptedAIGroundOwner, type ScriptedAIGroundFeedback } from './scriptedAIGround';
/**
 * `stepSimulation` — one fixed simulation tick (dt = 1/60 s). The legacy profiles
 * use actions → movement → weapons/damage → passes → grifball
 * objective (phase machine, ball, pickups, scoring) → respawns. Returns the tick's
 * events (goals, kills, pickups, phase transitions) for reward calculation.
 * live-roster-v2 moves respawns before AI and resolves committed flights in roster
 * order; this does not model the complete live decision or mixed-player pipeline.
 *
 * Determinism: the only randomness source is the injected RNG, whose state lives in
 * `SimState.rngState` and is restored/snapshotted every tick. A (seed + action
 * sequence) therefore reproduces an identical state hash across runs and restarts.
 */

import { prepareSimAIEngagementMotion } from './aiEngagementMotion';
import { applyScriptedAIMobility, type ScriptedAIDashDecision } from './scriptedAIMobility';
import { validateScriptedLungeFeedback, createScriptedLungeFeedback, type ScriptedLungeFeedback } from './scriptedLungeFeedback';
import { validateScriptedMeleeFeedback, createScriptedMeleeFeedback, type ScriptedMeleeFeedback } from './scriptedMeleeFeedback';
import { type UniversalSettings } from '../types';
import { resolveRunnerThrowAllowed } from '../game/runnerBallSettings';
import { resolveSimSettings } from './factory';
import { type SimState } from './simState';
import { type ActionsById, idleAction } from './actions';
import { createRng, type Rng } from './rng';
import { stepCombatantMovement, tickMovementCooldowns, normalizeYaw } from './physics';
import { stepCombatantWeapons, resolveMixedPlayerLunge, tickRespawns, tickWeaponSwapTimers, type KillEvent } from './weapons';
import { tickGrifballObjective, throwSimPass, reconcileSimCarrier, type ObjectiveEvents } from './grifball';
import { tickCombat } from './combat';
import { validateScriptedObjectiveInput, type ScriptedObjectiveInput } from './scriptedObjectiveInput';
import { validateScriptedCombatInput, type ScriptedCombatInput, type ScriptedCombatCommand } from './scriptedCombatInput';
import { validateScriptedActorDecisionOwner, validateScriptedActorDecision, type ScriptedActorDecisionOwner, type ScriptedActorDecisionRecord } from './scriptedActorDecision';
import { beginScriptedObjectivePlanning, validateScriptedObjectivePlanner, type ScriptedObjectivePlanner, type ScriptedObjectivePlannerFrame } from './scriptedObjectivePlanner';

/** Canonical fixed timestep. */
export const SIM_DT = 1 / 60;

export interface StepEvents extends ObjectiveEvents {
  kills: KillEvent[];
  /** Present only for explicit scripted planning; handoffs are not autonomous successes. */
  plannerFrame?: ScriptedObjectivePlannerFrame;
  actorDecisionFrame?: { version: 'scripted-actor-decision-v1'; decisions: ScriptedActorDecisionRecord[] };
}

export interface StepOptions {
  /** Effective settings; defaults to the standard grifball sim settings. */
  settings?: UniversalSettings;
  /** Timestep override (defaults to {@link SIM_DT}). */
  dt?: number;
  /** Opt-in planner movement; separate from player/RL ActionInput. */
  scriptedObjective?: ScriptedObjectiveInput;
  /** Opt-in own-state decisions at each roster actor's turn. Mutually exclusive
   * with a precomputed scriptedObjective packet; legacy/RL defaults are unchanged. */
  scriptedPlanner?: ScriptedObjectivePlanner;
  /** Ordered commands from an explicitly owned ground combat decision. */
  scriptedCombat?: ScriptedCombatInput;
  /** Caller-owned stationary hit-to-combo feedback, opt-in independently of movement. */
  scriptedMeleeFeedback?: ScriptedMeleeFeedback;
  /** Explicit post-flight AI memory/observation owner. */
  scriptedLungeFeedback?: ScriptedLungeFeedback;
  /** Own-state combat/fallback policy at each active actor's turn. May follow
   * scriptedPlanner objective handoffs; cannot share precomputed packet owners. */
  scriptedActorDecisions?: ScriptedActorDecisionOwner;
}

/**
 * Advance `state` in place by one tick using `actionsById` (missing combatants idle).
 * Returns the events produced this tick.
 */
export function stepSimulation(
  state: SimState,
  actionsById: ActionsById,
  options: StepOptions = {}
): StepEvents {
  const settings = options.settings ?? resolveSimSettings();
  const dt = options.dt ?? SIM_DT;
  validateScriptedActorDecisionOwner(state, options.scriptedActorDecisions, settings, dt);
  if (options.scriptedActorDecisions && (options.scriptedCombat || options.scriptedObjective))
    throw new Error('Scheduled actor decisions cannot share precomputed combat or objective packets');
  if ((options.scriptedMeleeFeedback || options.scriptedLungeFeedback) && (!Number.isFinite(dt) || dt <= 0)) throw new Error('Melee feedback requires a positive finite timestep');
  validateScriptedMeleeFeedback(state, options.scriptedMeleeFeedback, settings);
  validateScriptedLungeFeedback(state, options.scriptedLungeFeedback, settings);
  if (options.scriptedMeleeFeedback && options.scriptedLungeFeedback &&
    Object.keys(options.scriptedMeleeFeedback.knobs).some(id => Object.hasOwn(options.scriptedLungeFeedback!.knobs, id)) &&
    (options.scriptedMeleeFeedback.combos !== options.scriptedLungeFeedback.combos ||
      options.scriptedMeleeFeedback.memories !== options.scriptedLungeFeedback.memories ||
      options.scriptedMeleeFeedback.random !== options.scriptedLungeFeedback.random))
    throw new Error('Overlapping melee and lunge feedback must share AI memory, combos and RNG');
  const lungeFeedback = options.scriptedLungeFeedback ? createScriptedLungeFeedback(state, options.scriptedLungeFeedback, settings) : undefined;
  const meleeFeedback = options.scriptedMeleeFeedback ? createScriptedMeleeFeedback(state, options.scriptedMeleeFeedback, settings) : undefined;
  if (options.scriptedCombat && (!Number.isFinite(dt) || dt <= 0)) throw new Error('Scripted combat requires a positive finite timestep');
  if (options.scriptedObjective && options.scriptedPlanner) throw new Error('Choose either scripted objective inputs or a scripted planner');
  validateScriptedObjectivePlanner(state, options.scriptedPlanner, settings, dt);
  if (options.scriptedActorDecisions && options.scriptedPlanner) {
    for (const [id, difficulty] of Object.entries(options.scriptedActorDecisions.scriptedBots))
      if (Object.hasOwn(options.scriptedPlanner.scriptedBots, id) && options.scriptedPlanner.scriptedBots[id] !== difficulty)
        throw new Error(`Objective and combat decision owners disagree on difficulty: ${id}`);
  }
  if (options.scriptedCombat && options.scriptedPlanner) throw new Error('Scripted combat requires explicit movement ownership instead of the objective-only planner');
  const scriptedCombat = validateScriptedCombatInput(state, options.scriptedCombat, actionsById, settings);
  const scriptedMovement = validateScriptedObjectiveInput(state, options.scriptedObjective, actionsById, settings)
    ?? (options.scriptedPlanner || options.scriptedActorDecisions ? Object.create(null) : undefined);
  const resolvedActions = options.scriptedPlanner || options.scriptedActorDecisions ? { ...actionsById } : actionsById;
  const scheduledCombat: Record<string, readonly ScriptedCombatCommand[]> = Object.create(null);
  const actorDecisions: ScriptedActorDecisionRecord[] = [];
  const ownsDecision = (id: string) => !!options.scriptedActorDecisions && Object.hasOwn(options.scriptedActorDecisions.scriptedBots, id);
  const rng: Rng = createRng(0);
  rng.setState(state.rngState);

  const kills: KillEvent[] = [];
  const mixed = state.combatExecution === 'live-mixed-v1';
  // An omitted mixed-frame command is idle, preserving a reset/respawn heading.
  // Resolve it at use time because roster revival runs after local physics.
  const act = (id: string) => resolvedActions[id] ?? (mixed
    ? { ...idleAction(), aim: state.combatants.find(c => c.id === id)!.yaw } : idleAction());
  const mixedObjectiveFrame = mixed && state.mode === 'grifball';
  const player = mixed ? state.combatants.find(c => c.id === state.localPlayerId) : undefined;
  if (mixed && (!player || state.combatants.filter(c => c.id === state.localPlayerId).length !== 1))
    throw new Error('live-mixed-v1 requires exactly one explicit localPlayerId');
  // Pointer events are sampled before the frame: release from the previous
  // position/loadout, then move. Holding across a pickup is not a new press.
  if (mixedObjectiveFrame && player) {
    const input = act(player.id), held = input.attackSecondary;
    if (held && !player.passInputHeld && player.alive && player.hp > 0 && player.hasBall && resolveRunnerThrowAllowed(settings)) {
      player.passCharging = true; player.passChargeTimer = 0;
    } else if (!held && player.passInputHeld && player.passCharging) {
      player.yaw = input.aim;
      throwSimPass(state, player, player.passChargeTimer / (settings.grifballChargeMax ?? 1.2), settings);
      player.passCharging = false; player.passChargeTimer = 0;
    }
    player.passInputHeld = held;
  }
  const rosterV2 = state.combatExecution === 'live-roster-v2' || mixed;
  if (rosterV2) {
    const nominalTimeMs = state.tick * SIM_DT * 1000;
    const previousTimeMs = state.combatTimeMs ?? nominalTimeMs;
    // The live fixed runner derives time from its tick. Repeated addition would
    // turn the inclusive 350ms boundary into 350.00000000000006ms after 21 ticks.
    state.combatTimeMs = dt === SIM_DT && previousTimeMs === nominalTimeMs
      ? (state.tick + 1) * SIM_DT * 1000 : previousTimeMs + dt * 1000;
  }
  const flightAdvanced = rosterV2 ? new Set<string>() : null;
  const swapTimersAdvanced = new Set<string>();
  // Local physics/contact and weapon animation precede roster respawn and AI.
  if (player) {
    const wasDead = !player.alive;
    tickRespawns(state, settings, dt, [player]);
    if (!wasDead) {
      stepCombatantMovement(state, player, act(player.id), settings, dt);
      if (player.isLunging) resolveMixedPlayerLunge(state, player, settings, dt, kills);
    }
    // The live weapon-frame owner ticks main AI before local weapon animation
    // and roster revival/decisions, including while dead or phase-paused.
    const mainAI = mixedObjectiveFrame ? state.combatants.find(c => c !== player && c.id === 'main_ai') : undefined;
    if (mainAI) { tickWeaponSwapTimers(mainAI, dt); swapTimersAdvanced.add(mainAI.id); }
    if (player.alive) stepCombatantWeapons(state, player, act(player.id), settings, dt, kills);
    else { delete player.playerSwordLungeRecovery; player.weaponState = 'idle'; player.weaponTimer = player.weaponPhaseElapsed = 0; player.isLunging = false; }
  }
  // The live roster revives actors before their AI tick. Newly killed actors wait
  // until the next frame, and each flight resolves before the next actor's shield tick.
  if (rosterV2) {
    const dead = options.scriptedPlanner?.punchControl
      ? state.combatants.filter(c => c !== player && !c.alive) : [];
    tickRespawns(state, settings, dt, state.combatants.filter(c => c !== player));
    const cooldowns = options.scriptedPlanner?.punchControl?.cooldowns;
    for (const c of dead) if (c.alive && cooldowns && Object.hasOwn(cooldowns, c.id)) cooldowns[c.id] = 0;
  }
  const planner = options.scriptedPlanner ? beginScriptedObjectivePlanning(state, options.scriptedPlanner, settings, dt, resolvedActions, swapTimersAdvanced) : null;

  // Ordinary live AI returns before movement/intent in inactive Grifball phases.
  // Capture the pre-objective phase: countdown completion resumes AI on the next frame.
  // This is explicit per actor; existing committed-action and legacy profiles keep their behavior.
  const phasePaused = new Set(state.match.phase !== 'playing'
    ? state.combatants.filter(c => c !== player && (mixedObjectiveFrame && c.pauseDuringInactiveGrifball || planner?.owns(c.id) || ownsDecision(c.id))).map(c => c.id) : []);

  // Phase 1 — movement.
  for (const c of state.combatants) {
    if (c === player) continue;
    let engagementPrepared = false;
    let groundOwner: ScriptedAIGroundOwner | undefined;
    let dashDecision: ScriptedAIDashDecision | undefined;
    let engagementCommit: { beforeAttack?: () => void; sequentialOpportunities?: boolean; groundReadyOverride?: boolean } | undefined;
    const scheduled = ownsDecision(c.id);
    const decisionActive = scheduled && c.alive && c.hp > 0 && c.respawnTimer <= 0 && !phasePaused.has(c.id);
    if (decisionActive) {
      tickMovementCooldowns(c, dt);
      if (!swapTimersAdvanced.has(c.id)) { tickWeaponSwapTimers(c, dt); swapTimersAdvanced.add(c.id); }
    }
    const planned = planner?.resolve(c);
    if (planned) { resolvedActions[c.id] = planned.action; scriptedMovement![c.id] = planned.movement; }
    if (scheduled) {
      if (!decisionActive) actorDecisions.push({ id: c.id, kind: 'inactive' });
      else if (planned) actorDecisions.push({ id: c.id, kind: 'objective' });
      else {
        const owner = options.scriptedActorDecisions!;
        const view = settings === state.settings ? state : { ...state, settings };
        const context = { state: view, actorId: c.id, dt, clockPhase: 'after-swap-tick' as const };
        const preparation = owner.prepare ? owner.prepare(context) : 'default';
        if (preparation !== 'default' && preparation !== 'engagement') throw new Error(`Invalid actor preparation: ${c.id}`);
        if (preparation === 'engagement') {
          if (c.hasBall || c.weapon === 'ball' || view.match.ball.holderId === c.id)
            throw new Error(`Carrier movement cannot use armed engagement preparation: ${c.id}`);
          prepareSimAIEngagementMotion(view, c, settings, dt);
          engagementPrepared = true;
        }
        const motionPhase = engagementPrepared ? 'after-engagement-gravity' as const : 'default' as const;
        const decision = validateScriptedActorDecision(view, owner, c.id,
          owner.resolve({ ...context, motionPhase }), settings, engagementPrepared);
        if (engagementPrepared && !c.isLunging && c.dashRemaining > 0 && (decision.kind !== 'handled' || !decision.dash))
          throw new Error(`Active engagement dash requires current AI dash observations: ${c.id}`);
        if (engagementPrepared && (decision.kind === 'handled' ? decision.action : act(c.id)).jump)
          throw new Error(`Engagement decisions require a scripted AI jump owner: ${c.id}`);
        if (engagementPrepared && (decision.kind === 'handled' ? decision.action : act(c.id)).dash)
          throw new Error(`Engagement decisions require a scripted AI dash owner: ${c.id}`);
        actorDecisions.push({ id: c.id, kind: decision.kind, ...(engagementPrepared ? { motionPhase: 'after-engagement-gravity' as const } : {}), ...(decision.kind === 'handoff' ? { reason: decision.reason } : {}) });
        if (decision.kind === 'handled') {
          dashDecision = decision.dash; groundOwner = decision.ground;
          if (['scripted-combat-v3', 'scripted-combat-v4', 'scripted-combat-v5', 'scripted-combat-v6'].includes(decision.commandVersion ?? '') && decision.commands?.length) engagementCommit = { sequentialOpportunities: decision.commandVersion === 'scripted-combat-v6' };
          if (decision.mobility) {
            const mobility = decision.mobility, record = actorDecisions[actorDecisions.length - 1];
            const applyMobility = () => { applyScriptedAIMobility(c, mobility, dt, settings); record.mobility = mobility.kind; };
            if (engagementCommit) engagementCommit.beforeAttack = applyMobility;
            else applyMobility();
          }
          resolvedActions[c.id] = decision.action;
          if (decision.movement) scriptedMovement![c.id] = decision.movement;
          if (decision.commands) scheduledCombat[c.id] = decision.commands;
        }
      }
    }
    if (phasePaused.has(c.id)) {
      if (c.alive) {
        c.invulnerabilityTimer = Math.max(0, c.invulnerabilityTimer - dt);
        c.vel.x = c.vel.y = c.vel.z = 0;
      }
      continue;
    }
    // Scripted policy commits before movement. In particular a newly accepted
    // lunge returns from live AI without replacing launch-frame velocity or
    // integrating flight until the following frame. Rejected commands still walk.
    const earlyCommands = scheduledCombat[c.id];
    const intentBeforeMovement = !!earlyCommands?.length && !c.isLunging;
    if (intentBeforeMovement) {
      c.yaw = normalizeYaw(act(c.id).aim);
      c.isCrouching = act(c.id).crouch && !c.isJumping;
      stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, 'intent', earlyCommands, meleeFeedback, lungeFeedback, swapTimersAdvanced.has(c.id), engagementCommit);
      if (c.isLunging) continue;
    }
    const groundExecution: { execute: (savedVelY: number) => ScriptedAIGroundFeedback; completed?: ScriptedAIGroundFeedback } | undefined = groundOwner
      ? { execute: savedVelY => {
        // Spend intent clocks once even when a ground lunge returns early. An
        // empty command list leaves retained policy readiness with its owner.
        if (!intentBeforeMovement)
          stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, 'intent', [], meleeFeedback, lungeFeedback, swapTimersAdvanced.has(c.id));
        return executeScriptedAIGround(state, c, settings, dt, savedVelY, groundOwner!, !!engagementCommit?.groundReadyOverride);
      } } : undefined;
    const dashFeedback = stepCombatantMovement(state, c, act(c.id), settings, dt, scriptedMovement?.[c.id], decisionActive, engagementPrepared, dashDecision, groundExecution);
    if (groundExecution?.completed) actorDecisions[actorDecisions.length - 1].ground = groundExecution.completed;
    if (dashFeedback) actorDecisions[actorDecisions.length - 1].dash = dashFeedback;
    // Ground opportunities run inside movement after recovery. A fresh lunge
    // owns the remainder of this turn, just like an early combo lunge.
    if (groundExecution?.completed?.actions.includes('lunge')) continue;
    if (rosterV2 && c.alive && c.isLunging) {
      stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, 'complete', undefined, undefined, lungeFeedback, swapTimersAdvanced.has(c.id));
      flightAdvanced!.add(c.id);
    } else if (mixedObjectiveFrame && !intentBeforeMovement && !groundExecution?.completed) {
      // Live AI commits at its own roster turn. A later actor's flight (or
      // planner observation) must see this attack/swap immediately, while
      // skeletal melee damage still waits for the post-objective animation pass.
      stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, 'intent', scheduledCombat[c.id] ?? scriptedCombat?.[c.id], meleeFeedback, lungeFeedback, swapTimersAdvanced.has(c.id));
    }
  }

  // Mixed roster decisions commit before objectives; skeletal damage follows them.
  // Other profiles retain their original combined weapons/damage phase.
  for (const c of state.combatants) {
    if (mixedObjectiveFrame || c === player || flightAdvanced?.has(c.id)) continue;
    if (!phasePaused.has(c.id)) stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, 'complete', scriptedCombat?.[c.id], meleeFeedback, lungeFeedback);
    // Mixed execution advances paused animations below. The roster-only profile
    // has one combined weapon phase: suppress new input, not committed clocks.
    else if (!mixedObjectiveFrame && planner?.owns(c.id))
      stepCombatantWeapons(state, c, { ...idleAction(), aim: c.yaw }, settings, dt, kills, 'complete', undefined, meleeFeedback);
  }

  // Phase 3 — passes: hold secondary to charge the throw (grifballChargeMax), release to throw.
  const chargeMax = settings.grifballChargeMax ?? 1.2;
  const throwingAllowed = resolveRunnerThrowAllowed(settings);
  for (const c of state.combatants) {
    if ((mixedObjectiveFrame && c === player) || phasePaused.has(c.id)) continue;
    if (options.scriptedPlanner?.passControl && Object.hasOwn(options.scriptedPlanner.punchControl?.cooldowns ?? {}, c.id)) continue;
    if (!c.alive || !c.hasBall) continue;
    const a = act(c.id);
    if (!throwingAllowed) {
      c.passChargeTimer = 0;
    } else if (a.attackSecondary) {
      c.passChargeTimer = Math.min(chargeMax, c.passChargeTimer + dt);
    } else if (c.passChargeTimer > 0) {
      throwSimPass(state, c, c.passChargeTimer / chargeMax, settings);
      c.passChargeTimer = 0;
    }
  }

  // A paused AI clears pickup intent even when this objective update ends countdown.
  const objectiveActions = phasePaused.size
    ? Object.fromEntries(Object.entries(resolvedActions).filter(([id]) => !phasePaused.has(id))) : resolvedActions;

  // Phase 4 — objective: grifball (ball/pickups/scoring) or combat (kill-target win).
  const objective =
    state.mode === 'combat'
      ? tickCombat(state, settings, dt)
      : tickGrifballObjective(state, settings, dt, objectiveActions, options.scriptedPlanner);

  if (mixedObjectiveFrame) {
    for (const c of state.combatants) if (c !== player && !flightAdvanced?.has(c.id))
      stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, 'animation', undefined, meleeFeedback);
    reconcileSimCarrier(state, settings);
  }

  // Phase 5 — respawns.
  if (!rosterV2) tickRespawns(state, settings, dt);

  state.tick += 1;
  state.rngState = rng.getState();

  return { ...objective, kills, ...(planner ? { plannerFrame: planner.frame } : {}),
    ...(options.scriptedActorDecisions ? { actorDecisionFrame: { version: 'scripted-actor-decision-v1', decisions: actorDecisions } } : {}) };
}
