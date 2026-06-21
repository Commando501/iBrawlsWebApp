import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { createCombatantMeshRig } from './combatantModels';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { animateV3CombatantModel } from './combatantAnimationV3';
import { analyzeV3UpperBodyContinuity } from './v3UpperBodyContinuity';
import type { CharacterLoadout } from '../VoxelModels';

const V3_TEST_LOADOUT: CharacterLoadout = {
  modelSystem: 'v3',
  paintJob: {
    v3RoleColors: {
      primary: '#67d7ff',
      secondary: '#334155',
      accent: '#fbbf24',
      visor: '#67e8f9',
      emissive: '#5eead4',
      undersuit: '#111827',
    },
    v3RoleEmissive: {
      visor: true,
      emissive: true,
    },
  },
};

describe('V3 upper-body continuity', () => {
  it('keeps idle left shoulder and arm slots visibly connected after weapon carry settles', () => {
    const scene = new THREE.Scene();
    const meshRig = createCombatantMeshRig(scene, 192, false, V3_TEST_LOADOUT, {
      v3SourceFidelity: 'exact',
    });
    const refs = createInitialGrifballThreeRefs();
    refs.scene = scene;

    animateV3CombatantModel({
      refs,
      mesh: meshRig.group,
      vel: new THREE.Vector3(0, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      weaponTimer: 0,
      dt: 1 / 60,
      isLocalV3Animation: true,
      animationClockMs: 0,
      settings: {},
    });

    const report = analyzeV3UpperBodyContinuity(meshRig.group);
    const leftShoulder = report.links.find((link) => link.id === 'shoulder-upperArm-left');

    assert.equal(report.ready, true, report.issues.join(', '));
    assert.ok(leftShoulder, 'missing shoulder-upperArm-left continuity link');
    assert.ok(leftShoulder.visibleGap <= 0.055, `left shoulder gap ${leftShoulder.visibleGap}`);
  });
});
