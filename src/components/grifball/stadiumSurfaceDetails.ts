import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { getStadiumArchitecturePlacements } from './stadiumArchitecture';
import { applyStadiumWorldUVs } from './stadiumMaterials';

interface SurfaceMaterials {
  alloy: THREE.Material;
  graphite: THREE.Material;
  ceramic: THREE.Material;
}
type SurfacePart = 'kickplates' | 'trim' | 'service_panels' | 'gaskets' | 'team_markers';
interface SurfaceInstance { matrix: THREE.Matrix4; color?: THREE.Color }

/** Close-range detail belongs on the barriers, leaving the playing surface quiet. */
export function createStadiumSurfaceDetails(
  half: { x: number; z: number },
  quality: Pick<EnvironmentQualityProfile, 'tier' | 'architectureDetail'>,
  materials: SurfaceMaterials,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stadium_surface_details';
  const detailed = quality.tier !== 'low';
  const instances: Record<SurfacePart, SurfaceInstance[]> = {
    kickplates: [], trim: [], service_panels: [], gaskets: [], team_markers: [],
  };
  const transform = new THREE.Object3D();
  const position = new THREE.Vector3();
  const add = (
    part: SurfacePart, parent: THREE.Matrix4,
    x: number, y: number, z: number, width: number, height: number, depth: number,
    color?: THREE.Color, pitch = 0,
  ) => {
    transform.position.set(x, y, z);
    transform.rotation.set(pitch, 0, 0);
    transform.scale.set(width, height, depth);
    transform.updateMatrix();
    instances[part].push({ matrix: parent.clone().multiply(transform.matrix), color });
  };

  // Reuse the authored barrier transforms, including their clear 12m goal mouths.
  // Local +Z is the court-facing side. The nearest new surface remains over 0.8m
  // outside the playable rectangle; all parts stay within the barrier footprint.
  const barriers = getStadiumArchitecturePlacements(half, quality.architectureDetail)['barrier-panel'];
  barriers.forEach((parent, index) => {
    add('kickplates', parent, 0, 0.25, 0.43, 7.8, 0.38, 0.12);
    add('trim', parent, 0, 3.12, 0.41, 7.86, 0.08, 0.13);
    add('trim', parent, 0, 0.47, 0.45, 7.8, 0.035, 0.1);

    position.setFromMatrixPosition(parent);
    const teamColor = new THREE.Color(position.x < -half.x * 0.25 ? '#547c9e'
      : position.x > half.x * 0.25 ? '#a15e65' : '#5d8a91');
    add('team_markers', parent, -2.25, 2.86, 0.43, 1.2, 0.065, 0.035, teamColor);
    if (!detailed) return;

    // Real shallow reveals and metal lips provide readable contact depth without
    // adding decals, floor grime, or another dynamic light/shadow pass.
    for (const x of [-3.86, 3.86]) {
      add('gaskets', parent, x, 1.69, 0.405, 0.045, 2.38, 0.025);
    }
    add('gaskets', parent, 0, 0.515, 0.405, 7.67, 0.032, 0.03);
    if (index % 2 !== 0) return;

    // A small alternating maintenance cassette keeps the broad ceramic panels
    // dominant. Vents are physical angled louvers, batched with the upper caps.
    add('kickplates', parent, 2.24, 0.94, 0.445, 1.66, 0.68, 0.09);
    add('service_panels', parent, 2.24, 0.94, 0.5, 1, 1, 1);
    add('kickplates', parent, -2.3, 0.86, 0.445, 1.48, 0.49, 0.09);
    for (let slat = 0; slat < 4; slat++) {
      add('trim', parent, -2.3, 0.71 + slat * 0.1, 0.505, 1.32, 0.035, 0.085, undefined, -0.24);
    }
    add('gaskets', parent, 2.71, 0.94, 0.552, 0.12, 0.035, 0.015);
  });

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const serviceShape = new THREE.Shape();
  serviceShape.moveTo(-0.69, -0.26);
  serviceShape.lineTo(0.69, -0.26);
  serviceShape.lineTo(0.75, -0.2);
  serviceShape.lineTo(0.75, 0.2);
  serviceShape.lineTo(0.69, 0.26);
  serviceShape.lineTo(-0.69, 0.26);
  serviceShape.lineTo(-0.75, 0.2);
  serviceShape.lineTo(-0.75, -0.2);
  serviceShape.closePath();
  const serviceGeometry = detailed ? new THREE.ExtrudeGeometry(serviceShape, {
    depth: 0.035, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014,
    bevelSegments: 1, curveSegments: 1, steps: 1,
  }) : undefined;
  if (serviceGeometry) applyStadiumWorldUVs(serviceGeometry, 3);
  const materialByPart: Partial<Record<SurfacePart, THREE.Material>> = {
    kickplates: materials.graphite,
    trim: materials.alloy,
    service_panels: materials.ceramic,
    ...(detailed ? { gaskets: new THREE.MeshStandardMaterial({ color: '#111b23', roughness: 0.98, metalness: 0 }) } : {}),
    team_markers: new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 0.48, metalness: 0.28,
      emissive: '#30434e', emissiveIntensity: 0.16,
    }),
  };
  for (const part of Object.keys(instances) as SurfacePart[]) {
    const items = instances[part];
    if (!items.length) continue;
    const mesh = new THREE.InstancedMesh(part === 'service_panels' ? serviceGeometry! : unitBox, materialByPart[part]!, items.length);
    mesh.name = `stadium_surface_${part}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    items.forEach((item, index) => {
      mesh.setMatrixAt(index, item.matrix);
      if (item.color) mesh.setColorAt(index, item.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
