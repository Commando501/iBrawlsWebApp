import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION_PARITY_CASES } from './grifballMotionParity';
import { LUNGE_PARITY_ACTORS, runLungeParityTrace } from './grifballLungeParity';
import { lungeFixture } from './grifballLungeFixture';
import { createMatch } from '../../src/sim/factory';
import { stepCombatantWeapons, respawnCombatant } from '../../src/sim/weapons';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { placeCombatantsAtSpawns } from '../../src/sim/grifball';

for (const { id, targetId } of LUNGE_PARITY_ACTORS) for (const observer of [false, true]) for (const spec of MOTION_PARITY_CASES) {
  test(`motion parity ${id}->${targetId} observer=${observer} ${spec.name}`, () => {
    const trace = runLungeParityTrace(spec, id, observer, 'live-roster-v2', targetId);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
}

for (const id of ['main_ai', 'bot_2']) for (const observer of [false, true]) {
  test(`scripted prelude plus flight integrates airborne displacement once: ${id} observer=${observer}`, () => {
    const f = lungeFixture(id, observer);
    f.bot.pos.y = 2; f.bot.vel.y = 6; f.bot.isJumping = true; f.target.pos.z = 20;
    for (let tick = 1; tick <= 2; tick++) {
      f.gravityPrelude(f.bot); f.flight();
      assert.ok(Math.abs(f.bot.pos.z - tick * .4) < 1e-12);
      assert.ok(Math.abs(f.bot.vel.y - (6 - tick * .3)) < 1e-12);
      const expectedY = tick === 1 ? 2.095 : 2.185;
      assert.ok(Math.abs(f.bot.pos.y - expectedY) < 1e-12);
    }
  });
}

function airborneMatch() {
  const s = createMatch({ seed: 81, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 } });
  s.match.phase = 'playing'; const [c, target] = s.combatants;
  c.pos = { x: 0, y: 2, z: 0 }; c.vel.y = 20; c.isJumping = true; c.grounded = false;
  c.weapon = 'sword'; c.weaponReadyTimer = 0; c.lungeTargetId = target.id;
  c.lungeAimDirection = { x: 0, y: 3, z: 4 }; target.pos = { x: 0, y: 0, z: 20 };
  return s;
}

test('v2 normalizes and consumes a supplied 3D heading, preserving faster upward momentum', () => {
  const s = airborneMatch(), c = s.combatants[0];
  stepCombatantWeapons(s, c, { ...idleAction(), attackSecondary: true }, s.settings, 0, []);
  assert.deepEqual(c.lungeDir, { x: 0, y: .6, z: .8 });
  assert.equal(c.lungeAimDirection, undefined); assert.equal(c.vel.y, 20); assert.equal(c.isJumping, true);
  for (let tick = 0; tick < 180; tick++) stepSimulation(s, {});
  c.yaw = Math.PI / 2;
  stepCombatantWeapons(s, c, { ...idleAction(), attackSecondary: true }, s.settings, 0, []);
  assert.ok(Math.abs(c.lungeDir.x - 1) < 1e-12); assert.equal(c.lungeDir.y, 0);
});

test('airborne committed heading, vertical momentum and fall completion survive JSON restoration', () => {
  const s = airborneMatch(), c = s.combatants[0];
  stepCombatantWeapons(s, c, { ...idleAction(), attackSecondary: true }, s.settings, 0, []);
  for (let tick = 0; tick < 4; tick++) stepSimulation(s, {});
  const restored = JSON.parse(JSON.stringify(s));
  for (let tick = 0; tick < 180; tick++) {
    stepSimulation(s, {}); stepSimulation(restored, {}); assert.deepEqual(restored, s);
  }
  assert.equal(c.isLunging, false); assert.equal(c.isJumping, false); assert.equal(c.pos.y, 0);
});

test('invalid v2 headings fail before mutating the committed weapon state', () => {
  for (const direction of [{ x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 1 }, { x: 0, y: Infinity, z: 1 }]) {
    const s = airborneMatch(), c = s.combatants[0]; c.lungeAimDirection = direction;
    const before = structuredClone(c);
    assert.throws(() => stepCombatantWeapons(s, c, { ...idleAction(), attackSecondary: true }, s.settings, 0, []), /finite and nonzero/);
    assert.deepEqual(c, before);
  }
});

test('respawn and round reset clear unconsumed v2 headings', () => {
  const s = airborneMatch(), c = s.combatants[0];
  respawnCombatant(s, c, s.settings); assert.equal(c.lungeAimDirection, undefined);
  c.lungeAimDirection = { x: 1, y: 0, z: 0 };
  placeCombatantsAtSpawns(s, s.settings); assert.equal(c.lungeAimDirection, undefined);
});

test('v1 flight ignores the optional v2 heading', () => {
  for (const execution of ['legacy-v1', 'live-player-v1', 'live-roster-v1'] as const) {
    const s = airborneMatch(); s.combatExecution = execution;
    const baseline = structuredClone(s); delete baseline.combatants[0].lungeAimDirection;
    for (let tick = 0; tick < 120; tick++) {
      for (const match of [s, baseline]) stepSimulation(match, { [match.combatants[0].id]: {
        ...idleAction(), attackSecondary: tick === 0,
      } });
      const normalized = structuredClone(s); delete normalized.combatants[0].lungeAimDirection;
      assert.deepEqual(normalized, baseline);
    }
  }
});
