import { throwBall, GRIFBALL_BALL_GRAVITY, GRIFBALL_THROW_ARC } from '../../src/game/grifballBall';
import { isMapBodyClear } from './grifballMapCollisionOracle';
import { createArenaCollisionCallbacksForState } from '../../src/components/grifball/arenaCollisionCallbacks';
import { getGoalPlates } from '../../src/game/grifballGoals';
import { getGrifballEnemyGoalPosForMap } from '../../src/components/grifball/grifballObjectiveRuntime';
import { triggerEnemyHammerSwingForCombatant } from '../../src/components/grifball/enemyWeaponActions';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import { createCombatantActionCallbacksForState } from '../../src/components/grifball/combatantActionCallbacks';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { getOptimalSpawnPointForArena } from '../../src/components/grifball/arenaRuntime';
import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { updateAIRosterTick } from '../../src/components/grifball/aiRosterTick';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { updateGrifballObjectiveForState, setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics, validateGrifballTactics, type TeamTactics } from '../../src/game/grifballTacticsConfig';
import { isSpaceSegmentOpen } from '../../src/game/grifballSpaceGeometry';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import type { CustomMapData } from '../../src/types';
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { buildCombatantRigForModel } from '../../src/components/grifball/combatantRig';
import { triggerCombatantAttackAction, startAIHammerJumpForCombatant } from '../../src/components/grifball/combatantActions';
import { updateRosterCombatantVisualsForState } from '../../src/components/grifball/rosterVisualSync';
import { applyBotMeleeImpactForState } from '../../src/components/grifball/botMeleeImpactRuntime';

/** A recording can end during a committed windup; unfinished attacks are not impact witnesses. */
export function validateMainJumpCommitments(requests: readonly { tick: number; accepted: boolean }[],
  impacts: readonly { tick: number }[], deaths: readonly { tick: number; id: string }[],
  frames: readonly { tick: number; actors: readonly { id: string; hp: number; weapon: string;
    weaponState?: string; weaponTimer?: number; jumpPlanned: boolean }[] }[], windup: number, attack: number, dt: number) {
  const failures: string[] = [], pending: number[] = [], end = frames.at(-1)?.tick ?? 0;
  const budget = Math.ceil(windup / dt) + Math.ceil(attack / dt);
  for (const request of requests.filter(r => r.accepted)) {
    if (impacts.some(i => i.tick >= request.tick && i.tick <= Math.min(end, request.tick + budget)) ||
      deaths.some(d => d.id === 'main_ai' && d.tick >= request.tick && d.tick <= Math.min(end, request.tick + budget))) continue;
    if (end >= request.tick + budget) { failures.push(`jump at ${request.tick} has no impact or death within its budget`); continue; }
    const observed = frames.filter(f => f.tick >= request.tick);
    let phase = 'swing_up', elapsed = 0, valid = Number.isInteger(request.tick) && request.tick > 0 &&
      observed.length === end - request.tick + 1 && observed.length > 0;
    for (const [index, frame] of observed.entries()) {
      elapsed += dt;
      if (phase === 'swing_up' && elapsed >= windup) { phase = 'swing_down'; elapsed = 0; }
      const actor = frame.actors.find(a => a.id === 'main_ai');
      valid &&= frame.tick === request.tick + index && !!actor && actor.hp > 0 && actor.weapon === 'hammer' &&
        actor.jumpPlanned && actor.weaponState === phase && typeof actor.weaponTimer === 'number' &&
        Math.abs(actor.weaponTimer - elapsed) < 1e-8 && !(phase === 'swing_down' && elapsed >= attack);
    }
    if (valid) pending.push(request.tick);
    else failures.push(`jump at ${request.tick} lost its commitment before the recording ended`);
  }
  return { failures, pending };
}

export interface OpposedDecisionCase {
  mode: 'punch-first' | 'hammer-first' | 'contested';
  team: 'blue' | 'red'; reverse: boolean; main: boolean; seed?: number;
}
export type TankContestOpening = 'opening' | 'ready' | 'late-cover' | 'shared-blast' | 'disabled' | 'short-window' | 'threshold' | 'no-reserve';
export type EarnedTankOpening = 'opening' | 'default-roles' | 'late-arrival' | 'shared-blast';
export interface RosterContestOptions { teamSize: 3 | 4; tactics: Partial<TeamTactics>; tankOpening?: TankContestOpening; earnedTankOpening?: EarnedTankOpening }
export const OPPOSED_DECISION_CASES: OpposedDecisionCase[] =
  (['punch-first', 'hammer-first', 'contested'] as const).flatMap(mode =>
    (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
      [false, true].map(main => ({ mode, team, reverse, main })))));

/** Live decisions by every actor, through the production frame coordinator.
 * Initial positions, wounded possession and timing settings are authored; no
 * actions, assignments, movement, subsequent damage or ownership are injected.
 */
