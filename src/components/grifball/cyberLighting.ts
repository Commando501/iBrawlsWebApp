import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** One static atmospheric draw. No scrolling grid, stars, noise, lasers, or texture downloads. */
export function createCyberSkyMaterial(hue = 250, brightness = 5): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'cyber_sky', side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color() }, midColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() }, groundColor: { value: new THREE.Color() },
      skyExposure: { value: 1 },
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = (modelMatrix * vec4(position, 0.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: `
      uniform vec3 zenithColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      uniform float skyExposure;
      varying vec3 skyDirection;
      void main() {
        float elevation = normalize(skyDirection).y;
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.32, elevation));
        sky = mix(sky, zenithColor, smoothstep(0.2, 0.95, elevation));
        sky = mix(groundColor, sky, smoothstep(-0.3, 0.015, elevation));
        gl_FragColor = vec4(sky * skyExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  updateCyberSkyMaterial(material, hue, brightness);
  return material;
}

/** Live settings update uniforms only, keeping authored light and reflection directions stable. */
export function updateCyberSkyMaterial(material: THREE.ShaderMaterial, hue: number, brightness: number): void {
  if (material.name !== 'cyber_sky') return;
  const normalizedHue = (((Number.isFinite(hue) ? hue : 250) % 360) + 360) % 360 / 360;
  (material.uniforms.zenithColor.value as THREE.Color).setHSL(normalizedHue, .28, .075, THREE.SRGBColorSpace);
  (material.uniforms.midColor.value as THREE.Color).setHSL((normalizedHue + 340 / 360) % 1, .24, .17, THREE.SRGBColorSpace);
  (material.uniforms.horizonColor.value as THREE.Color).setHSL((normalizedHue + 325 / 360) % 1, .17, .27, THREE.SRGBColorSpace);
  (material.uniforms.groundColor.value as THREE.Color).setHSL(normalizedHue, .18, .085, THREE.SRGBColorSpace);
  material.uniforms.skyExposure.value = Math.max(0, Math.min(Number.isFinite(brightness) ? brightness : 5, 10)) / 5;
}

/** Broad, bake-only lighting cards give armor and coating highlights without live spotlights. */
export function createCyberLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#202839');
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(42, 30, 42), new THREE.MeshBasicMaterial({ color: '#374654', side: THREE.BackSide }));
  enclosure.name = 'cyber_probe_enclosure';
  scene.add(enclosure);
  const panel = (name: string, width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name; mesh.position.set(...position); mesh.lookAt(...target); scene.add(mesh);
  };
  panel('cyber_probe_key', 22, 9, '#e0eaf5', 3.8, [-9, 13, 6], [0, 0, 0]);
  panel('cyber_probe_rim', 4, 13, '#b8d7e9', 2, [17, 5, -13], [0, 3, 0]);
  panel('cyber_probe_horizon', 30, 5, '#aaa8c5', .85, [0, 4, -20], [0, 3, 0]);
  panel('cyber_probe_ground', 40, 40, '#242d38', 1, [0, -6, 0], [0, 0, 0]);
  return scene;
}

export function initializeCyberEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  const probe = createCyberLightProbeScene();
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
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
    });
    generator?.dispose();
  }
}

/** Only explicitly owned skies and the owned reflection target are released. */
export function disposeCyberEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose(); environments.delete(scene);
  }
  const skies: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === 'skybox_mesh' && object.userData.cyberOwnedSky === true) skies.push(object);
  });
  skies.forEach(sky => {
    sky.removeFromParent(); sky.geometry.dispose();
    (Array.isArray(sky.material) ? sky.material : [sky.material]).forEach(material => material.dispose());
  });
}

export function buildCyberFillLighting(): THREE.Group {
  const group = new THREE.Group(); group.name = 'cyber_fill';
  const hemisphere = new THREE.HemisphereLight('#c7d5e7', '#555162', .55);
  hemisphere.name = 'cyber_skylight_fill';
  const rim = new THREE.DirectionalLight('#b7d9e7', .38);
  rim.name = 'cyber_cool_rim'; rim.position.set(18, 12, -16); rim.target.position.set(0, 2, 0);
  rim.castShadow = false;
  group.add(hemisphere, rim, rim.target);
  return group;
}

/** The existing key is the only shadow light; preserve the player's direct-light intensity. */
export function configureCyberShadow(light: THREE.DirectionalLight, bounds: number | { x: number; z: number }, quality: EnvironmentQualityProfile): void {
  const half = typeof bounds === 'number' ? { x: bounds, z: bounds } : bounds;
  const extent = Math.hypot(half.x, half.z) + 7;
  light.position.set(-extent * .55, extent * 1.35, extent * .45);
  light.target.position.set(0, 0, 0); light.color.set('#e2eaf4');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5; camera.far = extent * 3.2;
  camera.left = camera.bottom = -extent; camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015; light.shadow.normalBias = .035;
}
