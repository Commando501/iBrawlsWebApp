import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeFrame,
  FrameDecoder,
  OPCODE,
  buildStepRequest,
  parseStepRequest,
  buildStepResponse,
  parseStepResponse,
  bytesToF32,
  f32Bytes,
} from './protocol';
import { runServer, type Transport } from './main';
import { VecEnv } from './vecEnv';
import { OBS_DIM } from '../env/observation';
import { ACTION_DIM } from '../env/action';

test('frame decoder reassembles split and coalesced frames', () => {
  const a = writeFrame(new Uint8Array([1, 2, 3]));
  const b = writeFrame(new Uint8Array([9]));
  const dec = new FrameDecoder();
  // Feed byte-by-byte (worst-case fragmentation).
  const all = new Uint8Array(a.length + b.length);
  all.set(a, 0); all.set(b, a.length);
  const payloads: Uint8Array[] = [];
  for (let i = 0; i < all.length; i++) {
    dec.push(all.subarray(i, i + 1));
    let p: Uint8Array | null;
    while ((p = dec.next())) payloads.push(p);
  }
  assert.equal(payloads.length, 2);
  assert.deepEqual([...payloads[0]], [1, 2, 3]);
  assert.deepEqual([...payloads[1]], [9]);
});

test('step request action block round-trips', () => {
  const actions = Int32Array.from([0, 1, 2, 8, 3, 1, 99, -2]);
  const payload = buildStepRequest(actions);
  assert.equal(payload[0], OPCODE.STEP);
  const back = parseStepRequest(payload, actions.length);
  assert.deepEqual([...back], [...actions]);
});

test('step response blocks round-trip incl. truncation + terminal obs (Verification #4)', () => {
  const n = 2;
  const obsDim = 3;
  const obs = Float32Array.from([0.5, -0.25, 1, 0, -1.5, 0.75]);
  const reward = Float32Array.from([0.1, -0.2]);
  const done = Uint8Array.from([0, 1]);
  const truncated = Uint8Array.from([0, 1]); // agent 1 was truncated
  const terminalObs = [null, Float32Array.from([9, 8, 7])];
  const payload = buildStepResponse(obs, reward, done, truncated, terminalObs, obsDim);
  const r = parseStepResponse(payload, n, obsDim);
  assert.deepEqual([...r.obs].map((x) => Math.round(x * 1e4)), [...obs].map((x) => Math.round(x * 1e4)));
  assert.deepEqual([...r.reward].map((x) => Math.round(x * 1e4)), [...reward].map((x) => Math.round(x * 1e4)));
  assert.deepEqual([...r.done], [...done]);
  assert.deepEqual([...r.truncated], [...truncated]);
  assert.equal(r.terminalObs.size, 1);
  assert.deepEqual([...r.terminalObs.get(1)!], [9, 8, 7]);
});

test('step response can append aggregate reward components', () => {
  const payload = buildStepResponse(
    Float32Array.from([0, 0]),
    Float32Array.from([1]),
    Uint8Array.from([0]),
    Uint8Array.from([0]),
    [null],
    2,
    Float32Array.from([0.5, -0.25, -1])
  );
  const r = parseStepResponse(payload, 1, 2, 3);
  assert.deepEqual([...r.rewardComponents], [0.5, -0.25, -1]);
});

test('float32 byte round-trip is exact for representable values', () => {
  const a = Float32Array.from([0, 1, -1, 0.5, 12345.0]);
  assert.deepEqual([...bytesToF32(f32Bytes(a), a.length)], [...a]);
});

test('VecEnv reset/step produce correctly-sized finite buffers', () => {
  const env = new VecEnv({ numEnvs: 4, baseSeed: 1 });
  const obs = env.reset();
  assert.equal(obs.length, env.numEnvs * env.numAgents * OBS_DIM);
  for (let i = 0; i < obs.length; i++) assert.ok(Number.isFinite(obs[i]));

  const actions = new Int32Array(env.numEnvs * env.numAgents * ACTION_DIM); // all idle/zero
  const r = env.step(actions);
  assert.equal(r.reward.length, env.numEnvs * env.numAgents);
  assert.equal(r.done.length, env.numEnvs * env.numAgents);
  assert.equal(r.obs.length, obs.length);
});

test('VecEnv is deterministic for a given config + actions', () => {
  const cfg = { numEnvs: 3, baseSeed: 42 };
  const e1 = new VecEnv(cfg);
  const e2 = new VecEnv(cfg);
  e1.reset(); e2.reset();
  const actions = new Int32Array(e1.numEnvs * e1.numAgents * ACTION_DIM);
  for (let t = 0; t < 50; t++) {
    for (let i = 0; i < actions.length; i++) actions[i] = (t + i) % 2; // varied but identical
    const r1 = e1.step(actions);
    const r2 = e2.step(actions);
    assert.deepEqual([...r1.reward], [...r2.reward], `reward diverged at ${t}`);
    assert.deepEqual([...r1.done], [...r2.done], `done diverged at ${t}`);
  }
});

