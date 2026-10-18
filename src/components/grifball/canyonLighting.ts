import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();
const sunDirection = new THREE.Vector3(-.6, .6, -.4).normalize();

/** A restrained outdoor gradient: one inexpensive sky draw, without texture downloads. */
export function createCanyonSkyMaterial(hue = 35, brightness = 7): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'canyon_sky', side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color() },
      midColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      groundColor: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color('#fff0d8') },
      sunDirection: { value: sunDirection.clone() },
      skyExposure: { value: 1 },
      sunStrength: { value: 5 },
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
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform float skyExposure;
      uniform float sunStrength;
      varying vec3 skyDirection;
      void main() {
        vec3 direction = normalize(skyDirection);
        float elevation = direction.y;
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.32, elevation));
        sky = mix(sky, zenithColor, smoothstep(0.22, 0.98, elevation));
        sky = mix(groundColor, sky, smoothstep(-0.32, 0.025, elevation));
        float facingSun = max(dot(direction, sunDirection), 0.0);
        float disk = smoothstep(0.99991, 0.99997, facingSun);
        float halo = pow(facingSun, 384.0) * 0.025;
        sky += sunColor * (disk + halo) * sunStrength;
        gl_FragColor = vec4(sky * skyExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  updateCanyonSkyMaterial(material, hue, brightness);
  return material;
}

/** Existing sky controls modify persistent uniforms rather than allocating new maps. */
export function updateCanyonSkyMaterial(material: THREE.ShaderMaterial, hue: number, brightness: number): void {
  if (material.name !== 'canyon_sky') return;
  const normalizedHue = (((Number.isFinite(hue) ? hue : 35) % 360) + 360) % 360 / 360;
  const coolHue = (normalizedHue + 175 / 360) % 1;
  (material.uniforms.zenithColor.value as THREE.Color).setHSL(coolHue, .32, .43, THREE.SRGBColorSpace);
  (material.uniforms.midColor.value as THREE.Color).setHSL(coolHue, .23, .64, THREE.SRGBColorSpace);
  (material.uniforms.horizonColor.value as THREE.Color).setHSL(normalizedHue, .18, .68, THREE.SRGBColorSpace);
  (material.uniforms.groundColor.value as THREE.Color).setHSL(normalizedHue, .13, .30, THREE.SRGBColorSpace);
  material.uniforms.skyExposure.value = Math.max(0, Math.min(Number.isFinite(brightness) ? brightness : 7, 10)) / 7;
}

/** Scratch-only sky and sun capture. No extra lighting or geometry survives the bake. */
export function createCanyonLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const skyMaterial = createCanyonSkyMaterial();
  // A slightly wider bake-only sun card keeps reflections stable at 128px.
  skyMaterial.uniforms.sunStrength.value = 0;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), skyMaterial);
  sky.name = 'canyon_probe_sky';
  sky.renderOrder = -100;
  scene.add(sky);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(.55, 24), new THREE.MeshBasicMaterial({
    color: new THREE.Color('#fff0d8').multiplyScalar(5), side: THREE.DoubleSide, toneMapped: false,
  }));
  sun.name = 'canyon_probe_sun';
  sun.position.copy(sunDirection).multiplyScalar(25);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: '#514a40', side: THREE.DoubleSide }));
  ground.name = 'canyon_probe_ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -10;
  scene.add(ground);
  return scene;
}

export function initializeCanyonEnvironment(
  scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile,
): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  if (previous) {
    previous.dispose();
    environments.delete(scene);
  }
  const probe = createCanyonLightProbeScene();
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    const target = generator.fromScene(probe, .012, .1, 100, { size: quality.tier === 'high' ? 256 : 128 });
    scene.environment = target.texture;
    scene.environmentIntensity = quality.tier === 'low' ? .6 : .72;
    environments.set(scene, target);
  } finally {
    probe.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => material.dispose());
    });
    generator.dispose();
  }
}

/** Release only this map's probe and owned sky, preserving any replacement environment. */
export function disposeCanyonEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose();
    environments.delete(scene);
  }
  const skyMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.material instanceof THREE.ShaderMaterial && object.material.name === 'canyon_sky') {
      skyMeshes.push(object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>);
    }
  });
  skyMeshes.forEach(mesh => { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); });
}

/** Cool skylight and restrained reflected ground light keep armor colors readable. */
export function buildCanyonFillLighting(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'canyon_fill';
  const hemisphere = new THREE.HemisphereLight('#c6d5e1', '#70695f', .72);
  hemisphere.name = 'canyon_skylight_fill';
  group.add(hemisphere);
  return group;
}

/** The existing directional key is the only shadow light. Its intensity remains user-controlled. */
export function configureCanyonShadow(
  light: THREE.DirectionalLight, half: { x: number; z: number }, quality: EnvironmentQualityProfile,
): void {
  const extent = Math.hypot(half.x, half.z) + 8;
  light.position.copy(sunDirection).multiplyScalar(extent * 1.8);
  light.target.position.set(0, 0, 0);
  light.color.set('#fff0d8');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5;
  camera.far = extent * 3.2;
  camera.left = camera.bottom = -extent;
  camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015;
  light.shadow.normalBias = .04;
}
