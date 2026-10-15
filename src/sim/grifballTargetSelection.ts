import * as THREE from 'three';
import type { TacticalTargetCandidate } from '../components/grifball/combatGeometry';
import { selectBestTacticalTarget } from '../game/aiTacticalTargetSelection';
import { selectAIEngagementTarget } from '../game/aiEngagementTarget';
import { selectGrifballAssignmentThreat, type GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import type { BotCoordinatorState } from '../game/aiBotCoordinator';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import { observeSimTacticalWeaponTarget } from './grifballTacticalWeaponChoice';
import type { LungeAIMemory } from './scriptedLungeFeedback';
import type { SimState } from './simState';

/** Select before engagement gravity/prediction, after objective handoff.
 * Assignments use the frozen team snapshot; candidates and finishing-movement
 * exceptions use this actor's current turn. This does not register engagement,
 * consume AI clocks, or choose no-target recovery behavior. */
export function resolveSimGrifballTargetSelection(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, context: {
    plan: GrifballTeamPlanState; coordinator: BotCoordinatorState;
    memories: Readonly<Record<string, LungeAIMemory>>;
    aiPlaystyle: number; spatialIQ: number; isObserverMode: boolean;
  }): TacticalTargetCandidate | null {
  if (state.mode !== 'grifball' || !['live-roster-v2', 'live-mixed-v1'].includes(state.combatExecution ?? ''))
    throw new Error('Target selection requires explicit live Grifball execution');
  const actors = state.combatants.filter(c => c.id === botId), actor = actors[0];
  if (actors.length !== 1 || actor.controller !== 'ai' || actor.id === state.localPlayerId ||
    !Object.hasOwn(scriptedBots, botId) || typeof scriptedBots[botId] !== 'string' ||
    isNeuralNetDifficulty(scriptedBots[botId]) || isNeuralNetDifficulty(state.settings.aiDifficulty) ||
    state.match.phase !== 'playing' || !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0) return null;
  if (![context.aiPlaystyle, context.spatialIQ].every(Number.isFinite) || typeof context.isObserverMode !== 'boolean')
    throw new Error('Invalid target selection tuning');
  const memory = context.memories[botId];
  if (!Object.hasOwn(context.memories, botId) || !memory) throw new Error(`Missing tactical actor memory: ${botId}`);
  const local = state.combatants.filter(c => c.id === state.localPlayerId);
  if (local.length > 1) throw new Error('Target selection requires a unique local player');
  const candidates: TacticalTargetCandidate[] = [];
  const roster = [...(context.isObserverMode ? [] : local), ...state.combatants.filter(c => c.controller === 'ai' && c.id !== state.localPlayerId)];
  const seen = new Set<string>();
  for (const other of roster) {
    if (other.id === botId || !other.alive || other.hp <= 0 || other.respawnTimer > 0 || other.team === actor.team) continue;
    if (seen.has(other.id)) throw new Error(`Duplicate tactical target: ${other.id}`);
    seen.add(other.id);
    if (other.id !== state.localPlayerId && !Object.hasOwn(context.memories, other.id))
      throw new Error(`Missing tactical target memory: ${other.id}`);
    const observed = observeSimTacticalWeaponTarget(state, other, context.memories[other.id]);
    candidates.push({ ...observed, pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z),
      vel: new THREE.Vector3(other.vel.x, other.vel.y, other.vel.z), maxHp: other.maxHp,
      isCrouching: other.isCrouching, playerName: other.id, modelType: other.modelType });
  }
  const assignment = context.plan.assignments.get(botId);
  const assignmentThreat = assignment
    ? selectGrifballAssignmentThreat(assignment, actor.pos, context.plan.snapshot?.players ?? []) : null;
  return selectAIEngagementTarget({ hasAssignment: !!assignment, assignmentThreat,
    finishingMovement: actor.isLunging || actor.dashRemaining > 0 || actor.slideActive,
    aiState: memory.aiState, pressureTargetId: memory.pressureTargetId,
    getById: id => candidates.find(c => c.id === id) ?? null,
    getBest: () => selectBestTacticalTarget({ botId, botPos: new THREE.Vector3(actor.pos.x, actor.pos.y, actor.pos.z),
      difficulty: scriptedBots[botId], myActiveWeapon: actor.weapon,
      aiPlaystyle: context.aiPlaystyle, targetSelectionSpatialIQ: context.spatialIQ,
      arenaRadius: state.map.arenaRadius, edgeInset: resolveBehaviorTuning(state.settings).arenaEdgeInset,
      coordinator: context.coordinator, potentialTargets: candidates }),
  });
}
