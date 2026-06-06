import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveSimSettings } from './factory';
import { stepSimulation } from './step';
import { stepCombatantWeapons, isTradeEligible } from './weapons';
import { setSimCarrier } from './grifball';
import { idleAction, type ActionInput } from './actions';
import { findCombatant } from './simState';

const combatSettings = resolveSimSettings(undefined, 'combat');
const grifSettings = resolveSimSettings();

function act(over: Partial<ActionInput>): ActionInput {
  return { ...idleAction(), ...over };
}

// --- weaponReadyTime: a freshly-swapped weapon can't fire until it's ready ---

test('a swapped weapon is locked out for weaponReadyTime before it can attack', () => {
  const s = createMatch({ seed: 1, mode: 'combat', combat: { teamSizes: [1, 1] } });
  const c = s.combatants[0];
  c.weapon = 'hammer'; c.weaponState = 'idle'; c.attackCooldown = 0; c.weaponReadyTimer = 0;
  const ev: any[] = [];

  stepCombatantWeapons(s, c, act({ swapWeapon: true }), combatSettings, 1 / 60, ev);
  assert.equal(c.weapon, 'sword');
  assert.ok(c.weaponReadyTimer > 0.4, 'swap arms the ready lockout');

  // Immediate attack is blocked.
  stepCombatantWeapons(s, c, act({ attackPrimary: true }), combatSettings, 1 / 60, ev);
  assert.equal(c.weaponState, 'idle', 'attack blocked while not ready');

  // Wait out the lockout (~0.5s), then attack works.
  for (let i = 0; i < 35; i++) stepCombatantWeapons(s, c, act({}), combatSettings, 1 / 60, ev);
  assert.equal(c.weaponReadyTimer, 0);
  stepCombatantWeapons(s, c, act({ attackPrimary: true }), combatSettings, 1 / 60, ev);
  assert.equal(c.weaponState, 'windup', 'attack fires once ready');
});

// --- weapon trade: a sword hit on a mid-attack opponent kills both ---

test('isTradeEligible flags a mid-attack sword opponent', () => {
  const s = createMatch({ seed: 2, mode: 'combat', combat: { teamSizes: [1, 1] } });
  const v = s.combatants[1];
  v.weapon = 'sword'; v.weaponState = 'windup';
  assert.equal(isTradeEligible(v, combatSettings, s.tick), true);
  v.weaponState = 'idle'; v.lastAttackTick = -100000;
  assert.equal(isTradeEligible(v, combatSettings, s.tick), false);
});

test('a sword lunge into a mid-attack opponent trades (both die, both teams score)', () => {
  const s = createMatch({ seed: 3, mode: 'combat', combat: { teamSizes: [1, 1] } });
  s.match.phase = 'playing';
  const atk = s.combatants[0];
  const vic = s.combatants[1];
  atk.pos = { x: 0, y: 0, z: 0 }; atk.yaw = 0; atk.weapon = 'sword';
  atk.invulnerabilityTimer = 0; atk.weaponReadyTimer = 0; atk.attackCooldown = 0;
  vic.pos = { x: 0, y: 0, z: 1.0 }; vic.weapon = 'sword'; vic.invulnerabilityTimer = 0;
  vic.weaponState = 'windup'; // mid-attack -> trade eligible

  let bothDead = false;
  for (let i = 0; i < 10 && !bothDead; i++) {
    stepSimulation(s, { [atk.id]: act({ attackSecondary: true, aim: 0 }) }, { settings: combatSettings });
    bothDead = !findCombatant(s, atk.id)!.alive && !findCombatant(s, vic.id)!.alive;
  }
  assert.ok(bothDead, 'both combatants should die in the trade');
  assert.ok(s.scores[atk.team].kills >= 1 && s.scores[vic.team].kills >= 1, 'both teams credited');
});

// --- hammer-jump: a grounded hammer strike lets the next jump launch high ---

test('a grounded hammer strike enables a boosted hammer-jump', () => {
  const s = createMatch({ seed: 4, mode: 'combat', combat: { teamSizes: [1, 1] } });
  s.match.phase = 'playing';
  const me = s.combatants[0];
  me.weapon = 'hammer'; me.invulnerabilityTimer = 0; me.weaponReadyTimer = 0;

  let opened = false;
  for (let i = 0; i < 60 && !opened; i++) {
    stepSimulation(s, { [me.id]: act({ attackPrimary: true, aim: me.yaw }) }, { settings: combatSettings });
    if (findCombatant(s, me.id)!.hammerJumpWindowTimer > 0) opened = true;
  }
  assert.ok(opened, 'a grounded hammer strike opens the jump window');

  // Jump inside the window -> boosted vertical velocity (7.2 + hammerJumpPower).
  stepSimulation(s, { [me.id]: act({ jump: true, aim: me.yaw }) }, { settings: combatSettings });
  const j = findCombatant(s, me.id)!;
  assert.ok(j.isJumping && j.vel.y > 10, `hammer-jump should boost vy, got ${j.vel.y}`);
});

test('a normal jump (no window) is not boosted', () => {
  const s = createMatch({ seed: 5, mode: 'combat', combat: { teamSizes: [1, 1] } });
  s.match.phase = 'playing';
  const me = s.combatants[0];
  me.invulnerabilityTimer = 0;
  stepSimulation(s, { [me.id]: act({ jump: true, aim: me.yaw }) }, { settings: combatSettings });
  const j = findCombatant(s, me.id)!;
  assert.ok(j.vel.y > 6 && j.vel.y < 7.5, `normal jump ~7.2, got ${j.vel.y}`);
});

// --- grifball pass charge: longer hold throws the ball faster ---

function chargeAndThrow(holdTicks: number): number {
  const s = createMatch({ seed: 11 });
  s.match.phase = 'playing';
  const carrier = s.combatants.find((c) => c.team === 'blue')!;
  carrier.pos = { x: 0, y: 0, z: 0 }; carrier.yaw = 0;
  s.match.ball.state = 'held'; s.match.ball.holderId = carrier.id;
  setSimCarrier(carrier, true, grifSettings);

  for (let i = 0; i < holdTicks; i++) {
    stepSimulation(s, { [carrier.id]: act({ attackSecondary: true, aim: 0 }) }, { settings: grifSettings });
  }
  // Release.
  stepSimulation(s, { [carrier.id]: act({ aim: 0 }) }, { settings: grifSettings });
  return Math.hypot(s.match.ball.vel.x, s.match.ball.vel.z);
}

test('holding the pass longer throws the ball faster (grifballChargeMax)', () => {
  const shortThrow = chargeAndThrow(3);    // ~0.05s
  const longThrow = chargeAndThrow(80);    // past chargeMax (1.2s) -> capped at max
  assert.ok(shortThrow > 0, 'a short charge still throws');
  assert.ok(longThrow > shortThrow + 2, `long charge faster: ${longThrow.toFixed(1)} vs ${shortThrow.toFixed(1)}`);
  const max = grifSettings.grifballPassSpeedMax ?? 26;
  assert.ok(longThrow <= max + 1e-6, 'capped at passSpeedMax');
});
