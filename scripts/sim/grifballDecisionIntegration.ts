import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { updateAIRosterTick } from '../../src/components/grifball/aiRosterTick';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { isSpaceSegmentOpen } from '../../src/game/grifballSpaceGeometry';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import type { CustomMapData } from '../../src/types';

export interface DecisionIntegrationCase {
  route: 'open' | 'detour' | 'blocked';
  team: 'blue' | 'red';
  reverse: boolean;
  retrieverId: 'main_ai' | 'collector';
}
export const DECISION_INTEGRATION_CASES: DecisionIntegrationCase[] =
  (['open', 'detour', 'blocked'] as const).flatMap(route =>
    (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
      (['main_ai', 'collector'] as const).map(retrieverId => ({ route, team, reverse, retrieverId })))));

/** Live-only closed loop: no authored assignments, pickup requests or movement inputs.
 * The arena/roster tick -> production AI updater -> objective boundary is exercised;
 * presentation, combat and the outer active-frame coordinator are outside this fixture.
 */
export function runDecisionIntegrationTrace(spec: DecisionIntegrationCase) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', aiDifficulty: 'normal' },
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs();
  const sign = spec.team === 'blue' ? 1 : -1;
  const map = { id: 'decision-corridor', name: 'Decision corridor', mapShape: 'rectangular',
    arenaRadius: 60, arenaHalfExtents: { x: 52, z: 23 }, objects: spec.route === 'open' ? [] : [
      { type: 'box', position: { x: 0, y: 1, z: 0 }, scale: { x: .1, y: 2, z: spec.route === 'blocked' ? 60 : 8 }, isCollidable: true },
    ] } as CustomMapData;
  state.arenaRadius = map.arenaRadius;
  state.isObserverMode = true;
  state.grifball.phase = 'playing';
  state.grifball.ball.home = { x: 8 * sign, y: .35, z: 0 };
  state.grifball.ball.pos = { ...state.grifball.ball.home };
  state.grifballTactics = defaultGrifballTactics();
  // Isolate retrieval/routing/escort. Autonomous passing is a later acceptance slice.
  state.grifballTactics.defaults.passingEnabled = false;
  state.otherPlayers.clear();
  const seeds = [
    { id: spec.retrieverId, x: -8, z: 0, team: spec.team, controller: 'ai' as const },
    { id: 'support_a', x: -15, z: -6, team: spec.team, controller: 'ai' as const },
    { id: 'support_b', x: -15, z: 6, team: spec.team, controller: 'ai' as const },
    { id: 'remote', x: 40, z: 18, team: spec.team === 'blue' ? 'red' as const : 'blue' as const, controller: 'remote' as const },
  ];
  for (const s of spec.reverse ? [...seeds].reverse() : seeds) {
    const c = createOfflineBotCombatant({ id: s.id, playerName: s.id, team: s.team,
      spawnPos: new THREE.Vector3(s.x * sign, 0, s.z * sign), yaw: -sign * Math.PI / 2,
      hue: 0, difficulty: 'normal', settings: state.settings });
    Object.assign(c, { controller: s.controller, weaponState: 'ready', weaponTimer: 0,
      invulnerabilityTimer: 0, respawnTimer: 0, swapCooldownTimer: 0 });
    state.otherPlayers.set(c.id, c);
    refs.otherPlayerMeshes.set(c.id, { group: new THREE.Group() } as never);
  }
  const failures: { tick: number; field: string; actual: unknown; expected: unknown }[] = [];
  let failureCount = 0, tick = 0;
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) { failureCount++; if (failures.length < 64) failures.push({ tick, field, actual, expected }); }
  };
  const noop = () => {};
  const goal = (team: string | undefined) => ({ x: team === 'blue' ? 47 : -47, z: 0 });
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'),
    resolveBotKnobs: () => ({ difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
      weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0 }),
    resolveBotDerived: () => ({ pressureAggression: 50 }), resolveBotFlags: () => ({}),
    getMatchScoreContext: () => ({ ownScore: 0, opponentScore: 0, scoreToWin: 25 }),
    grifballEnemyGoalPos: goal,
    getActiveCustomMap: () => map,
    constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
    getBestTacticalTarget: () => { check('unexpected generic combat', true, false); return null; },
    triggerCombatantAttack: () => check('unexpected attack', true, false),
    playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop,
  });
  const random = seededRandom(17), dt = 1 / 60;
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const frames = [];
  let pickupTick = 0, runnerTick = 0, pickupX = 0;
  for (tick = 1; tick <= 480; tick++) {
    const before = new Map([...state.otherPlayers].map(([id, c]) => [id, c.pos.clone()]));
    const heldBefore = state.grifball.ball.holderId;
    const plan = state.aiMatchContext.grifballTeamPlan;
    let revision = 0, snapshot = '';
    const intents: { id: string; role: string | null; pickup: boolean; route: string | null;
      destination: { x: number; z: number } | null; reason: string | null }[] = [];
    withSimulationRandom(random, tick * dt, () => {
      updateAIRosterTick({ refs, rosterAI: [...state.otherPlayers.values()], dt,
        respawnCombatant: () => check('unexpected respawn', true, false),
        beforeUpdate: () => {
          updateGrifballTeamPlanForState(state, dt, goal, map);
          revision = plan.revision; snapshot = JSON.stringify(plan.snapshot);
          check('remote ownership', plan.assignments.has('remote'), false);
          const retrievers = [...plan.assignments.values()].filter(a => a.role === 'retriever');
          check('retriever count', retrievers.length, heldBefore ? 0 : 1);
          if (!heldBefore) check('nearest retriever', retrievers[0]?.botId, spec.retrieverId);
        }, updateSingleAIEntity: (id, delta) => {
          const a = plan.assignments.get(id);
          update(id, delta);
          const c = state.otherPlayers.get(id)!;
          check(`${id}.shared revision`, plan.revision, revision);
          check(`${id}.detached snapshot`, JSON.stringify(plan.snapshot), snapshot);
          check(`${id}.pickup intent`, !!c.pickupRequested, !heldBefore && a?.role === 'retriever');
          check(`${id}.finite movement`, [...c.pos.toArray(), ...c.vel.toArray(), c.yaw].every(Number.isFinite), true);
          const speed = (heldBefore === id ? 5.8 * (state.settings.grifballRunnerSpeedForward ?? 100) / 100 : 5.2)
            * state.settings.speedForward / 100;
          check(`${id}.speed limit`, c.pos.distanceTo(before.get(id)!) <= speed * dt + 1e-6, true);
          check(`${id}.open segment`, isSpaceSegmentOpen(plan.snapshot!.geometry!, before.get(id)!, c.pos), true);
          if (id === spec.retrieverId && heldBefore) {
            check('carrier role', a?.role, 'runner');
            if (!runnerTick) runnerTick = tick;
          }
          intents.push({ id, role: a?.role ?? null, pickup: !!c.pickupRequested, route: a?.space?.route.status ?? null,
            destination: a ? { ...a.destination } : null, reason: a?.reason ?? null });
        } });
      updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
        isMultiplayer: false, activeCustomMap: map,
        placeCombatantsAtGrifballSpawns: () => check('unexpected round reset', true, false), pushStatsUpdate: noop });
    });
    const holder = state.grifball.ball.holderId;
    if (holder && !pickupTick) { pickupTick = tick; pickupX = state.otherPlayers.get(holder)!.pos.x; }
    if (holder) check('pickup owner', holder, spec.retrieverId);
    const remote = state.otherPlayers.get('remote')!;
    check('remote stationary', remote.pos.equals(before.get('remote')!), true);
    for (const c of state.otherPlayers.values()) check(`${c.id}.consumed pickup`, !!c.pickupRequested, false);
    frames.push({ tick, revision, intents, holder, ball: { ...state.grifball.ball.pos }, actors: [...state.otherPlayers.values()].map(c => ({
      id: c.id, pos: c.pos.toArray(), vel: c.vel.toArray(), yaw: c.yaw, weapon: c.activeWeapon,
    })) });
  }
  tick = 480;
  const retriever = state.otherPlayers.get(spec.retrieverId)!;
  if (spec.route === 'blocked') {
    check('blocked no pickup', pickupTick, 0);
    check('blocked holds position', retriever.pos.distanceTo(new THREE.Vector3(-8 * sign, 0, 0)) < 1e-6, true);
    check('blocked route classified', frames.every(f => f.intents.find(i => i.id === spec.retrieverId)?.route === 'blocked'), true);
  } else {
    check('eventual pickup', pickupTick > 0 && pickupTick < 420, true);
    check('next-frame runner', runnerTick, pickupTick + 1);
    check('runner progress', sign * (retriever.pos.x - pickupX) > 1, true);
    check('carrier equipped', retriever.activeWeapon, 'ball');
    if (spec.route === 'detour') check('detour leaves center lane', frames.some(f => Math.abs(f.actors.find(c => c.id === spec.retrieverId)!.pos[2]) > 4), true);
  }
  const supports = ['support_a', 'support_b'].map(id => state.otherPlayers.get(id)!);
  check('support separation', supports[0].pos.distanceTo(supports[1].pos) > 2, true);
  for (const c of supports) {
    const start = seeds.find(s => s.id === c.id)!;
    const distance = c.pos.distanceTo(new THREE.Vector3(start.x * sign, 0, start.z * sign));
    check(`${c.id}.support movement`, spec.route === 'blocked' ? distance < 1e-6 : distance > 1, true);
  }
  return { name: `${spec.route}/${spec.team}/${spec.reverse ? 'reverse' : 'forward'}/${spec.retrieverId}`,
    boundary: 'live-decision-integration' as const, scenario: spec, ticks: 480, failureCount, failures,
    pickupTick, runnerTick, frames };
}

export const runDecisionIntegration = () => DECISION_INTEGRATION_CASES.map(runDecisionIntegrationTrace);
