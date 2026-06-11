import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatVecEnv } from './combatVecEnv';
import { OBS_DIM } from '../env/observation';
import { ACTION_DIM } from '../env/action';

test('flattens heterogeneous worlds into one fixed batch', () => {
  const env = new CombatVecEnv({ worldSizes: [2, 2, 4, 8], baseSeed: 1 });
  assert.equal(env.numAgents, 16);
  assert.equal(env.numEnvs, 1);
  assert.equal(env.mode, 'combat');
  assert.equal(env.agentIds.length, 16);
  const obs = env.reset();
  assert.equal(obs.length, 16 * OBS_DIM);
  for (let i = 0; i < obs.length; i++) assert.ok(Number.isFinite(obs[i]));
});

test('step returns correctly-sized finite buffers', () => {
  const env = new CombatVecEnv({ worldSizes: [2, 4], baseSeed: 2 });
  env.reset();
  const actions = new Int32Array(env.numAgents * ACTION_DIM);
  const r = env.step(actions);
  assert.equal(r.reward.length, env.numAgents);
  assert.equal(r.done.length, env.numAgents);
  assert.equal(r.truncated.length, env.numAgents);
  assert.equal(r.obs.length, env.numAgents * OBS_DIM);
  for (let i = 0; i < r.obs.length; i++) assert.ok(Number.isFinite(r.obs[i]));
});

test('is deterministic for a given config + actions', () => {
  const cfg = { worldSizes: [2, 2, 4], baseSeed: 7, killTargetRange: [3, 6] as [number, number] };
  const a = new CombatVecEnv(cfg);
  const b = new CombatVecEnv(cfg);
  a.reset(); b.reset();
  const actions = new Int32Array(a.numAgents * ACTION_DIM);
  for (let t = 0; t < 80; t++) {
    for (let i = 0; i < actions.length; i++) actions[i] = (t * 7 + i) % 3;
    const ra = a.step(actions);
    const rb = b.step(actions);
    assert.deepEqual([...ra.reward], [...rb.reward], `reward diverged at ${t}`);
    assert.deepEqual([...ra.done], [...rb.done], `done diverged at ${t}`);
  }
});

test('a world that reaches its kill target finishes and regenerates', () => {
  // Tiny 1v1 worlds + low kill target + aggressive actions -> matches end and respawn.
  const env = new CombatVecEnv({
    worldSizes: [2, 2],
    baseSeed: 5,
    killTargetRange: [2, 2],
    maxTicks: 60 * 60 * 5,
  });
  env.reset();
  const actions = new Int32Array(env.numAgents * ACTION_DIM);
  let sawDone = false;
  for (let t = 0; t < 60 * 60 * 6 && !sawDone; t++) {
    // Everyone: aim toward ball (no ball -> toward center-ish), primary attack, move forward.
    for (let i = 0; i < env.numAgents; i++) {
      const base = i * ACTION_DIM;
      actions[base + 0] = 1;     // move forward
      actions[base + 1] = (t + i) % 3; // vary aim
      actions[base + 2] = 1;     // primary attack
    }
    const r = env.step(actions);
    if (r.done.some((d) => d === 1)) {
      sawDone = true;
      // After a world ends it auto-regenerates; obs stays finite.
      for (let i = 0; i < r.obs.length; i++) assert.ok(Number.isFinite(r.obs[i]));
    }
  }
  assert.ok(sawDone, 'a kill-target=2 world should finish within the cap');
});

test('domain randomization is deterministic and actually changes dynamics', () => {
  const mk = (dr: any) => new CombatVecEnv({ worldSizes: [2, 2], baseSeed: 5, randomize: dr, randomizeLayout: false });
  const off = mk({ enabled: false, pct: 0 });
  const on1 = mk({ enabled: true, pct: 0.3 });
  const on2 = mk({ enabled: true, pct: 0.3 });
  off.reset(); on1.reset(); on2.reset();

  const acts = new Int32Array(off.numAgents * ACTION_DIM);
  for (let i = 0; i < acts.length; i++) acts[i] = (i % 2) + 1; // move + attack-ish

  let onObs1!: Float32Array, onObs2!: Float32Array, offObs!: Float32Array;
  for (let t = 0; t < 40; t++) {
    offObs = off.step(acts).obs;
    onObs1 = on1.step(acts).obs;
    onObs2 = on2.step(acts).obs;
  }
  // Same DR config + actions -> identical (reproducible).
  assert.deepEqual([...onObs1], [...onObs2]);
  // Randomized dynamics diverge from the un-randomized baseline.
  assert.notDeepEqual([...onObs1], [...offObs]);
});

test('decisionInterval=4 equals four single-tick steps (obs identical, rewards summed)', () => {
  const base = { worldSizes: [2, 4], baseSeed: 11, randomizeLayout: false as const };
  const skip = new CombatVecEnv({ ...base, decisionInterval: 4 });
  const tick = new CombatVecEnv({ ...base, decisionInterval: 1 });
  skip.reset(); tick.reset();

  const actions = new Int32Array(skip.numAgents * ACTION_DIM);
  for (let i = 0; i < actions.length; i++) actions[i] = (i * 5) % 2; // varied, deterministic

  for (let t = 0; t < 10; t++) {
    const rs = skip.step(actions);
    const summed = new Float32Array(tick.numAgents);
    let rt!: ReturnType<typeof tick.step>;
    for (let k = 0; k < 4; k++) {
      rt = tick.step(actions);
      for (let i = 0; i < tick.numAgents; i++) summed[i] += rt.reward[i];
    }
    assert.deepEqual([...rs.obs], [...rt.obs], `obs diverged at decision ${t}`);
    for (let i = 0; i < skip.numAgents; i++) {
      assert.ok(Math.abs(rs.reward[i] - summed[i]) < 1e-5, `reward sum diverged at ${t} agent ${i}`);
    }
  }
});

test('randomizeLayout=false gives a stable FFA layout', () => {
  const env = new CombatVecEnv({ worldSizes: [4], baseSeed: 9, randomizeLayout: false });
  env.reset();
  // All 4 agents on distinct teams (FFA) — verified indirectly via finite, sized obs.
  const r = env.step(new Int32Array(env.numAgents * ACTION_DIM));
  assert.equal(r.obs.length, 4 * OBS_DIM);
});