export function runOpposedDecisionTrace(spec: OpposedDecisionCase, continuation: 'opening' | 'revival' | 'match' | 'mobility' | 'map-contest' | 'map-match' | 'pass-contest' | 'pass-match' | 'map-pass-match' | 'roster-contest' | 'tank-contest' | 'earned-tank-contest' | 'pass-recovery' | 'map-roster-match' = 'opening', suppliedMap?: CustomMapData, passOpening?: { defender: { x: number; z: number }; cover: { x: number; z: number }; passingEnabled?: boolean; releaseSpeed?: number }, rosterOptions?: RosterContestOptions) {
  const rosterMatch = continuation === 'map-roster-match';
  const passRecovery = continuation === 'pass-recovery';
  const earnedTank = continuation === 'earned-tank-contest';
  const tankContest = continuation === 'tank-contest' || earnedTank;
  const rosterContest = continuation === 'roster-contest' || tankContest || rosterMatch;
  if (tankContest && !earnedTank && !rosterOptions?.tankOpening) throw new Error('Tank contest requires an opening');
  if (earnedTank && !rosterOptions?.earnedTankOpening) throw new Error('Earned tank contest requires an opening');
  if (rosterContest && (!rosterOptions || ![3, 4].includes(rosterOptions.teamSize))) throw new Error('Roster contest requires a three- or four-player team');
  const mapPassMatch = continuation === 'map-pass-match' || rosterMatch;
  const passMatch = continuation === 'pass-match' || mapPassMatch;
  const passing = continuation === 'pass-contest' || passMatch || rosterContest || passRecovery;
  if (passing && (!passOpening || spec.mode !== 'contested')) throw new Error('Pass contest requires four-actor opening positions');
  const mapMatch = continuation === 'map-match';
  const mapped = continuation === 'map-contest' || mapMatch || mapPassMatch;
  if (mapped && !suppliedMap) throw new Error('Map contest requires a supplied map');
  const match = continuation === 'match' || mapped || passMatch, mobility = continuation === 'mobility', revival = continuation !== 'opening';
  const observeDash = mobility || continuation === 'revival';
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal',
      ...(mobility ? { maxHP: 3 } : {}),
      ...(match ? { grifballGoalTarget: 2, grifballRoundResetDelay: .19, grifballCountdownDuration: .09 } : {}),
      ...(!earnedTank && !passRecovery && !rosterMatch ? { hammerMeleeSpeed: spec.mode === 'punch-first' ? .04 : .5,
      hammerSlamWindupTime: spec.mode === 'punch-first' ? .5 : .08,
      hammerSlamAttackTime: spec.mode === 'punch-first' ? .2 : .04,
      ...(tankContest ? { maxHP: 3, attackRange: 1.5, attackRadius: rosterOptions!.tankOpening === 'shared-blast' ? 4.5 : 1.5, hammerReloadTime: 1.2 } : {}) } : {}) },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), sign = spec.team === 'blue' ? 1 : -1;
  const map = mapped ? structuredClone(suppliedMap!) : { id: 'opposed-corridor', name: 'Opposed corridor', mapShape: 'rectangular', arenaRadius: 60,
    arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData;
  if (match && !mapped) map.objects = (['blue', 'red'] as const).map(team => ({ id: team, type: 'box', goalPlateTeam: team,
    position: { x: team === 'blue' ? -47 : 47, y: 0, z: 0 }, scale: { x: 2, y: .12, z: 2 }, rotation: { x: 0, y: 0, z: 0 } })) as CustomMapData['objects'];
  const mapBefore = JSON.stringify(map);
  state.arenaRadius = map.arenaRadius; state.isObserverMode = true; state.grifball.phase = 'playing';
  state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.passingEnabled = passing && passOpening?.passingEnabled !== false; state.otherPlayers.clear();
  if (rosterContest) {
    Object.assign(state.grifballTactics.defaults, rosterOptions!.tactics);
    state.grifballTactics = validateGrifballTactics(state.grifballTactics);
  }
  const tacticsBefore = JSON.stringify(state.grifballTactics);
  const carrierId = spec.main && !earnedTank && !passRecovery ? 'main_ai' : 'carrier';
  const defenderId = passRecovery && spec.main ? 'main_ai' : 'defender';
  if (revival && !mapped) map.teamSpawns = { blue: [{ x: -12, y: 0, z: 3 }], red: [{ x: 12, y: 0, z: -3 }] };
  const otherTeam = spec.team === 'blue' ? 'red' as const : 'blue' as const;
  const seeds = [
    { id: carrierId, x: passing ? -20 : -1, z: 0, team: spec.team },
    { id: defenderId, x: passing ? passOpening!.defender.x : 1, z: passing ? passOpening!.defender.z : 0, team: otherTeam },
    ...(spec.mode === 'contested' ? [
      { id: 'escort', x: -8, z: passing ? 0 : 3, team: spec.team },
      { id: 'cover', x: passing ? passOpening!.cover.x : 8, z: passing ? passOpening!.cover.z : -3, team: otherTeam },
    ] : []),
  ];
  if (rosterContest) for (let slot = 1; slot <= rosterOptions!.teamSize - 2; slot++) {
    seeds.push({ id: `support_${slot}`, x: -24, z: slot === 1 ? -9 : 9, team: spec.team },
      { id: `rival_${slot}`, x: slot === 1 ? -34 : -40, z: slot === 1 ? -9 : 3, team: otherTeam });
  }
  if (tankContest) {
    const positions: Record<string, [number, number]> = {
      [carrierId]: [0, 0], defender: [5, 0], escort: [4, -2.5], support_1: [4, 2.5],
      support_2: rosterOptions!.tankOpening === 'late-cover' ? [-23, 0] : [-4, 0],
      cover: [40, 18], rival_1: [45, -18], rival_2: [48, 15],
    };
    if (earnedTank) {
      const flank = rosterOptions!.earnedTankOpening === 'shared-blast' ? 2 : 5.5;
      Object.assign(positions, { carrier: [0, 0], defender: [4, 0], escort: [4, -flank], support_1: [4, flank], support_2: [-12, 0] });
    }
    for (const s of seeds) [s.x, s.z] = positions[s.id];
  }
  if (earnedTank && spec.main) seeds.find(s => s.id === 'escort')!.id = 'main_ai';
  const initialRespawns = new Map<string, number>();
  if (earnedTank) map.teamSpawns![spec.team] = seeds.filter(s => ['escort', 'main_ai', 'support_1'].includes(s.id))
    .map(s => ({ x: s.x * sign, y: 0, z: s.z * sign }));
  for (const s of spec.reverse ? [...seeds].reverse() : seeds) {
    const c = createOfflineBotCombatant({ id: s.id, playerName: s.id, team: s.team,
      spawnPos: new THREE.Vector3(s.x * sign, 0, s.z * sign), yaw: -sign * Math.PI / 2,
      hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: 'ai', weaponState: 'ready', weaponTimer: 0,
      hp: tankContest && !earnedTank ? 3 : 1, maxHp: mobility || (tankContest && !earnedTank) ? 3 : 1, invulnerabilityTimer: 0, respawnTimer: 0, swapCooldownTimer: 0 });
    if (earnedTank && ['escort', 'main_ai', 'support_1'].includes(c.id)) {
      c.hp = 0; c.respawnTimer = rosterOptions!.earnedTankOpening === 'late-arrival' ? 1.35 : .75;
      initialRespawns.set(c.id, c.respawnTimer);
    }
    state.otherPlayers.set(c.id, c);
    const group = new THREE.Group(); group.userData.modelSystem = 'v2';
    refs.otherPlayerMeshes.set(c.id, { group, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(group) });
  }
  if (mapPassMatch && [...state.otherPlayers.values()].some(c => !isMapBodyClear(map, c.pos))) throw new Error('Map pass fixture starts inside an obstacle');
  const carrier = state.otherPlayers.get(carrierId)!, defender = state.otherPlayers.get(defenderId)!;
  // Author only the initial visible recovery; all later decisions and phases are live.
  if (tankContest && !earnedTank && rosterOptions!.tankOpening !== 'ready') defender.weaponState = 'recovering';
  if (tankContest && !earnedTank && rosterOptions!.tankOpening === 'short-window') defender.weaponTimer = 1.19;
  // Mid-fight start: a ready opponent is descending after using its air-jump
  // budget. Its next swing and recovery must be produced by the live owners.
  if (earnedTank) { defender.pos.y = .8; defender.isJumping = true; defender.aiHammerJumpsInAir = 1; }
  const ballState = () => state.grifball.ball.state;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = carrierId;
  state.grifball.ball.pos = { x: carrier.pos.x, y: 1.1, z: carrier.pos.z };
  setGrifballCarrierForState({ state, refs, id: carrierId, carrying: true });
  if (!passing) { carrier.hp = 1; carrier.runnerLastHp = 1; carrier.runnerHealDelayTimer = 3; } // Wounded carrier: one lethal hit, normal carrier mechanics.
  if (earnedTank) { carrier.weaponState = 'recovering'; carrier.weaponTimer = 0; }
  const authoredPass = passRecovery ? { tick: 0, carrierId, receiverId: 'escort', speed: passOpening!.releaseSpeed ?? 17.5,
    origin: { x: carrier.pos.x, y: 1.1, z: carrier.pos.z }, direction: { x: sign, y: 0, z: 0 } } : null;
  if (authoredPass) {
    updateGrifballTeamPlanForState(state, 0, team => ({ x: team === 'blue' ? 47 : -47, z: 0 }), map);
    // Controlled unsafe release through the same ball and carrier owners used
    // by live throwing. The AI planner is not asked to choose an unsafe pass.
    throwBall(state.grifball.ball, authoredPass.origin, authoredPass.direction, authoredPass.speed);
    setGrifballCarrierForState({ state, refs, id: carrierId, carrying: false });
    state.aiMatchContext.grifballTeamPlan.passFlight = { team: spec.team, carrierId, receiverId: 'escort' };
  }
  const releaseState = authoredPass ? { ball: structuredClone(state.grifball.ball), weapon: carrier.activeWeapon,
    hp: carrier.hp, maxHp: carrier.maxHp, flight: structuredClone(state.aiMatchContext.grifballTeamPlan.passFlight) } : null;
  const combatSettings = earnedTank || passRecovery || rosterMatch ? Object.fromEntries(['maxHP', 'attackRange', 'attackRadius', 'hammerMeleeSpeed',
    'hammerSlamWindupTime', 'hammerSlamAttackTime', 'hammerReloadTime', 'respawnInvulnerabilityDuration', 'hammerJumpPower',
    ...(passRecovery ? ['grifballPickupRadius', 'grifballRunnerHealth', 'grifballPassSpeedMin', 'grifballPassSpeedMax', 'grifballChargeMax'] : [])]
    .map(key => [key, state.settings[key as keyof typeof state.settings]])) : undefined;
  let tick = 0, failureCount = 0;
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  const noop = () => {}, goal = (team: string | undefined) => mapped ? getGrifballEnemyGoalPosForMap(team, map) : ({ x: team === 'blue' ? 47 : -47, z: 0 });
  const collision = createArenaCollisionCallbacksForState({ getState: () => state, getRefs: () => refs, getActiveCustomMap: () => map,
    getMainAI: () => state.otherPlayers.get('main_ai'), isMultiplayer: false, multiplayerRole: null, opponentClientId: '' });
  const atTeamSpawn = (c: { team?: string; pos: THREE.Vector3 }) => (map.teamSpawns?.[c.team as 'blue' | 'red'] ?? []).some(p => c.pos.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 1e-8);
  const knobs: AIResolvedKnobs = { difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
    weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0, aiPlaystyle: 50 };
  const derived = deriveAIParams(state.settings, knobs);
  const getMatchScoreContext = () => ({ scorePlayer: 0, scoreEnemy: 0, killsToWin: 25 });
  const targets = createTacticalTargetCallbacksForState({ getState: () => state, getMainAI: () => state.otherPlayers.get('main_ai'),
    getRosterAI: () => [...state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as never),
    resolveBotKnobs: () => knobs, resolveBotDerived: () => derived, getMatchScoreContext });
  const attacks: { tick: number; id: string; weapon: string; melee: boolean; kind: 'swing' | 'hammer-jump' }[] = [];
  const captureTankState = () => {
    const plan = state.aiMatchContext.grifballTeamPlan;
    return {
      tick, holderId: state.grifball.ball.holderId,
      players: [...state.otherPlayers.values()].map(c => ({ id: c.id, team: c.team, pos: c.pos.toArray(), hp: c.hp,
        weapon: c.activeWeapon, phase: c.weaponState, elapsed: c.weaponTimer })),
      observed: structuredClone(plan.snapshot?.players ?? []),
      assignments: [...plan.assignments.values()].map(a => ({ id: a.botId, team: a.team, destination: { ...a.destination },
        tanking: a.tanking ? structuredClone(a.tanking) : null })),
    };
  };
  const tankSamples: ReturnType<typeof captureTankState>[] = [];
  const tankActions: (ReturnType<typeof captureTankState> & { id: string; kind: string })[] = [];
  const mainJumpRequests: { tick: number; accepted: boolean; dash: number; swap: number }[] = [];
  const targetLookups: { tick: number; id: string; target: string }[] = [];
  let dashRequests = 0;
  let resolvedTarget: string | null = null;
  let resolvedIncomingThreat = false;
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs, resolveBotDerived: () => derived,
    resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS, getMatchScoreContext, grifballEnemyGoalPos: goal,
    constrainCombatantToArena: mapped ? collision.constrainCombatantToArena : (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
    ...targets,
    getBestTacticalTarget: (id: string, pos: THREE.Vector3, difficulty: string) => {
      const target = targets.getBestTacticalTarget(id, pos, difficulty);
      resolvedTarget = target?.id ?? null;
      resolvedIncomingThreat = !!target?.isLunging;
      if (target) targetLookups.push({ tick, id, target: target.id });
      return target;
    },
    getTacticalTargetById: (id: string, target: string) => {
      targetLookups.push({ tick, id, target });
      const found = targets.getTacticalTargetById(id, target);
      resolvedTarget = found?.id ?? null;
      resolvedIncomingThreat = !!found?.isLunging;
      return found;
    },
    triggerCombatantAttack: (self, weapon, melee = false) => {
      if (tankContest) tankActions.push({ ...captureTankState(), id: self.id, kind: melee ? 'melee' : 'swing' });
      attacks.push({ tick, id: self.id, weapon: self.activeWeapon, melee, kind: 'swing' });
      triggerCombatantAttackAction({ self, weapon, melee, recordHammerAttack: noop, playSwing: noop });
    },
    getOptimalSpawnPoint: excludePositions => getOptimalSpawnPointForArena({ activeCustomMap: map, spawnPoints: [], excludePositions }),
    getActiveCustomMap: () => map, getTargetPlayerModel: () => null,
    recordCombatantObservation: noop, tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    recoverCombatantAltitude: mapped ? collision.recoverCombatantAltitude : noop, clearPressureTarget: noop,
    startAIHammerJump: (self, _pos, vel, horizontalHeading, jumpType) => {
      const tankBefore = tankContest ? captureTankState() : null;
      const plannedBefore = !!self.hammerJumpPlanned;
      const started = startAIHammerJumpForCombatant({ self, settings: state.settings, vel, horizontalHeading, jumpType,
        onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(state.otherPlayers.get('main_ai')), playSwing: noop, playJump: noop });
      if (self.id === 'main_ai') {
        if ((self.aiDashRemaining ?? 0) > 0 || (self.swapCooldownTimer ?? 0) > 0)
          check('main jump cannot bypass dash or swap lockout', started, false);
        mainJumpRequests.push({ tick, accepted: started, dash: self.aiDashRemaining ?? 0, swap: self.swapCooldownTimer ?? 0 });
        if (!started && !plannedBefore) check('rejected main jump leaves no latent plan', !!self.hammerJumpPlanned, false);
      }
      if (started) attacks.push({ tick, id: self.id, weapon: self.activeWeapon, melee: false, kind: 'hammer-jump' });
      if (started && tankBefore) tankActions.push({ ...tankBefore, id: self.id, kind: 'hammer-jump' });
      return started;
    },
    triggerCombatantLunge: () => check('unexpected sword lunge', true, false),
    swapCombatantWeapon: () => check('unexpected weapon swap', true, false),
    spawnVoxelShockwaveParticles: noop,
    playDash: () => { dashRequests++; }, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  const actions = createCombatantActionCallbacksForState({ getState: () => state, getRefs: () => refs,
    spawnPoints: [], getRosterAI: () => [...state.otherPlayers.values()], getActiveCustomMap: () => map,
    getOptimalSpawnPoint: excludePositions => getOptimalSpawnPointForArena({ activeCustomMap: map, spawnPoints: [], excludePositions }),
    recordCombatantObservation: noop, onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(state.otherPlayers.get('main_ai')), playSwing: noop, playJump: noop, playDash: noop, playRespawn: noop });
  const placement = createArenaOrchestratorCallbacksForState({ getState: () => state, getRefs: () => refs, spawnPoints: [],
    getActiveCustomMap: () => map, getLegacyRosterProps: () => ({}), getOfflineBotCount: () => state.otherPlayers.size,
    isPlaying: true, opponentClientId: '', constrainCombatantToArena: noop, getVisualModelPolicy: () => 'v2', pushStatsUpdate: noop, playRespawn: noop });
  const transitions: { tick: number; from: string; to: string; round: number }[] = [];
  const goals: { tick: number; id: string; team: string; round: number }[] = [];
  const resets: { tick: number; round: number }[] = [];
  let notifications = 0;
  const deaths: { tick: number; id: string }[] = [];
  const revivals: { tick: number; id: string; pos: number[]; shield: number; deaths: number; kills: number }[] = [];
  const random = seededRandom(spec.seed ?? 17), dt = 1 / 60;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const frames = [];
  const dashState = (id: string) => {
    const c = state.otherPlayers.get(id)!;
    return { pos: c.pos.toArray(), vel: c.vel.toArray(), hp: c.hp, weapon: c.activeWeapon,
      remaining: c.aiDashRemaining ?? 0, cooldown: c.aiDashCooldownTimer ?? 0,
      direction: { ...c.aiDashDir }, jumping: !!c.isJumping,
      role: state.aiMatchContext.grifballTeamPlan.assignments.get(id)?.role ?? null };
  };
  const dashSamples: { tick: number; id: string; requested: boolean; target: string | null; incomingThreat: boolean; before: ReturnType<typeof dashState>; after: ReturnType<typeof dashState> }[] = [];
  const tacticalSamples: { tick: number; holderId: string | null; assignments: { id: string; team: string; role: string; slot: number; destination: { x: number; z: number }; tanking: { mode: string; targetId: string | null; partnerId: string | null; recoveryId: string | null; doubleCommit: boolean } | null; escort: string | null }[] }[] = [];
  const mainJumpImpacts: { tick: number; launched: boolean; budget: number }[] = [];
  const carrierDeaths: { tick: number; id: string; pos: number[] }[] = [];
  const impacts: { tick: number; id: string; victims: string[] }[] = [];
  const pickups: { tick: number; id: string; distance: number }[] = [];
  const passGeometry = { evaluations: 0, blockedCandidateSamples: 0, blockedExamples: [] as { tick: number; carrierId: string; receiverId: string; speed: number; path: { x: number; y: number; z: number }[] }[] };
  const passes: { tick: number; carrierId: string; receiverId: string; speed: number; chargeSeconds: number }[] = [];
  const cancellations: { tick: number; carrierId: string; receiverId: string; elapsed: number; reason: string }[] = [];
  let deathTick = 0, dropTick = 0;
  let terminalTick = 0;
  let ticks = rosterMatch ? 108000 : passRecovery ? 600 : tankContest ? 300 : rosterContest ? 1800 : mapPassMatch ? 108000 : passMatch ? 18000 : passing ? 1200 : mapMatch ? 108000 : mapped ? 1800 : mobility ? 3600 : match ? (spec.main ? 9000 : spec.mode === 'contested' ? 10800 : 3840) : revival ? 600 : 150;
  for (tick = 1; tick <= ticks; tick++) {
    const plan = state.aiMatchContext.grifballTeamPlan, phase = state.grifball.phase;
    const updates: string[] = [];
    const recoveryIntents: { id: string; pickup: boolean }[] = [];
    const attackCount = attacks.length;
    const chargeAtFrameStart = passing && plan.passCharge ? { ...plan.passCharge } : null;
    let living = [...state.otherPlayers.values()].filter(c => c.hp > 0).map(c => c.id);
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    withSimulationRandom(random, tick * dt, () => advanceGrifballFrameForState({
      state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
      isPlaying: true, isPausedRef: { current: false }, replayData: null,
      keysPressed: { current: {} }, grifbHoldTimerRef: { current: 0 }, secretAudioRef: { current: null },
      isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
      replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
      spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
      // Observer fixture: no local input/weapon owner or roster resize. Bot physics
      // execute inside the real updater; optional continuation includes real respawns.
      updatePhysics: noop, updateHammerAnimations: noop, runAIOrchestrator: noop,
      updateAI: delta => updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt: delta,
        respawnCombatant: (c, mesh) => {
          check('respawn continuation enabled', revival, true);
          const death = deaths.filter(d => d.id === c.id).at(-1);
          if (earnedTank && !death) check('authored pending respawn expires within one frame',
            Math.abs(tick / 60 - (initialRespawns.get(c.id) ?? -10)) <= 1 / 60 + 1e-9, true);
          else check('revival follows one full death delay', tick, (death?.tick ?? -181) + 181);
          const deathCount = c.deaths, kills = c.kills;
          actions.respawnCombatant(c, mesh);
          revivals.push({ tick, id: c.id, pos: c.pos.toArray(), shield: c.invulnerabilityTimer, deaths: deathCount, kills });
          const spawn = map.teamSpawns?.[c.team!]?.[0];
          if (mapped || earnedTank) check('respawn uses supplied team layout', atTeamSpawn(c), true);
          else check('team spawn', JSON.stringify(c.pos.toArray()), JSON.stringify(spawn ? [spawn.x, spawn.y, spawn.z] : []));
          check('respawn full base health', c.hp, state.settings.maxHP ?? 1);
          check('respawn weapon ready', c.weaponState, 'ready');
          check('respawn grounded', !!c.isJumping, false);
          check('respawn jump plan cleared', !!c.hammerJumpPlanned, false);
          check('respawn jump type cleared', c.hammerJumpType, undefined);
          check('respawn jump budget reset', c.aiHammerJumpsInAir, 0);
          check('respawn jump window cleared', c.hammerJumpWindowTimer, 0);
          check('respawn flight cleared', !!c.isLunging, false);
          check('respawn velocity reset', c.vel.length(), 0);
          check('respawn dash reset', c.aiDashRemaining, 0);
          check('respawn pressure reset', c.aiPressureTargetId, undefined);
          check('respawn shield initialized', c.invulnerabilityTimer, state.settings.respawnInvulnerabilityDuration);
          check('respawn visible', mesh.visible, true);
          check('respawn timestamp uses simulation clock', c.spawnTime, 1_000_000 + tick * dt * 1000);
          check('respawn preserves deaths', c.deaths, deathCount);
          check('respawn preserves kills', c.kills, kills);
        },
        beforeUpdate: () => {
          living = [...state.otherPlayers.values()].filter(c => c.hp > 0).map(c => c.id);
          const revision = plan.revision;
          updateGrifballTeamPlanForState(state, delta, goal, map);
          if (tankContest && plan.revision !== revision) tankSamples.push(captureTankState());
          if (mapPassMatch && plan.revision !== revision) for (const assignment of plan.assignments.values()) {
            if (!assignment.pass) continue;
            passGeometry.evaluations++;
            const blocked = assignment.pass.candidates.filter(c => c.reason === 'Throw crosses blocked space');
            passGeometry.blockedCandidateSamples += blocked.length;
            for (const c of blocked) if (passGeometry.blockedExamples.length < 8) passGeometry.blockedExamples.push({ tick, carrierId: assignment.botId, receiverId: c.receiverId, speed: c.speed, path: c.path });
          }
          if (rosterContest || passRecovery) {
            const assignments = [...plan.assignments.values()];
            check('active living roster assigned; inactive assignments clear', JSON.stringify([...plan.assignments.keys()].sort()), JSON.stringify(state.grifball.phase === 'playing' ? [...living].sort() : []));
            for (const a of assignments) {
              const actor = state.otherPlayers.get(a.botId)!;
              check('assignment belongs to actor team', a.team, actor.team);
              check('assignment destination finite', Number.isFinite(a.destination.x) && Number.isFinite(a.destination.z), true);
              if (a.tanking?.targetId) check('tanking target is a living opponent', living.includes(a.tanking.targetId) && state.otherPlayers.get(a.tanking.targetId)?.team !== a.team, true);
              for (const id of [a.tanking?.partnerId, a.tanking?.recoveryId]) if (id) check('tanking support is a living teammate', living.includes(id) && state.otherPlayers.get(id)?.team === a.team, true);
            }
            for (const a of assignments) if (a.tanking?.partnerId) check('tanking partner is another actor', a.tanking.partnerId !== a.botId, true);
            const holder = state.grifball.ball.holderId;
            check('one runner owns held possession', JSON.stringify(assignments.filter(a => a.role === 'runner').map(a => a.botId)), JSON.stringify(holder ? [holder] : []));
            for (const team of ['blue', 'red']) {
              const assigned = assignments.filter(a => a.team === team), slots = assigned.filter(a => a.slot >= 0).map(a => a.slot);
              check('team support slots unique', new Set(slots).size, slots.length);
              check('one retriever per available team', assigned.filter(a => a.role === 'retriever').length, !holder && assigned.length ? 1 : 0);
            }
            if (plan.revision !== revision) tacticalSamples.push({ tick, holderId: holder, assignments: assignments.map(a => ({
              id: a.botId, team: a.team, role: a.role, slot: a.slot, destination: { ...a.destination }, escort: a.escort?.kind ?? null,
              tanking: a.tanking ? { mode: a.tanking.mode, targetId: a.tanking.targetId, partnerId: a.tanking.partnerId, recoveryId: a.tanking.recoveryId, doubleCommit: a.tanking.doubleCommit } : null,
            })) });
          }
          // Verify revival at the planner boundary, before later combat can
          // invalidate the whole plan by killing the current carrier.
          for (const r of revivals.filter(r => r.tick === tick)) {
            check('revived bot assigned before decisions', plan.assignments.has(r.id), state.grifball.phase === 'playing');
          }
        }, updateSingleAIEntity: (id, delta) => {
          const dashBefore = observeDash ? dashState(id) : null;
          const requestsBefore = dashRequests;
          resolvedTarget = null;
          resolvedIncomingThreat = false;
          updates.push(id); update(id, delta);
          if (dashBefore) dashSamples.push({ tick, id, requested: dashRequests > requestsBefore, target: resolvedTarget, incomingThreat: resolvedIncomingThreat, before: dashBefore, after: dashState(id) });
          if (passRecovery) recoveryIntents.push({ id, pickup: !!state.otherPlayers.get(id)!.pickupRequested });
        } }),
      updateGrifball: delta => {
        const previousBallState = ballState();
        const oldHolder = state.grifball.ball.holderId;
        const scorer = oldHolder ? state.otherPlayers.get(oldHolder) : undefined;
        const scoringPosition = scorer?.pos.clone();
        const priorGoals = { blue: state.teamScores.blue.goals, red: state.teamScores.red.goals };
        const wasHeld = previousBallState === 'held';
        const requested = new Map([...state.otherPlayers].map(([id, c]) => [id, !!c.pickupRequested && c.hp > 0 && c.respawnTimer <= 0]));
        const ballPos = { ...state.grifball.ball.pos };
        const weaponBefore = scorer?.weaponState;
        const chargeBefore = passing && plan.passCharge ? { ...plan.passCharge } : null;
        const selected = passing && oldHolder ? plan.assignments.get(oldHolder)?.pass?.selected : null;
        const choice = selected ? { receiverId: selected.receiverId, speed: selected.speed, chargeSeconds: selected.chargeSeconds } : null;
        updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: delta,
          isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => {
            check('round continuation enabled', match, true);
            const health = [...state.otherPlayers.values()].map(c => [c.id, c.hp, c.respawnTimer, c.kills, c.deaths]);
            placement.placeCombatantsAtGrifballSpawns();
            resets.push({ tick, round: state.grifball.roundNumber });
            check('round reset preserves combat lifecycle', JSON.stringify([...state.otherPlayers.values()].map(c => [c.id, c.hp, c.respawnTimer, c.kills, c.deaths])), JSON.stringify(health));
            for (const c of state.otherPlayers.values()) {
              const spawn = map.teamSpawns![c.team!]![0];
              if (mapped) check('reset uses supplied team layout', atTeamSpawn(c), true);
              else check('round team spawn', JSON.stringify(c.pos.toArray()), JSON.stringify([spawn.x, spawn.y, spawn.z]));
              check('round velocity reset', c.vel.length(), 0);
            }
          }, pushStatsUpdate: () => notifications++ });
        if (passing) {
          const released = wasHeld && ballState() === 'thrown';
          const elapsed = (chargeBefore && choice && chargeBefore.carrierId === oldHolder && chargeBefore.receiverId === choice.receiverId && chargeBefore.speed === choice.speed ? chargeBefore.elapsed : 0) + delta;
          if (plan.passCharge) {
            check('charge selects a viable pass', selected?.viable, true);
            check('pass charge advances once', Math.abs(plan.passCharge.elapsed - elapsed) < 1e-9, true);
            check('charge belongs to living holder', plan.passCharge.carrierId === state.grifball.ball.holderId && !!scorer && scorer.hp > 0, true);
            check('charge stays below release threshold', !!choice && elapsed + 1e-9 < choice.chargeSeconds, true);
          }
          if (released) {
            check('release selects a viable pass', selected?.viable, true);
            if (mapPassMatch) check('released prediction clears map footprints', !!selected && selected.path.every(p => isMapBodyClear(map, { ...p, y: 0 })), true);
            check('release starts from ready weapon', weaponBefore, 'ready');
            check('release has autonomous selection', !!choice, true);
            check('release reaches charge threshold', !!choice && elapsed + 1e-9 >= choice.chargeSeconds, true);
            check('release clears charge', plan.passCharge, null);
            check('release clears charge display', scorer?.grifballPassCharge, 0);
            check('release restores hammer', scorer?.activeWeapon, 'hammer');
            check('release restores base health', scorer?.maxHp, state.settings.maxHP);
            check('release receiver retained', plan.passFlight?.receiverId, choice?.receiverId);
            check('release receiver alive and allied', !!choice && state.otherPlayers.get(choice.receiverId)!.hp > 0 && state.otherPlayers.get(choice.receiverId)!.team === scorer?.team, true);
            if (choice) {
              passes.push({ tick, carrierId: oldHolder!, ...choice });
              check('released horizontal speed', Math.abs(Math.hypot(state.grifball.ball.vel.x, state.grifball.ball.vel.z) - choice.speed) < 1e-9, true);
              check('released vertical speed', Math.abs(state.grifball.ball.vel.y - (choice.speed * GRIFBALL_THROW_ARC - GRIFBALL_BALL_GRAVITY * delta)) < 1e-9, true);
              check('release advances ball once', Math.abs(Math.hypot(state.grifball.ball.pos.x - scorer!.pos.x, state.grifball.ball.pos.z - scorer!.pos.z) - choice.speed * delta) < 1e-9, true);
            }
          }
          if (chargeBefore && !plan.passCharge && !released) cancellations.push({ tick, carrierId: chargeBefore.carrierId, receiverId: chargeBefore.receiverId,
            elapsed: chargeBefore.elapsed, reason: oldHolder ? plan.assignments.get(oldHolder)?.pass?.reason ?? 'unavailable' : 'no holder' });
          if (ballState() === 'thrown') check('no airborne possession', state.grifball.ball.holderId, null);
        }
        for (const team of ['blue', 'red'] as const) if (state.teamScores[team].goals !== priorGoals[team]) {
          goals.push({ tick, id: oldHolder!, team, round: state.grifball.roundNumber });
          check('goal only during play', phase, 'playing');
          check('single goal increment', state.teamScores[team].goals, priorGoals[team] + 1);
          const plate = getGoalPlates(map).find(p => p.team !== team)!;
          const dx = Math.abs(scoringPosition!.x - plate.position.x), dz = Math.abs(scoringPosition!.z - plate.position.z);
          const over = plate.shape === 'ellipse' ? (dx / plate.halfExtents.x) ** 2 + (dz / plate.halfExtents.z) ** 2 <= 1 : dx <= plate.halfExtents.x && dz <= plate.halfExtents.z;
          check('living scorer on enemy plate', !!scorer && scorer.team === team && scorer.hp > 0 && over, true);
          check('goal clears possession', state.grifball.ball.holderId, null);
          check('goal restores weapon', scorer?.activeWeapon, 'hammer');
          check('goal restores base health', scorer?.maxHp, state.settings.maxHP ?? 1);
          check('goal clears charge', plan.passCharge, null);
          check('goal starts scored hold', state.grifball.phase, 'scored');
        }
        if (!wasHeld && ballState() === 'held') {
          const id = state.grifball.ball.holderId!, c = state.otherPlayers.get(id)!;
          const pickupPosition = passing ? state.grifball.ball.pos : ballPos;
          pickups.push({ tick, id, distance: Math.hypot(c.pos.x - pickupPosition.x, c.pos.z - pickupPosition.z) });
          check('autonomous pickup request', requested.get(id), true);
          check('pickup begins from available ball', previousBallState === 'loose' || (match || passing) && previousBallState === 'idle' || passing && previousBallState === 'thrown' && state.grifball.ball.pos.y <= .35 + 1e-9, true);
          check('pickup alive', c.hp > 0 && c.respawnTimer <= 0, true);
          check('pickup range', pickups.at(-1)!.distance <= (state.settings.grifballPickupRadius ?? 1.6) + 1e-6, true);
        }
      },
      updateCharacterSkeletalAnimations: delta => updateRosterCombatantVisualsForState({ state, refs, dt: delta,
        renderSwordLungeTrailVfx: noop, applyBotMeleeImpact: botId => {
          const holderId = state.grifball.ball.holderId;
          const attacker = state.otherPlayers.get(botId)!;
          const plannedJump = botId === 'main_ai' && !!attacker.hammerJumpPlanned;
          const jumpBudget = attacker.aiHammerJumpsInAir ?? 0;
          const health = new Map([...state.otherPlayers].map(([id, c]) => [id, c.hp]));
          applyBotMeleeImpactForState({ state, botId, renderHammerSplashVfx: noop, spawnVoxelShockwaveParticles: noop,
            playExplosion: noop, playDeath: noop, playSwing: noop, recordBotPsychKill: noop, recordBotCalibrationDeath: noop });
          if (plannedJump) {
            check('main jump plan consumed at impact', attacker.hammerJumpPlanned, false);
            check('main jump type consumed at impact', attacker.hammerJumpType, undefined);
            check('main jump applies upward impulse', attacker.vel.y, 7.2 + (state.settings.hammerJumpPower ?? 6.5));
            check('main jump increments budget once', attacker.aiHammerJumpsInAir, jumpBudget + 1);
            mainJumpImpacts.push({ tick, launched: !!attacker.isJumping, budget: attacker.aiHammerJumpsInAir ?? 0 });
          }
          const victims = [...state.otherPlayers.values()].filter(c => c.hp < health.get(c.id)!).map(c => c.id);
          impacts.push({ tick, id: botId, victims });
          for (const id of victims) if (state.otherPlayers.get(id)!.hp <= 0) {
            deaths.push({ tick, id });
            if (holderId === id) carrierDeaths.push({ tick, id, pos: state.otherPlayers.get(id)!.pos.toArray() });
          }
          check('no damage through spawn shield', victims.every(id => state.otherPlayers.get(id)!.invulnerabilityTimer <= 0), true);
          check('only enemy damage', victims.every(id => state.otherPlayers.get(id)!.team !== state.otherPlayers.get(botId)!.team), true);
        } }),
      updateMatchTimers: noop, enforceArenaBounds: noop,
      renderGame: () => {
        const lost = carrierDeaths.at(-1);
        if (lost?.tick === tick) {
          check('every carrier death releases ownership before render', state.grifball.ball.holderId, null);
          check('every carrier death drops loose ball', ballState(), 'loose');
          check('every drop uses death position', Math.hypot(state.grifball.ball.pos.x - lost.pos[0], state.grifball.ball.pos.z - lost.pos[2]) < 1e-9, true);
          check('every dead carrier restores hammer', state.otherPlayers.get(lost.id)!.activeWeapon, 'hammer');
          check('every dead carrier clears assignment', plan.assignments.has(lost.id), false);
          check('every dead carrier clears charge', plan.passCharge, null);
        }
        if (carrier.hp <= 0 && !deathTick) deathTick = tick;
        if (!passing && deathTick === tick && (!match || dropTick === 0 && tick < 150)) {
          check('dead carrier released before render', state.grifball.ball.holderId !== carrierId, true);
          if (ballState() !== 'held') dropTick = tick;
          check('dead carrier weapon restored', carrier.activeWeapon, 'hammer');
          check('stale carrier charge cleared', plan.passCharge, null);
          check('dead carrier pickup intent cleared', !!carrier.pickupRequested, false);
          check('dropped ball at death position', Math.hypot(state.grifball.ball.pos.x - carrier.pos.x,
            state.grifball.ball.pos.z - carrier.pos.z) < 1e-9, true);
          check('drop starts fresh loose clock', state.grifball.ball.looseTimer, 0);
          check('stale carrier assignment cleared', plan.assignments.has(carrierId), false);
        }
      },
      updateFloatingNameplate: noop, pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop,
      recordReplayFrame: noop, playRespawn: noop,
    }));
    if (chargeAtFrameStart && !plan.passCharge && passes.at(-1)?.tick !== tick && cancellations.at(-1)?.tick !== tick) {
      cancellations.push({ tick, carrierId: chargeAtFrameStart.carrierId, receiverId: chargeAtFrameStart.receiverId, elapsed: chargeAtFrameStart.elapsed,
        reason: plan.assignments.get(chargeAtFrameStart.carrierId)?.pass?.reason ?? 'Ownership or combat availability changed' });
    }
    if (mapPassMatch && ballState() === 'thrown') check('released pass stays clear of ground obstacles', isMapBodyClear(map, { ...state.grifball.ball.pos, y: 0 }), true);
    if (passing) {
      if (plan.passCharge) check('frame-end charge belongs to holder', plan.passCharge.carrierId, state.grifball.ball.holderId);
      for (const c of state.otherPlayers.values()) if (plan.passCharge?.carrierId !== c.id) check('no stale charge display: ' + c.id, c.grifballPassCharge ?? 0, 0);
    }
    check('one decision per living actor', JSON.stringify(updates), JSON.stringify(living));
    for (const r of revivals.filter(r => r.tick === tick)) {
      const c = state.otherPlayers.get(r.id)!;
      check('revived shield advances once', Math.abs(c.invulnerabilityTimer - (r.shield - dt)) < 1e-9, true);
    }
    const lastPickup = pickups.at(-1);
    if (lastPickup && tick === lastPickup.tick + 1 && phase === 'playing' && state.grifball.ball.holderId === lastPickup.id) {
      check('new carrier becomes runner', plan.assignments.get(lastPickup.id)?.role, 'runner');
      if (passing) check('reception clears old pass flight', plan.passFlight, null);
    }
    if (!passing && dropTick && tick === dropTick + 1) {
      check('enemy recovers loose-ball assignment', plan.assignments.get(defender.id)?.role, 'retriever');
      if (spec.mode === 'contested') check('ally contests loose ball', plan.assignments.get('escort')?.role, 'retriever');
    }
    for (const c of state.otherPlayers.values()) {
      const latestRevival = revivals.filter(r => r.id === c.id).at(-1);
      if (latestRevival && c.hp > 0) {
        const expectedShield = Math.max(0, latestRevival.shield - (tick - latestRevival.tick + 1) * dt);
        check(`${c.id}.shield countdown`, Math.abs(c.invulnerabilityTimer - expectedShield) < 1e-9, true);
      }
      check(`${c.id}.finite`, [...c.pos.toArray(), ...c.vel.toArray(), c.yaw, c.aiTimer ?? 0].every(Number.isFinite), true);
      if (mapped) {
        // Combat may jump onto platforms or slide around rounded obstacle corners.
        // Ground route segments cannot describe those legal 3D collision results.
        check(`${c.id}.clear map body`, isMapBodyClear(map, c.pos), true);
        const geometry = plan.snapshot?.geometry;
        if (geometry) check(`${c.id}.inside map bounds`, Math.abs(c.pos.x) <= geometry.x + 1e-8 && Math.abs(c.pos.z) <= geometry.z + 1e-8, true);
      } else if (plan.snapshot?.geometry && resets.at(-1)?.tick !== tick && latestRevival?.tick !== tick) check(`${c.id}.open segment`, isSpaceSegmentOpen(plan.snapshot.geometry, before.get(c.id)!, c.pos), true);
      check(`${c.id}.pickup intent cleared`, !!c.pickupRequested, false);
    }
    if (ballState() === 'held') {
      const holder = state.otherPlayers.get(state.grifball.ball.holderId!)!;
      check('living carrier at frame end', holder.hp > 0 && holder.respawnTimer <= 0, true);
      check('carrier loadout', holder.activeWeapon, 'ball');
    }
    if (state.grifball.phase !== phase) transitions.push({ tick, from: phase, to: state.grifball.phase, round: state.grifball.roundNumber });
    if (phase !== 'playing') {
      check('inactive assignments cleared', plan.assignments.size, 0);
      check('inactive bots do not start attacks', attacks.length, attackCount);
    }
    frames.push({ ...(passRecovery ? { recoveryIntents } : {}), ...(passing ? { pass: { charge: plan.passCharge ? { ...plan.passCharge } : null, flight: plan.passFlight ? { ...plan.passFlight } : null,
      selections: [...plan.assignments.values()].filter(a => a.pass).map(a => ({ id: a.botId, selected: a.pass!.selected ? { receiverId: a.pass!.selected.receiverId, speed: a.pass!.selected.speed } : null, reason: a.pass!.reason })) } } : {}), tick, phase: state.grifball.phase, round: state.grifball.roundNumber, scores: structuredClone(state.teamScores), winner: state.grifball.winningTeam, ball: structuredClone(state.grifball.ball),
      assignments: [...plan.assignments.values()].map(a => ({ ...(passRecovery ? { destination: { ...a.destination }, receive: a.receive ? structuredClone(a.receive) : null, defense: a.defense ? structuredClone(a.defense) : null } : {}), id: a.botId, role: a.role, target: state.aiMatchContext.coordinator.tacticalEngagements.get(a.botId)?.targetId ?? null })),
      actors: [...state.otherPlayers.values()].map(c => ({ id: c.id, team: c.team, pos: c.pos.toArray(), vel: c.vel.toArray(),
        hp: c.hp, maxHp: c.maxHp, kills: c.kills, deaths: c.deaths, respawnTimer: c.respawnTimer, shield: c.invulnerabilityTimer, yaw: c.yaw, weapon: c.activeWeapon, weaponState: c.weaponState, weaponTimer: c.weaponTimer, isJumping: !!c.isJumping, jumpBudget: c.aiHammerJumpsInAir ?? 0, jumpPlanned: !!c.hammerJumpPlanned, aiState: c.aiState, timer: c.aiTimer ?? 0 })) });
    if (!passing && tick === 150) validateOpeningContest();
    if ((mapMatch || passMatch) && (state.grifball.phase as string) === 'matchEnd') {
      terminalTick ||= tick;
      // Retain three seconds after the winning transition, including pending respawns.
      // Committed impacts may finish after match end. Larger-roster acceptance
      // observes their full respawn delay as well as the terminal hold.
      const observationEnd = rosterMatch ? Math.max(terminalTick, deaths.at(-1)?.tick ?? 0) + 181 : terminalTick + 181;
      if (tick >= observationEnd) { ticks = tick; break; }
    }
  }
  tick = ticks;
  if (revival && !passing) {
    const loser = spec.mode === 'punch-first' ? defender : carrier;
    const first = revivals.find(r => r.id === loser.id);
    check('first loser revives', !!first, true);
    check('full respawn delay', first?.tick, (impacts[0]?.tick ?? 0) + 181);
    check('revived actor resumes useful movement', frames.some(f => f.tick > (first?.tick ?? ticks) &&
      f.actors.some(c => c.id === loser.id && c.hp > 0 && Math.hypot(c.pos[0] - first!.pos[0], c.pos[2] - first!.pos[2]) > 2)), true);
    if (continuation !== 'revival' && (spec.mode === 'contested' || spec.mode === 'hammer-first' && !spec.reverse)) {
      // A second carrier can die and rejoin combat while the original loser
      // takes a support role. Require a real post-revival attack, not a fight
      // by one prescribed identity regardless of its current assignment.
      // The 600-tick revival wrapper separately validates attacks or consumed
      // defensive dashes, retaining original-carrier attack matrix coverage.
      check('revived actor autonomously attacks again', attacks.some(a =>
        revivals.some(r => r.id === a.id && r.tick < a.tick)), true);
    }
    check('revived actor resumes tactical role', frames.some(f => f.tick > (first?.tick ?? ticks) &&
      f.assignments.some(a => a.id === loser.id && ['chaser', 'safety', 'lead', 'left', 'right', 'runner', 'retriever', 'cover'].includes(a.role))), true);
  }
  let pendingMainJumpRequests: number[] = [];
  if (match || mobility || passing) {
    const main = state.otherPlayers.get('main_ai');
    check('main identity final kill accounting', state.enemyKills, main?.kills ?? 0);
    check('main identity final death accounting', state.enemyDeaths, main?.deaths ?? 0);
    const commitments = validateMainJumpCommitments(mainJumpRequests, mainJumpImpacts, deaths, frames,
      state.settings.hammerSlamWindupTime, state.settings.hammerSlamAttackTime, dt);
    pendingMainJumpRequests = commitments.pending;
    for (const failure of commitments.failures) check(failure, false, true);
  }
  function validateOpeningContest() {
    check('runner attacks autonomously', attacks.some(a => a.id === carrierId), true);
    check('opponent attacks autonomously', attacks.some(a => a.id === defender.id), true);
    check('hostile target lookups', targetLookups.every(t => state.otherPlayers.get(t.id)!.team !== state.otherPlayers.get(t.target)!.team), true);
    const punchWins = spec.mode === 'punch-first';
    const winner = punchWins ? carrier : defender, loser = punchWins ? defender : carrier;
    check('loser health', loser.hp, 0);
    check('first impact credits exactly one kill', frames.find(f => f.tick === impacts[0]?.tick)?.actors.find(a => a.id === winner.id)?.kills, 1);
    for (const failure of validateOpeningCombatCredit([...state.otherPlayers.values()], impacts, deaths))
      check(failure, false, true);
    check('one recorded death', loser.deaths, 1);
    check('loser never kills', loser.kills, 0);
    check('winner survives', winner.deaths, 0);
    check('first impact owner', impacts[0]?.id, winner.id);
    check('first impact victim', JSON.stringify(impacts[0]?.victims), JSON.stringify([loser.id]));
    // The goal-side counter can commit on the first frame. Require prompt
    // commitment and the full configured windup instead of a historical tick.
    const firstCommitment = attacks.find(a => a.id === winner.id);
    check('opening commitment within three frames', !!firstCommitment && firstCommitment.tick >= 1 && firstCommitment.tick <= 3, true);
    check('first impact follows full commitment', impacts[0]?.tick,
      (firstCommitment?.tick ?? -100) + (punchWins ? 4 : 7));
    check('loser commitment cancelled on death', impacts.some(i => i.id === loser.id), false);
    check('no post-death attack', attacks.some(a => a.id === loser.id && a.tick > impacts[0]?.tick), false);
    check('dead actor respawn clock advances once', Math.abs(loser.respawnTimer - (3 - (150 - (impacts[0]?.tick ?? 0)) / 60)) < 1e-9, true);
    check('dead actor weapon ready', loser.weaponState, 'ready');
    check('main identity kill bookkeeping', state.enemyKills, state.otherPlayers.get('main_ai')?.kills ?? 0);
    check('main identity death bookkeeping', state.enemyDeaths, state.otherPlayers.get('main_ai')?.deaths ?? 0);
    for (const failure of validateOpeningPossession(carrierId, frames, pickups, carrierDeaths))
      check(failure, false, true);
    check('same-frame death/drop', dropTick, punchWins ? 0 : impacts[0]?.tick);
    if (punchWins) {
      check('winning runner needs no recovery pickup', pickups.length, 0);
      check('runner retains possession', state.grifball.ball.holderId, carrierId);
      check('runner resumes route', carrier.pos.x * sign > 5, true);
    } else {
      for (const failure of validateOpeningRecovery({ defenderId: defender.id,
        contested: spec.mode === 'contested', requireImpact: !mobility, dropTick,
        frames, pickups, impacts, targetLookups })) check(failure, false, true);
      if (spec.mode === 'contested') check('coverage teammate unharmed', state.otherPlayers.get('cover')!.hp, 1);
    }
  }
  if (rosterContest) check('tactical configuration preserved', JSON.stringify(state.grifballTactics), tacticsBefore);
  if (mapped) check('supplied map preserved', JSON.stringify(map), mapBefore);
  return { ...(observeDash ? { dashSamples, dashSettings: { distance: state.settings.dashDistance, duration: state.settings.dashDuration, cooldown: state.settings.dashCooldown } } : {}),
    name: `${spec.mode}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.main ? 'main' : 'ordinary'}`,
    boundary: passRecovery ? 'live-pass-recovery' as const : earnedTank ? 'live-earned-tank-contest' as const : tankContest ? 'live-tank-contest' as const : rosterContest ? 'live-roster-contest' as const : mapPassMatch ? 'live-map-pass-match' as const : passMatch ? 'live-pass-match' as const : passing ? 'live-pass-contest' as const : mapMatch ? 'live-map-match' as const : mapped ? 'live-map-contest' as const : mobility ? 'live-mobility-decision-integration' as const : match ? 'live-match-decision-integration' as const : revival ? 'live-revival-decision-integration' as const : 'live-opposed-decision-integration' as const, scenario: spec, ticks,
    failureCount, failures, ...(earnedTank || passRecovery || rosterMatch ? { combatSettings } : {}), ...(passRecovery ? { authoredPass, releaseState } : {}), tankSamples, tankActions, tacticalSamples, passGeometry, passes, cancellations, mainJumpRequests, mainJumpImpacts, pendingMainJumpRequests, carrierDeaths, goals, resets, transitions, notifications, deaths, revivals, deathTick, dropTick, attacks, impacts, pickups, targetLookups, frames };
}
export const runOpposedDecisionIntegration = () => OPPOSED_DECISION_CASES.map(spec => runOpposedDecisionTrace(spec));

