import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** A static dusk sky with a restrained striped sunset disc; no texture, animation or postprocessing. */
export function createNeonSkyMaterial(hue = 310, brightness = 7): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'neon_sky', side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color() }, midColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() }, groundColor: { value: new THREE.Color() },
      skyExposure: { value: 1 }, sunColor: { value: new THREE.Color() },
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
      uniform vec3 sunColor;
      varying vec3 skyDirection;
      void main() {
        vec3 direction = normalize(skyDirection);
        float elevation = direction.y;
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.34, elevation));
        sky = mix(sky, zenithColor, smoothstep(0.22, 0.95, elevation));
        sky = mix(groundColor, sky, smoothstep(-0.3, 0.015, elevation));
        vec3 sunDirection = normalize(vec3(-.6, .22, -.8));
        vec3 sunRight = normalize(cross(vec3(0.0, 1.0, 0.0), sunDirection));
        vec3 sunUp = cross(sunDirection, sunRight);
        vec2 sunUV = vec2(dot(direction, sunRight), dot(direction, sunUp)) / .195;
        float sunRadius = length(sunUV);
        float edge = max(fwidth(sunRadius), .001);
        float disc = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, sunRadius)) * step(.9, dot(direction, sunDirection));
        // Eight broad cuts only across the lower disc retain the original Outrun silhouette.
        float band = sin((sunUV.y + 1.0) * 25.1327412);
        float bandAA = max(fwidth(band), .025);
        float stripe = smoothstep(-.3 - bandAA, -.3 + bandAA, band);
        float lowerCut = 1.0 - smoothstep(.05, .15, sunUV.y);
        disc *= mix(1.0, stripe, lowerCut);
        vec3 sunset = sunColor * mix(.7, 1.15, clamp(sunUV.y * .5 + .5, 0.0, 1.0));
        float glow = exp(-sunRadius * sunRadius * 1.2) * .08 * step(.5, dot(direction, sunDirection));
        sky += sunColor * glow;
        sky = mix(sky, sunset, disc * .82);
        gl_FragColor = vec4(sky * skyExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  updateNeonSkyMaterial(material, hue, brightness);
  return material;
}

/** Hue offsets preserve a multicolor dusk palette; default 310 keeps the neutral blue upper sky. */
export function updateNeonSkyMaterial(material: THREE.ShaderMaterial, hue: number, brightness: number): void {
  if (material.name !== 'neon_sky') return;
  const shift = ((Number.isFinite(hue) ? hue : 310) - 310) / 360;
  const shifted = (degrees: number) => (((degrees / 360 + shift) % 1) + 1) % 1;
  (material.uniforms.zenithColor.value as THREE.Color).setHSL(shifted(228), .29, .17, THREE.SRGBColorSpace);
  (material.uniforms.midColor.value as THREE.Color).setHSL(shifted(266), .18, .34, THREE.SRGBColorSpace);
  (material.uniforms.horizonColor.value as THREE.Color).setHSL(shifted(16), .34, .56, THREE.SRGBColorSpace);
  (material.uniforms.groundColor.value as THREE.Color).setHSL(shifted(232), .15, .15, THREE.SRGBColorSpace);
  (material.uniforms.sunColor.value as THREE.Color).setHSL(shifted(24), .7, .7, THREE.SRGBColorSpace);
  material.uniforms.skyExposure.value = Math.max(0, Math.min(Number.isFinite(brightness) ? brightness : 7, 10)) / 7;
}

/** Neutral overhead bounce and warm dusk cards bake once into readable V3 armor highlights. */
export function createNeonLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#98a5b6');
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(60, 38, 60), new THREE.MeshBasicMaterial({ color: '#8b95a3', side: THREE.BackSide }));
  enclosure.name = 'neon_probe_enclosure'; scene.add(enclosure);
  const panel = (name: string, width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name; mesh.position.set(...position); mesh.lookAt(...target); scene.add(mesh);
  };
  panel('neon_probe_key', 22, 14, '#fff0df', 3.4, [-14, 16, 8], [0, 0, 0]);
  panel('neon_probe_sky', 34, 22, '#cbddea', 1.3, [7, 17, -11], [0, 0, 0]);
  panel('neon_probe_sunset', 30, 12, '#e8b2b2', .6, [0, 4, -29], [0, 3, 0]);
  panel('neon_probe_ground', 56, 56, '#7b838e', .75, [0, -7, 0], [0, 0, 0]);
  return scene;
}

export function initializeNeonEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  const probe = createNeonLightProbeScene();
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
export function disposeNeonEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose(); environments.delete(scene);
  }
  const skies: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === 'skybox_mesh' && object.userData.neonOwnedSky === true) skies.push(object);
  });
  skies.forEach(sky => {
    sky.removeFromParent(); sky.geometry.dispose();
    (Array.isArray(sky.material) ? sky.material : [sky.material]).forEach(material => material.dispose());
  });
}

export function buildNeonFillLighting(): THREE.Group {
  const group = new THREE.Group(); group.name = 'neon_fill';
  const hemisphere = new THREE.HemisphereLight('#d5e1ef', '#798390', .55);
  hemisphere.name = 'neon_skylight_fill';
  const rim = new THREE.DirectionalLight('#d5ddeb', .35);
  rim.name = 'neon_dusk_rim'; rim.position.set(18, 14, -16); rim.target.position.set(0, 2, 0);
  rim.castShadow = false; group.add(hemisphere, rim, rim.target);
  return group;
}

/** Keep the existing key as the only shadow light, respecting the user's direct-light intensity. */
export function configureNeonShadow(light: THREE.DirectionalLight, bounds: number | { x: number; z: number }, quality: EnvironmentQualityProfile): void {
  const half = typeof bounds === 'number' ? { x: bounds, z: bounds } : bounds;
  const extent = Math.hypot(half.x, half.z) + 9;
  light.position.set(-extent * .6, extent * 1.4, extent * .4);
  light.target.position.set(0, 0, 0); light.color.set('#fff0df');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5; camera.far = extent * 3.5;
  camera.left = camera.bottom = -extent; camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015; light.shadow.normalBias = .035;
}


/** Fill is deliberately unshadowed; the existing arena key remains the only shadow pass. */
export function addNeonFillLighting(scene: THREE.Scene): THREE.Group {
  const fill = buildNeonFillLighting(); scene.add(fill); return fill;
}
