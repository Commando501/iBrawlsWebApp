import { hasCoherentSimCarrierState } from './grifballCarrierState';
import { recordCalibrationCounterAttempt } from '../game/aiSkillCalibration';
import { getEffectivePressureAggression } from '../components/grifball/matchPressure';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import type { AIMatchContext } from '../game/aiMatchContext';
import { getOrCreatePlayerModel, getPlayerModelSnapshot, observePlayerLungeStart } from '../game/aiPlayerModel';
import type { AIMatchScoreContext } from '../game/aiTuning';
import { idleAction } from './actions';
import { resolveSimGrifballAdaptiveTuning, type SimAdaptiveTuningOwner } from './grifballAdaptiveTuning';
import { resolveSimGrifballCombatPriorities, type SimCombatPriorityMemory } from './grifballCombatPriorities';
import { createSimGrifballGroundOwner, adoptSimGrifballMovementFeedback } from './grifballGroundPolicy';
import { beginSimGrifballTargetEngagement, observeSimGrifballTargetEngagement } from './grifballTargetEngagement';
import { resolveSimGrifballTargetSelection } from './grifballTargetSelection';
import { validateScriptedActorDecisionOwner, type ScriptedActorDecisionOwner } from './scriptedActorDecision';
import type { ScriptedLungeFeedback } from './scriptedLungeFeedback';
import type { ScriptedObjectivePlanner } from './scriptedObjectivePlanner';
import type { SimState } from './simState';
import type { StepOptions } from './step';

type BotConfig = Pick<SimAdaptiveTuningOwner, 'knobs' | 'derived' | 'flags'>;
type Adaptive = NonNullable<ReturnType<typeof resolveSimGrifballAdaptiveTuning>>;
export interface SimGrifballActorControl {
  scriptedBots: Readonly<Record<string, string>>;
  configs: Readonly<Record<string, BotConfig>>;
  memories: Record<string, SimCombatPriorityMemory>;
  matchContext: AIMatchContext;
  random: () => number;
  getScoreContext: (state: SimState) => AIMatchScoreContext;
  isObserverMode: boolean;
  spawnPoints: readonly { x: number; y: number; z: number }[];
  /** Rebuild after map changes and checkpoint restoration. */
  navigation: Parameters<typeof createSimGrifballGroundOwner>[3]['navigation'];
  /** When attached, must own these same actors, plan and objective reloads. */
  planner?: ScriptedObjectivePlanner;
}

/** Construct once for the next simulation step. Persistent AI state belongs to
 * control; the returned hooks retain only this frame's observations. No physical
 * state, clocks or randomness advance during construction. Missing ownership
 * throws rather than supplying an idle action and calling it autonomous play. */
