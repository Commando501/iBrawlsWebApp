import { createMatch } from '../../src/sim/factory';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_PLAYER_FLIGHT_CASES, runRoundPlayerFlightTrace } from './grifballRoundPlayerFlightParity';
for (const spec of ROUND_PLAYER_FLIGHT_CASES) test(`round player flight ${spec.round.map.id}/${spec.round.mirror}/${spec.round.reverse}/${spec.round.winner}/${JSON.stringify(spec.flight)}`, () => {
  const trace = runRoundPlayerFlightTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const spec of ROUND_PLAYER_FLIGHT_CASES.filter(c => c.round.reverse && c.round.mirror && c.flight.hp === 1 && c.flight.mainTarget && c.flight.impactTick !== 3))
  for (const at of [15, 16, 44, 45]) test(`round player flight snapshot ${spec.round.map.id}/${spec.round.winner}/${spec.flight.impactTick}/${at}`, () => {
    const trace = runRoundPlayerFlightTrace(spec, at);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });

test('dead mixed player clears hidden sword recovery before revival', () => {
  const sim = createMatch({ seed: 815, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  const player = sim.combatants[0]; sim.localPlayerId = player.id;
  player.weapon = 'hammer'; player.playerSwordLungeRecovery = { elapsed: .1, duration: .39 };
  player.alive = false; player.hp = 0; player.respawnTimer = .02;
  stepSimulation(sim, {}, { settings: sim.settings }); assert.equal(player.playerSwordLungeRecovery, undefined);
  stepSimulation(sim, {}, { settings: sim.settings }); assert.equal(player.alive, true); assert.equal(player.playerSwordLungeRecovery, undefined);
});
test('a new player slash clears completed lunge recovery', () => {
  const sim = createMatch({ seed: 815, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  const player = sim.combatants[0]; sim.localPlayerId = player.id;
  player.weapon = 'sword'; player.playerSwordLungeRecovery = { elapsed: .4, duration: .39 };
  player.weaponState = 'idle'; player.attackCooldown = player.weaponReadyTimer = 0;
  stepSimulation(sim, { [player.id]: { ...idleAction(), aim: player.yaw, attackPrimary: true } }, { settings: sim.settings });
  assert.equal(player.attackKind, 'slash'); assert.equal(player.playerSwordLungeRecovery, undefined);
});
