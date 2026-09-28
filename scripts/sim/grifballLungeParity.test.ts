import test from 'node:test';
import assert from 'node:assert/strict';
import { LUNGE_PARITY_ACTORS, LUNGE_PARITY_CASES, runLungeParityTrace } from './grifballLungeParity';
import { createMatch } from '../../src/sim/factory';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { placeCombatantsAtSpawns } from '../../src/sim/grifball';
import { BOT_PARITY_CASES, runBotExecutionParityTrace } from './grifballBotExecutionParity';

for (const { id, targetId } of LUNGE_PARITY_ACTORS) for (const observer of [false, true]) for (const spec of LUNGE_PARITY_CASES) {
  test(`lunge parity ${id}->${targetId} observer=${observer} ${spec.name}`, () => {
    const trace = runLungeParityTrace(spec, id, observer, 'live-roster-v2', targetId);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
}

for (const spec of BOT_PARITY_CASES) test(`v2 retains stationary roster parity: ${spec.name}`, () => {
  const trace = runBotExecutionParityTrace(spec, 'bot_2', true, 'live-roster-v2');
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 5)));
});

test('v1 lunge dynamics remain compatible with the legacy model', () => {
  const legacy = createMatch({ seed: 1, combatExecution: 'legacy-v1' });
  const v1 = structuredClone(legacy); v1.combatExecution = 'live-roster-v1';
  for (const s of [legacy, v1]) {
    s.match.phase = 'playing'; const c = s.combatants[0]; c.weapon = 'sword'; c.weaponReadyTimer = 0;
  }
  for (let tick = 0; tick < 180; tick++) {
    for (const s of [legacy, v1]) stepSimulation(s, { [s.combatants[0].id]: { ...idleAction(), attackSecondary: tick === 0 } });
    const { combatExecution: _, ...a } = legacy, { combatExecution: __, ...b } = v1;
    assert.deepEqual(a, b);
  }
});

test('committed v2 flight and respawn survive JSON restoration, and round reset clears flight memory', () => {
  const s = createMatch({ seed: 9, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 } });
  s.match.phase = 'playing'; const [c, target] = s.combatants;
  c.pos = { x: 0, y: 0, z: 0 }; c.yaw = 0; target.pos = { x: 0, y: 0, z: 5 };
  c.weapon = 'sword'; c.weaponReadyTimer = c.invulnerabilityTimer = target.invulnerabilityTimer = 0;
  c.lungeTargetId = target.id;
  stepCombatantWeapons(s, c, { ...idleAction(), attackSecondary: true }, s.settings, 0, []);
  for (let i = 0; i < 3; i++) stepSimulation(s, {}, { settings: s.settings });
  const restored = JSON.parse(JSON.stringify(s));
  let sawDeath = false, sawRevival = false;
  for (let i = 0; i < 240; i++) {
    stepSimulation(s, {}, { settings: s.settings }); stepSimulation(restored, {}, { settings: restored.settings });
    assert.deepEqual(restored, s);
    sawDeath ||= !target.alive; sawRevival ||= sawDeath && target.alive;
  }
  assert.ok(sawDeath && sawRevival);
  placeCombatantsAtSpawns(s, s.settings);
  assert.equal(c.lungeStartPos, undefined); assert.equal(c.lungeTargetId, undefined); assert.equal(c.lungeOutcome, undefined);
  assert.equal(c.isLunging, false); assert.equal(c.attackCooldown, 0);
});

test('v2 requires an explicit tactical target instead of silently substituting target selection', () => {
  const s = createMatch({ seed: 1, combatExecution: 'live-roster-v2' }); const c = s.combatants[0];
  c.weapon = 'sword'; c.weaponReadyTimer = 0;
  assert.throws(() => stepCombatantWeapons(s, c, { ...idleAction(), attackSecondary: true }, s.settings, 0, []), /explicit lungeTargetId/);
  assert.equal(c.isLunging, false);
});

test('the same corrected fixture exposes prior roster lunge damage and timer differences', () => {
  const trace = runLungeParityTrace(LUNGE_PARITY_CASES[0], 'bot_2', true, 'live-roster-v1');
  assert.ok(trace.differenceCount > 0);
  assert.ok(trace.differences.some(d => d.field === '1.health'));
  assert.ok(trace.differences.some(d => d.field === 'cooldown'));
});

test('v2 cannot swap weapons during committed flight even though its weapon animation is idle', () => {
  const s = createMatch({ seed: 1, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 } });
  const [c, target] = s.combatants; c.weapon = 'sword'; c.weaponReadyTimer = 0; c.lungeTargetId = target.id;
  stepCombatantWeapons(s, c, { ...idleAction(), attackSecondary: true }, s.settings, 0, []);
  stepCombatantWeapons(s, c, { ...idleAction(), swapWeapon: true }, s.settings, 1 / 60, []);
  assert.equal(c.weapon, 'sword'); assert.equal(c.swapLockoutTimer, 0);
});
