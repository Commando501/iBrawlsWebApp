import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import type { ValidationCase } from '../../src/game/grifballValidation/types';
import { createComposedValidationMatch, createComposedMatchStepper } from './grifballComposedMatch';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { hashState } from '../../src/sim/hash';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { updateGrifballMatchTimers } from '../../src/components/grifball/matchTimers';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createOfflineBotCombatant } from '../../src/game/roster';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';

async function inputs(roster: ValidationCase['roster'] = 'scripted-1v1', seed = 101, mirrored = false, simulationSeconds?: number) {
  const manifest = createSuiteManifest('standard');
  manifest.cases = [{ ...(manifest.cases.find(c => c.mode === 'match' && c.roster === roster) ??
    manifest.cases.find(c => c.mode === 'match'))!, roster, seeds: [seed], mirrored }];
  if (simulationSeconds !== undefined) manifest.cases[0].simulationSeconds = simulationSeconds;
  const plan = await createSuitePlan(manifest, { commit: null, dirty: null, workingTreeHash: null, scope: [] });
  const job = plan.jobs.find(j => j.variant === 'candidate' && j.mirrored === mirrored)!;
  return { fixture: plan.cases[0], job };
}
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) <= 1e-6, `${label}: ${a} != ${b}`);

for (const roster of ['scripted-1v1', 'scripted-3v4', 'scripted-4v4', 'local-4v4'] as const) for (const mirrored of [false, true])
  test(`composed match uses production starting roster and countdown ${roster}/${mirrored}`, async () => {
    const { fixture, job } = await inputs(roster, 101, mirrored), live = createAutonomousValidationRuntime(fixture, job);
    const { checkpoint } = createComposedValidationMatch(fixture, job), state = checkpoint.state;
    const step = createComposedMatchStepper(fixture, job, checkpoint);
    try {
      for (let tick = 0; tick <= 180; tick++) {
        assert.equal(state.match.phase, live.state.grifball.phase);
        for (const actor of live.state.otherPlayers.values()) {
          const sim = state.combatants.find(c => c.id === actor.id)!;
          assert.equal(sim.team, actor.team); assert.equal(sim.hp, actor.hp); assert.equal(sim.weapon, actor.activeWeapon);
          for (const axis of ['x', 'y', 'z'] as const) near(sim.pos[axis], actor.pos[axis], `${tick}/${actor.id}/${axis}`);
          near(sim.invulnerabilityTimer, actor.invulnerabilityTimer, 'initial protection expires once per frame');
          if (tick) near(checkpoint.memories[actor.id].swayTimer, actor.aiSwayTimer!, 'seeded default initialization');
        }
        if (tick < 180) { step(); live.runtime.step(); }
      }
      const snap = createSimGrifballTacticalSnapshot(state, { scriptedBots: Object.fromEntries(fixture.roster.map(a => [a.id, 'normal'])) });
      assert.equal(snap.players.some(p => p.id === 'player'), roster === 'local-4v4');
    } finally { live.runtime.dispose(); }
  });

