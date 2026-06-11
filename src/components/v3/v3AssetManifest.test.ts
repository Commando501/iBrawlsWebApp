import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_CHARACTER_SLOT_IDS,
  V3_PAINT_ROLES,
  validateV3AssetBudget,
} from './v3ModelTypes';
import { getV3CharacterPartBounds } from './v3PartBounds';
import {
  BUILT_IN_V3_CHARACTER_PARTS,
  V3_DEFAULT_CHARACTER_BUDGET_LIMITS,
  getDefaultV3CharacterBudgetSummary,
  getDefaultV3CharacterLoadout,
  getV3CharacterPartManifest,
} from './v3AssetManifest';

const forbiddenReferenceTerms = [
  'halo',
  'mark',
  'mjolnir',
  'odst',
  'reach',
  'spartan_',
  'unsc',
  'kat_',
  'master_chief',
];

describe('V3 character manifest', () => {
  it('defines one complete default V3 character loadout', () => {
    const loadout = getDefaultV3CharacterLoadout();
    const slots = Object.keys(loadout.partIds).sort();

    assert.equal(loadout.modelSystem, 'v3');
    assert.equal(loadout.id, 'ibrawls-v3-aegis');
    assert.deepEqual(slots, [...V3_CHARACTER_SLOT_IDS].sort());
    assert.equal(new Set(Object.values(loadout.partIds)).size, V3_CHARACTER_SLOT_IDS.length);
  });

  it('defines exactly one default part for every V3 character slot', () => {
    const slots = BUILT_IN_V3_CHARACTER_PARTS.map((part) => part.slot).sort();

    assert.deepEqual(slots, [...V3_CHARACTER_SLOT_IDS].sort());
  });

  it('keeps every character part within canonical roles, bounds, budgets, and lod metadata', () => {
    for (const part of BUILT_IN_V3_CHARACTER_PARTS) {
      assert.equal(part.kind, 'characterPart');
      assert.equal(part.boundsId, part.slot);
      assert.deepEqual(validateV3AssetBudget(part.budget), [], part.id);
      assert.equal(part.lods.length, part.budget.lodCount, `${part.id} lod count`);
      assert.equal(part.paintRoles.length > 0, true, `${part.id} paint roles`);

      for (const role of part.paintRoles) {
        assert.equal(V3_PAINT_ROLES.includes(role), true, `${part.id} invalid role ${role}`);
      }

      const bounds = getV3CharacterPartBounds(part.boundsId);
      assert.equal(bounds.kind, 'characterPart');

      for (const lod of part.lods) {
        assert.deepEqual(validateV3AssetBudget(lod.budget), [], lod.id);
        assert.equal(lod.sourceId.includes(part.id), true, `${lod.id} source id`);
      }
    }
  });

  it('uses original iBrawls naming rather than private reference names', () => {
    const names = [
      getDefaultV3CharacterLoadout().id,
      getDefaultV3CharacterLoadout().label,
      ...BUILT_IN_V3_CHARACTER_PARTS.flatMap((part) => [part.id, part.label, part.designLine]),
    ]
      .join('\n')
      .toLowerCase();

    for (const term of forbiddenReferenceTerms) {
      assert.equal(names.includes(term), false, `forbidden reference term: ${term}`);
    }
  });

  it('summarizes the default character budget under Phase 3 limits', () => {
    const summary = getDefaultV3CharacterBudgetSummary();

    assert.equal(summary.partCount, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(summary.sourceVoxelCount <= V3_DEFAULT_CHARACTER_BUDGET_LIMITS.sourceVoxelCount, true);
    assert.equal(summary.mergedBoxCount <= V3_DEFAULT_CHARACTER_BUDGET_LIMITS.mergedBoxCount, true);
    assert.equal(summary.materialGroupCount <= V3_DEFAULT_CHARACTER_BUDGET_LIMITS.materialGroupCount, true);
    assert.equal(summary.drawCallEstimate <= V3_DEFAULT_CHARACTER_BUDGET_LIMITS.drawCallEstimate, true);
    assert.equal(summary.memoryEstimateKb <= V3_DEFAULT_CHARACTER_BUDGET_LIMITS.memoryEstimateKb, true);
  });

  it('resolves character parts by id using defensive copies', () => {
    const loadout = getDefaultV3CharacterLoadout();
    const helmet = getV3CharacterPartManifest(loadout.partIds.helmet);

    assert.ok(helmet);
    helmet.budget.sourceVoxelCount = 999999;

    assert.notEqual(getV3CharacterPartManifest(loadout.partIds.helmet)?.budget.sourceVoxelCount, 999999);
  });
});
