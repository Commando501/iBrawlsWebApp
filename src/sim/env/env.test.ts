import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveSimSettings } from '../factory';
import { stepSimulation, SIM_DT } from '../step';
import { setSimCarrier } from '../grifball';
import {
  encodeObservation,
  OBS_DIM,
  OBS_DIM_V2,
  OBS_LAYOUT,
  MAX_TEAMMATES,
  MAX_OPPONENTS,
  MECHANICS_OBS_KEYS,
  encodeObservationForVersion,
} from './observation';
import {
  decodeAction,
  decodeActionBlock,
  ACTION_DIM,
  ACTION_NVEC,
  yawToFace,
} from './action';
import {
  computeStepRewards,
  computeStepRewardDetails,
  initRewardMemory,
  DEFAULT_REWARD_CONFIG,
} from './reward';
import { buildEnvSpec } from './spec';
import { forwardDir } from '../physics';
import { idleAction } from '../actions';

const settings = resolveSimSettings();

test('observation is fixed-width and finite for every agent', () => {
  const state = createMatch({ seed: 1 });
  const out = new Float32Array(OBS_DIM * state.combatants.length);
  state.combatants.forEach((c, i) => encodeObservation(state, c.id, out, i * OBS_DIM));
  for (let i = 0; i < out.length; i++) {
    assert.ok(Number.isFinite(out[i]), `non-finite at ${i}`);
    assert.ok(out[i] >= -5 && out[i] <= 5, `out of expected range at ${i}: ${out[i]}`);
  }
});

test('encodeObservation writes exactly OBS_DIM and does not touch neighbours', () => {
  const state = createMatch({ seed: 2 });
  const buf = new Float32Array(OBS_DIM + 4).fill(-99);
  encodeObservation(state, state.combatants[0].id, buf, 2);
  assert.equal(buf[0], -99);
  assert.equal(buf[1], -99);
  assert.equal(buf[OBS_DIM + 2], -99);
  assert.equal(buf[OBS_DIM + 3], -99);
});

test('self has-ball flag reflects carrier state', () => {
  const state = createMatch({ seed: 3 });
  const c = state.combatants[0];
  state.match.ball.state = 'held';
  state.match.ball.holderId = c.id;
  setSimCarrier(c, true, settings);
  const out = new Float32Array(OBS_DIM);
  encodeObservation(state, c.id, out, 0);
  const o = OBS_LAYOUT['self_has_ball'].offset;
  assert.equal(out[o], 1);
  // holder relation one-hot = self.
  const h = OBS_LAYOUT['ball_holder_rel'].offset;
  assert.equal(out[h], 1);
});

test('presence masks zero-out absent teammate/opponent slots', () => {
  // 1v1 leaves most slots empty.
  const state = createMatch({ seed: 4, teamSizes: { blue: 1, red: 1 } });
  const self = state.combatants.find((c) => c.team === 'blue')!;
  const out = new Float32Array(OBS_DIM);
  encodeObservation(state, self.id, out, 0);
  const tm = OBS_LAYOUT['teammates'];
  // No teammates in a 1v1 -> entire block zero.
  for (let i = 0; i < tm.size; i++) assert.equal(out[tm.offset + i], 0);
  const opp = OBS_LAYOUT['opponents'];
  // First opponent slot present (mask = 1 at end of slot), rest zero.
  const slotW = opp.size / MAX_OPPONENTS;
  assert.equal(out[opp.offset + slotW - 1], 1, 'first opponent present');
  for (let s = 1; s < MAX_OPPONENTS; s++) {
    assert.equal(out[opp.offset + s * slotW + slotW - 1], 0, `opponent slot ${s} absent`);
  }
  void MAX_TEAMMATES;
});

