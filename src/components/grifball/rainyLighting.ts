import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** Static layered overcast with a subdued sodium city horizon; no animated sky or extra pass. */
export function createRainySkyMaterial(hue = 210, brightness = 2): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'rainy_sky', side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color() }, midColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() }, groundColor: { value: new THREE.Color() },
      skyExposure: { value: 1 }, cityColor: { value: new THREE.Color() },
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
      uniform vec3 cityColor;
      varying vec3 skyDirection;
      void main() {
        vec3 direction = normalize(skyDirection);
        float elevation = direction.y;
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.34, elevation));
        sky = mix(sky, zenithColor, smoothstep(0.22, 0.95, elevation));
        sky = mix(groundColor, sky, smoothstep(-0.3, 0.015, elevation));
        // Broad smooth cloud masses stay quiet behind distant architecture.
        float cloud = sin(direction.x * 5.0 + direction.z * 3.0)
          * sin(elevation * 11.0 - direction.z * 4.0) * .5 + .5;
        sky *= mix(.84, 1.07, cloud);
        float cityHaze = exp(-pow((elevation - .025) / .13, 2.0));
        sky += cityColor * cityHaze * .15;
        gl_FragColor = vec4(sky * skyExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  updateRainySkyMaterial(material, hue, brightness);
  return material;
}

/** User controls shift the overcast palette without flattening the city horizon or rebuilding it. */
export function updateRainySkyMaterial(material: THREE.ShaderMaterial, hue: number, brightness: number): void {
  if (material.name !== 'rainy_sky') return;
  const shift = ((Number.isFinite(hue) ? hue : 210) - 210) / 360;
  const shifted = (degrees: number) => (((degrees / 360 + shift) % 1) + 1) % 1;
  (material.uniforms.zenithColor.value as THREE.Color).setHSL(shifted(215), .24, .12, THREE.SRGBColorSpace);
  (material.uniforms.midColor.value as THREE.Color).setHSL(shifted(211), .19, .24, THREE.SRGBColorSpace);
  (material.uniforms.horizonColor.value as THREE.Color).setHSL(shifted(208), .13, .32, THREE.SRGBColorSpace);
  (material.uniforms.groundColor.value as THREE.Color).setHSL(shifted(218), .17, .10, THREE.SRGBColorSpace);
  (material.uniforms.cityColor.value as THREE.Color).setHSL(shifted(31), .32, .39, THREE.SRGBColorSpace);
  material.uniforms.skyExposure.value = Math.max(0, Math.min(Number.isFinite(brightness) ? brightness : 2, 10)) / 2;
}

/** Broad cloud bounce and sodium lamp cards bake once into restrained wet-surface highlights. */
export function createRainyLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#839ba9');
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(60, 38, 60), new THREE.MeshBasicMaterial({ color: '#718693', side: THREE.BackSide }));
  enclosure.name = 'rainy_probe_enclosure'; scene.add(enclosure);
  const panel = (name: string, width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name; mesh.position.set(...position); mesh.lookAt(...target); scene.add(mesh);
  };
  panel('rainy_probe_key', 22, 14, '#ffe1bf', 3.2, [-14, 16, 8], [0, 0, 0]);
  panel('rainy_probe_sky', 34, 22, '#c5e0ee', 1.5, [7, 17, -11], [0, 0, 0]);
  panel('rainy_probe_city', 30, 12, '#e6be8f', .5, [0, 4, -29], [0, 3, 0]);
  panel('rainy_probe_ground', 56, 56, '#687d88', .65, [0, -7, 0], [0, 0, 0]);
  return scene;
}

export function initializeRainyEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  const probe = createRainyLightProbeScene();
  let generator: THREE.PMREMGenerator | undefined;
  try {
    generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(probe, .035, .1, 100, { size: quality.tier === 'high' ? 256 : 128 });
    scene.environment = target.texture;
    scene.environmentIntensity = quality.tier === 'low' ? .5 : .62;
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
export function disposeRainyEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose(); environments.delete(scene);
  }
  const skies: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === 'skybox_mesh' && object.userData.rainyOwnedSky === true) skies.push(object);
  });
  skies.forEach(sky => {
    sky.removeFromParent(); sky.geometry.dispose();
    (Array.isArray(sky.material) ? sky.material : [sky.material]).forEach(material => material.dispose());
  });
}

export function buildRainyFillLighting(): THREE.Group {
  const group = new THREE.Group(); group.name = 'rainy_fill';
  const hemisphere = new THREE.HemisphereLight('#c3dce9', '#6b7781', .68);
  hemisphere.name = 'rainy_skylight_fill';
  const rim = new THREE.DirectionalLight('#c8e0ee', .42);
  rim.name = 'rainy_cloud_rim'; rim.position.set(18, 14, -16); rim.target.position.set(0, 2, 0);
  rim.castShadow = false; group.add(hemisphere, rim, rim.target);
  return group;
}

/** Keep the existing key as the only shadow light, respecting the user's direct-light intensity. */
export function configureRainyShadow(light: THREE.DirectionalLight, bounds: number | { x: number; z: number }, quality: EnvironmentQualityProfile): void {
  const half = typeof bounds === 'number' ? { x: bounds, z: bounds } : bounds;
  const extent = Math.hypot(half.x, half.z) + 9;
  light.position.set(-extent * .6, extent * 1.4, extent * .4);
  light.target.position.set(0, 0, 0); light.color.set('#ffe1bf');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5; camera.far = extent * 3.5;
  camera.left = camera.bottom = -extent; camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015; light.shadow.normalBias = .035;
}


/** Fill is deliberately unshadowed; the existing arena key remains the only shadow pass. */
export function addRainyFillLighting(scene: THREE.Scene): THREE.Group {
  const fill = buildRainyFillLighting(); scene.add(fill); return fill;
}