for (const seed of [101, 102]) for (const mirrored of [false, true])
  test(`autonomous complete 1v1 matches production and restored continuation ${seed}/${mirrored}`, async t => {
    const { fixture, job } = await inputs('scripted-1v1', seed, mirrored), live = createAutonomousValidationRuntime(fixture, job);
    const { checkpoint } = createComposedValidationMatch(fixture, job);
    let restored = structuredClone(checkpoint), replay = createComposedMatchStepper(fixture, job, restored);
    const step = createComposedMatchStepper(fixture, job, checkpoint);
    let kills = 0, revivals = 0, resets = 0;
    try {
      while (checkpoint.state.tick < job.simulationTicks && checkpoint.state.match.phase !== 'matchEnd') {
        const dead = new Set(checkpoint.state.combatants.filter(c => !c.alive).map(c => c.id));
        const event = step()!, repeated = replay(); live.runtime.step();
        assert.deepEqual(repeated, event); assert.deepEqual(restored, checkpoint, 'complete restored continuation');
        kills += event.kills.length; resets += Number(event.roundReset);
        revivals += checkpoint.state.combatants.filter(c => c.alive && dead.has(c.id)).length;
        const tick = checkpoint.state.tick;
        assert.equal(checkpoint.state.match.phase, live.state.grifball.phase, `phase at ${tick}`);
        assert.equal(checkpoint.state.match.ball.holderId, live.state.grifball.ball.holderId, `holder at ${tick}`);
        for (const actor of live.state.otherPlayers.values()) {
          const sim = checkpoint.state.combatants.find(c => c.id === actor.id)!;
          assert.equal(sim.hp, actor.hp, `hp at ${tick}`); assert.equal(sim.weapon, actor.activeWeapon, `weapon at ${tick}`);
          for (const axis of ['x', 'y', 'z'] as const) near(sim.pos[axis], actor.pos[axis], `${tick}/${actor.id}/${axis}`);
        }
        if ([1, 180, 900, 1800].includes(tick) || event.roundReset) {
          restored = structuredClone(checkpoint); replay = createComposedMatchStepper(fixture, job, restored);
        }
      }
      assert.equal(checkpoint.state.match.phase, 'matchEnd', 'simulation cap must not count as a finished match');
      const result = await live.runtime.done;
      assert.equal(result.termination, 'match-end'); assert.equal(result.check.verdict, 'pass');
      assert.equal(result.end!.tick, checkpoint.state.tick); assert.equal(resets, 1);
      assert.ok(kills > 0 && revivals > 0, 'the complete match must include combat and revival');
      const before = structuredClone(checkpoint); assert.equal(step(), null); assert.deepEqual(checkpoint, before);
      t.diagnostic(JSON.stringify({ seed, mirrored, ticks: checkpoint.state.tick, kills, revivals, resets }));
    } finally { live.runtime.dispose(); }
  });

test('observer cannot consume a spawn, revive, take input or disappear from the state hash', async () => {
  const { fixture, job } = await inputs(), { checkpoint } = createComposedValidationMatch(fixture, job);
  const state = checkpoint.state, observer = state.combatants[0];
  state.match.phase = 'scored'; state.match.phaseTimer = 99; observer.respawnTimer = .01;
  const before = structuredClone(observer), active = { ...state, localPlayerIsObserver: false };
  assert.notEqual(hashState(state), hashState(active));
  const event = stepSimulation(state, { player: { ...idleAction(), jump: true, pickup: true, attackPrimary: true, moveZ: 1 } }, { settings: state.settings });
  assert.equal(event.roundReset, true); assert.deepEqual(observer, before);
  const first = state.combatants[1], expected = fixture.map.teamSpawns![first.team][0];
  near(first.pos.x, expected.x, 'observer must not reserve first team spawn');
  near(first.pos.z, expected.z, 'observer must not reserve first team spawn');
  observer.alive = true; observer.hp = 1;
  assert.throws(() => stepSimulation(state, {}, { settings: state.settings }), /observer camera/);
});

test('simulation cap remains unfinished and foreign checkpoints are rejected', async () => {
  const { fixture, job } = await inputs(), short = { ...job, simulationTicks: 2 };
  const { checkpoint } = createComposedValidationMatch(fixture, short), step = createComposedMatchStepper(fixture, short, checkpoint);
  step(); step(); assert.equal(step(), null); assert.equal(checkpoint.state.tick, 2);
  assert.notEqual(checkpoint.state.match.phase, 'matchEnd');
  assert.throws(() => createComposedMatchStepper(fixture, { ...job, id: 'different-job' }, checkpoint), /frozen job/);
});