test('combat opponent slots prioritize nearest hostile threats without changing OBS_DIM', () => {
  const state = createMatch({ seed: 44, mode: 'combat', combat: { teamSizes: [1, 1, 1, 1, 1] } });
  const self = state.combatants[0];
  self.pos = { x: 0, y: 0, z: 0 };
  self.yaw = 0;
  state.combatants[1].pos = { x: 20, y: 0, z: 0 };
  state.combatants[2].pos = { x: 0, y: 0, z: 3 };
  state.combatants[3].pos = { x: -12, y: 0, z: 0 };
  state.combatants[4].pos = { x: 0, y: 0, z: 9 };

  const out = new Float32Array(OBS_DIM);
  encodeObservation(state, self.id, out, 0);
  const opp = OBS_LAYOUT['opponents'];
  const slotW = opp.size / MAX_OPPONENTS;
  assert.equal(OBS_DIM, buildEnvSpec().obsDim);
  assert.equal(out[opp.offset + slotW - 1], 1);
  assert.ok(out[opp.offset] > 0, 'nearest hostile should be in front of self');
  assert.ok(Math.abs(out[opp.offset + 1]) < 0.001, 'nearest hostile should be centered laterally');
});

test('mechanics block is ~0 at nominal settings', () => {
  const state = createMatch({ seed: 1 });
  const out = new Float32Array(OBS_DIM);
  encodeObservation(state, state.combatants[0].id, out, 0);
  const m = OBS_LAYOUT['mechanics'];
  assert.equal(m.size, MECHANICS_OBS_KEYS.length);
  for (let i = 0; i < m.size; i++) {
    assert.ok(Math.abs(out[m.offset + i]) < 1e-6, `${MECHANICS_OBS_KEYS[i]} not nominal`);
  }
});

test('mechanics block reflects a tuned setting (deviation from nominal)', () => {
  // attackRange default 3.2 -> set +50%
  const state = createMatch({ seed: 1, settings: { attackRange: 3.2 * 1.5 } });
  const out = new Float32Array(OBS_DIM);
  encodeObservation(state, state.combatants[0].id, out, 0);
  const m = OBS_LAYOUT['mechanics'];
  const idx = MECHANICS_OBS_KEYS.indexOf('attackRange');
  assert.ok(idx >= 0);
  assert.ok(Math.abs(out[m.offset + idx] - 0.5) < 1e-5, `attackRange dev = ${out[m.offset + idx]}`);
  // an untouched key stays at 0
  const dashIdx = MECHANICS_OBS_KEYS.indexOf('dashDistance');
  assert.ok(Math.abs(out[m.offset + dashIdx]) < 1e-6);
});

test('decodeAction maps factors into an ActionInput', () => {
  const state = createMatch({ seed: 5 });
  const self = state.combatants[0];
  // move=1 (forward), aim=0 (hold), attack=1 (primary), jump=1, dash=0, swap=0
  const a = decodeAction([1, 0, 1, 1, 0, 0], state, self.id);
  assert.equal(a.moveZ, 1);
  assert.equal(a.moveX, 0);
  assert.equal(a.attackPrimary, true);
  assert.equal(a.attackSecondary, false);
  assert.equal(a.jump, true);
  assert.equal(a.aim, self.yaw); // hold keeps current yaw
});

test('decodeAction aim-toward-ball faces the ball', () => {
  const state = createMatch({ seed: 6 });
  const self = state.combatants[0];
  self.pos = { x: 0, y: 0, z: 0 };
  state.match.ball.pos = { x: 5, y: 0.35, z: 0 };
  const a = decodeAction([0, 1, 0, 0, 0, 0], state, self.id); // aim=toward-ball
  // Movement-forward should point at +x (the ball).
  const f = forwardDir(a.aim);
  assert.ok(f.x > 0.99, `forward.x=${f.x} should face +x`);
  assert.ok(Math.abs(f.z) < 0.02, `forward.z=${f.z} ~ 0`);
});

