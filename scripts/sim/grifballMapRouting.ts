import * as THREE from 'three';
import { PREMADE_MAPS } from '../../src/game/premadeMaps';
import { toGrifballArena } from '../../src/game/grifballMaps';
import { getGoalPlates } from '../../src/game/grifballGoals';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { isSpaceSegmentOpen } from '../../src/game/grifballSpaceGeometry';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { updateAIRosterTick } from '../../src/components/grifball/aiRosterTick';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { getGrifballEnemyGoalPosForMap, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { createArenaCollisionCallbacksForState } from '../../src/components/grifball/arenaCollisionCallbacks';
import type { CustomMapData } from '../../src/types';

export interface MapRoutingCase { map: CustomMapData; team: 'blue' | 'red'; reverse: boolean; retrieverId: 'main_ai' | 'collector' }
export const MAP_ROUTING_CASES: MapRoutingCase[] = PREMADE_MAPS.map(toGrifballArena)
  .filter(map => getGoalPlates(map).length === 2).flatMap(map => (['blue', 'red'] as const).flatMap(team =>
    [false, true].flatMap(reverse => (['main_ai', 'collector'] as const).map(retrieverId => ({ map, team, reverse, retrieverId })))));

/** Three allied bots start at real team spawns and autonomously retrieve the
 * center ball and carry it to a physical goal. No movement/role/action injection. */
export function runMapRoutingTrace(spec: MapRoutingCase) {
  const map = structuredClone(spec.map), mapBefore = JSON.stringify(map);
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal', grifballGoalTarget: 1, grifballRoundResetDelay: .19 },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), noop = () => {}, dt = 1 / 60;
  state.arenaRadius = map.arenaRadius; state.isObserverMode = true; state.otherPlayers.clear(); state.grifball.phase = 'playing';
  state.grifball.ball.home = { x: 0, y: .35, z: 0 }; state.grifball.ball.pos = { ...state.grifball.ball.home };
  state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.passingEnabled = false;
  const spawns = map.teamSpawns?.[spec.team];
  if (!spawns || spawns.length < 4) throw new Error(`Missing supplied team spawn layout: ${map.id}/${spec.team}`);
  // On these three maps the end-zone barrier makes the outer spawn's route
  // shorter despite its greater straight-line distance. Pin the expected choice.
  const barrier = map.objects.find(o => ['barrier_w', 'grid_barrier_w', 'rainy_barrier_w'].includes(o.id));
  const retrieverSlot = barrier ? 0 : 1;
  const seeds = [{ id: spec.retrieverId, spawn: spawns[retrieverSlot] }, { id: 'support_a', spawn: spawns[1 - retrieverSlot] }, { id: 'support_b', spawn: spawns[3] }];
  for (const s of spec.reverse ? [...seeds].reverse() : seeds) {
    const c = createOfflineBotCombatant({ id: s.id, playerName: s.id, team: spec.team, spawnPos: new THREE.Vector3(s.spawn.x, s.spawn.y, s.spawn.z),
      yaw: spec.team === 'blue' ? -Math.PI / 2 : Math.PI / 2, hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: 'ai', weaponState: 'ready', weaponTimer: 0, invulnerabilityTimer: 0, respawnTimer: 0, swapCooldownTimer: 0 });
    state.otherPlayers.set(c.id, c); refs.otherPlayerMeshes.set(c.id, { group: new THREE.Group() } as never);
  }
  let tick = 0, failureCount = 0, pickupTick = 0, runnerTick = 0, goalTick = 0, endTick = 0, notifications = 0;
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  const goal = (team: string | undefined) => getGrifballEnemyGoalPosForMap(team, map);
  const collision = createArenaCollisionCallbacksForState({ getState: () => state, getRefs: () => refs, getActiveCustomMap: () => map,
    getMainAI: () => state.otherPlayers.get('main_ai'), isMultiplayer: false, multiplayerRole: null, opponentClientId: '' });
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'),
    resolveBotKnobs: () => ({ difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0, weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0 }),
    resolveBotDerived: () => ({ pressureAggression: 50 }), resolveBotFlags: () => ({}),
    getMatchScoreContext: () => ({ ownScore: 0, opponentScore: 0, scoreToWin: 1 }), grifballEnemyGoalPos: goal,
    ...collision, getActiveCustomMap: () => map,
    getBestTacticalTarget: () => { check('unexpected generic combat', true, false); return null; },
    triggerCombatantAttack: () => check('unexpected attack', true, false), playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop });
  const random = seededRandom(17), frames = [];
  const currentPhase = () => state.grifball.phase;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const scorer = state.otherPlayers.get(spec.retrieverId)!;
  const targetPlate = getGoalPlates(map).find(p => p.team !== spec.team)!;
  // Independently check each authored obstacle footprint along the ground path.
  const groundClear = (p: THREE.Vector3) => map.objects.filter(o => o.isCollidable && o.position.y + o.scale.y / 2 > .05 && o.position.y - o.scale.y / 2 < 2).every(o => {
    if (o.type === 'box') return Math.hypot(Math.max(0, Math.abs(p.x - o.position.x) - o.scale.x / 2), Math.max(0, Math.abs(p.z - o.position.z) - o.scale.z / 2)) >= .55 - 1e-6;
    if (o.type === 'cylinder') return Math.hypot(p.x - o.position.x, p.z - o.position.z) >= o.scale.x / 2 + .55 - 1e-6;
    throw new Error(`Unsupported ground oracle obstacle: ${o.type}`);
  });
  for (tick = 1; tick <= 1440; tick++) {
    const phase = currentPhase(), held = state.grifball.ball.holderId;
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    const plan = state.aiMatchContext.grifballTeamPlan;
    const intents: { id: string; role: string | null; pickup: boolean; route: string | null }[] = [];
    const updates: string[] = [];
    withSimulationRandom(random, tick * dt, () => {
      updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt, respawnCombatant: () => check('unexpected respawn', true, false),
        beforeUpdate: () => {
          updateGrifballTeamPlanForState(state, dt, goal, map);
          const retrievers = [...plan.assignments.values()].filter(a => a.role === 'retriever');
          check('single retriever while available', retrievers.length, phase === 'playing' && !held ? 1 : 0);
          if (retrievers.length) check('expected route-aware retriever', retrievers[0].botId, spec.retrieverId);
        }, updateSingleAIEntity: (id, delta) => {
          updates.push(id); const a = plan.assignments.get(id); update(id, delta); const c = state.otherPlayers.get(id)!;
          check('finite actor state', [...c.pos.toArray(), ...c.vel.toArray(), c.yaw].every(Number.isFinite), true);
          const speed = (held === id ? 5.8 * (state.settings.grifballRunnerSpeedForward ?? 100) / 100 : 5.2) * state.settings.speedForward / 100;
          check('configured movement speed', c.pos.distanceTo(before.get(id)!) <= speed * dt + 1e-6, true);
          check('planner safe movement segment', isSpaceSegmentOpen(plan.snapshot!.geometry!, before.get(id)!, c.pos), true);
          check('independent obstacle clearance', groundClear(c.pos), true);
          check('grounded route', c.pos.y, 0);
          if (phase !== 'playing') check('inactive movement stopped', c.pos.equals(before.get(id)!), true);
          if (held === id && phase === 'playing') { check('carrier assigned runner', a?.role, 'runner'); if (!runnerTick) runnerTick = tick; }
          intents.push({ id, role: a?.role ?? null, pickup: !!c.pickupRequested, route: a?.space?.route.status ?? null });
        } });
      const priorScore = state.teamScores[spec.team].goals;
      const ballPos = { ...state.grifball.ball.pos };
      updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
        isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => check('unexpected round reset', true, false), pushStatsUpdate: () => notifications++ });
      if (!held && state.grifball.ball.holderId) {
        pickupTick = tick;
        check('autonomous pickup owner', state.grifball.ball.holderId, spec.retrieverId);
        check('pickup requested by planner retriever', intents.some(i => i.id === spec.retrieverId && i.pickup && i.role === 'retriever'), true);
        check('pickup within radius', Math.hypot(scorer.pos.x - ballPos.x, scorer.pos.z - ballPos.z) <= (state.settings.grifballPickupRadius ?? 1.6) + 1e-6, true);
        check('pickup equips ball', scorer.activeWeapon, 'ball');
      }
      if (state.teamScores[spec.team].goals > priorScore) {
        goalTick = tick; check('goal follows possession during play', held === spec.retrieverId && phase === 'playing', true);
        const dx = Math.abs(scorer.pos.x - targetPlate.position.x), dz = Math.abs(scorer.pos.z - targetPlate.position.z);
        const over = targetPlate.shape === 'ellipse' ? (dx / targetPlate.halfExtents.x) ** 2 + (dz / targetPlate.halfExtents.z) ** 2 <= 1 : dx <= targetPlate.halfExtents.x && dz <= targetPlate.halfExtents.z;
        check('physical enemy plate reached', over, true);
        check('goal clears possession', state.grifball.ball.holderId, null); check('goal restores hammer', scorer.activeWeapon, 'hammer');
      }
    });
    check('one update per actor', new Set(updates).size === 3 && updates.length === 3, true);
    for (const c of state.otherPlayers.values()) check('pickup intent consumed', !!c.pickupRequested, false);
    if (currentPhase() === 'matchEnd') {
      if (!endTick) endTick = tick;
      check('terminal score remains one', state.teamScores[spec.team].goals, 1); check('terminal ownership clear', state.grifball.ball.holderId, null);
      check('terminal assignments clear', plan.assignments.size, 0);
    }
    frames.push({ tick, phase: currentPhase(), holder: state.grifball.ball.holderId, intents,
      actors: [...state.otherPlayers.values()].map(c => ({ id: c.id, pos: c.pos.toArray() })) });
  }
  tick = 1440;
  check('autonomous pickup completed', pickupTick > 0, true); check('next-frame runner assignment', runnerTick, pickupTick + 1);
  check('autonomous goal completed', goalTick > pickupTick && pickupTick > 0, true);
  check('terminal state observed for at least one second', endTick > 0 && endTick <= 1380, true);
  check('twelve-update scored hold', endTick, goalTick + 12);
  check('winning team', state.grifball.winningTeam, spec.team); check('single goal notification', notifications, 1);
  check('opposing team never scores', state.teamScores[spec.team === 'blue' ? 'red' : 'blue'].goals, 0);
  if (barrier) {
    check('obstructed nearest spawn yields retrieval to clear outer route', Math.hypot(spawns[0].x, spawns[0].z) > Math.hypot(spawns[1].x, spawns[1].z), true);
    const enemyBarrier = map.objects.find(o => o.isCollidable && o.position.x * (spec.team === 'blue' ? 1 : -1) > 30)!;
    check('runner crosses enemy barrier via a detour', frames.some(f => f.holder === spec.retrieverId && f.actors.some(c => c.id === spec.retrieverId && Math.abs(c.pos[0] - enemyBarrier.position.x) <= enemyBarrier.scale.x / 2 && Math.abs(c.pos[2] - enemyBarrier.position.z) >= enemyBarrier.scale.z / 2 + .55)), true);
  }
  check('supports remain separated', state.otherPlayers.get('support_a')!.pos.distanceTo(state.otherPlayers.get('support_b')!.pos) > 2, true);
  check('supplied map and spawn layout preserved', JSON.stringify(map), mapBefore);
  return { name: `${map.id}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.retrieverId}`,
    boundary: 'live-map-routing' as const, mapId: map.id, retrieverSlot, obstacleDetour: !!barrier, ticks: 1440, failureCount, failures, pickupTick, runnerTick, goalTick, endTick, frames };
}
export const runMapRouting = () => MAP_ROUTING_CASES.map(runMapRoutingTrace);
