import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** Enclosed industrial light cards are captured once, never rendered in a live frame. */
export function createHangarLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#131d25');
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(42, 24, 34), new THREE.MeshBasicMaterial({ color: '#27333d', side: THREE.BackSide }));
  enclosure.name = 'hangar_probe_enclosure';
  scene.add(enclosure);
  const panel = (name: string, width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.lookAt(...target);
    scene.add(mesh);
  };
  for (const z of [-7, 7]) panel('hangar_probe_roof_strip', 30, 2.2, '#e3eff7', 4, [0, 10, z], [0, 0, z]);
  for (const x of [-19, 19]) panel('hangar_probe_warm_door', 3, 6, '#ffe0ab', 1.3, [x, 4, 0], [0, 3, 0]);
  for (const z of [-15, 15]) panel('hangar_probe_wall_fill', 26, 2.5, '#adc4d3', .8, [0, 5, z], [0, 3, 0]);
  panel('hangar_probe_floor', 40, 32, '#18222a', 1, [0, -3, 0], [0, 0, 0]);
  return scene;
}

/** Prefiltered overhead fixtures add coating and armor depth without extra shadow passes. */
export function initializeHangarEnvironment(
  scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile,
): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  const probe = createHangarLightProbeScene();
  let generator: THREE.PMREMGenerator | undefined;
  try {
    generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(probe, .02, .1, 100, { size: quality.tier === 'high' ? 256 : 128 });
    scene.environment = target.texture;
    scene.environmentIntensity = quality.tier === 'low' ? .58 : .72;
    environments.set(scene, target);
    previous?.dispose();
  } finally {
    probe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    });
    generator?.dispose();
  }
}

/** Release scene-owned probe/sky handles while preserving the shared sky texture cache. */
export function disposeHangarEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose();
    environments.delete(scene);
  }
  const skies: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === 'skybox_mesh' && object.userData.hangarOwnedSky === true) skies.push(object);
  });
  skies.forEach(sky => {
    sky.removeFromParent();
    sky.geometry.dispose();
    const materials = Array.isArray(sky.material) ? sky.material : [sky.material];
    materials.forEach(material => material.dispose());
  });
}

/** Gentle cool fill and a warm unshadowed rim keep V3 armor readable against the walls. */
export function buildHangarFillLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hangar_fill';
  const hemisphere = new THREE.HemisphereLight('#c0d1df', '#4d4945', .5);
  hemisphere.name = 'hangar_overhead_fill';
  const rim = new THREE.DirectionalLight('#ffe5c1', .45);
  rim.name = 'hangar_warm_rim';
  rim.position.set(16, 11, -16);
  rim.target.position.set(0, 2, 0);
  rim.castShadow = false;
  group.add(hemisphere, rim, rim.target);
  return group;
}

/** Reuse the existing directional shadow; never change the player's key intensity. */
export function configureHangarShadow(
  light: THREE.DirectionalLight, radius: number | { x: number; z: number }, quality: EnvironmentQualityProfile,
): void {
  const half = typeof radius === 'number' ? { x: radius, z: radius } : radius;
  const extent = Math.hypot(half.x, half.z) + 7;
  light.position.set(-extent * .45, extent * 1.4, extent * .35);
  light.target.position.set(0, 0, 0);
  light.color.set('#e5eef7');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5;
  camera.far = extent * 3.2;
  camera.left = camera.bottom = -extent;
  camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015;
  light.shadow.normalBias = .035;
}
