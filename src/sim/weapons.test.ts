import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveSimSettings } from './factory';
import { type SimCombatant } from './simState';
import {
  type KillEvent,
  inMeleeHitVolume,
  inHammerStrikeVolume,
  stepCombatantWeapons,
} from './weapons';
import { idleAction, type ActionInput } from './actions';
import { type UniversalSettings } from '../types';

const baseSettings = resolveSimSettings();
const withReach = (range: number, radius: number): UniversalSettings =>
  resolveSimSettings({ attackRange: range, attackRadius: radius });

/** Two fresh combatants (different teams) with controllable pose. */
function pair(): { atk: SimCombatant; vic: SimCombatant } {
  const s = createMatch({ seed: 1 });
  const atk = s.combatants.find((c) => c.team === 'blue')!;
  const vic = s.combatants.find((c) => c.team === 'red')!;
  atk.pos = { x: 0, y: 0, z: 0 };
  atk.yaw = 0; // forward = (sin0, cos0) = (0, +1) = +z
  atk.weapon = 'hammer';
  vic.isCrouching = false;
  return { atk, vic };
}

function hammerStrikePair(settings: UniversalSettings): {
  state: ReturnType<typeof createMatch>;
  atk: SimCombatant;
  vic: SimCombatant;
  events: KillEvent[];
} {
  const state = createMatch({ seed: 1, teamSizes: { blue: 1, red: 1 }, settings });
  const atk = state.combatants.find((c) => c.team === 'blue')!;
  const vic = state.combatants.find((c) => c.team === 'red')!;
  atk.pos = { x: 0, y: 0, z: 0 };
  atk.yaw = 0;
  atk.weapon = 'hammer';
  atk.weaponState = 'idle';
  atk.weaponTimer = 0;
  atk.attackCooldown = 0;
  atk.weaponReadyTimer = 0;
  atk.attackKind = 'none';
  vic.pos = { x: 0, y: 0, z: 3.2 };
  vic.hp = 1;
  vic.maxHp = 1;
  vic.alive = true;
  vic.invulnerabilityTimer = 0;
  return { state, atk, vic, events: [] };
}

const hammerPrimaryAction = (): ActionInput => ({
  ...idleAction(),
  attackPrimary: true,
});

test('a target directly in front within reach is hit', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: 2.5 };
  assert.equal(inMeleeHitVolume(atk, vic), true);
});

test('hammer reach edge ~3.0 (eye 1.65 -> body 0.825) is respected', () => {
  const { atk, vic } = pair();
  // dist = sqrt(d^2 + 0.825^2); reach 3.0 => d_max ≈ 2.884.
  vic.pos = { x: 0, y: 0, z: 2.8 };
  assert.equal(inMeleeHitVolume(atk, vic), true, 'just inside reach');
  vic.pos = { x: 0, y: 0, z: 2.95 };
  assert.equal(inMeleeHitVolume(atk, vic), false, 'just beyond reach');
});

test('sword reach (2.8) is shorter than hammer reach (3.0)', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: 2.7 }; // dist ≈ 2.82
  atk.weapon = 'hammer';
  assert.equal(inMeleeHitVolume(atk, vic), true, 'hammer reaches');
  atk.weapon = 'sword';
  assert.equal(inMeleeHitVolume(atk, vic), false, 'sword falls short');
});

test('a target behind the attacker is outside the cone', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: -2 };
  assert.equal(inMeleeHitVolume(atk, vic), false);
});

test('a target 90 degrees to the side is outside the 1.0-rad cone', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 2, y: 0, z: 0 };
  assert.equal(inMeleeHitVolume(atk, vic), false);
});

test('the cone boundary near 1.0 rad gates hits', () => {
  const { atk, vic } = pair();
  // Place at fixed planar distance 2.0, sweep angle off the +z forward axis.
  const place = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    vic.pos = { x: Math.sin(a) * 2.0, y: 0, z: Math.cos(a) * 2.0 };
  };
  place(40);
  assert.equal(inMeleeHitVolume(atk, vic), true, '40deg inside cone');
  place(75);
  assert.equal(inMeleeHitVolume(atk, vic), false, '75deg outside ~57deg cone');
});

test('crouching lowers the body center, shrinking effective reach at max range', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: 2.85 };
  vic.isCrouching = false;
  const standingHit = inMeleeHitVolume(atk, vic);
  vic.isCrouching = true;
  const crouchHit = inMeleeHitVolume(atk, vic);
  // At the very edge, dropping the body center can pull the target out of reach.
  assert.equal(standingHit, true);
  assert.equal(crouchHit, false);
});