/** These opening frames have no throws, goals or respawns. Reconstruct every
 * holder from pickup/death events instead of assuming only one recovery. The
 * objective runs before melee, so a pickup can precede a death in the same frame. */
export function validateOpeningPossession(
  initialHolder: string,
  frames: readonly { tick: number; ball: { state: string; holderId: string | null }; actors: readonly { id: string; hp: number; weapon: string }[] }[],
  pickups: readonly { tick: number; id: string }[],
  carrierDeaths: readonly { tick: number; id: string }[],
) {
  const failures: string[] = [];
  let holder: string | null = initialHolder;
  for (const [kind, events] of [['pickup', pickups], ['carrier death', carrierDeaths]] as const) {
    if (events.some((event, index) => !Number.isInteger(event.tick) || event.tick < 1 || event.tick > frames.length ||
      index > 0 && event.tick <= events[index - 1].tick)) failures.push(`ordered in-window ${kind} events`);
  }
  for (const [index, frame] of frames.entries()) {
    if (frame.tick !== index + 1) failures.push(`contiguous opening frame: ${frame.tick}`);
    for (const pickup of pickups.filter(event => event.tick === frame.tick)) {
      if (holder !== null) failures.push(`pickup requires released possession: ${frame.tick}`);
      holder = pickup.id;
    }
    for (const death of carrierDeaths.filter(event => event.tick === frame.tick)) {
      if (holder !== death.id || !frame.actors.some(actor => actor.id === death.id && actor.hp <= 0))
        failures.push(`death releases the actual carrier: ${frame.tick}`);
      holder = null;
    }
    if (frame.ball.holderId !== holder || frame.ball.state !== (holder === null ? 'loose' : 'held'))
      failures.push(`event-backed opening possession: ${frame.tick}`);
    if (holder !== null && !frame.actors.some(actor => actor.id === holder && actor.hp > 0 && actor.weapon === 'ball'))
      failures.push(`living equipped opening holder: ${frame.tick}`);
  }
  return failures;
}

