import { createMatch } from '../../src/sim/factory';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_FLIGHT_CASES, runRoundFlightTrace } from './grifballRoundFlightParity';
for (const spec of ROUND_FLIGHT_CASES) test(`round flight ${JSON.stringify({ ...spec.round, map: spec.round.map.id })}/${JSON.stringify(spec.combat)}`, () => {
  const trace = runRoundFlightTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const spec of ROUND_FLIGHT_CASES.filter(c => c.round.reverse && c.round.mirror && c.combat.hp === 1 && c.combat.impactTick === 17))
  for (const at of [3, 15, 16, 22]) test(`round flight snapshot ${spec.round.map.id}/${spec.round.winner}/${spec.combat.pause}/${at}`, () => {
    const trace = runRoundFlightTrace(spec, at);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });

for (const id of ['main_ai', 'ordinary']) for (const phase of ['countdown', 'scored', 'matchEnd'] as const) test(`${id} mixed AI freezes intent but advances shields and committed melee in ${phase}`, () => {
  const sim = createMatch({ seed: 811, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 }, settings: { swordSlashSpeed: .15 } });
  const [player, bot] = sim.combatants; sim.localPlayerId = player.id; bot.id = id;
  sim.match.phase = phase; sim.match.phaseTimer = 0;
  bot.pauseDuringInactiveGrifball = true; bot.invulnerabilityTimer = .5; bot.weapon = 'sword';
  bot.weaponState = 'windup'; bot.attackKind = 'slash'; bot.weaponPhaseElapsed = 0;
  bot.attackCooldown = bot.swapLockoutTimer = bot.weaponReadyTimer = bot.dashCooldownTimer = .5;
  bot.vel = { x: 3, y: 2, z: 4 };
  const pos = { ...bot.pos }, yaw = bot.yaw;
  stepSimulation(sim, { [bot.id]: { ...idleAction(), moveZ: 1, aim: .7, jump: true, dash: true, swapWeapon: true, attackSecondary: true } }, { settings: sim.settings });
  assert.deepEqual(bot.pos, pos); assert.deepEqual(bot.vel, { x: 0, y: 0, z: 0 }); assert.equal(bot.yaw, yaw);
  assert.equal(bot.weapon, 'sword'); assert.equal(bot.isLunging, false); assert.equal(bot.weaponState, 'windup');
  assert.equal(bot.weaponPhaseElapsed, 1 / 60); assert.equal(bot.invulnerabilityTimer, .5 - 1 / 60);
  for (const timer of ['attackCooldown', 'dashCooldownTimer'] as const) assert.equal(bot[timer], .5);
  // Main AI has a global weapon-frame clock even when its AI turn is paused.
  for (const timer of ['swapLockoutTimer', 'weaponReadyTimer'] as const) assert.equal(bot[timer], id === 'main_ai' ? .5 - 1 / 60 : .5);
});

test('ordinary AI resumes on the frame after countdown completes', () => {
  const sim = createMatch({ seed: 811, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  const [player, bot] = sim.combatants; sim.localPlayerId = player.id; bot.pauseDuringInactiveGrifball = true;
  sim.match.phase = 'countdown'; sim.settings.grifballCountdownDuration = .001; sim.match.phaseTimer = 0;
  const pos = { ...bot.pos }, actions = { [bot.id]: { ...idleAction(), aim: 0, moveZ: 1 } };
  stepSimulation(sim, actions, { settings: sim.settings });
  assert.equal(sim.match.phase, 'playing'); assert.deepEqual(bot.pos, pos);
  stepSimulation(sim, actions, { settings: sim.settings }); assert.ok(bot.pos.z > pos.z);
});

for (const kind of ['player', 'legacy', 'combat'] as const) test(`ordinary phase pause does not change ${kind} execution`, () => {
  const sim = createMatch({ seed: 811, combatExecution: kind === 'legacy' ? 'legacy-v1' : 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  const [player, bot] = sim.combatants; sim.localPlayerId = player.id;
  const actor = kind === 'player' ? player : bot; actor.pauseDuringInactiveGrifball = true;
  sim.match.phase = 'countdown'; if (kind === 'combat') sim.mode = 'combat';
  const before = actor.pos.z;
  stepSimulation(sim, { [actor.id]: { ...idleAction(), aim: 0, moveZ: 1 } }, { settings: sim.settings });
  assert.ok(actor.pos.z > before);
});

test('paused pickup intent is cleared on the countdown completion frame', () => {
  const sim = createMatch({ seed: 811, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  const [player, bot] = sim.combatants; sim.localPlayerId = player.id; bot.pauseDuringInactiveGrifball = true;
  sim.match.phase = 'countdown'; sim.settings.grifballCountdownDuration = .001; sim.match.phaseTimer = 0;
  player.pos = { x: 30, y: 0, z: 0 }; bot.pos = { x: 0, y: 0, z: 0 }; bot.invulnerabilityTimer = 0;
  sim.match.ball.state = 'loose'; sim.match.ball.holderId = null; sim.match.ball.pos = { x: 0, y: 0, z: 0 }; sim.match.ball.vel = { x: 0, y: 0, z: 0 };
  const actions = { [bot.id]: { ...idleAction(), pickup: true } };
  stepSimulation(sim, actions, { settings: sim.settings });
  assert.equal(sim.match.phase, 'playing'); assert.equal(sim.match.ball.holderId, null);
  stepSimulation(sim, actions, { settings: sim.settings }); assert.equal(sim.match.ball.holderId, bot.id);
});