for (const multiplayer of [false, true]) for (const controller of ['ai', 'remote'] as const)
  test(`general match clocks retain remote ownership ${multiplayer}/${controller}`, () => {
    const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: DEFAULT_ADMIN_SETTINGS, isMultiplayer: multiplayer, multiplayerRole: null });
    const bot = createOfflineBotCombatant({ id: 'test', team: 'blue', playerName: 'test', hue: 0,
      spawnPos: new THREE.Vector3(), yaw: 0, difficulty: 'normal', settings: state.settings });
    bot.controller = controller; bot.respawnTimer = 3; bot.invulnerabilityTimer = 1;
    state.otherPlayers.set(bot.id, bot); updateGrifballMatchTimers(state, undefined, .1);
    assert.equal(bot.respawnTimer, !multiplayer && controller === 'ai' ? 3 : 2.9);
    assert.equal(bot.invulnerabilityTimer, !multiplayer && controller === 'ai' ? 1 : .9);
  });

test('production full frame spends an AI respawn delay only once', async () => {
  const { fixture, job } = await inputs(), live = createAutonomousValidationRuntime(fixture, job);
  try {
    const bot = [...live.state.otherPlayers.values()][0]; bot.hp = 0; bot.respawnTimer = 3;
    for (let tick = 0; tick < 120; tick++) live.runtime.step();
    assert.equal(bot.hp, 0, 'three-second respawn must still be pending after two seconds');
    near(bot.respawnTimer, 1, 'remaining respawn delay');
    for (let tick = 0; tick < 61; tick++) live.runtime.step();
    assert.ok(bot.hp > 0, 'actor must revive when the full delay elapses');
    near(bot.invulnerabilityTimer, fixture.mechanics.respawnInvulnerabilityDuration - 1 / 60, 'new shield ticks once');
  } finally { live.runtime.dispose(); }
});

const fullSizeCases = (['scripted-3v4', 'scripted-4v4', 'local-4v4'] as const).flatMap(roster =>
  [101, 102].flatMap(seed => [false, true].map(mirrored => ({ roster, seed, mirrored, seconds: 120 }))));
// Separate frozen extended fixture; the standard cap and its inconclusive verdict stay intact.
fullSizeCases.push({ roster: 'local-4v4', seed: 101, mirrored: false, seconds: 300 });
for (const { roster, seed, mirrored, seconds } of fullSizeCases)
  test(`full-size production comparison retains the real termination ${roster}/${seed}/${mirrored}/${seconds}`, async t => {
    const { fixture, job } = await inputs(roster, seed, mirrored, seconds), live = createAutonomousValidationRuntime(fixture, job);
    const { checkpoint } = createComposedValidationMatch(fixture, job), step = createComposedMatchStepper(fixture, job, checkpoint);
    let restored = seconds === 300 ? structuredClone(checkpoint) : undefined;
    let replay = restored ? createComposedMatchStepper(fixture, job, restored) : undefined;
    let kills = 0, goals = 0, launches = 0, flightEnds = 0;
    try {
      while (checkpoint.state.tick < job.simulationTicks && checkpoint.state.match.phase !== 'matchEnd') {
        const flights = new Set([...live.state.otherPlayers.values()].filter(a => a.isLunging).map(a => a.id));
        const event = step()!; live.runtime.step(); kills += event.kills.length; goals += Number(!!event.goal);
        if (replay) {
          assert.deepEqual(replay(), event); assert.deepEqual(restored, checkpoint, 'extended local restored continuation');
          if (event.roundReset || checkpoint.state.tick === 6700) {
            restored = structuredClone(checkpoint); replay = createComposedMatchStepper(fixture, job, restored);
          }
        }
        const state = checkpoint.state, tick = state.tick;
        assert.equal(state.match.phase, live.state.grifball.phase, `phase at ${tick}`);
        assert.equal(state.match.ball.holderId, live.state.grifball.ball.holderId, `holder at ${tick}`);
        for (const actor of live.state.otherPlayers.values()) {
          const sim = state.combatants.find(c => c.id === actor.id)!;
          if (actor.hp > 0 && (actor.isLunging || flights.has(actor.id))) {
            const memory = checkpoint.memories[actor.id];
            assert.equal(memory.aiState, actor.aiState, `${tick}/${actor.id}/flight state writeback`);
            near(memory.timer ?? 0, actor.aiTimer ?? 0, `${tick}/${actor.id}/flight reload writeback`);
            near(memory.swayTimer, actor.aiSwayTimer ?? 0, `${tick}/${actor.id}/flight sway writeback`);
            if (actor.isLunging && !flights.has(actor.id)) launches++;
            if (!actor.isLunging && flights.has(actor.id)) flightEnds++;
          }
          assert.equal(sim.hp, actor.hp, `${actor.id} hp at ${tick}`); assert.equal(sim.weapon, actor.activeWeapon, `${actor.id} weapon at ${tick}`);
          for (const axis of ['x', 'y', 'z'] as const) near(sim.pos[axis], actor.pos[axis], `${tick}/${actor.id}/${axis}`);
        }
        if (roster === 'local-4v4') for (const axis of ['x', 'y', 'z'] as const)
          near(state.combatants[0].pos[axis], live.state.playerPos[axis], `${tick}/player/${axis}`);
      }
      if (seconds === 300) assert.equal(checkpoint.state.match.phase, 'matchEnd', 'extended local fixture must actually finish');
      const result = await live.runtime.done;
      assert.equal(result.end!.tick, checkpoint.state.tick);
      assert.equal(result.termination, checkpoint.state.match.phase === 'matchEnd' ? 'match-end' : 'simulation-cap');
      assert.equal(result.check.verdict, result.termination === 'match-end' ? 'pass' : 'inconclusive');
      assert.ok(kills > 0, 'full-size run must exercise real combat');
      t.diagnostic(JSON.stringify({ roster, seed, mirrored, seconds, termination: result.termination, ticks: checkpoint.state.tick, kills, goals, launches, flightEnds }));
    } finally { live.runtime.dispose(); }
  });