/** Opening fights have no respawns or environmental deaths. Every recorded
 * death must have exactly one lethal impact and its credit on that attacker. */
export function validateOpeningCombatCredit(
  actors: readonly { id: string; kills: number; deaths: number }[],
  impacts: readonly { tick: number; id: string; victims: readonly string[] }[],
  deaths: readonly { tick: number; id: string }[],
) {
  const failures: string[] = [];
  const credits = new Map<string, number>();
  for (const death of deaths) {
    const owners = impacts.filter(i => i.tick === death.tick && i.victims.includes(death.id));
    if (owners.length !== 1 || !actors.some(a => a.id === owners[0]?.id)) failures.push(`death has one known impact owner: ${death.id}/${death.tick}`);
    else credits.set(owners[0].id, (credits.get(owners[0].id) ?? 0) + 1);
  }
  for (const actor of actors) {
    if (actor.kills !== (credits.get(actor.id) ?? 0)) failures.push(`credited lethal impacts: ${actor.id}`);
    if (actor.deaths !== deaths.filter(d => d.id === actor.id).length) failures.push(`recorded deaths: ${actor.id}`);
  }
  return failures;
}

/** Either contender may earn recovery. Prove the subsequent hostile response
 * against the actual living carrier while it holds the ball, within the same
 * 150-frame opening. Physical pickup, possession and death credit are checked
 * independently by the frame coordinator and the other opening validators. */