test('aiming via the facing convention lands a front hit (regression on yaw sign)', () => {
  const { atk, vic } = pair();
  // Enemy at +x; facing it requires yaw = atan2(dx, dz) = atan2(1, 0) = +PI/2.
  vic.pos = { x: 2.0, y: 0, z: 0 };
  atk.yaw = Math.PI / 2;
  assert.equal(inMeleeHitVolume(atk, vic), true);
});

// --- Hammer primary AoE strike (attackRange forward + attackRadius splash) ---

test('hammer strike hits a target at the projected impact point', () => {
  const { atk, vic } = pair(); // atk at origin, yaw 0 (forward +z)
  // default attackRange 3.2 -> impact at (0,0,3.2)
  vic.pos = { x: 0, y: 0, z: 3.2 };
  assert.equal(inHammerStrikeVolume(atk, vic, baseSettings), true);
});

test('hammer strike is a splash sphere, not a cone (hits to the side of impact)', () => {
  const { atk, vic } = pair();
  // Beside the impact point (0,0,3.2): 4m to the side is within the 4.5 splash.
  vic.pos = { x: 4, y: 0, z: 3.2 };
  assert.equal(inHammerStrikeVolume(atk, vic, baseSettings), true);
  // The same target is OUTSIDE the short swipe cone — proving strike ≠ swipe.
  assert.equal(inMeleeHitVolume(atk, vic), false);
});

test('hammer strike splash even catches a target near the attacker (AoE back-blast)', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: 0 }; // at the attacker; within 4.5 of impact (0,0,3.2)
  assert.equal(inHammerStrikeVolume(atk, vic, baseSettings), true);
});

test('a target beyond the splash radius is missed', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: 9 }; // far past impact + radius
  assert.equal(inHammerStrikeVolume(atk, vic, baseSettings), false);
});

test('attackRadius is live-tunable: shrinking it removes a hit', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: 0 };
  assert.equal(inHammerStrikeVolume(atk, vic, withReach(3.2, 4.5)), true);
  assert.equal(inHammerStrikeVolume(atk, vic, withReach(3.2, 1.0)), false);
});

test('attackRange is live-tunable: it moves the impact point forward', () => {
  const { atk, vic } = pair();
  vic.pos = { x: 0, y: 0, z: 8 };
  assert.equal(inHammerStrikeVolume(atk, vic, withReach(3.2, 4.5)), false); // impact at 3.2, far
  assert.equal(inHammerStrikeVolume(atk, vic, withReach(8.0, 4.5)), true);  // impact now at 8
});

test('hammer primary waits for configured windup plus attack before hitting', () => {
  const settings = resolveSimSettings({
    hammerSlamWindupTime: 0.5,
    hammerSlamAttackTime: 0.25,
    weaponReadyTime: 0,
  });
  const { state, atk, vic, events } = hammerStrikePair(settings);

  stepCombatantWeapons(state, atk, hammerPrimaryAction(), settings, 0, events);
  stepCombatantWeapons(state, atk, idleAction(), settings, 0.74, events);

  assert.equal(vic.alive, true);
  assert.equal(events.length, 0);

  stepCombatantWeapons(state, atk, idleAction(), settings, 0.02, events);

  assert.equal(vic.alive, false);
  assert.equal(events.length, 1);
});

test('shorter hammer slam timing lands sooner than the default split', () => {
  const defaultSettings = resolveSimSettings({ weaponReadyTime: 0 });
  const shortSettings = resolveSimSettings({
    hammerSlamWindupTime: 0.08,
    hammerSlamAttackTime: 0.04,
    weaponReadyTime: 0,
  });
  const defaultStrike = hammerStrikePair(defaultSettings);
  const shortStrike = hammerStrikePair(shortSettings);

  stepCombatantWeapons(
    defaultStrike.state,
    defaultStrike.atk,
    hammerPrimaryAction(),
    defaultSettings,
    0,
    defaultStrike.events
  );
  stepCombatantWeapons(
    shortStrike.state,
    shortStrike.atk,
    hammerPrimaryAction(),
    shortSettings,
    0,
    shortStrike.events
  );
  stepCombatantWeapons(
    defaultStrike.state,
    defaultStrike.atk,
    idleAction(),
    defaultSettings,
    0.13,
    defaultStrike.events
  );
  stepCombatantWeapons(
    shortStrike.state,
    shortStrike.atk,
    idleAction(),
    shortSettings,
    0.13,
    shortStrike.events
  );

  assert.equal(defaultStrike.vic.alive, true);
  assert.equal(shortStrike.vic.alive, false);
});
