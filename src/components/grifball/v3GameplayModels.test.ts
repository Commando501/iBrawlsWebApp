import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getV3GameplayRenderOptions } from '../v3/v3QualityTiers';
import { V3_CHARACTER_SLOT_IDS, V3_QUALITY_TIERS } from '../v3/v3ModelTypes';
import { createCombatantMeshRig, rebuildDualWeaponCombatantModel } from './combatantModels';

test('gameplay preserves complete V3 armor when quality drops, including rebuilt combatants', () => {
  for (const tier of V3_QUALITY_TIERS) {
    const options = getV3GameplayRenderOptions(tier);
    assert.equal(options.v3QualityTier, tier);
    assert.equal(options.v3SourceFidelity, 'exact');
  }
  const scene = new THREE.Scene();
  const v3Options = getV3GameplayRenderOptions('mobileLow');
  const initial = createCombatantMeshRig(scene, 200, true, { modelSystem: 'v3' }, v3Options, 'blue');
  const rebuilt = rebuildDualWeaponCombatantModel({
    scene, previousGroup: initial.group, isEnemyBot: true, hue: 200,
    loadout: { modelSystem: 'v3' }, position: new THREE.Vector3(3, 0, 2),
    activeWeapon: 'hammer', v3Options, teamArmorTeam: 'blue',
  });
  assert.equal(initial.group.parent, null);
  for (const model of [initial.group, rebuilt.group]) {
    assert.equal(model.userData.v3SourceFidelity, 'exact');
    const visible = new Set<THREE.Object3D>();
    model.traverseVisible(object => visible.add(object));
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const geometry = model.userData.v3PartGeometryGroups[slot] as THREE.Group;
      assert.equal(geometry.userData.v3SourceFidelity, 'exact', slot);
      assert.ok(geometry.children.some(child => child instanceof THREE.Mesh && visible.has(child)), slot);
      assert.ok(model.userData.v3PartGroups[slot].userData.v3SelectedLod.budget.sourceVoxelCount > 0, slot);
    }
  }
});
