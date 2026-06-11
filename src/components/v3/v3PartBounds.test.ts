import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { V3_CHARACTER_SLOT_IDS, V3_WEAPON_IDS } from './v3ModelTypes';
import {
  getV3CharacterPartBounds,
  getV3WeaponBounds,
  validateV3FitBounds,
  type V3FitBounds,
} from './v3PartBounds';

describe('V3 fit bounds', () => {
  it('defines valid visual bounds for every character slot', () => {
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const bounds = getV3CharacterPartBounds(slot);

      assert.equal(bounds.id, slot);
      assert.equal(bounds.kind, 'characterPart');
      assert.equal(bounds.centerOffset.length, 3);
      assert.equal(bounds.maxDimensions.x > 0, true, `${slot} max x`);
      assert.equal(bounds.maxDimensions.y > 0, true, `${slot} max y`);
      assert.equal(bounds.maxDimensions.z > 0, true, `${slot} max z`);
      assert.deepEqual(validateV3FitBounds(bounds), []);
    }
  });

  it('defines valid visual bounds and grip safety envelopes for every weapon', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const bounds = getV3WeaponBounds(weapon);

      assert.equal(bounds.id, weapon);
      assert.equal(bounds.kind, 'weapon');
      assert.equal(bounds.centerOffset.length, 3);
      assert.equal(bounds.maxDimensions.x > 0, true, `${weapon} max x`);
      assert.equal(bounds.maxDimensions.y > 0, true, `${weapon} max y`);
      assert.equal(bounds.maxDimensions.z > 0, true, `${weapon} max z`);
      assert.equal((bounds.gripSafetyEnvelope?.radius ?? 0) > 0, true, `${weapon} grip radius`);
      assert.deepEqual(validateV3FitBounds(bounds), []);
    }
  });

  it('reports missing or non-positive dimensions', () => {
    const issues = validateV3FitBounds({
      id: '',
      kind: 'characterPart',
      maxDimensions: { x: 0, y: -2, z: Number.NaN },
      centerOffset: [0, 0] as any,
    });

    assert.match(issues.join('\n'), /id/);
    assert.match(issues.join('\n'), /maxDimensions.x/);
    assert.match(issues.join('\n'), /maxDimensions.y/);
    assert.match(issues.join('\n'), /maxDimensions.z/);
    assert.match(issues.join('\n'), /centerOffset/);
  });

  it('reports malformed weapon grip safety envelopes', () => {
    const issues = validateV3FitBounds({
      id: 'hammer',
      kind: 'weapon',
      maxDimensions: { x: 8, y: 34, z: 8 },
      centerOffset: [0, 0, 0],
      gripSafetyEnvelope: { radius: 0, length: -1 },
    });

    assert.match(issues.join('\n'), /gripSafetyEnvelope.radius/);
    assert.match(issues.join('\n'), /gripSafetyEnvelope.length/);
  });

  it('returns defensive copies so callers cannot mutate canonical bounds', () => {
    const helmet = getV3CharacterPartBounds('helmet');
    const hammer = getV3WeaponBounds('hammer');

    helmet.maxDimensions.x = 999;
    helmet.centerOffset[0] = 999;
    if (hammer.gripSafetyEnvelope) {
      hammer.gripSafetyEnvelope.radius = 999;
    }

    assert.notEqual(getV3CharacterPartBounds('helmet').maxDimensions.x, 999);
    assert.notEqual(getV3CharacterPartBounds('helmet').centerOffset[0], 999);
    assert.notEqual(getV3WeaponBounds('hammer').gripSafetyEnvelope?.radius, 999);
  });
});
