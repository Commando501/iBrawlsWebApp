import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** A static space sky: sparse stars and one shaded planetoid, with no textures or animation. */
export function createAsteroidSkyMaterial(hue = 210, brightness = 3): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'asteroid_sky', side: THREE.BackSide, depthWrite: false, fog: false,
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
      float starHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 direction = normalize(skyDirection);
        float elevation = direction.y;
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.34, elevation));
        sky = mix(sky, zenithColor, smoothstep(0.22, 0.95, elevation));
        sky = mix(groundColor, sky, smoothstep(-0.3, 0.015, elevation));
        vec2 starUV = vec2(atan(direction.z, direction.x) / 6.2831853 + .5, asin(clamp(direction.y, -1.0, 1.0)) / 3.14159265 + .5);
        vec2 cell = starUV * vec2(520.0, 260.0);
        float random = starHash(floor(cell));
        vec2 starPosition = vec2(starHash(floor(cell) + 17.0), starHash(floor(cell) + 49.0)) * .6 + .2;
        float distanceToStar = length(fract(cell) - starPosition);
        float starRadius = .025 + .035 * starHash(floor(cell) + 91.0);
        float antialias = max(fwidth(distanceToStar), .025);
        float star = (1.0 - smoothstep(starRadius, starRadius + antialias, distanceToStar)) * step(.998, random);
        sky += vec3(.36, .42, .5) * star * smoothstep(.04, .22, elevation);
        vec3 planetDirection = normalize(vec3(-.55, .38, -.74));
        vec3 planetRight = normalize(cross(vec3(0.0, 1.0, 0.0), planetDirection));
        vec3 planetUp = cross(planetDirection, planetRight);
        vec2 planetUV = vec2(dot(direction, planetRight), dot(direction, planetUp)) / .19;
        float planetRadius = length(planetUV);
        float edge = max(fwidth(planetRadius), .001);
        float disc = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, planetRadius)) * step(.9, dot(direction, planetDirection));
        vec3 normal = vec3(planetUV, sqrt(max(0.0, 1.0 - dot(planetUV, planetUV))));
        float light = max(0.0, dot(normalize(normal), normalize(vec3(-.8, .5, -.3))));
        float bands = .94 + .06 * sin(planetUV.y * 27.0 + sin(planetUV.x * 8.0));
        vec3 planet = vec3(.075, .10, .135) * (.12 + light * 1.6) * bands;
        sky = mix(sky, planet, disc);
        gl_FragColor = vec4(sky * skyExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  updateAsteroidSkyMaterial(material, hue, brightness);
  return material;
}

/** Existing controls offset the authored palette; default 210 remains a quiet cool starfield. */
export function updateAsteroidSkyMaterial(material: THREE.ShaderMaterial, hue: number, brightness: number): void {
  if (material.name !== 'asteroid_sky') return;
  const shift = ((Number.isFinite(hue) ? hue : 210) - 210) / 360;
  const shifted = (degrees: number) => (((degrees / 360 + shift) % 1) + 1) % 1;
  (material.uniforms.zenithColor.value as THREE.Color).setHSL(shifted(222), .38, .025, THREE.SRGBColorSpace);
  (material.uniforms.midColor.value as THREE.Color).setHSL(shifted(216), .3, .055, THREE.SRGBColorSpace);
  (material.uniforms.horizonColor.value as THREE.Color).setHSL(shifted(214), .24, .12, THREE.SRGBColorSpace);
  (material.uniforms.groundColor.value as THREE.Color).setHSL(shifted(220), .2, .035, THREE.SRGBColorSpace);
  material.uniforms.skyExposure.value = Math.max(0, Math.min(Number.isFinite(brightness) ? brightness : 3, 10)) / 3;
}

/** Industrial work lights and cool rock bounce bake once into readable V3 armor highlights. */
export function createAsteroidLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8194a7');
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(60, 38, 60), new THREE.MeshBasicMaterial({ color: '#768591', side: THREE.BackSide }));
  enclosure.name = 'asteroid_probe_enclosure'; scene.add(enclosure);
  const panel = (name: string, width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name; mesh.position.set(...position); mesh.lookAt(...target); scene.add(mesh);
  };
  panel('asteroid_probe_key', 22, 14, '#fff0dc', 3.4, [-14, 16, 8], [0, 0, 0]);
  panel('asteroid_probe_sky', 34, 22, '#cbddea', 1.3, [7, 17, -11], [0, 0, 0]);
  panel('asteroid_probe_worklight', 30, 12, '#ffcf95', .85, [0, 4, -29], [0, 3, 0]);
  panel('asteroid_probe_ground', 56, 56, '#646e78', .7, [0, -7, 0], [0, 0, 0]);
  return scene;
}

export function initializeAsteroidEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  const probe = createAsteroidLightProbeScene();
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
export function disposeAsteroidEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose(); environments.delete(scene);
  }
  const skies: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === 'skybox_mesh' && object.userData.asteroidOwnedSky === true) skies.push(object);
  });
  skies.forEach(sky => {
    sky.removeFromParent(); sky.geometry.dispose();
    (Array.isArray(sky.material) ? sky.material : [sky.material]).forEach(material => material.dispose());
  });
}

export function buildAsteroidFillLighting(): THREE.Group {
  const group = new THREE.Group(); group.name = 'asteroid_fill';
  const hemisphere = new THREE.HemisphereLight('#d0dfe9', '#707985', .55);
  hemisphere.name = 'asteroid_skylight_fill';
  const rim = new THREE.DirectionalLight('#c1d5eb', .35);
  rim.name = 'asteroid_worklight_rim'; rim.position.set(18, 14, -16); rim.target.position.set(0, 2, 0);
  rim.castShadow = false; group.add(hemisphere, rim, rim.target);
  return group;
}

/** Keep the existing key as the only shadow light, respecting the user's direct-light intensity. */
export function configureAsteroidShadow(light: THREE.DirectionalLight, bounds: number | { x: number; z: number }, quality: EnvironmentQualityProfile): void {
  const half = typeof bounds === 'number' ? { x: bounds, z: bounds } : bounds;
  const extent = Math.hypot(half.x, half.z) + 9;
  light.position.set(-extent * .6, extent * 1.4, extent * .4);
  light.target.position.set(0, 0, 0); light.color.set('#fff0dc');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5; camera.far = extent * 3.5;
  camera.left = camera.bottom = -extent; camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015; light.shadow.normalBias = .035;
}

