import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveAIEngagementPreparation as production, type AIEngagementPreparationInput } from './aiEngagementPreparation';

const referencePath = '../../output/m7-engagement-preparation-reference';
const resolve: typeof production = process.env.M7_ENGAGEMENT_PREPARATION_REFERENCE
  ? (await import(referencePath)).resolveAIEngagementPreparation : production;
function input(): AIEngagementPreparationInput {
  return { aiState: 'SIDE_STEPPING', swayTimer: 0, slideActive: false, movementComplexity: 80,
    weaponState: 'ready', coordCommitTimer: .4, psychEnabled: true, standoffTimer: .7,
    resolvedDangerZone: 3, standoffRangeMinOffset: 1.5, standoffRangeMaxOffset: 5.5, dt: 1 / 60,
    range: { botPos: new THREE.Vector3(), botVel: new THREE.Vector3(), botIsJumping: false,
      targetIsCrouching: false, targetHp: 2, targetProtected: false, predictedTargetPos: new THREE.Vector3(0, 0, 5),
      distanceToTarget: 5, activeWeapon: 'sword', attackRange: 3.2, attackRadius: 4.5, resolvedAiReach: 5 } };
}
for (const state of ['SIDE_STEPPING', 'COOLDOWN', 'APPROACHING'] as const)
  for (const sway of [0, 1.499, 1.5, 4]) for (const sliding of [false, true])
    test(`posture precedes range ${state}/${sway}/${sliding}`, () => {
      const p = input(); p.aiState = state; p.swayTimer = sway; p.slideActive = sliding;
      p.range.predictedTargetPos.set(0, 1.05, 2.45); p.range.distanceToTarget = 2.45;
      const expectedCrouch = sliding || state !== 'APPROACHING' && (sway === 0 || sway === 1.499 || sway === 4);
      const before = structuredClone(p), result = resolve(p);
      assert.equal(result.isCrouching, expectedCrouch);
      assert.ok(Math.abs(result.range.verticalDeltaToTarget - (expectedCrouch ? 1.355 : 1.05)) < 1e-12);
      assert.equal(result.range.enemyInKillRange, !expectedCrouch,
        'lowered body center must affect the vertical-threat attack range in this fixture');
      assert.deepEqual(structuredClone(p), before);
    });
for (const complexity of [0, 30, 31]) test(`crouch complexity threshold ${complexity}`, () => {
  const p = input(); p.movementComplexity = complexity;
  assert.equal(resolve(p).isCrouching, complexity > 30);
  p.slideActive = true; assert.equal(resolve(p).isCrouching, true);
});
for (const dt of [1 / 60, 1 / 30]) for (const gate of ['ready', 'outside', 'shield', 'dead', 'swing_up', 'swing_down', 'recovering'] as const)
  test(`coordination commitment clock ${dt}/${gate}`, () => {
    const p = input(); p.dt = dt; p.range.predictedTargetPos.set(0, 0, 5.5); p.range.distanceToTarget = 5.5;
    if (gate === 'outside') { p.range.distanceToTarget += .001; p.range.predictedTargetPos.z += .001; }
    if (gate === 'shield') p.range.targetProtected = true;
    if (gate === 'dead') p.range.targetHp = 0;
    if (['swing_up', 'swing_down', 'recovering'].includes(gate)) p.weaponState = gate;
    assert.equal(resolve(p).coordCommitTimer, gate === 'ready' ? .4 + dt : 0);
  });
for (const dt of [1 / 60, 1 / 30]) for (const distance of [4.5, 4.50001, 8.5, 8.50001])
  for (const enabled of [false, true]) test(`standoff band ${dt}/${distance}/${enabled}`, () => {
    const p = input(); p.dt = dt; p.range.distanceToTarget = distance; p.psychEnabled = enabled;
    const expected = !enabled ? .7 : distance > 4.5 && distance <= 8.5 ? .7 + dt : 0;
    assert.equal(resolve(p).standoffTimer, expected);
  });
test('custom standoff offsets and disabled psychology preserve original boundaries', () => {
  const p = input(); p.standoffRangeMinOffset = -2; p.standoffRangeMaxOffset = 1;
  p.range.distanceToTarget = 4; assert.equal(resolve(p).standoffTimer, .7 + p.dt);
  p.range.distanceToTarget = 1; assert.equal(resolve(p).standoffTimer, 0);
  p.psychEnabled = false; assert.equal(resolve(p).standoffTimer, .7);
});
test('posture reads the entry sway clock without advancing state or sway', () => {
  const p = input(); p.swayTimer = 1.5 - p.dt / 2;
  const result = resolve(p); assert.equal(result.isCrouching, true);
  assert.equal(p.swayTimer, 1.5 - p.dt / 2); assert.equal(p.aiState, 'SIDE_STEPPING');
});
