import assert from 'node:assert/strict';
import test from 'node:test';
import { lungeFixture } from './grifballLungeFixture';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { observeSimGrifballSpace } from '../../src/sim/grifballTacticalAdapter';
import { createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { combatExecutionForActor, type SimCombatExecution } from '../../src/sim/simState';
for (const execution of ['live-roster-v2', 'live-mixed-v1'] as const)
for (const id of ['main_ai', 'bot_2'])
for (const reload of [1.2, .35])
for (const followup of [false, true])
test(`post-lunge observable readiness and requested primary ${execution}/${id}/${reload}/${followup}`, () => {
  const f = lungeFixture(id, true), { state, sim, bot, target } = f, [self, rival] = sim.combatants;
  sim.combatExecution = execution;
  sim.match.phase = state.grifball.phase = 'playing';
  state.settings.swordLungeReload = sim.settings.swordLungeReload = reload;
  self.id = id;
  rival.id = target.id;
  self.yaw = 0;
  if (execution === 'live-mixed-v1')
    sim.localPlayerId = rival.id;
  self.weapon = bot.activeWeapon = 'sword';
  self.pos = { x: 0, y: 0, z: 0 };
  bot.pos.set(0, 0, 0);
  bot.lungeStartPos = { ...self.pos };
  rival.pos = { x: 0, y: 0, z: 2 };
  target.pos.set(0, 0, 2);
  self.hp = self.maxHp = bot.hp = bot.maxHp = rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
  self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
  self.lungeTargetId = rival.id;
  stepCombatantWeapons(sim, self, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
  let ended = 0, primaryHit = 0;
  const differences: string[] = [];
  for (let tick = 1; tick <= 180; tick++) {
    const request = followup && ended > 0;
    bot.aiTimer = Math.max(0, (bot.aiTimer ?? 0) - 1 / 60);
    if (bot.isLunging) {
      f.weaponFrame(1 / 60);
      f.flight();
      f.visuals(1 / 60);
    }
    else
      f.frame(request);
    stepSimulation(sim, { [id]: { ...idleAction(), attackPrimary: request }, [target.id]: idleAction() }, { settings: sim.settings });
    assert.equal(!!bot.isLunging, self.isLunging, `flight tick ${tick}`);
    if (!bot.isLunging && !ended)
      ended = tick;
    if (target.hp < 19 && !primaryHit)
      primaryHit = tick;
    if (target.hp !== rival.hp)
      differences.push(`health@${tick} live=${target.hp} sim=${rival.hp}`);
    const live = createLiveGrifballTacticalSnapshot(state, () => null, f.map).players.find(p => p.id === id)!.space!;
    const headless = observeSimGrifballSpace(self, sim.settings, combatExecutionForActor(sim, self));
    for (const key of Object.keys(live) as (keyof typeof live)[]) {
      const a = live[key], b = headless[key];
      if (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-6 : a !== b)
        differences.push(`${key}@${tick} ${a} != ${b}`);
    }
  }
  assert.equal(ended, 2, 'both independent flights must hit and finish');
  if (followup)
    assert.ok(primaryHit > ended && primaryHit < ended + reload * 60, 'explicit follow-up can land before AI backoff ends');
  else
    assert.equal(target.hp, 19, 'idle input must never invent follow-up attacks');
  assert.equal(differences.length, 0, differences.slice(0, 8).join('\n'));
});
test('post-lunge weapon-ready delay blocks a requested attack until the actual boundary', () => {
  const { sim } = lungeFixture('main_ai', true), self = sim.combatants[0];
  sim.combatExecution = 'live-roster-v2';
  Object.assign(self, { weapon: 'sword', weaponState: 'idle', attackKind: 'none', isLunging: false,
    lungeOutcome: 'hit', attackCooldown: 1.2, weaponReadyTimer: .25 });
  const input = { ...idleAction(), attackPrimary: true };
  const forecast = observeSimGrifballSpace(self, sim.settings, 'live-roster-v2');
  assert.equal(forecast.attackIn, .25 + sim.settings.swordSlashSpeed * .5);
  // Binary-exact increments isolate readiness from floating-point tick rounding.
  for (let tick = 0; tick < 15; tick++)
    stepCombatantWeapons(sim, self, input, sim.settings, 1 / 64, []);
  assert.equal(self.weaponState, 'idle');
  stepCombatantWeapons(sim, self, input, sim.settings, 1 / 64, []);
  assert.equal(self.weaponState, 'windup');
  assert.ok(self.attackCooldown > .8, 'decision timer remains available to its owner');
});
test('a spent slash still requires real recovery despite an earlier lunge outcome', () => {
  const { sim } = lungeFixture('main_ai', true), self = sim.combatants[0];
  sim.combatExecution = 'live-roster-v2';
  const recovery = sim.settings.swordSlashReload;
  Object.assign(self, { weapon: 'sword', weaponState: 'recovering', attackKind: 'slash', isLunging: false,
    lungeOutcome: 'hit', attackCooldown: recovery, weaponTimer: recovery, weaponPhaseElapsed: 0, weaponReadyTimer: 0 });
  const input = { ...idleAction(), attackPrimary: true };
  assert.equal(observeSimGrifballSpace(self, sim.settings, 'live-roster-v2').attackIn, recovery + sim.settings.swordSlashSpeed * .5);
  stepCombatantWeapons(sim, self, input, sim.settings, recovery / 2, []);
  assert.equal(self.weaponState, 'recovering');
  stepCombatantWeapons(sim, self, input, sim.settings, recovery / 2, []);
  assert.equal(self.weaponState, 'idle');
  stepCombatantWeapons(sim, self, input, sim.settings, 1 / 60, []);
  assert.equal(self.weaponState, 'windup');
});
for (const execution of ['legacy-v1', 'live-roster-v1', 'live-player-v1', 'live-mixed-v1'] as SimCombatExecution[])
  test(`post-lunge exception does not change the existing non-v2 owner contract: ${execution}`, () => {
    const { sim } = lungeFixture('main_ai', true), self = sim.combatants[0];
    sim.combatExecution = execution;
    sim.localPlayerId = self.id;
    Object.assign(self, { weapon: 'sword', weaponState: 'idle', attackKind: 'none', isLunging: false,
      lungeOutcome: 'hit', attackCooldown: 1.2, weaponReadyTimer: 0 });
    const profile = combatExecutionForActor(sim, self);
    const observation = observeSimGrifballSpace(self, sim.settings, profile);
    const primary = sim.settings.swordSlashSpeed * (execution === 'legacy-v1' ? 1 : .5);
    assert.equal(observation.attackIn, 1.2 + primary);
    stepCombatantWeapons(sim, self, { ...idleAction(), attackPrimary: true }, sim.settings, .1, []);
    assert.equal(self.weaponState, 'idle');
    assert.ok(self.attackCooldown > 1);
  });
test('an unrelated idle cooldown is not waived for v2 roster actors', () => {
  const { sim } = lungeFixture('main_ai', true), self = sim.combatants[0];
  sim.combatExecution = 'live-roster-v2';
  Object.assign(self, { weapon: 'sword', weaponState: 'idle', attackKind: 'none', isLunging: false,
    attackCooldown: 1.2, weaponReadyTimer: 0 });
  delete self.lungeOutcome;
  assert.equal(observeSimGrifballSpace(self, sim.settings, 'live-roster-v2').attackIn, 1.2 + sim.settings.swordSlashSpeed * .5);
  stepCombatantWeapons(sim, self, { ...idleAction(), attackPrimary: true }, sim.settings, .1, []);
  assert.equal(self.weaponState, 'idle');
});
