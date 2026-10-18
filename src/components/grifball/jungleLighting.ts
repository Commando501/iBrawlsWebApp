import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** One static haze gradient: a natural sky above the canopy, without beams or animated noise. */
export function createJungleSkyMaterial(hue = 120, brightness = 6): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'jungle_sky', side: THREE.BackSide, depthWrite: false, fog: false,
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
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.34, elevation));
        sky = mix(sky, zenithColor, smoothstep(0.22, 0.95, elevation));
        sky = mix(groundColor, sky, smoothstep(-0.3, 0.015, elevation));
        gl_FragColor = vec4(sky * skyExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  updateJungleSkyMaterial(material, hue, brightness);
  return material;
}

/** The existing hue control offsets the authored palette; default 120 remains blue-gray daylight. */
export function updateJungleSkyMaterial(material: THREE.ShaderMaterial, hue: number, brightness: number): void {
  if (material.name !== 'jungle_sky') return;
  const shift = ((Number.isFinite(hue) ? hue : 120) - 120) / 360;
  const shifted = (degrees: number) => (((degrees / 360 + shift) % 1) + 1) % 1;
  (material.uniforms.zenithColor.value as THREE.Color).setHSL(shifted(204), .22, .49, THREE.SRGBColorSpace);
  (material.uniforms.midColor.value as THREE.Color).setHSL(shifted(188), .14, .61, THREE.SRGBColorSpace);
  (material.uniforms.horizonColor.value as THREE.Color).setHSL(shifted(145), .09, .64, THREE.SRGBColorSpace);
  (material.uniforms.groundColor.value as THREE.Color).setHSL(shifted(112), .09, .29, THREE.SRGBColorSpace);
  material.uniforms.skyExposure.value = Math.max(0, Math.min(Number.isFinite(brightness) ? brightness : 6, 10)) / 6;
}

/** Broad sky and forest bounce are baked once, giving V3 armor readable neutral highlights. */
export function createJungleLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#aabcbf');
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(60, 38, 60), new THREE.MeshBasicMaterial({ color: '#8a9b96', side: THREE.BackSide }));
  enclosure.name = 'jungle_probe_enclosure'; scene.add(enclosure);
  const panel = (name: string, width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name; mesh.position.set(...position); mesh.lookAt(...target); scene.add(mesh);
  };
  panel('jungle_probe_key', 22, 14, '#fff1d8', 3.4, [-14, 16, 8], [0, 0, 0]);
  panel('jungle_probe_sky', 34, 22, '#d5e5ed', 1.4, [7, 17, -11], [0, 0, 0]);
  panel('jungle_probe_forest', 54, 14, '#718a75', .65, [0, 4, -29], [0, 3, 0]);
  panel('jungle_probe_ground', 56, 56, '#5f6556', .7, [0, -7, 0], [0, 0, 0]);
  return scene;
}

export function initializeJungleEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  const probe = createJungleLightProbeScene();
  let generator: THREE.PMREMGenerator | undefined;
  try {
    generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(probe, .035, .1, 100, { size: quality.tier === 'high' ? 256 : 128 });
    scene.environment = target.texture;
    scene.environmentIntensity = quality.tier === 'low' ? .52 : .65;
    environments.set(scene, target); previous?.dispose();
  } finally {
    probe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
    });
    generator?.dispose();
  }
}

/** Release only this scene's probe and explicitly marked sky; other maps and cached images survive. */
export function disposeJungleEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose(); environments.delete(scene);
  }
  const skies: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === 'skybox_mesh' && object.userData.jungleOwnedSky === true) skies.push(object);
  });
  skies.forEach(sky => {
    sky.removeFromParent(); sky.geometry.dispose();
    (Array.isArray(sky.material) ? sky.material : [sky.material]).forEach(material => material.dispose());
  });
}

export function buildJungleFillLighting(): THREE.Group {
  const group = new THREE.Group(); group.name = 'jungle_fill';
  const hemisphere = new THREE.HemisphereLight('#cddfe2', '#747568', .48);
  hemisphere.name = 'jungle_skylight_fill';
  const rim = new THREE.DirectionalLight('#d6e5dd', .3);
  rim.name = 'jungle_canopy_rim'; rim.position.set(18, 14, -16); rim.target.position.set(0, 2, 0);
  rim.castShadow = false; group.add(hemisphere, rim, rim.target);
  return group;
}

/** Keep the existing key as the only shadow light, respecting the user's direct-light intensity. */
export function configureJungleShadow(light: THREE.DirectionalLight, bounds: number | { x: number; z: number }, quality: EnvironmentQualityProfile): void {
  const half = typeof bounds === 'number' ? { x: bounds, z: bounds } : bounds;
  const extent = Math.hypot(half.x, half.z) + 9;
  light.position.set(-extent * .6, extent * 1.4, extent * .4);
  light.target.position.set(0, 0, 0); light.color.set('#fff0d7');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5; camera.far = extent * 3.5;
  camera.left = camera.bottom = -extent; camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015; light.shadow.normalBias = .035;
}
