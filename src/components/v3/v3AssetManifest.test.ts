import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_CHARACTER_SLOT_IDS,
  V3_PAINT_ROLES,
  V3_WEAPON_IDS,
  validateV3AssetBudget,
} from './v3ModelTypes';
import { getV3CharacterPartBounds, getV3WeaponBounds } from './v3PartBounds';
import {
  BUILT_IN_V3_CHARACTER_PARTS,
  BUILT_IN_V3_WEAPONS,
  V3_DEFAULT_CHARACTER_BUDGET_LIMITS,
  V3_DEFAULT_WEAPON_BUDGET_LIMITS,
  getDefaultV3CharacterBudgetSummary,
  getDefaultV3CharacterLoadout,
  getDefaultV3WeaponBudgetSummary,
  getDefaultV3WeaponManifest,
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

const requiredWeaponSockets = [
  'thirdPersonPrimaryGrip',
  'thirdPersonOffhandGrip',
  'firstPersonPrimaryGrip',
  'firstPersonOffhandGrip',
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

describe('V3 weapon manifest', () => {
  it('defines one built-in hammer, sword, and pistol manifest', () => {
    const weaponIds = BUILT_IN_V3_WEAPONS.map((weapon) => weapon.weapon).sort();

    assert.deepEqual(weaponIds, [...V3_WEAPON_IDS].sort());
  });

  it('keeps every weapon within canonical roles, bounds, budgets, lods, and grip sockets', () => {
    for (const weapon of BUILT_IN_V3_WEAPONS) {
      assert.equal(weapon.kind, 'weapon');
      assert.equal(weapon.boundsId, weapon.weapon);
      assert.deepEqual(validateV3AssetBudget(weapon.budget), [], weapon.id);
      assert.equal(weapon.lods.length, weapon.budget.lodCount, `${weapon.id} lod count`);
      assert.equal(weapon.paintRoles.length > 0, true, `${weapon.id} paint roles`);

      for (const role of weapon.paintRoles) {
        assert.equal(V3_PAINT_ROLES.includes(role), true, `${weapon.id} invalid role ${role}`);
      }

      const bounds = getV3WeaponBounds(weapon.boundsId);
      assert.equal(bounds.kind, 'weapon');

      for (const lod of weapon.lods) {
        assert.deepEqual(validateV3AssetBudget(lod.budget), [], lod.id);
        assert.equal(lod.sourceId.includes(weapon.id), true, `${lod.id} source id`);
      }

      const socketNames = weapon.sockets.map((socket) => socket.name).sort();
      assert.deepEqual(socketNames, [...requiredWeaponSockets].sort(), `${weapon.id} sockets`);

      for (const socket of weapon.sockets) {
        assert.equal(socket.position.length, 3, `${weapon.id} ${socket.name} position`);
        assert.equal(socket.rotation.length, 3, `${weapon.id} ${socket.name} rotation`);
        assert.equal(socket.position.every(Number.isFinite), true, `${weapon.id} ${socket.name} position finite`);
        assert.equal(socket.rotation.every(Number.isFinite), true, `${weapon.id} ${socket.name} rotation finite`);
      }
    }
  });

  it('uses original iBrawls naming for weapon manifests', () => {
    const names = BUILT_IN_V3_WEAPONS.flatMap((weapon) => [
      weapon.id,
      weapon.label,
      weapon.designLine,
      ...weapon.lods.map((lod) => lod.sourceId),
    ])
      .join('\n')
      .toLowerCase();

    for (const term of forbiddenReferenceTerms) {
      assert.equal(names.includes(term), false, `forbidden reference term: ${term}`);
    }
  });

  it('summarizes default weapon budgets under Phase 3 limits', () => {
    const summary = getDefaultV3WeaponBudgetSummary();

    assert.equal(summary.partCount, V3_WEAPON_IDS.length);
    assert.equal(summary.sourceVoxelCount <= V3_DEFAULT_WEAPON_BUDGET_LIMITS.sourceVoxelCount, true);
    assert.equal(summary.mergedBoxCount <= V3_DEFAULT_WEAPON_BUDGET_LIMITS.mergedBoxCount, true);
    assert.equal(summary.materialGroupCount <= V3_DEFAULT_WEAPON_BUDGET_LIMITS.materialGroupCount, true);
    assert.equal(summary.drawCallEstimate <= V3_DEFAULT_WEAPON_BUDGET_LIMITS.drawCallEstimate, true);
    assert.equal(summary.memoryEstimateKb <= V3_DEFAULT_WEAPON_BUDGET_LIMITS.memoryEstimateKb, true);
  });

  it('resolves weapon manifests by weapon id using defensive copies', () => {
    const hammer = getDefaultV3WeaponManifest('hammer');
    const hammerGripPosition = hammer.sockets[0].position as [number, number, number];

    hammer.budget.sourceVoxelCount = 999999;
    hammerGripPosition[0] = 999999;

    assert.notEqual(getDefaultV3WeaponManifest('hammer').budget.sourceVoxelCount, 999999);
    assert.notEqual(getDefaultV3WeaponManifest('hammer').sockets[0].position[0], 999999);
  });
});