test('VecEnv decisionInterval advances N ticks per step and accumulates reward', () => {
  const skip = new VecEnv({ numEnvs: 1, baseSeed: 3, decisionInterval: 5 });
  const tick = new VecEnv({ numEnvs: 1, baseSeed: 3, decisionInterval: 1 });
  skip.reset(); tick.reset();
  const actions = new Int32Array(skip.numEnvs * skip.numAgents * ACTION_DIM);
  for (let i = 0; i < actions.length; i++) actions[i] = i % 2;

  const rs = skip.step(actions);
  assert.equal(skip.getState(0).tick, 5, 'one decision should advance 5 sim ticks');

  const summed = new Float32Array(tick.numEnvs * tick.numAgents);
  let rt!: ReturnType<typeof tick.step>;
  for (let k = 0; k < 5; k++) {
    rt = tick.step(actions);
    for (let i = 0; i < summed.length; i++) summed[i] += rt.reward[i];
  }
  assert.deepEqual([...rs.obs], [...rt.obs]);
  for (let i = 0; i < summed.length; i++) {
    assert.ok(Math.abs(rs.reward[i] - summed[i]) < 1e-5, `reward sum diverged for agent ${i}`);
  }
});

test('VecEnv auto-resets a finished match and signals done', () => {
  // Built-in heuristic on both teams, goal target 1 -> a quick, terminating match.
  const env = new VecEnv({
    numEnvs: 1,
    baseSeed: 5,
    settings: { grifballGoalTarget: 1 },
    builtinAgents: Array.from({ length: 8 }, (_, i) => i),
    maxTicks: 60 * 60 * 5,
  });
  env.reset();
  const actions = new Int32Array(env.numEnvs * env.numAgents * ACTION_DIM);
  let sawDone = false;
  for (let t = 0; t < 60 * 60 * 5 && !sawDone; t++) {
    const r = env.step(actions);
    if (r.done.some((d) => d === 1)) {
      sawDone = true;
      // On done, a terminal obs is captured and the env has auto-reset.
      assert.ok(r.info.terminalObs.every((o) => o !== null), 'terminal obs captured for all agents');
      // Fresh match -> back to countdown.
      assert.equal(env.getState(0).match.phase, 'countdown');
    }
  }
  assert.ok(sawDone, 'a goalTarget=1 match should finish within the cap');
});

/** Collects frames a server writes; lets a test feed request payloads. */
class MemTransport implements Transport {
  private cb: ((c: Uint8Array) => void) | null = null;
  readonly out: Uint8Array[] = [];
  closed = false;
  private readonly dec = new FrameDecoder();
  onData(cb: (c: Uint8Array) => void) { this.cb = cb; }
  write(frame: Uint8Array) { this.dec.push(frame); let p; while ((p = this.dec.next())) this.out.push(p); }
  close() { this.closed = true; }
  feed(payload: Uint8Array) { this.cb?.(writeFrame(payload)); }
}

test('runServer drives a full HELLO/RESET/STEP/CLOSE handshake end-to-end', () => {
  const t = new MemTransport();
  runServer(t);

  // HELLO with config.
  const cfgJson = new TextEncoder().encode(
    JSON.stringify({ numEnvs: 2, baseSeed: 1, decisionInterval: 3 }));
  const hello = new Uint8Array(1 + cfgJson.length);
  hello[0] = OPCODE.HELLO; hello.set(cfgJson, 1);
  t.feed(hello);

  assert.equal(t.out.length, 1);
  assert.equal(t.out[0][0], OPCODE.HELLO);
  const header = JSON.parse(new TextDecoder().decode(t.out[0].subarray(1)));
  assert.equal(header.obsDim, OBS_DIM);
  assert.equal(header.numEnvs, 2);
  assert.equal(header.decisionInterval, 3);
  const count = header.numEnvs * header.numAgents;

  // RESET.
  t.feed(new Uint8Array([OPCODE.RESET]));
  assert.equal(t.out.length, 2);
  assert.equal(t.out[1].length, count * header.obsDim * 4);

  // STEP with all-zero actions.
  const actions = new Int32Array(count * header.actionDim);
  t.feed(buildStepRequest(actions));
  assert.equal(t.out.length, 3);
  const resp = parseStepResponse(t.out[2], count, header.obsDim);
  assert.equal(resp.obs.length, count * header.obsDim);
  assert.equal(resp.reward.length, count);
  assert.equal(resp.done.length, count);
  assert.equal(resp.truncated.length, count);

  // CLOSE.
  t.feed(new Uint8Array([OPCODE.CLOSE]));
  assert.ok(t.closed);
});
