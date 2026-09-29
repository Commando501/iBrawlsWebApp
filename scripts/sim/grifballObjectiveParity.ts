import * as THREE from 'three';
import { createMatch, defaultGrifballMap } from '../../src/sim/factory';
import { tickGrifballObjective, throwSimPass, setSimCarrier } from '../../src/sim/grifball';
import type { SimState } from '../../src/sim/simState';
import { idleAction } from '../../src/sim/actions';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import { updateGrifballObjectiveForState, setGrifballCarrierForState, throwPlayerGrifballPassForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { attachBallTo, throwBall } from '../../src/game/grifballBall';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { parityRecorder } from './grifballMultiActorParity';
import { SPAWN_PARITY_MAPS } from './grifballSpawnParity';
import type { CustomMapData } from '../../src/types';

const noop = () => {};
const KINDS = ['pickup-tie', 'pickup-nearer', 'pickup-remote', 'pickup-respawning', 'pickup-no-request',
  'countdown', 'pickup-goal', 'own-goal', 'winner', 'round-reset', 'carrier-death', 'carrier-respawning',
  'carrier-removed', 'healing', 'pass-min', 'pass-full', 'pass-disabled', 'pass-catch', 'pass-return', 'release-recovering',
  'pickup-recovering', 'carrier-death-on-goal', 'pass-on-goal'] as const;
export interface ObjectiveParityCase { kind: typeof KINDS[number]; carrier: 'player' | 'bot'; mirror: boolean; reverse: boolean; map?: CustomMapData }
export const OBJECTIVE_PARITY_CASES: ObjectiveParityCase[] = [
  ...KINDS.flatMap(kind => (['player', 'bot'] as const).flatMap(carrier => [false, true].flatMap(mirror =>
    [false, true].map(reverse => ({ kind, carrier, mirror, reverse }))))),
  ...SPAWN_PARITY_MAPS.flatMap(map => [false, true].flatMap(mirror => [false, true].map(reverse =>
    ({ kind: 'round-reset' as const, carrier: 'bot' as const, mirror, reverse, map })))),
];

/** Objective boundary parity, independent of movement/combat ticks. Releases and
 * damage are authored events; this does not certify AI pass selection or full-frame ordering. */
export function runObjectiveParityTrace(spec: ObjectiveParityCase, snapshotAt?: number) {
  const sim = createMatch({ seed: 107, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    map: structuredClone(spec.map ?? defaultGrifballMap()), settings: { maxHP: 2, grifballGoalTarget: spec.kind === 'winner' ? 1 : 2,
      grifballCountdownDuration: .1, grifballRoundResetDelay: .2, grifballBallReturnTimeout: .4,
      grifballAllowThrowing: spec.kind !== 'pass-disabled', grifballRunnerHealth: 3, grifballRunnerHealDelay: .1, grifballRunnerHealRate: 2 } });
  const [player, bot, rival] = sim.combatants;
  player.id = sim.localPlayerId = 'player'; player.controller = 'remote'; bot.id = 'bot'; rival.id = 'rival';
  player.team = bot.team = spec.mirror ? 'red' : 'blue'; rival.team = spec.mirror ? 'blue' : 'red';
  const carrier = spec.carrier === 'player' ? player : bot;
  const receiver = spec.carrier === 'player' ? bot : player;
  for (const c of sim.combatants) { c.pos = { x: 12, y: 0, z: 0 }; c.vel = { x: 0, y: 0, z: 0 }; c.yaw = 0; c.invulnerabilityTimer = 0; }
  carrier.pos = { x: 0, y: 0, z: 0 }; receiver.pos = { x: .5, y: 0, z: 0 };
  sim.match.phase = spec.kind === 'countdown' ? 'countdown' : 'playing';
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...sim.settings }, isMultiplayer: false, multiplayerRole: null });
  live.otherPlayers.clear(); live.grifballTactics = defaultGrifballTactics(); live.localPlayerTeam = player.team; live.arenaRadius = sim.map.arenaRadius;
  live.playerHP = player.hp; live.playerMaxHP = player.maxHp; live.playerRespawnTimer = 0;
  live.pWeaponState = live.pSwordState = 'ready'; live.pWeaponTimer = live.pSwordTimer = 0;
  for (const c of [bot, rival]) {
    const actor = createOfflineBotCombatant({ id: c.id, playerName: c.id, team: c.team, spawnPos: new THREE.Vector3(),
      yaw: 0, hue: 0, difficulty: 'normal', settings: live.settings, modelType: 'medium' });
    actor.hp = c.hp; actor.maxHp = c.maxHp; actor.weaponState = 'ready'; actor.weaponTimer = 0;
    actor.respawnTimer = 0; actor.runnerHealDelayTimer = 0; actor.runnerLastHp = c.hp;
    live.otherPlayers.set(c.id, actor);
  }
  live.playerRunnerHealDelayTimer = 0; live.playerRunnerLastHp = player.hp;
  const refs = createInitialGrifballThreeRefs(), ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  let resets = 0, stats = 0;
  const placement = createArenaOrchestratorCallbacksForState({ getState: () => live, getRefs: () => refs,
    spawnPoints: [], getActiveCustomMap: () => sim.map, getLegacyRosterProps: () => ({}), getOfflineBotCount: () => 2,
    isPlaying: true, opponentClientId: '', constrainCombatantToArena: noop, getVisualModelPolicy: () => 'v2', pushStatsUpdate: noop, playRespawn: noop });
  const hasCarrier = !spec.kind.startsWith('pickup') && !['countdown', 'round-reset'].includes(spec.kind);
  if (hasCarrier) { attachBallTo(sim.match.ball, carrier.id); setSimCarrier(carrier, true, sim.settings); }
  if (['pickup-goal', 'winner', 'own-goal', 'carrier-death-on-goal', 'pass-on-goal'].includes(spec.kind)) {
    const plate = sim.goalPlates.find(p => (p.team === carrier.team) === (spec.kind === 'own-goal'))!;
    carrier.pos = { ...plate.position };
    if (spec.kind === 'pickup-goal') sim.match.ball.pos = { ...plate.position, y: .35 };
  }
  if (spec.kind === 'pickup-tie') receiver.pos = { ...carrier.pos };
  if (spec.kind === 'pickup-nearer') { carrier.pos.x = 1; receiver.pos.x = .25; }
  if (spec.kind === 'pickup-remote') { bot.controller = 'remote'; player.pos.x = 5; bot.pos.x = 0; }
  if (['pickup-respawning', 'carrier-respawning'].includes(spec.kind)) carrier.respawnTimer = 1;
  if (spec.kind.startsWith('carrier-death')) { carrier.hp = 0; carrier.alive = false; carrier.respawnTimer = 1; }
  if (spec.kind === 'healing') { carrier.hp -= 1; }
  if (spec.kind === 'round-reset') {
    sim.match.phase = 'scored'; sim.match.phaseTimer = .19;
    bot.hp = 0; bot.alive = false; bot.respawnTimer = 1; player.hp = 1;
    rival.weapon = 'sword'; rival.weaponState = 'recovering'; rival.weaponTimer = .3; rival.weaponPhaseElapsed = .2;
  }
  if (['release-recovering', 'pickup-recovering'].includes(spec.kind)) { carrier.weaponState = 'recovering'; carrier.weaponTimer = .3; carrier.weaponPhaseElapsed = .2; }
  if (spec.kind === 'pass-catch') receiver.pos = { x: 0, y: 0, z: 8 };
  else if (spec.kind.startsWith('pass') || spec.kind === 'release-recovering') receiver.pos.x = 15;
  live.grifball = structuredClone(sim.match);
  for (const c of [player, bot, rival]) {
    if (c.hasBall) setGrifballCarrierForState({ state: live, id: c.id, carrying: true });
    const a = live.otherPlayers.get(c.id);
    if (a) {
      a.controller = c.controller; a.yaw = c.yaw + Math.PI; a.pos.set(c.pos.x, c.pos.y, c.pos.z); a.vel.set(c.vel.x, c.vel.y, c.vel.z);
      a.hp = c.hp; a.maxHp = c.maxHp; a.respawnTimer = c.respawnTimer; a.activeWeapon = c.weapon;
      a.weaponState = c.weaponState === 'idle' ? 'ready' : 'recovering'; a.weaponTimer = c.weaponPhaseElapsed ?? 0;
      a.runnerLastHp = c.runnerLastHp; a.runnerHealDelayTimer = c.runnerHealDelayTimer;
    } else {
      live.playerPos.set(c.pos.x, c.pos.y, c.pos.z); live.playerVel.set(0, 0, 0); live.yaw = c.yaw + Math.PI;
      live.playerHP = c.hp; live.playerMaxHP = c.maxHp; live.playerRespawnTimer = c.respawnTimer;
      live.activeWeapon = c.weapon; live.pWeaponState = c.weaponState === 'idle' ? 'ready' : 'recovering';
      live.pWeaponTimer = c.weaponPhaseElapsed ?? 0; live.playerRunnerLastHp = c.runnerLastHp;
    }
  }
  if (spec.kind === 'carrier-removed') {
    // The removed id deliberately has no actor in either runtime.
    live.grifball.ball.holderId = sim.match.ball.holderId = 'departed'; carrier.hasBall = false;
  }
  if (spec.reverse) { sim.combatants.reverse(); live.otherPlayers = new Map([...live.otherPlayers].reverse()); }
  const record = parityRecorder(), frames = []; let restored: SimState | undefined;
  const release = spec.kind.startsWith('pass') || spec.kind === 'release-recovering';
  const charge = spec.kind === 'pass-full' ? 1 : 0;
  let goals = 0;
  const ticks = spec.kind === 'pass-full' ? 360 : 120;
  for (let tick = 1; tick <= ticks; tick++) {
    if (release && tick === (spec.kind === 'pass-on-goal' ? 1 : 2)) {
      if (carrier.id === 'player') {
        ballChargeTimerRef.current = charge * (sim.settings.grifballChargeMax ?? 1.2);
        throwPlayerGrifballPassForState({ state: live, refs, ballChargingRef, ballChargeTimerRef, playSwing: noop });
      } else if (spec.kind !== 'pass-disabled') {
        // Authored roster release uses the same production primitive as the scripted passer.
        const a = live.otherPlayers.get(carrier.id)!;
        throwBall(live.grifball.ball, { x: a.pos.x, y: a.pos.y + 1.1, z: a.pos.z }, { x: 0, y: 0, z: 1 },
          (sim.settings.grifballPassSpeedMin ?? 9) + charge * ((sim.settings.grifballPassSpeedMax ?? 26) - (sim.settings.grifballPassSpeedMin ?? 9)));
        setGrifballCarrierForState({ state: live, id: carrier.id, carrying: false });
      }
      throwSimPass(sim, carrier, charge, sim.settings);
      if (restored) throwSimPass(restored, restored.combatants.find(c => c.id === carrier.id)!, charge, restored.settings);
    }
    const pickup = (id: string) => spec.kind === 'pass-catch' ? id === receiver.id
      : (spec.kind.startsWith('pickup') || spec.kind === 'countdown') && spec.kind !== 'pickup-no-request';
    const actions = Object.fromEntries(sim.combatants.map(c => [c.id, { ...idleAction(), pickup: pickup(c.id) }]));
    live.playerPickupRequested = pickup('player'); for (const a of live.otherPlayers.values()) a.pickupRequested = pickup(a.id);
    updateGrifballObjectiveForState({ state: live, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: 1 / 60,
      isMultiplayer: false, activeCustomMap: sim.map, placeCombatantsAtGrifballSpawns: () => { resets++; placement.placeCombatantsAtGrifballSpawns(); }, pushStatsUpdate: () => { stats++; } });
    const events = tickGrifballObjective(sim, sim.settings, 1 / 60, actions); if (events.goal) goals++;
    if (restored) {
      const restoredEvents = tickGrifballObjective(restored, restored.settings, 1 / 60, actions);
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim));
      record.compare(tick, 'snapshot.events', JSON.stringify(restoredEvents), JSON.stringify(events));
    }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    const liveActors = [player, bot, rival].map(c => {
      const a = live.otherPlayers.get(c.id);
      return { id: c.id, hasBall: live.grifball.ball.holderId === c.id, hp: a ? a.hp : live.playerHP, maxHp: a ? a.maxHp : live.playerMaxHP,
        respawn: a ? a.respawnTimer : live.playerRespawnTimer, weapon: a ? a.activeWeapon : live.activeWeapon,
        phase: (a ? a.weaponState : live.pWeaponState) === 'ready' ? 'idle' : (a ? a.weaponState : live.pWeaponState),
        elapsed: a ? a.weaponTimer : live.pWeaponTimer, pos: (a ? a.pos : live.playerPos).toArray(),
        yaw: a ? a.yaw : live.yaw, healDelay: a ? a.runnerHealDelayTimer : live.playerRunnerHealDelayTimer,
        lastHp: a ? a.runnerLastHp : live.playerRunnerLastHp };
    });
    const headlessActors = [player, bot, rival].map(c => ({ id: c.id, hasBall: c.hasBall, hp: c.hp, maxHp: c.maxHp, respawn: c.respawnTimer,
      weapon: c.weapon, phase: c.weaponState, elapsed: c.weaponPhaseElapsed ?? 0, pos: [c.pos.x, c.pos.y, c.pos.z],
      yaw: c.yaw + Math.PI, healDelay: c.runnerHealDelayTimer, lastHp: c.runnerLastHp }));
    const compareTree = (path: string, a: unknown, b: unknown) => {
      if (a && typeof a === 'object') for (const key of Object.keys(a)) compareTree(`${path}.${key}`,
        (a as Record<string, unknown>)[key], (b as Record<string, unknown> | undefined)?.[key]);
      else record.compare(tick, path, a, b, typeof a === 'number' ? 1e-9 : 0);
    };
    compareTree('match', live.grifball, sim.match); compareTree('scores', live.teamScores, sim.scores);
    compareTree('actors', liveActors, headlessActors);
    record.compare(tick, 'goal.notifications', stats, goals);
    record.compare(tick, 'player.requestConsumed', live.playerPickupRequested, false);
    for (const a of live.otherPlayers.values()) record.compare(tick, `${a.id}.requestConsumed`, a.pickupRequested, false);
    frames.push({ tick, live: { match: structuredClone(live.grifball), actors: liveActors, resets, stats },
      headless: { match: structuredClone(sim.match), actors: headlessActors, events } });
  }
  // Independent endpoint assertions prevent two engines sharing an incorrect outcome.
  for (const side of ['live', 'headless'] as const) {
    const first = frames[0][side], last = frames.at(-1)![side];
    const expectedPickup = spec.kind === 'pickup-tie' ? 'bot' : ['pickup-nearer', 'pickup-respawning'].includes(spec.kind) ? receiver.id
      : spec.kind === 'countdown' ? carrier.id : null;
    if (expectedPickup) record.compare(120, `expected.${side}.pickup`, last.match.ball.holderId, expectedPickup);
    if (['pickup-remote', 'pickup-no-request', 'carrier-death', 'carrier-respawning', 'carrier-removed'].includes(spec.kind))
      record.compare(1, `expected.${side}.unheld`, first.match.ball.holderId, null);
    if (spec.kind === 'pickup-goal') record.compare(1, `expected.${side}.scored`, first.match.phase, 'scored');
    if (spec.kind === 'winner') { record.compare(120, `expected.${side}.winner`, last.match.winningTeam, carrier.team); record.compare(120, `expected.${side}.end`, last.match.phase, 'matchEnd'); }
    if (spec.kind === 'own-goal') record.compare(120, `expected.${side}.ownGoal`, last.match.phase, 'playing');
    if (spec.kind === 'pass-catch') record.compare(120, `expected.${side}.catch`, last.match.ball.holderId, receiver.id);
    if (['pass-min', 'pass-full', 'pass-return'].includes(spec.kind)) record.compare(120, `expected.${side}.return`, last.match.ball.state, 'idle');
    if (spec.kind === 'pass-disabled') record.compare(120, `expected.${side}.retained`, last.match.ball.holderId, carrier.id);
    if (['carrier-death-on-goal', 'pass-on-goal'].includes(spec.kind)) record.compare(1, `expected.${side}.noGoal`, first.match.phase, 'playing');
    if (spec.kind === 'pickup-recovering') {
      record.compare(1, `expected.${side}.pickupDuringRecovery`, first.match.ball.holderId, carrier.id);
      record.compare(1, `expected.${side}.recoveryPreserved`, first.actors.find(c => c.id === carrier.id)!.phase, 'recovering');
    }
    if (spec.kind === 'healing') {
      record.compare(1, `expected.${side}.damageDelay`, first.actors.find(c => c.id === carrier.id)!.healDelay, .1);
      record.compare(120, `expected.${side}.healed`, last.actors.find(c => c.id === carrier.id)!.hp, 3, 1e-9);
    }
    if (['pass-min', 'pass-full'].includes(spec.kind)) record.compare(2, `expected.${side}.releaseSpeed`, frames[1][side].match.ball.vel.z, charge ? 26 : 9);
    if (spec.kind === 'round-reset') {
      record.compare(1, `expected.${side}.round`, first.match.roundNumber, 2);
      record.compare(1, `expected.${side}.deadStaysDead`, first.actors[1].hp, 0);
      record.compare(1, `expected.${side}.respawnPreserved`, first.actors[1].respawn, 1);
      record.compare(1, `expected.${side}.injuryPreserved`, first.actors[0].hp, 1);
    }
  }
  if (['pickup-goal', 'winner'].includes(spec.kind)) record.compare(ticks, 'expected.oneGoalNotification', stats, 1);
  if (spec.kind === 'round-reset') record.compare(ticks, 'expected.oneReset', resets, 1);
  return { name: `${spec.kind}/${spec.carrier}/${spec.mirror}/${spec.reverse}/${spec.map?.id ?? 'default'}`,
    boundary: 'objective-functions', ticks, ...record.result(), frames };
}
export const runObjectiveParity = () => OBJECTIVE_PARITY_CASES.map(c => runObjectiveParityTrace(c));
