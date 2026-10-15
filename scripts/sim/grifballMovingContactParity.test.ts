import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVING_ATTACK_CASES, MOVING_LUNGE_CASES } from './grifballMovingContactParity';
import { runBotExecutionParityTrace } from './grifballBotExecutionParity';
import { LUNGE_PARITY_ACTORS, runLungeParityTrace } from './grifballLungeParity';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { groundMotionAction, stepLiveGroundMotion, type GroundMotion } from './grifballGroundMotion';
import { stepSimulation } from '../../src/sim/step';

test('authored objective walking, reversal and stop have independent travel expectations', () => {
  const f = createBotParityFixture('bot_2', true, { speedForward: 100, speedBackward: 100, speedSide: 100 });
  const c = f.sim.combatants[1]; c.id = f.target.id; c.pos = { x: 0, y: 0, z: 2 }; f.sim.match.phase = 'playing';
  f.sim.combatExecution = 'live-roster-v2';
  const motion: GroundMotion = { walk: [{ tick: 1, direction: { x: 1, z: 0 } },
    { tick: 4, direction: { x: -1, z: 0 } }, { tick: 7, direction: { x: 0, z: 0 } }] };
  for (let tick = 1; tick <= 10; tick++) {
    stepLiveGroundMotion(f, f.target, motion, tick);
    stepSimulation(f.sim, { [c.id]: groundMotionAction(c, motion, tick, 0, f.sim.settings) }, { settings: f.sim.settings });
    const steps = tick <= 3 ? tick : tick <= 6 ? 6 - tick : 0;
    for (const pos of [f.target.pos, c.pos]) {
      assert.ok(Math.abs(pos.x - steps * 5.2 / 60) < 1e-12); assert.equal(pos.z, 2);
    }
  }
});

test('committed dash includes its expiry frame, then stops and retains the remaining cooldown', () => {
  const f = createBotParityFixture('bot_2', true, { dashDistance: 2, dashDuration: .07, dashCooldown: 2 });
  const c = f.sim.combatants[1]; c.id = f.target.id; c.pos = { x: 0, y: 0, z: 2 }; f.sim.match.phase = 'playing';
  f.sim.combatExecution = 'live-roster-v2';
  const motion: GroundMotion = { dash: { tick: 1, direction: { x: 1, z: 0 } } };
  for (let tick = 1; tick <= 8; tick++) {
    stepLiveGroundMotion(f, f.target, motion, tick);
    stepSimulation(f.sim, { [c.id]: groundMotionAction(c, motion, tick, 0, f.sim.settings) }, { settings: f.sim.settings });
    const expectedDistance = Math.min(tick, 5) * (2 / .07) / 60;
    for (const actor of [{ pos: f.target.pos, vel: f.target.vel, dashCooldownTimer: f.target.aiDashCooldownTimer, dashRemaining: f.target.aiDashRemaining }, c]) {
      assert.ok(Math.abs(actor.pos.x - expectedDistance) < 1e-12);
      assert.ok(Math.abs(actor.dashCooldownTimer! - (2 - tick / 60)) < 1e-12);
      if (tick >= 6) { assert.equal(actor.vel.x, 0); assert.equal(actor.dashRemaining, 0); }
    }
  }
});

for (const id of ['main_ai', 'bot_2']) for (const observer of [false, true]) for (const c of MOVING_ATTACK_CASES) {
  test(`moving attack ${id} observer=${observer} ${c.name}`, () => {
    const t = runBotExecutionParityTrace(c, id, observer, 'live-roster-v2');
    assert.equal(t.differenceCount, 0, JSON.stringify(t.differences.slice(0, 6)));
  });
}
for (const { id, targetId } of LUNGE_PARITY_ACTORS) for (const observer of [false, true]) for (const c of MOVING_LUNGE_CASES) {
  test(`moving lunge ${id}->${targetId} observer=${observer} ${c.name}`, () => {
    const t = runLungeParityTrace(c, id, observer, 'live-roster-v2', targetId);
    assert.equal(t.differenceCount, 0, JSON.stringify(t.differences.slice(0, 6)));
  });
}
