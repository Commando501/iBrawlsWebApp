import { createMatch } from '../../src/sim/factory';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_FRAME_CASES, runRoundFrameTrace } from './grifballRoundFrameParity';
for (const spec of ROUND_FRAME_CASES) test(`round frame ${spec.map.id}/${spec.player}/${spec.mirror}/${spec.reverse}/${spec.winner}`, () => {
  const trace = runRoundFrameTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});

for (const spec of ROUND_FRAME_CASES.filter(c => c.reverse && c.mirror))
  for (const snapshotAt of spec.winner ? [15] : [3, 15, 22, 29]) test(`round snapshot ${spec.map.id}/${spec.player}/${spec.winner}/${snapshotAt}`, () => {
    const trace = runRoundFrameTrace(spec, snapshotAt);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });

for (const explicitAim of [false, true]) test(`mixed respawn ${explicitAim ? 'honors explicit aim' : 'preserves facing without a command'}`, () => {
  const sim = createMatch({ seed: 812, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  const [player, revived] = sim.combatants;
  sim.localPlayerId = player.id; revived.hp = 0; revived.alive = false; revived.respawnTimer = .001;
  stepSimulation(sim, explicitAim ? { [revived.id]: { ...idleAction(), aim: .71 } } : {}, { settings: sim.settings });
  assert.equal(revived.alive, true);
  if (explicitAim) assert.equal(revived.yaw, .71);
  else {
    const length = Math.hypot(revived.pos.x, revived.pos.z);
    assert.ok(Math.abs(Math.sin(revived.yaw) + revived.pos.x / length) < 1e-6);
    assert.ok(Math.abs(Math.cos(revived.yaw) + revived.pos.z / length) < 1e-6);
  }
});
