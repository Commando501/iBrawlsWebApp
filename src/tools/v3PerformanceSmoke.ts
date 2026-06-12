import * as THREE from 'three';
import {
  createCombatantMeshRig,
  type CombatantMeshRig,
} from '../components/grifball/combatantModels';
import { summarizeV3SceneRenderBudget, type V3RenderBudgetSummary } from '../components/v3/v3PerformanceBudget';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import { V3_QUALITY_TIERS, type V3QualityTier } from '../components/v3/v3ModelTypes';
import type { CharacterLoadout } from '../components/VoxelModels';

export interface V3PerformanceSmokeCombatant {
  id: string;
  meshes: CombatantMeshRig;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  loadout: CharacterLoadout;
}

export interface V3PerformanceSmokeBudgetGate {
  maxDrawCallEstimate: number;
  maxMergedBoxCount: number;
  maxMemoryEstimateKb: number;
}

export interface V3PerformanceSmokeReport {
  ready: boolean;
  qualityTier: V3QualityTier;
  combatantCount: number;
  weaponCoverage: ('hammer' | 'pistol' | 'sword')[];
  budget: V3RenderBudgetSummary;
  gates: V3PerformanceSmokeBudgetGate;
  issues: string[];
}

export const V3_PERFORMANCE_SMOKE_BUDGETS: Record<V3QualityTier, V3PerformanceSmokeBudgetGate> = {
  mobileLow: { maxDrawCallEstimate: 270, maxMergedBoxCount: 11250, maxMemoryEstimateKb: 9800 },
  mobile: { maxDrawCallEstimate: 270, maxMergedBoxCount: 11250, maxMemoryEstimateKb: 9800 },
  desktop: { maxDrawCallEstimate: 410, maxMergedBoxCount: 16800, maxMemoryEstimateKb: 14600 },
  ultra: { maxDrawCallEstimate: 500, maxMergedBoxCount: 20250, maxMemoryEstimateKb: 17600 },
};

const weapons = ['hammer', 'sword', 'pistol'] as const;

const smokePaints = [
  ['#4f86f7', '#f97316'],
  ['#ef4444', '#22d3ee'],
  ['#22c55e', '#eab308'],
  ['#a855f7', '#f8fafc'],
] as const;

function createSmokeLoadout(index: number): CharacterLoadout {
  const [primary, accent] = smokePaints[index % smokePaints.length];
  return {
    modelSystem: 'v3',
    helmet: index % 2 === 0 ? 'mark-vi' : 'odst',
    torso: 'mark-vi',
    arm: 'mark-vi',
    leg: 'mark-vi',
    hammerPreset: index % 2 === 0 ? 'gravity-axe' : 'default',
    swordPreset: index % 3 === 0 ? 'infinite' : 'default',
    paintJob: {
      v3RoleColors: {
        primary,
        accent,
        visor: '#67e8f9',
        emissive: '#5eead4',
      },
      v3RoleEmissive: {
        visor: true,
        emissive: true,
      },
    },
  };
}

export function createV3PerformanceSmokeCombatants(
  scene: THREE.Scene,
  qualityTier: V3QualityTier
): V3PerformanceSmokeCombatant[] {
  return Array.from({ length: 8 }, (_, index) => {
    const loadout = createSmokeLoadout(index);
    const meshes = createCombatantMeshRig(scene, (index * 47) % 360, false, loadout, {
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
      loadout,
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

export function buildV3PerformanceSmokeReport(
  smoke: ReturnType<typeof buildV3PerformanceSmokeScene>
): V3PerformanceSmokeReport {
  const gates = V3_PERFORMANCE_SMOKE_BUDGETS[smoke.qualityTier];
  const weaponCoverage = [...new Set(smoke.combatants.map((entry) => entry.activeWeapon))]
    .sort() as ('hammer' | 'pistol' | 'sword')[];
  const issues: string[] = [];

  if (smoke.combatants.length !== 8) {
    issues.push(`expected 8 combatants, found ${smoke.combatants.length}`);
  }
  if (!V3_QUALITY_TIERS.includes(smoke.qualityTier)) {
    issues.push(`invalid quality tier ${smoke.qualityTier}`);
  }
  for (const weapon of weapons) {
    if (!weaponCoverage.includes(weapon)) {
      issues.push(`missing ${weapon} combatant`);
    }
  }
  if (smoke.budget.modelCount !== 8) {
    issues.push(`expected 8 V3 models, found ${smoke.budget.modelCount}`);
  }
  if (smoke.budget.drawCallEstimate > gates.maxDrawCallEstimate) {
    issues.push(`draw call estimate ${smoke.budget.drawCallEstimate} exceeds ${gates.maxDrawCallEstimate}`);
  }
  if (smoke.budget.mergedBoxCount > gates.maxMergedBoxCount) {
    issues.push(`merged box count ${smoke.budget.mergedBoxCount} exceeds ${gates.maxMergedBoxCount}`);
  }
  if (smoke.budget.memoryEstimateKb > gates.maxMemoryEstimateKb) {
    issues.push(`memory estimate ${smoke.budget.memoryEstimateKb}KB exceeds ${gates.maxMemoryEstimateKb}KB`);
  }

  return {
    ready: issues.length === 0,
    qualityTier: smoke.qualityTier,
    combatantCount: smoke.combatants.length,
    weaponCoverage,
    budget: smoke.budget,
    gates,
    issues,
  };
}

export function assertV3PerformanceSmokeBudget(
  smoke: ReturnType<typeof buildV3PerformanceSmokeScene>
): void {
  const report = buildV3PerformanceSmokeReport(smoke);
  if (!report.ready) {
    throw new Error(`V3 performance smoke failed: ${report.issues.join('; ')}`);
  }
}