export function createSimGrifballActorStepOptions(state: SimState, control: SimGrifballActorControl,
  dt = 1 / 60): StepOptions {
  const { scriptedBots, configs, memories, matchContext: ai, random, planner } = control;
  if (typeof random !== 'function' || typeof control.getScoreContext !== 'function' ||
    typeof control.isObserverMode !== 'boolean' || !control.navigation || !Array.isArray(control.spawnPoints))
    throw new Error('Invalid composed actor control');
  const ids = Object.keys(scriptedBots), tick = state.tick;
  for (const id of ids) {
    const memory = memories[id], config = configs[id];
    if (!memory || !config || config.knobs.difficulty !== scriptedBots[id] ||
      ![memory.timer ?? 0, memory.swayTimer, memory.coordCommitTimer, memory.cooldownMultiplier].every(Number.isFinite) ||
      memory.cooldownMultiplier !== 1 || typeof memory.pendingPostEvasionCharge !== 'boolean')
      throw new Error(`Missing or incompatible composed actor configuration: ${id}`);
  }
  if (planner && (planner.plan !== ai.grifballTeamPlan || !planner.punchControl ||
    Object.keys(planner.scriptedBots).length !== ids.length || ids.some(id => planner.scriptedBots[id] !== scriptedBots[id] ||
      !Object.hasOwn(planner.punchControl!.cooldowns, id))))
    throw new Error('Composed objectives must share actor authority, team plan and reload ownership');

  const turns = new Map<string, { adaptive: Adaptive; targetId?: string | null; resolved?: boolean }>();
  const current = (view: SimState, actorId: string, stepDt: number) => {
    if (view.combatants !== state.combatants || view.tick !== tick || stepDt !== dt || !Object.hasOwn(scriptedBots, actorId))
      throw new Error('Composed actor hooks belong to one simulation frame');
    const turn = turns.get(actorId);
    if (!turn) throw new Error(`Composed actor turn must begin before selection: ${actorId}`);
    return turn;
  };
  const actorDecisions: ScriptedActorDecisionOwner = {
    version: 'scripted-actor-decision-v1', scriptedBots,
    beginTurn: ({ state: view, actorId, dt: stepDt }) => {
      if (view.combatants !== state.combatants || view.tick !== tick || stepDt !== dt || turns.has(actorId))
        throw new Error('Composed actor prelude must run once in its own frame');
      const memory = memories[actorId];
      const adaptive = resolveSimGrifballAdaptiveTuning(view, actorId, scriptedBots, {
        ...configs[actorId], memory, matchContext: ai, score: control.getScoreContext(view),
      }, dt);
      if (!adaptive) throw new Error(`Composed actor prelude lost authority: ${actorId}`);
      turns.set(actorId, { adaptive });
      if (planner) planner.punchControl!.cooldowns[actorId] = memory.aiState === 'COOLDOWN' ? Math.max(0, memory.timer ?? 0) : 0;
    },
    prepare: ({ state: view, actorId, dt: stepDt }) => {
      const turn = current(view, actorId, stepDt), actor = view.combatants.find(c => c.id === actorId)!;
      if (turn.targetId !== undefined) throw new Error('Composed target selection must run once');
      if (!hasCoherentSimCarrierState(view, actor))
        throw new Error(`Carrier combat requires coherent possession: ${actorId}`);
      const target = resolveSimGrifballTargetSelection(view, actorId, scriptedBots, {
        plan: ai.grifballTeamPlan, coordinator: ai.coordinator, memories,
        aiPlaystyle: configs[actorId].knobs.aiPlaystyle, spatialIQ: turn.adaptive.derivedParams.spatialIQ,
        isObserverMode: control.isObserverMode,
      });
      turn.targetId = target?.id ?? null;
      if (!target) return 'default';
      if (!beginSimGrifballTargetEngagement(view, actorId, target.id, scriptedBots,
        { memory: memories[actorId], matchContext: ai }, dt, actor.isLunging))
        throw new Error(`Composed engagement lost its selected target: ${actorId}`);
      return 'engagement';
    },
    resolve: ({ state: view, actorId, dt: stepDt, motionPhase }) => {
      const turn = current(view, actorId, stepDt), memory = memories[actorId];
      if (turn.targetId === undefined || turn.resolved) throw new Error('Composed decision requires one prepared selection');
      turn.resolved = true;
      if (turn.targetId === null) return { kind: 'handled', action: idleAction(), noTarget: {
        version: 'scripted-ai-no-target-v1', resolve: () => ({ memories, matchContext: ai,
          isObserverMode: control.isObserverMode, spatialIQ: turn.adaptive.derivedParams.spatialIQ,
          edgeInset: resolveBehaviorTuning(view.settings).arenaEdgeInset, spawnPoints: control.spawnPoints }),
      } };
      if (motionPhase !== 'after-engagement-gravity') throw new Error('Composed engagement must follow gravity');
      const actor = view.combatants.find(c => c.id === actorId)!, a = turn.adaptive;
      const engagement = observeSimGrifballTargetEngagement(view, actorId, turn.targetId, scriptedBots, a, {
        memory, matchContext: ai, nowSeconds: view.combatTimeMs! / 1000, isObserverMode: control.isObserverMode,
        ...(actor.isLunging ? { committedFlight: true as const } : {}),
      }, dt);
      if (!engagement) throw new Error(`Composed observation lost its selected target: ${actorId}`);
      const playerModel = getPlayerModelSnapshot(ai, turn.targetId);
      const priorities = resolveSimGrifballCombatPriorities(view, actorId, scriptedBots, {
        ...a, spacingFactor: engagement.spacingFactor, pressureAggression: a.derivedParams.pressureAggression,
      }, memories, { observation: engagement.observation, matchContext: ai, random, playerModel,
        scoreContext: control.getScoreContext(view), spatialIQ: a.derivedParams.spatialIQ,
        resolvedDangerZone: engagement.resolvedDangerZone,
        defensiveEvasionMult: a.difficulty === 'easy' ? 1 : 1.5 - Math.abs(a.playstyleFactor - .5),
      }, dt);
      if (!priorities) throw new Error(`Composed combat lost its engagement: ${actorId}`);
      if (priorities.evasion?.counterStarted && a.calibrationEnabled) recordCalibrationCounterAttempt(ai, actorId);
      if (priorities.combo.lungeObservation) {
        const tuning = resolveBehaviorTuning(view.settings);
        observePlayerLungeStart(getOrCreatePlayerModel(ai, actorId, { emaAlpha: tuning.playerModelEmaAlpha,
          defaultLungeDistance: tuning.defaultLungeDistance, defaultReactionTime: tuning.defaultReactionTime }),
        priorities.combo.lungeObservation.distance);
      }
      if (actor.isLunging || priorities.mode === 'sync_return') return priorities.decision;
      return { ...priorities.decision, ground: createSimGrifballGroundOwner(actorId, scriptedBots, memories, {
        adaptive: a, priorities, observation: engagement.observation, matchContext: ai, playerModel,
        resolvedDangerZone: engagement.resolvedDangerZone, random, navigation: control.navigation,
      }) };
    },
    completeTurn: ({ state: view, actorId, dt: stepDt, record }) => {
      current(view, actorId, stepDt);
      const memory = memories[actorId];
      if (record.kind === 'objective') {
        if (!planner || !record.objective) throw new Error('Composed objective completion requires its planner');
        if (record.objective.reason === 'punch') memory.aiState = 'COOLDOWN';
        if (memory.aiState === 'COOLDOWN' && ((memory.timer ?? 0) > 0 || record.objective.reason === 'punch'))
          memory.timer = planner.punchControl!.cooldowns[actorId];
        else { memory.aiState = 'APPROACHING'; memory.timer = 0; }
      }
      if (record.noTarget) Object.assign(memory, record.noTarget.memory);
      adoptSimGrifballMovementFeedback(record, memories, ai);
    },
  };
  validateScriptedActorDecisionOwner(state, actorDecisions, state.settings, dt);
  const knobs = Object.fromEntries(ids.map(id => [id, configs[id].knobs]));
  const pressure: Record<string, { aggression: number; skip?: boolean }> = {};
  // Feedback may run before this actor's turn. Read current scores without
  // advancing its adaptive prelude or inventing a previous-turn tuning snapshot.
  for (const id of ids) Object.defineProperty(pressure, id, { enumerable: true, get: () => ({
    aggression: getEffectivePressureAggression(state.settings, control.getScoreContext(state), configs[id].derived.pressureAggression),
    skip: configs[id].flags.skipPressure,
  }) });
  const lunge: ScriptedLungeFeedback = { version: 'scripted-lunge-feedback-v1', memories, knobs, random,
    combos: ai.comboState, models: ai.playerModels, coordinator: ai.coordinator, pressure,
    get scoreContext() { return control.getScoreContext(state); } };
  return { dt, settings: state.settings,
    scriptedCombatLearning: { version: 'scripted-combat-learning-v1', scriptedBots, matchContext: ai,
      isObserverMode: control.isObserverMode, lifecycle: { memories, pressure, spawnPoints: control.spawnPoints } },
    scriptedActorDecisions: actorDecisions, scriptedLungeFeedback: lunge,
    scriptedMeleeFeedback: { version: 'scripted-melee-feedback-v1', memories, knobs, random, combos: ai.comboState },
    ...(planner ? { scriptedPlanner: planner, scriptedCoordination: { version: 'scripted-coordination-v1', coordinator: ai.coordinator } } : {}),
  };
}