test('decodeAction aim-toward-nearest-enemy faces the closest hostile combatant', () => {
  const state = createMatch({ seed: 61 });
  const self = state.combatants.find((c) => c.team === 'blue')!;
  const enemies = state.combatants.filter((c) => c.team === 'red');
  self.pos = { x: 0, y: 0, z: 0 };
  enemies[0].pos = { x: 8, y: 0, z: 0 };
  enemies[1].pos = { x: 0, y: 0, z: 3 };
  const a = decodeAction([0, 3, 0, 0, 0, 0], state, self.id); // aim=toward-nearest-enemy
  const f = forwardDir(a.aim);
  assert.ok(Math.abs(f.x) < 0.02, `forward.x=${f.x} ~ 0`);
  assert.ok(f.z > 0.99, `forward.z=${f.z} should face nearest +z enemy`);
});

test('out-of-range factors are clamped, dead agents idle', () => {
  const state = createMatch({ seed: 7 });
  const self = state.combatants[0];
  const a = decodeAction([99, -3, 50, 7, 7, 7], state, self.id);
  assert.ok(a.moveZ >= -1 && a.moveZ <= 1);
  self.alive = false;
  const dead = decodeAction([1, 1, 1, 1, 1, 1], state, self.id);
  assert.equal(dead.moveZ, 0);
  assert.equal(dead.attackPrimary, false);
});

test('decodeActionBlock decodes a flat roster block', () => {
  const state = createMatch({ seed: 8 });
  const ids = state.combatants.map((c) => c.id);
  const block = new Int32Array(ids.length * ACTION_DIM);
  // Make agent 1 jump (factor index 3 == jump).
  block[1 * ACTION_DIM + 3] = 1;
  const decoded = decodeActionBlock(block, ids, state);
  assert.equal(decoded[ids[1]].jump, true);
  assert.equal(decoded[ids[0]].jump, false);
});

test('yawToFace round-trips through forwardDir', () => {
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, -0.8]]) {
    const yaw = yawToFace(dx, dz);
    const f = forwardDir(yaw);
    const len = Math.hypot(dx, dz);
    assert.ok(Math.abs(f.x - dx / len) < 1e-6 && Math.abs(f.z - dz / len) < 1e-6);
  }
});

test('reward: scoring a goal rewards the scoring team and penalizes the other', () => {
  const state = createMatch({ seed: 9 });
  state.match.phase = 'playing';
  const carrier = state.combatants.find((c) => c.team === 'blue')!;
  const redPlate = state.goalPlates.find((p) => p.team === 'red')!;
  state.match.ball.state = 'held';
  state.match.ball.holderId = carrier.id;
  setSimCarrier(carrier, true, settings);
  carrier.pos = { x: redPlate.position.x, y: 0, z: redPlate.position.z };

  const mem = initRewardMemory(state);
  const events = stepSimulation(state, {}, { settings });
  assert.equal(events.goal, 'blue');
  const rewards = computeStepRewards(state, events, DEFAULT_REWARD_CONFIG, mem);
  const blue = state.combatants.find((c) => c.team === 'blue')!.id;
  const red = state.combatants.find((c) => c.team === 'red')!.id;
  assert.ok(rewards[blue] > 0.5, `blue reward ${rewards[blue]}`);
  assert.ok(rewards[red] < 0, `red reward ${rewards[red]}`);
});

test('reward: possession gives the holding team a small positive shaping', () => {
  const state = createMatch({ seed: 10 });
  state.match.phase = 'playing';
  const carrier = state.combatants.find((c) => c.team === 'blue')!;
  state.match.ball.state = 'held';
  state.match.ball.holderId = carrier.id;
  setSimCarrier(carrier, true, settings);
  // Warm-up tick so the held ball syncs to the carrier before we baseline progress.
  stepSimulation(state, {}, { settings });
  const mem = initRewardMemory(state);
  // A no-op tick keeps possession with the ball stationary; ensure no goal.
  const events = stepSimulation(state, {}, { settings });
  const rewards = computeStepRewards(state, events, DEFAULT_REWARD_CONFIG, mem);
  const blue = carrier.id;
  const red = state.combatants.find((c) => c.team === 'red')!.id;
  assert.ok(rewards[blue] > rewards[red], 'holder team should out-reward the other');
});

