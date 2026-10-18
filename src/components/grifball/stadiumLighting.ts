import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** Fade beam silhouettes and their floor intersections instead of drawing solid cone edges. */
export function createStadiumLightShaftMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'stadium_soft_light_shaft',
    uniforms: { beamColor: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    forceSinglePass: true, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 beamNormal;
      varying vec3 beamView;
      varying vec2 beamUv;
      varying float beamHeight;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        beamNormal = normalize(normalMatrix * normal);
        beamView = -mvPosition.xyz;
        beamUv = uv;
        beamHeight = worldPosition.y;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: `
      uniform vec3 beamColor;
      varying vec3 beamNormal;
      varying vec3 beamView;
      varying vec2 beamUv;
      varying float beamHeight;
      void main() {
        float edge = pow(abs(dot(normalize(beamNormal), normalize(beamView))), 1.5);
        float floorFade = smoothstep(2.0, 8.0, beamHeight);
        float tipFade = 1.0 - smoothstep(0.97, 1.0, beamUv.y);
        gl_FragColor = vec4(beamColor, 0.045 * edge * floorFade * tipFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Arena-shaped light cards are baked once into a probe, never drawn during gameplay. */
export function createStadiumLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101921');
  const panel = (width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(...position);
    mesh.lookAt(...target);
    scene.add(mesh);
  };
  // Long roof apertures give armor and coated floor directional highlights.
  for (const z of [-8, 8]) panel(32, 3.5, '#e6efff', 3.2, [0, 14, z], [0, 0, z]);
  // Restrained warm broadcast fixtures break up the otherwise cool palette.
  for (const x of [-24, 24]) panel(4, 7, '#ffe6bf', 1.5, [x, 7, 0], [0, 3, 0]);
  for (const z of [-18, 18]) panel(22, 2.5, '#91b7d3', 0.75, [0, 6, z], [0, 3, 0]);
  panel(60, 45, '#121b23', 1, [0, -3, 0], [0, 0, 0]);
  return scene;
}

/** Prefiltered roof lighting gives materials depth without extra per-frame shadow passes. */
export function initializeStadiumEnvironment(
  scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile,
): void {
  const room = createStadiumLightProbeScene();
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    const target = generator.fromScene(room, 0.025, 0.1, 100, { size: quality.tier === 'high' ? 256 : 128 });
    scene.environment = target.texture;
    scene.environmentIntensity = quality.tier === 'low' ? 0.55 : 0.7;
    environments.set(scene, target);
  } finally {
    room.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    });
    generator.dispose();
  }
}

export function disposeStadiumEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (!target) return;
  if (scene.environment === target.texture) scene.environment = null;
  target.dispose();
  environments.delete(scene);
}

/** One sun shadow covers the full playable court. Decoration never adds shadow lights. */
export function configureStadiumShadow(
  light: THREE.DirectionalLight, half: { x: number; z: number }, quality: EnvironmentQualityProfile,
): void {
  const extent = Math.hypot(half.x, half.z) + 5;
  light.position.set(-extent * 0.6, extent * 1.1, extent * 0.45);
  light.color.set('#e4edff');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = 0.5;
  camera.far = extent * 3;
  camera.left = camera.bottom = -extent;
  camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -0.00015;
  light.shadow.normalBias = 0.035;
}

/** One unshadowed rim separates dark armor from the stands; Low retains the same readability. */
export function buildStadiumFillLighting(half: { x: number; z: number }): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stadium_fill';
  group.add(new THREE.HemisphereLight('#b6cee6', '#242128', 0.48));
  const rim = new THREE.DirectionalLight('#ffe7ce', 0.65);
  rim.name = 'stadium_rim';
  rim.position.set(half.x * 0.65, 18, -half.z * 1.3);
  rim.castShadow = false;
  group.add(rim, rim.target);
  return group;
}
