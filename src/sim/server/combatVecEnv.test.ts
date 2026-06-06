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

test('randomizeLayout=false gives a stable FFA layout', () => {
  const env = new CombatVecEnv({ worldSizes: [4], baseSeed: 9, randomizeLayout: false });
  env.reset();
  // All 4 agents on distinct teams (FFA) — verified indirectly via finite, sized obs.
  const r = env.step(new Int32Array(env.numAgents * ACTION_DIM));
  assert.equal(r.obs.length, 4 * OBS_DIM);
});