test('reward: wasted actions are penalized and exposed as components', () => {
  const state = createMatch({ seed: 101, teamSizes: { blue: 1, red: 1 } });
  state.mode = 'combat';
  state.match.phase = 'playing';
  const self = state.combatants.find((c) => c.team === 'blue')!;
  self.attackCooldown = 1;
  self.dashCooldownTimer = 1;
  self.isJumping = true;
  self.swapLockoutTimer = 1;
  self.weapon = 'hammer';
  self.weaponState = 'windup';

  const mem = initRewardMemory(state);
  const details = computeStepRewardDetails(
    state,
    { startedPlaying: false, goal: null, pickup: null, roundReset: false, matchEnded: false, kills: [] },
    {
      ...DEFAULT_REWARD_CONFIG,
      timePenalty: 0,
      approach: 0,
      invalidAttack: 0.4,
      invalidDash: 0.3,
      invalidJump: 0.2,
      invalidSwap: 0.1,
    },
    mem,
    { [self.id]: { ...idleAction(), attackPrimary: true, dash: true, jump: true, swapWeapon: true } }
  );
  assert.ok(Math.abs(details.rewards[self.id] + 1) < 1e-9);
  assert.equal(details.components.invalidAttack, -0.4);
  assert.equal(details.components.invalidDash, -0.3);
  assert.equal(details.components.invalidJump, -0.2);
  assert.equal(details.components.invalidSwap, -0.1);
});

test('observation v2 appends full FFA pressure context while v1 remains unchanged', () => {
  const state = createMatch({ seed: 45, mode: 'combat', combat: { teamSizes: [1, 1, 1, 1, 1, 1, 1, 1] } });
  const self = state.combatants[0];
  self.pos = { x: 0, y: 0, z: 0 };
  self.yaw = 0;
  state.combatants[1].pos = { x: 0, y: 0, z: 3 };
  state.combatants[2].pos = { x: 4, y: 0, z: 0 };
  state.combatants[3].pos = { x: 0, y: 0, z: 7 };

  const v1 = new Float32Array(OBS_DIM);
  const v2 = new Float32Array(OBS_DIM_V2);
  encodeObservationForVersion(state, self.id, v1, 0, 1);
  encodeObservationForVersion(state, self.id, v2, 0, 2);

  assert.equal(OBS_DIM_V2, OBS_DIM + 12);
  assert.deepEqual([...v2.slice(0, OBS_DIM)], [...v1]);
  assert.ok(v2[OBS_DIM] > 0, 'nearest hostile should be in front in pressure summary');
  assert.equal(v2[OBS_DIM + 5], 2, 'two hostiles within 4m');
  assert.equal(v2[OBS_DIM + 6], 3, 'three hostiles within 8m');
});

test('env spec exposes consistent dims', () => {
  const spec = buildEnvSpec();
  assert.equal(spec.obsDim, OBS_DIM);
  assert.equal(spec.actionDim, ACTION_DIM);
  assert.deepEqual(spec.actionNvec, ACTION_NVEC);
  assert.equal(spec.obsFields.reduce((n, f) => n + f.size, 0), OBS_DIM);
  // offsets are contiguous and ordered.
  let off = 0;
  for (const f of spec.obsFields) {
    assert.equal(f.offset, off);
    off += f.size;
  }
});

test('env spec exposes observation v2 when requested', () => {
  const spec = buildEnvSpec(2);
  assert.equal(spec.obsDim, OBS_DIM_V2);
  assert.equal(spec.obsFields[spec.obsFields.length - 1].name, 'combat_pressure');
  assert.equal(spec.version, 5);
});
