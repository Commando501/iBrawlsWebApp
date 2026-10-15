import test from 'node:test';
import { createMatch } from '../../src/sim/factory';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { observeSimGrifballSpace, createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import assert from 'node:assert/strict';
import { runExecutionParityTrace, PARITY_TRACE_CASES } from './grifballExecutionParity';

for (const [name, hitTick] of [['sword-hit-recovery', 7], ['punch-hit-recovery', 23]] as const) {
  test(`${name}: damage and recovery agree with production live functions`, () => {
    const trace = runExecutionParityTrace(name);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
    assert.equal(trace.frames.find(f => f.live.targetHp === 0)?.tick, hitTick);
    assert.equal(trace.frames.find(f => f.headless.targetHp === 0)?.tick, hitTick);
  });
}

for (const c of PARITY_TRACE_CASES) {
  test(`player execution parity: ${c.name}`, () => {
    const trace = runExecutionParityTrace(c.actionTrace, c.options);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
    if (c.hits !== undefined) {
      assert.equal(c.options!.targetHp! - trace.frames.at(-1)!.live.targetHp, c.hits, 'fixture must exercise the expected live hits/misses');
    }
  });
}

test('default execution preserves legacy training dynamics; corrected execution survives a mid-attack snapshot', () => {
  const legacy = createMatch({ seed: 7 });
  const explicit = createMatch({ seed: 7, combatExecution: 'legacy-v1' });
  assert.equal(legacy.combatExecution, undefined);
  for (const state of [legacy, explicit]) {
    state.match.phase = 'playing';
    state.combatants[0].weapon = 'sword';
  }
  for (let i = 0; i < 120; i++) {
    const action = { player: { ...idleAction(), attackPrimary: true } };
    stepSimulation(legacy, action); stepSimulation(explicit, action);
    const { combatExecution: _, ...withoutVersion } = explicit;
    assert.deepEqual(legacy, withoutVersion);
  }
  const state = createMatch({ seed: 8, combatExecution: 'live-player-v1' });
  state.match.phase = 'playing'; state.combatants[0].weapon = 'sword';
  for (let i = 0; i < 5; i++) stepSimulation(state, { player: { ...idleAction(), attackPrimary: true } });
  const restored = JSON.parse(JSON.stringify(state));
  assert.ok(restored.combatants[0].weaponPhaseElapsed > 0);
  for (let i = 0; i < 120; i++) {
    const action = { player: { ...idleAction(), attackPrimary: true } };
    stepSimulation(state, action); stepSimulation(restored, action);
    assert.deepEqual(state, restored);
  }
});

test('tactical observations use the selected execution model and do not forecast a second slash hit', () => {
  const sim = createMatch({ seed: 9, combatExecution: 'live-player-v1' });
  sim.match.phase = 'playing';
  const c = sim.combatants[0]; c.weapon = 'sword';
  const observation = () => observeSimGrifballSpace(c, sim.settings, sim.combatExecution);
  assert.equal(observation().attackIn, sim.settings.swordSlashSpeed * .5);
  for (let i = 0; i < 6; i++) stepSimulation(sim, { player: { ...idleAction(), attackPrimary: i === 0 } });
  assert.ok(Math.abs(observation().attackIn - .01) < 1e-9);
  stepSimulation(sim, {});
  assert.ok(observation().attackIn > .8, 'after the midpoint, next damage requires finishing and recovering');
  const snapshot = createSimGrifballTacticalSnapshot(sim, { scriptedBots: {} });
  assert.equal(snapshot.players.find(p => p.id === c.id)!.space.attackIn, observation().attackIn);
  c.weapon = 'ball'; c.weaponState = 'windup'; c.attackKind = 'punch'; c.weaponTimer = .1;
  assert.equal(observation().attackIn, .1 + .12);
  c.weaponState = 'active'; c.weaponTimer = .06;
  assert.equal(observation().attackIn, .06);
});
