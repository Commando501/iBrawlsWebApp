import test from 'node:test';
import assert from 'node:assert/strict';
import { planTeamSafeAim, teamAimImpactDelay, isTeamAimAttackPending, type TeamAimBody, type TeamAimInput } from './aiTeamSafeAim';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { defaultGrifballMap } from '../sim/factory';

const body = (id: string, team: string, x: number, z: number): TeamAimBody =>
  ({ id, team, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, modelType: 'medium' });
function fixture(weapon: TeamAimInput['weapon'] = 'hammer') {
  const self = body('bot', 'blue', 0, 0), ally = body('ally', 'blue', 1.5, 3), enemy = body('enemy', 'red', 0, 4);
  const input: TeamAimInput = { self, bodies: [self, ally, enemy], heading: { x: 0, y: 0, z: 1 }, weapon,
    settings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' }, impactIn: .4, attacking: true, arenaRadius: 30, targetId: enemy.id };
  return { input, self, ally, enemy };
}

test('safe sphere placement can hit several enemies while clearing an ally', () => {
  const { input, ally } = fixture(); ally.pos = { x: 3, y: 0, z: 3 };
  input.bodies = [...input.bodies, body('second', 'red', -1, 4)];
  const plan = planTeamSafeAim(input);
  assert.equal(plan.kind, 'aim');
  if (plan.kind !== 'aim') return;
  assert.deepEqual(plan.enemyIds.sort(), ['enemy', 'second']);
  assert.ok(plan.heading.x < -.1, 'place the sphere off the target center, away from the ally');
  assert.deepEqual(planTeamSafeAim(structuredClone(input)), plan, 'checkpoint-stable and deterministic');
});

test('a teammate screening the entire swing makes the bot find a new position', () => {
  const { input, ally, enemy } = fixture(); ally.pos = { x: 0, y: 0, z: .6 }; enemy.pos.z = 5;
  const plan = planTeamSafeAim(input);
  assert.equal(plan.kind, 'reposition', 'escape close friendly crowding instead of waiting indefinitely');
  if (plan.kind !== 'reposition') return;
  assert.ok(Math.hypot(plan.destination.x, plan.destination.z - .6) > .6, 'separate from the overlapping ally');
  assert.equal(planTeamSafeAim({ ...input, self: { ...input.self, pos: plan.destination } }).kind, 'aim');
});

test('inseparable enemy and ally are not attacked', () => {
  const { input, ally, enemy } = fixture(); ally.pos = { ...enemy.pos };
  assert.equal(planTeamSafeAim(input).kind, 'hold');
});

test('reposition candidates stay inside a cramped arena', () => {
  const { input, ally } = fixture(); ally.pos = { x: 0, y: 0, z: .5 };
  input.map = { ...defaultGrifballMap(), arenaRadius: 1, mapShape: 'circle', objects: [] };
  assert.equal(planTeamSafeAim(input).kind, 'hold');
});

test('the bot does not step through map geometry to reach a safe swing', () => {
  const { input, ally, enemy } = fixture(); ally.pos = { x: 0, y: 0, z: .6 }; enemy.pos.z = 5;
  assert.equal(planTeamSafeAim(input).kind, 'reposition');
  const wall = { id: 'wall', name: 'Wall', type: 'box' as const, position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: .2, y: 3, z: 12 }, color: '#fff', metalness: 0,
    roughness: 1, opacity: 1, transparent: false, emissive: '#000', emissiveIntensity: 0, isCollidable: true, texture: 'none' as const };
  input.map = { ...defaultGrifballMap(), mapShape: 'circle', arenaRadius: 30, objects: [wall] };
  assert.equal(planTeamSafeAim(input).kind, 'hold', 'do not leave a collidable wall by walking through it');
});

test('long-lived shields and a teammate far above the blast do not block an attack', () => {
  for (const protectedAlly of [true, false]) {
    const { input, ally, enemy } = fixture(); ally.pos = { ...enemy.pos };
    if (protectedAlly) ally.invulnerabilityTimer = 10; else ally.pos.y = 10;
    assert.equal(planTeamSafeAim(input).kind, 'aim');
    ally.pos.y = 0; ally.invulnerabilityTimer = .1;
    assert.equal(planTeamSafeAim(input).kind, 'hold', 'a shield expiring before contact is not protection');
  }
});

test('forecast prevents a swing through an ally moving into the enemy', () => {
  const { input, ally, enemy } = fixture(); ally.pos = { x: 8, y: 0, z: 4 }; ally.vel.x = -20;
  assert.equal(planTeamSafeAim({ ...input, impactIn: 0 }).kind, 'aim');
  assert.equal(planTeamSafeAim(input).kind, 'hold', 'predicted overlap cannot be hit safely');
  assert.equal(enemy.pos.x, 0); assert.equal(ally.pos.x, 8, 'planner does not mutate observations');
});

test('no teammates and sandbox combat preserve the original policy', () => {
  const { input, enemy } = fixture();
  assert.equal(planTeamSafeAim({ ...input, bodies: [enemy] }).kind, 'unchanged');
  assert.equal(planTeamSafeAim({ ...input, settings: { ...input.settings, gameMode: 'sandbox' } }).kind, 'unchanged');
});

test('lunge checks the first contact and can choose a clear offset trajectory', () => {
  const { input, ally, enemy } = fixture('sword'); input.lunge = true;
  ally.pos = { x: 0, y: 0, z: 3 }; enemy.pos.z = 9;
  assert.equal(planTeamSafeAim(input).kind, 'hold');
  ally.pos = { x: 1.6, y: 0, z: 4 };
  const offset = planTeamSafeAim(input);
  assert.equal(offset.kind, 'aim');
  if (offset.kind === 'aim') { assert.ok(offset.heading.x < 0); assert.deepEqual(offset.enemyIds, ['enemy']); }
  ally.pos = { x: 0, y: 0, z: 12 };
  assert.equal(planTeamSafeAim(input).kind, 'unchanged', 'enemy contact ends the lunge before the teammate behind it');
});

test('punch assistance cannot carry a jab through a teammate', () => {
  const { input, ally, enemy } = fixture('ball');
  input.settings.grifballPunchLungeDistance = 3;
  ally.pos = { x: 0, y: 0, z: 2.5 }; enemy.pos.z = 4;
  assert.equal(planTeamSafeAim(input).kind, 'hold');
  ally.pos.x = 5;
  assert.equal(planTeamSafeAim(input).kind, 'unchanged', 'retain safe runner assistance');
});

test('time to contact follows each real roster animation boundary', () => {
  const s = { ...DEFAULT_ADMIN_SETTINGS, hammerMeleeSpeed: .3, swordSlashSpeed: .4, hammerSlamWindupTime: .4, hammerSlamAttackTime: .2 };
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
  near(teamAimImpactDelay(s, 'sword', 'swing_up', .1), .1);
  near(teamAimImpactDelay(s, 'hammer', 'swing_up', .1), .5);
  near(teamAimImpactDelay(s, 'hammer', 'swing_down', .1), .1);
  near(teamAimImpactDelay(s, 'hammer', 'melee_down', .1), .08);
  near(teamAimImpactDelay(s, 'ball', 'swing_up', .1), .35);
  near(teamAimImpactDelay(s, 'ball', 'swing_down', .1), .05);
  assert.equal(isTeamAimAttackPending('sword', 'swing_down'), false);
  assert.equal(isTeamAimAttackPending('hammer', 'swing_down'), true);
});
