import * as THREE from 'three';
import {
  createCombatantMeshRig,
  type CombatantMeshRig,
} from '../components/grifball/combatantModels';
import { summarizeV3SceneRenderBudget } from '../components/v3/v3PerformanceBudget';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import type { V3QualityTier } from '../components/v3/v3ModelTypes';

export interface V3PerformanceSmokeCombatant {
  id: string;
  meshes: CombatantMeshRig;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
}

const weapons = ['hammer', 'sword', 'pistol'] as const;

export function createV3PerformanceSmokeCombatants(
  scene: THREE.Scene,
  qualityTier: V3QualityTier
): V3PerformanceSmokeCombatant[] {
  return Array.from({ length: 8 }, (_, index) => {
    const meshes = createCombatantMeshRig(scene, (index * 47) % 360, false, { modelSystem: 'v3' }, {
      v3QualityTier: qualityTier,
      v3Distance: index * 3,
    });
    const row = index < 4 ? 0 : 1;
    const col = index % 4;
    meshes.group.position.set((col - 1.5) * 1.8, 0, row === 0 ? -1.4 : 1.4);
    meshes.group.rotation.y = row === 0 ? 0.25 : Math.PI - 0.25;

    const activeWeapon = weapons[index % weapons.length];
    meshes.hammer.visible = activeWeapon === 'hammer';
    meshes.sword.visible = activeWeapon === 'sword';
    if (meshes.pistol) {
      meshes.pistol.visible = activeWeapon === 'pistol';
    }

    return {
      id: `smoke-${index + 1}`,
      meshes,
      activeWeapon,
    };
  });
}

export function buildV3PerformanceSmokeScene({
  qualityTier,
}: {
  qualityTier: V3QualityTier;
}) {
  const normalizedTier = normalizeV3QualityTier(qualityTier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#071014');

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
  camera.position.set(0, 3.2, 8);
  camera.lookAt(0, 0.9, 0);

  scene.add(new THREE.HemisphereLight('#ffffff', '#223344', 1.7));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 6),
    new THREE.MeshStandardMaterial({
      color: '#0f1f25',
      roughness: 0.78,
      metalness: 0.08,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const combatants = createV3PerformanceSmokeCombatants(scene, normalizedTier);
  const budget = summarizeV3SceneRenderBudget(scene);
  return {
    scene,
    camera,
    combatants,
    budget,
    qualityTier: normalizedTier,
  };
}
