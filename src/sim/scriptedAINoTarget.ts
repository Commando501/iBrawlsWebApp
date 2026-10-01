import * as THREE from 'three';
import { resolveNoTargetAIFrameForCombatant, type AINoTargetResolutionMode } from '../components/grifball/aiNoTargetRuntime';
import type { GrifballAIObjectiveFrame } from '../components/grifball/grifballAIObjectiveMovement';
import { finishAISwordLungeWithVitals } from '../components/grifball/aiSwordLungeFinishRuntime';
import { recoverCombatantAltitude } from '../components/grifball/altitudeRecovery';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { getOptimalGrifballSpawnPoint } from '../components/grifball/arenaSpawns';
import { GRAVITY_ACCELERATION } from '../components/grifball/combatGeometry';
import type { AIMatchContext } from '../game/aiMatchContext';
import { getOrCreatePlayerModel } from '../game/aiPlayerModel';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import type { UniversalSettings, WeaponState } from '../types';
import type { SimState, SimCombatant } from './simState';
import type { LungeAIMemory } from './scriptedLungeFeedback';
import { observeSimTacticalWeaponTarget } from './grifballTacticalWeaponChoice';
import { normalizeYaw } from './physics';

type Point = { x: number; y: number; z: number };
export interface ScriptedAINoTargetRequest {
  memories: Readonly<Record<string, LungeAIMemory>>;
  matchContext: Pick<AIMatchContext, 'grifballTeamPlan' | 'playerModels'>;
  isObserverMode: boolean;
  spatialIQ: number;
  edgeInset: number;
  /** Live fallback ring; authored map spawn points still take precedence. */
  spawnPoints: readonly Point[];
}
export interface ScriptedAINoTargetOwner {
  version: 'scripted-ai-no-target-v1';
  /** The policy has selected no combat target. Called before any engagement
   * gravity or normal movement. Only caller-owned memory may be mutated. */
  resolve(context: { state: SimState; actorId: string; dt: number }): ScriptedAINoTargetRequest;
}
export interface ScriptedAINoTargetFeedback {
  mode: AINoTargetResolutionMode;
  memory: LungeAIMemory;
  pickupRequested: boolean;
}
export function validateScriptedAINoTargetOwner(owner: ScriptedAINoTargetOwner, conflicting: boolean) {
  if (!owner || owner.version !== 'scripted-ai-no-target-v1' || typeof owner.resolve !== 'function' || conflicting)
    throw new Error('No-target recovery requires exclusive unprepared AI movement');
  return owner;
}
const point = (p: Point) => new THREE.Vector3(p.x, p.y, p.z);

/** Full live no-target branch, including cancellation before travel and support
 * retry after dash cancellation. Decision memory is returned for completeTurn;
 * lunge model feedback is written immediately to the explicitly owned context. */