export function validateOpeningRecovery(input: {
  defenderId: string; contested: boolean; requireImpact: boolean; dropTick: number;
  frames: readonly { tick: number; ball: { holderId: string | null }; actors: readonly { id: string; team?: string; hp: number }[] }[];
  pickups: readonly { tick: number; id: string }[];
  impacts: readonly { tick: number; id: string; victims: readonly string[] }[];
  targetLookups: readonly { tick: number; id: string; target: string }[];
}) {
  const failures: string[] = [], recovery = input.pickups[0];
  if (!Number.isInteger(input.dropTick) || input.dropTick <= 0 || !recovery || !Number.isInteger(recovery.tick) || recovery.tick <= input.dropTick || recovery.tick > 150 ||
    ![input.defenderId, ...(input.contested ? ['escort'] : [])].includes(recovery.id))
    return ['opening requires timely recovery by a surviving contender'];
  const frames = new Map(input.frames.map(f => [f.tick, f]));
  const recovered = frames.get(recovery.tick);
  if (recovered?.ball.holderId !== recovery.id || !recovered.actors.some(a => a.id === recovery.id && a.hp > 0))
    failures.push('recovery belongs to the observed living carrier');
  if (!input.contested) return failures;
  const hostileResponse = (tick: number, id: string, target: string) => {
    // Pre-impact frame avoids treating lethal follow-up damage as a dead target.
    const frame = frames.get(tick - 1);
    const actor = frame?.actors.find(a => a.id === id), carrier = frame?.actors.find(a => a.id === recovery.id);
    return Number.isInteger(tick) && tick > recovery.tick && tick <= 150 && target === recovery.id &&
      frame?.ball.holderId === recovery.id && !!actor && !!carrier && actor.hp > 0 && carrier.hp > 0 &&
      !!actor.team && !!carrier.team && actor.team !== carrier.team;
  };
  if (!input.targetLookups.some(t => hostileResponse(t.tick, t.id, t.target)))
    failures.push('new carrier targeted autonomously by a living opponent');
  if (input.requireImpact && !input.impacts.some(i => i.victims.includes(recovery.id) && hostileResponse(i.tick, i.id, recovery.id)))
    failures.push('opponent contests the actual new runner');
  return failures;
}
