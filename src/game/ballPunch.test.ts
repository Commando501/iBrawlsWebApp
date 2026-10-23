import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePunch, beginPunch, findPunchHitTarget, findPunchLockTarget, punchContactDistance, type PunchActor, type PunchBody } from './ballPunch';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { resolvePunchMagnetism } from './runnerBallSettings';
import type { CustomMapData } from '../types';

const settings = { ...DEFAULT_ADMIN_SETTINGS };
const actor = (): PunchActor => ({ id: 'runner', pos: { x: 0, y: 0, z: 0 }, heading: { x: 0, y: 0, z: -1 }, eyeHeight: 1.2 });
const body = (id: string, x: number, z: number, y = 0): PunchBody => ({ id, pos: { x, y, z } });
const wall = { objects: [{ type: 'box', position: { x: 0, y: 1, z: -1 }, scale: { x: 5, y: 2, z: .05 }, isCollidable: true }] } as CustomMapData;

test('punch contacts only the nearest model; side, behind and distant bodies miss', () => {
  const a = actor(), near = body('near', 0, -1.3), far = body('far', 0, -1.9);
  assert.equal(findPunchHitTarget(a, [far, near])?.id, 'near');
  assert.equal(findPunchHitTarget(a, [near, far])?.id, 'near');
  for (const b of [body('side', 1, -1.3), body('behind', 0, 1.3), body('far', 0, -3), body('above', 0, -1.3, 3)])
    assert.equal(punchContactDistance(a, b), null, b.id);
});

test('contact honors target model size and crouching height', () => {
  const a = actor(); a.eyeHeight = 1.65;
  const target = body('target', .72, -1.2);
  assert.equal(punchContactDistance(a, target), null);
  target.modelType = 'large';
  assert.notEqual(punchContactDistance(a, target), null);
  target.modelType = 'medium'; target.pos.x = 0; target.isCrouching = true;
  assert.equal(punchContactDistance(a, target), null);
  a.heading = { x: 0, y: -.5, z: -1 };
  assert.notEqual(punchContactDistance(a, target), null);
});

test('a miss is a stationary jab and never acquires a target mid-attack', () => {
  const a = actor(), attack = beginPunch(a, [], settings);
  advancePunch(a, attack, [body('late', 0, -3)], settings, .24);
  assert.equal(attack.targetId, null);
  assert.deepEqual(a.pos, { x: 0, y: 0, z: 0 });
});

test('red-reticle lock lunges up to configured travel, stopping at model contact', () => {
  for (const distance of [.5, 1.8, 5]) {
    const a = actor(), s = { ...settings, grifballPunchLungeDistance: distance };
    const b = body('target', 0, -(distance + 1));
    assert.equal(findPunchLockTarget(a, [b], s)?.id, b.id);
    const attack = beginPunch(a, [b], s);
    for (let i = 0; i < 60; i++) advancePunch(a, attack, [b], s, 1 / 60);
    assert.ok(-a.pos.z <= distance + 1e-9);
    assert.ok(-a.pos.z > 0);
    assert.ok(Math.abs(a.pos.z - b.pos.z) >= 1.1);
    assert.equal(findPunchHitTarget({ ...a, heading: attack.direction }, [b])?.id, b.id);
  }
});

test('0% disables acquisition assistance and steering but preserves a directly aimed straight lunge', () => {
  const a = actor(), offset = body('offset', .85, -3), off = { ...settings, grifballPunchMagnetism: 0 };
  assert.equal(findPunchLockTarget(a, [offset], off), null);
  assert.equal(findPunchLockTarget(a, [offset], settings)?.id, 'offset');
  const target = body('moving', 0, -3), attack = beginPunch(a, [target], off);
  target.pos.x = .5;
  advancePunch(a, attack, [target], off, .1);
  assert.equal(a.pos.x, 0);
  assert.deepEqual(attack.direction, { x: 0, y: 0, z: -1 });
  assert.equal(resolvePunchMagnetism({ grifballPunchMagnetism: NaN }), 1);
  assert.equal(resolvePunchMagnetism({ grifballPunchMagnetism: -10 }), 0);
});

test('magnetism scales tracking, retains its target and stops on target loss', () => {
  const displacement = [0, 50, 100].map(percent => {
    const a = actor(), b = body('moving', 0, -3), s = { ...settings, grifballPunchMagnetism: percent };
    const attack = beginPunch(a, [b], s); b.pos.x = .7;
    advancePunch(a, attack, [b], s, .1);
    const before = { ...a.pos };
    advancePunch(a, attack, [body('replacement', 0, -2)], s, .1);
    assert.deepEqual(a.pos, before);
    assert.equal(attack.targetId, 'moving');
    return a.pos.x;
  });
  assert.ok(displacement[0] < displacement[1] && displacement[1] < displacement[2]);
});

test('thin walls block lock, damage, and travel even at a long frame interval', () => {
  const a = actor(), b = body('target', 0, -1.8);
  assert.equal(findPunchLockTarget(a, [b], settings, wall), null);
  assert.equal(findPunchHitTarget(a, [b], wall), null);
  const attack = beginPunch(a, [body('far', 0, -3)], settings);
  advancePunch(a, attack, [body('far', 0, -3)], settings, 1, wall);
  assert.equal(a.pos.z, 0);
});

test('distance limits lock and never extends stationary damage', () => {
  const a = actor(), b = body('target', 0, -3);
  assert.equal(findPunchLockTarget(a, [b], { ...settings, grifballPunchLungeDistance: .5 }), null);
  assert.equal(findPunchLockTarget(a, [b], settings)?.id, b.id);
  assert.equal(findPunchHitTarget(a, [b]), null);
});