for (const [roster, ticks] of [['scripted-4v4', 2200], ['local-4v4', 1600]] as const)
  test(`objective stance and mid-swing pickup retain production behavior ${roster}`, async () => {
    const { fixture, job } = await inputs(roster), live = createAutonomousValidationRuntime(fixture, job);
    const { checkpoint } = createComposedValidationMatch(fixture, job), step = createComposedMatchStepper(fixture, job, checkpoint);
    let crouchedObjectiveFrames = 0, pickupDuringSwing = false, kills = 0;
    try {
      for (let tick = 0; tick < ticks; tick++) {
        const event = step()!; live.runtime.step(); kills += event.kills.length;
        for (const actor of live.state.otherPlayers.values()) {
          const sim = checkpoint.state.combatants.find(c => c.id === actor.id)!;
          assert.equal(sim.hp, actor.hp, `${tick}/${actor.id}/hp`);
          assert.equal(sim.isCrouching, actor.isCrouching, `${tick}/${actor.id}/stance`);
          for (const axis of ['x', 'y', 'z'] as const) near(sim.pos[axis], actor.pos[axis], `${tick}/${actor.id}/${axis}`);
          if (sim.isCrouching && event.actorDecisionFrame?.decisions.some(d => d.id === actor.id && d.kind === 'objective')) crouchedObjectiveFrames++;
        }
        const player = checkpoint.state.combatants[0];
        if (roster === 'local-4v4') {
          assert.equal(player.weapon, live.state.activeWeapon); assert.equal(player.hp, live.state.playerHP);
          for (const axis of ['x', 'y', 'z'] as const) near(player.pos[axis], live.state.playerPos[axis], `${tick}/player/${axis}`);
          if (player.hasBall && player.weaponState === 'windup') pickupDuringSwing = true;
        }
      }
      assert.ok(kills > 0, 'trace must include real combat');
      if (roster === 'scripted-4v4') assert.ok(crouchedObjectiveFrames > 0, 'trace must retain crouch through objective steering');
      else assert.ok(pickupDuringSwing, 'trace must include possession during an active swing');
    } finally { live.runtime.dispose(); }
  });
