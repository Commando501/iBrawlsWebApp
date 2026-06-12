import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildVoxelSpartanModel } from '../VoxelModels';
import { createCustomArmorPiece, createCustomArmorSnapshot } from '../customArmor';
import { createCombatantMeshRig } from '../grifball/combatantModels';
import {
  buildV3PistolModel,
  buildV3SpartanModel,
  buildV3WeaponModel,
} from './VoxelModelsV3';
import { V3_CHARACTER_SLOT_IDS, V3_WEAPON_IDS } from './v3ModelTypes';
import { getDefaultV3CharacterLoadout, getDefaultV3WeaponManifest } from './v3AssetManifest';

const requiredSegments = ['lowerTorso', 'upperTorso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

describe('buildV3SpartanModel', () => {
  it('builds a V3 model with required combatant segment groups and manifest metadata', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });

    assert.equal(model.userData.modelSystem, 'v3');
    assert.equal(model.userData.v3CharacterLoadout.id, getDefaultV3CharacterLoadout().id);
    assert.deepEqual(Object.keys(model.userData.v3PartGroups).sort(), [...V3_CHARACTER_SLOT_IDS].sort());

    for (const key of requiredSegments) {
      assert.ok(model.userData[key] instanceof THREE.Group, `missing ${key}`);
    }
  });

  it('produces a visible original blockout inside normalized gameplay scale', () => {
    const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
    model.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());

    assert.ok(size.x > 0.5 && size.x < 2.2, `unexpected width ${size.x}`);
    assert.ok(size.y > 1.2 && size.y < 2.8, `unexpected height ${size.y}`);
    assert.ok(size.z > 0.25 && size.z < 1.8, `unexpected depth ${size.z}`);
  });

  it('builds V3 custom armor pieces in place of matching built-in V3 parts', () => {
    const customHelmet = createCustomArmorSnapshot(createCustomArmorPiece(
      'helmet',
      'Test V3 Helmet',
      Array.from({ length: 130 }, (_, index) => ({
        x: index % 8,
        y: Math.floor(index / 8) % 8,
        z: Math.floor(index / 64),
        role: index % 11 === 0 ? 'visor' : 'primary',
        emissive: index % 11 === 0,
      })),
      'ibv3-aegis-helmet',
      undefined,
      'v3'
    ));

    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      loadout: { modelSystem: 'v3', customArmor: { helmet: customHelmet } },
    });
    const helmet = model.userData.v3PartGroups.helmet as THREE.Group;

    assert.equal(helmet.userData.customArmorId, customHelmet.id);
    assert.equal(helmet.userData.v3Slot, 'helmet');
  });

  it('ignores V2 custom armor snapshots when building a V3 model', () => {
    const v2Helmet = createCustomArmorSnapshot(createCustomArmorPiece(
      'helmet',
      'V2 Helmet',
      Array.from({ length: 130 }, (_, index) => ({
        x: index % 4,
        y: 35 + Math.floor(index / 4) % 8,
        z: Math.floor(index / 32),
        role: 'primary' as const,
      }))
    ));

    const model = buildV3SpartanModel({
      isEnemy: false,
      customHue: 192,
      loadout: { modelSystem: 'v3', customArmor: { helmet: v2Helmet } },
    });
    const helmet = model.userData.v3PartGroups.helmet as THREE.Group;

    assert.equal(helmet.userData.customArmorId, undefined);
    assert.equal(helmet.userData.v3PartId, 'ibv3-aegis-helmet');
  });
});

describe('V3 weapon builders', () => {
  it('builds every V3 weapon with manifest id, weapon type, lod, and socket metadata', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      const manifest = getDefaultV3WeaponManifest(weapon);

      assert.equal(model.userData.modelSystem, 'v3');
      assert.equal(model.userData.weaponType, weapon);
      assert.equal(model.userData.v3ManifestId, manifest.id);
      assert.equal(model.userData.v3Sockets.length, manifest.sockets.length);
      assert.ok(model.children.length > 0, `${weapon} should render geometry`);
    }
  });

  it('exports pistol-specific convenience builder', () => {
    assert.equal(buildV3PistolModel(192).userData.weaponType, 'pistol');
  });

  it('V3 weapon manifests include first-person socket metadata on built weapons', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      const socketNames = model.userData.v3Sockets.map((socket: { name: string }) => socket.name);

      assert.ok(socketNames.includes('firstPersonPrimaryGrip'), `${weapon} missing first-person primary grip`);
      assert.ok(socketNames.includes('firstPersonOffhandGrip'), `${weapon} missing first-person offhand grip`);
    }
  });
});

describe('buildVoxelSpartanModel V3 dispatch', () => {
  it('preserves V1 and V2 dispatch while routing V3 separately', () => {
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v1' }).userData.modelSystem, undefined);
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v2' }).userData.modelSystem, 'v2');
    assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v3' }).userData.modelSystem, 'v3');
  });

  it('passes V3 quality options into V3 builders', () => {
    const model = buildVoxelSpartanModel(false, 192, { modelSystem: 'v3' }, {
      v3QualityTier: 'mobileLow',
      v3Distance: 32,
    });

    assert.equal(model.userData.v3QualityTier, 'mobileLow');
    assert.equal(model.userData.v3Distance, 32);
  });

  it('createCombatantMeshRig uses V3 weapon builders for V3 loadouts', () => {
    const scene = new THREE.Scene();
    const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });

    assert.equal(meshes.group.userData.modelSystem, 'v3');
    assert.equal(meshes.hammer.userData.modelSystem, 'v3');
    assert.equal(meshes.sword.userData.modelSystem, 'v3');
    assert.equal(meshes.pistol?.userData.modelSystem, 'v3');
    assert.equal(meshes.hammer.userData.weaponType, 'hammer');
    assert.equal(meshes.sword.userData.weaponType, 'sword');
    assert.equal(meshes.pistol?.userData.weaponType, 'pistol');
  });
});
