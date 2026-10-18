import * as THREE from 'three';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const environments = new WeakMap<THREE.Scene, THREE.WebGLRenderTarget>();

/** Static facility horizon: quiet blue-gray haze with no animated sky or extra pass. */
export function createCircleSkyMaterial(hue = 224, brightness = 4): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: 'circle_sky', side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color() }, midColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() }, groundColor: { value: new THREE.Color() },
      skyExposure: { value: 1 }, hazeColor: { value: new THREE.Color() },
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
      uniform vec3 hazeColor;
      varying vec3 skyDirection;
      void main() {
        vec3 direction = normalize(skyDirection);
        float elevation = direction.y;
        vec3 sky = mix(horizonColor, midColor, smoothstep(0.0, 0.34, elevation));
        sky = mix(sky, zenithColor, smoothstep(0.22, 0.95, elevation));
        sky = mix(groundColor, sky, smoothstep(-0.3, 0.015, elevation));
        // A broad luminous horizon separates remote architecture without a bright disc or grid.
        float facilityHaze = exp(-pow((elevation - .025) / .13, 2.0));
        sky += hazeColor * facilityHaze * .055;
        gl_FragColor = vec4(sky * skyExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  updateCircleSkyMaterial(material, hue, brightness);
  return material;
}

/** Preserve the original Circle brightness 4 at exposure 1 while retaining live sky controls. */
export function updateCircleSkyMaterial(material: THREE.ShaderMaterial, hue: number, brightness: number): void {
  if (material.name !== 'circle_sky') return;
  const shift = ((Number.isFinite(hue) ? hue : 224) - 224) / 360;
  const shifted = (degrees: number) => (((degrees / 360 + shift) % 1) + 1) % 1;
  (material.uniforms.zenithColor.value as THREE.Color).setHSL(shifted(220), .22, .13, THREE.SRGBColorSpace);
  (material.uniforms.midColor.value as THREE.Color).setHSL(shifted(214), .21, .23, THREE.SRGBColorSpace);
  (material.uniforms.horizonColor.value as THREE.Color).setHSL(shifted(206), .16, .34, THREE.SRGBColorSpace);
  (material.uniforms.groundColor.value as THREE.Color).setHSL(shifted(218), .17, .10, THREE.SRGBColorSpace);
  (material.uniforms.hazeColor.value as THREE.Color).setHSL(shifted(203), .12, .42, THREE.SRGBColorSpace);
  material.uniforms.skyExposure.value = Math.max(0, Math.min(Number.isFinite(brightness) ? brightness : 4, 20)) / 4;
}

/** Broad overhead panels and neutral bounce bake once into readable V3 armor highlights. */
export function createCircleLightProbeScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8294a2');
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(60, 38, 60), new THREE.MeshBasicMaterial({ color: '#7b8c9b', side: THREE.BackSide }));
  enclosure.name = 'circle_probe_enclosure'; scene.add(enclosure);
  const panel = (name: string, width: number, height: number, color: string, intensity: number,
    position: [number, number, number], target: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name; mesh.position.set(...position); mesh.lookAt(...target); scene.add(mesh);
  };
  panel('circle_probe_key', 22, 14, '#f0f3ee', 2.5, [-14, 16, 8], [0, 0, 0]);
  panel('circle_probe_sky', 34, 22, '#c6dce7', 1.5, [7, 17, -11], [0, 0, 0]);
  panel('circle_probe_horizon', 30, 12, '#9ab7c7', .65, [0, 4, -29], [0, 3, 0]);
  panel('circle_probe_ground', 56, 56, '#8897a2', .7, [0, -7, 0], [0, 0, 0]);
  return scene;
}

export function initializeCircleEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: EnvironmentQualityProfile): void {
  const previous = environments.get(scene);
  if (previous && scene.environment === previous.texture) return;
  const probe = createCircleLightProbeScene();
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
export function disposeCircleEnvironment(scene: THREE.Scene): void {
  const target = environments.get(scene);
  if (target) {
    if (scene.environment === target.texture) scene.environment = null;
    target.dispose(); environments.delete(scene);
  }
  const skies: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.name === 'skybox_mesh' && object.userData.circleOwnedSky === true) skies.push(object);
  });
  skies.forEach(sky => {
    sky.removeFromParent(); sky.geometry.dispose();
    (Array.isArray(sky.material) ? sky.material : [sky.material]).forEach(material => material.dispose());
  });
}

export function buildCircleFillLighting(): THREE.Group {
  const group = new THREE.Group(); group.name = 'circle_fill';
  const hemisphere = new THREE.HemisphereLight('#d4e3ec', '#718392', .6);
  hemisphere.name = 'circle_skylight_fill';
  const rim = new THREE.DirectionalLight('#cbdde5', .36);
  rim.name = 'circle_facility_rim'; rim.position.set(18, 14, -16); rim.target.position.set(0, 2, 0);
  rim.castShadow = false; group.add(hemisphere, rim, rim.target);
  return group;
}

/** Keep the existing key as the only shadow light, respecting the user's direct-light intensity. */
export function configureCircleShadow(light: THREE.DirectionalLight, bounds: number | { x: number; z: number }, quality: EnvironmentQualityProfile): void {
  const half = typeof bounds === 'number' ? { x: bounds, z: bounds } : bounds;
  const extent = Math.hypot(half.x, half.z) + 9;
  light.position.set(-extent * .6, extent * 1.4, extent * .4);
  light.target.position.set(0, 0, 0); light.color.set('#f0f3ee');
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const camera = light.shadow.camera;
  camera.near = .5; camera.far = extent * 3.5;
  camera.left = camera.bottom = -extent; camera.right = camera.top = extent;
  camera.updateProjectionMatrix();
  light.shadow.bias = -.00015; light.shadow.normalBias = .035;
}


/** Fill is deliberately unshadowed; the existing arena key remains the only shadow pass. */
export function addCircleFillLighting(scene: THREE.Scene): THREE.Group {
  const fill = buildCircleFillLighting(); scene.add(fill); return fill;
}