export function executeScriptedAINoTarget(state: SimState, actor: SimCombatant, settings: UniversalSettings,
  dt: number, owner: ScriptedAINoTargetOwner): ScriptedAINoTargetFeedback {
  if (state.mode !== 'grifball' || state.combatExecution !== 'live-mixed-v1' || state.match.phase !== 'playing' ||
    actor.controller !== 'ai' || actor.id === state.localPlayerId || !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0 ||
    actor.hasBall || actor.weapon === 'ball' || state.match.ball.holderId === actor.id)
    throw new Error('No-target recovery requires an active armed roster AI');
  const request = owner.resolve({ state: settings === state.settings ? state : { ...state, settings }, actorId: actor.id, dt });
  if (!request || ![request.spatialIQ, request.edgeInset].every(Number.isFinite) || typeof request.isObserverMode !== 'boolean' ||
    !request.memories || typeof request.memories !== 'object' || Array.isArray(request.memories) ||
    !(request.matchContext?.grifballTeamPlan?.assignments instanceof Map) || !(request.matchContext?.playerModels instanceof Map) ||
    !Array.isArray(request.spawnPoints) || request.spawnPoints.some(p => !p || ![p.x, p.y, p.z].every(Number.isFinite)))
    throw new Error('Invalid no-target recovery context');
  const memoryFor = (id: string) => {
    const m = Object.hasOwn(request.memories, id) ? request.memories[id] : undefined;
    if (!m || !Number.isFinite(m.timer ?? 0) || !Number.isFinite(m.cooldownMultiplier))
      throw new Error(`No-target recovery requires current AI memory: ${id}`);
    return m;
  };
  const memory = { ...memoryFor(actor.id) };
  const locals = state.combatants.filter(c => c.id === state.localPlayerId);
  if (locals.length !== 1 || new Set(state.combatants.map(c => c.id)).size !== state.combatants.length)
    throw new Error('No-target recovery requires unique roster identities and local player');
  const local = locals[0], main = state.combatants.find(c => c.id === 'main_ai');
  const mainAIState = main ? memoryFor(main.id).aiState : undefined;
  const roster = new Map(state.combatants.filter(c => c !== local).map(c => [c.id, {
    id: c.id, hp: c.alive ? c.hp : 0, respawnTimer: c.respawnTimer, team: c.team,
    pos: point(c.pos), invulnerabilityTimer: c.invulnerabilityTimer,
  }]));
  const pos = point(actor.pos), vel = point(actor.vel);
  const self = { id: actor.id, team: actor.team, isLunging: actor.isLunging, isJumping: actor.isJumping,
    aiHammerJumpsInAir: actor.hammerJumpsInAir, aiHammerJumpCooldownTimer: actor.aiHammerJumpCooldownTimer,
    aiDashRemaining: actor.dashRemaining, weaponState: observeSimTacticalWeaponTarget(state, actor).weaponState as WeaponState,
    weaponTimer: actor.weaponPhaseElapsed, hammerJumpPlanned: actor.hammerJumpPlanned, hammerJumpType: actor.hammerJumpType,
    hammerJumpWindowTimer: actor.hammerJumpWindowTimer, aiLastLungeOutcome: memory.lastLungeOutcome,
    aiLastLungeTargetId: memory.lastLungeTargetId, aiPostLungeDecisionTimer: memory.postLungeDecisionTimer,
    lungeStartPos: actor.lungeStartPos, aiTimer: memory.timer, vel };
  const frame: GrifballAIObjectiveFrame = { pos, vel, yaw: actor.yaw + Math.PI, aiState: memory.aiState,
    timer: memory.timer ?? 0, dashRemaining: actor.dashRemaining, slideActive: actor.slideActive,
    weaponState: self.weaponState, pickupRequested: false };
  const initialYaw = frame.yaw;
  let cancelled = false, recovered = false, grounded = false;
  const runtime = { settings, grifball: state.match, aiMatchContext: request.matchContext,
    arenaRadius: state.map.arenaRadius, playerHP: local.alive ? local.hp : 0, playerRespawnTimer: local.respawnTimer,
    isObserverMode: request.isObserverMode, localPlayerTeam: local.team, playerPos: point(local.pos),
    playerInvulnerabilityTimer: local.invulnerabilityTimer, otherPlayers: roster };
  const alliesList = state.combatants.filter(c => c !== actor && (c !== local || !request.isObserverMode) &&
    c.alive && c.hp > 0 && c.respawnTimer <= 0 && c.team === actor.team).map(c => ({ x: c.pos.x, z: c.pos.z }));
  const tuning = resolveBehaviorTuning(settings);
  actor.isSprinting = false;
  if (actor.slideCooldownTimer > 0) actor.slideCooldownTimer = Math.max(0, actor.slideCooldownTimer - dt);
  const mode = resolveNoTargetAIFrameForCombatant({ state: runtime, self, frame, botId: actor.id,
    mainAI: main ? { hp: main.alive ? main.hp : 0, pos: point(main.pos), aiState: mainAIState } : undefined,
    alliesList, spatialIQ: request.spatialIQ, edgeInset: request.edgeInset, dt, activeCustomMap: state.map,
    gravityAcceleration: GRAVITY_ACCELERATION,
    finishSwordLungeTargetDead: () => {
      cancelled = true;
      const finishFrame = { pos, vel, aiState: frame.aiState, timer: frame.timer, weaponState: self.weaponState };
      finishAISwordLungeWithVitals({ state: runtime, self, frame: finishFrame, botId: actor.id,
        outcome: 'target_dead', cooldownMultiplier: 1, targetVitals: { hp: 0, invulnerabilityTimer: 0 },
        recordCombatantObservation: (id, observe) => observe(getOrCreatePlayerModel(request.matchContext, id, {
          emaAlpha: tuning.playerModelEmaAlpha, defaultLungeDistance: tuning.defaultLungeDistance,
          defaultReactionTime: tuning.defaultReactionTime })),
        recordBotDamageTag: () => {}, tryEnterPressureState: () => false, tryStartComboOnHit: () => {},
      });
      Object.assign(frame, finishFrame);
    },
    recoverCombatantAltitude: () => { const result = recoverCombatantAltitude(settings, self, pos, vel); recovered ||= result; return result; },
    constrainCombatantToArena: () => { grounded = constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: state.map, arenaRadius: state.map.arenaRadius }).grounded; },
    getOptimalSpawnPoint: exclude => getOptimalGrifballSpawnPoint(state.map, request.spawnPoints.map(point), exclude),
    getCombatantTeam: id => state.combatants.find(c => c.id === id)?.team,
    getCombatantRef: id => { const c = state.combatants.find(c => c.id === id); return c ? { pos: point(c.pos), alive: c.alive && c.hp > 0 } : null; },
    getEnemyGoalPos: team => state.goalPlates.find(p => p.team !== team)?.position ?? null,
  });
  Object.assign(actor.pos, pos); Object.assign(actor.vel, vel);
  actor.yaw = frame.yaw === initialYaw ? actor.yaw : normalizeYaw(frame.yaw - Math.PI);
  actor.isLunging = !!self.isLunging; actor.isJumping = !!self.isJumping; actor.hammerJumpsInAir = self.aiHammerJumpsInAir ?? 0;
  actor.dashRemaining = frame.dashRemaining; actor.slideActive = frame.slideActive;
  actor.hammerJumpWindowTimer = self.hammerJumpWindowTimer;
  actor.hammerJumpPlanned = self.hammerJumpPlanned; actor.hammerJumpType = self.hammerJumpType;
  if (self.aiHammerJumpCooldownTimer !== undefined) actor.aiHammerJumpCooldownTimer = self.aiHammerJumpCooldownTimer;
  if (cancelled || recovered) { actor.weaponState = 'idle'; actor.weaponTimer = actor.weaponPhaseElapsed = 0; }
  if (cancelled) { actor.lungeOutcome = 'target_dead'; actor.attackCooldown = settings.swordLungeReload ?? 1.2;
    memory.lastLungeOutcome = self.aiLastLungeOutcome; memory.lastLungeTargetId = self.aiLastLungeTargetId;
    memory.postLungeDecisionTimer = self.aiPostLungeDecisionTimer; }
  actor.grounded = grounded || actor.pos.y <= .0001;
  memory.aiState = frame.aiState; memory.timer = frame.timer;
  return { mode, memory, pickupRequested: frame.pickupRequested };
}
