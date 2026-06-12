import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildLocalPlayerViewForRefs } from './localPlayerViewRuntime';
import { sampleV3FirstPersonWeaponPose } from './v3AnimationFidelity';
import { createInitialGrifballThreeRefs } from './threeRefs';

const assertWeaponPose = (model: THREE.Group | null | undefined, pose: ReturnType<typeof sampleV3FirstPersonWeaponPose>) => {
  assert.ok(model);
  assert.deepEqual(model.position.toArray(), pose.position);
  assert.deepEqual(model.rotation.toArray().slice(0, 3), pose.rotation);
};

const groupContainsHexColor = (group: THREE.Object3D | null | undefined, color: string): boolean => {
  if (!group) return false;
  const target = color.replace('#', '').toLowerCase();
  let found = false;
  group.traverse((object) => {
    if (found || !(object instanceof THREE.Mesh)) return;
    const attribute = object.geometry.getAttribute('color');
    if (attribute) {
      for (let i = 0; i < attribute.count; i++) {
        const vertexColor = new THREE.Color(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
        if (vertexColor.getHexString() === target) {
          found = true;
          return;
        }
      }
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const materialColor = (material as THREE.Material & { color?: THREE.Color }).color;
      if (materialColor?.getHexString() === target) {
        found = true;
        return;
      }
    }
  });
  return found;
};

test('local first-person view uses V3 weapon builders for V3 loadouts', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 192 },
    playerLoadout: { modelSystem: 'v3' },
  });

  assert.equal(refs.playerHammer?.userData.modelSystem, 'v3');
  assert.equal(refs.playerSword?.userData.modelSystem, 'v3');
  assert.equal(refs.playerPistol?.userData.modelSystem, 'v3');
  assert.equal(refs.playerHammer?.userData.weaponType, 'hammer');
  assert.equal(refs.playerSword?.userData.weaponType, 'sword');
  assert.equal(refs.playerPistol?.userData.weaponType, 'pistol');
});

test('local first-person V3 weapons receive render quality options', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 192 },
    playerLoadout: { modelSystem: 'v3' },
    v3Options: {
      v3QualityTier: 'mobileLow',
    },
  });

  assert.equal(refs.playerHammer?.userData.v3QualityTier, 'mobileLow');
  assert.equal(refs.playerSword?.userData.v3QualityTier, 'mobileLow');
  assert.equal(refs.playerPistol?.userData.v3QualityTier, 'mobileLow');
});

test('local first-person V3 weapons receive loadout role paint', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 192 },
    playerLoadout: {
      modelSystem: 'v3',
      paintJob: {
        v3RoleColors: {
          primary: '#56789a',
        },
      },
    },
  });

  assert.equal(groupContainsHexColor(refs.playerHammer, '#56789a'), true);
  assert.equal(groupContainsHexColor(refs.playerSword, '#56789a'), true);
  assert.equal(groupContainsHexColor(refs.playerPistol, '#56789a'), true);
});

test('local first-person V3 weapons start from shared V3 first-person poses', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 192 },
    playerLoadout: { modelSystem: 'v3' },
  });

  assertWeaponPose(refs.playerHammer, sampleV3FirstPersonWeaponPose({
    activeWeapon: 'hammer',
    weaponState: 'ready',
    weaponTimer: 0,
    isLunging: false,
    settings: {},
  }));
  assertWeaponPose(refs.playerSword, sampleV3FirstPersonWeaponPose({
    activeWeapon: 'sword',
    weaponState: 'ready',
    weaponTimer: 0,
    isLunging: false,
    settings: {},
  }));
  assertWeaponPose(refs.playerPistol, sampleV3FirstPersonWeaponPose({
    activeWeapon: 'pistol',
    weaponState: 'ready',
    weaponTimer: 0,
    isLunging: false,
    settings: {},
  }));
});
