import * as THREE from 'three';
import type { CustomMapData } from '../../types';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const WEATHER_NAME = 'glacier_weather';
const vertexShader = `
  attribute vec4 aSeed;
  uniform float uTime;
  varying float vHeight;
  varying float vDistance;
  void main() {
    float height = mod(aSeed.z - uTime * aSeed.w, 22.0);
    vec3 flake = vec3(aSeed.x + sin(aSeed.z + uTime * .21) * .65 + height * .07,
      height, aSeed.y + cos(aSeed.x + uTime * .17) * .5);
    vec4 viewPosition = modelViewMatrix * vec4(flake + position, 1.0);
    vHeight = height;
    vDistance = length(viewPosition.xyz);
    gl_PointSize = clamp(180.0 * (.65 + fract(aSeed.z) * .35) / max(1.0, -viewPosition.z), 1.3, 4.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const fragmentShader = `
  uniform vec3 uColor;
  varying float vHeight;
  varying float vDistance;
  void main() {
    float radius = length(gl_PointCoord - vec2(.5));
    if (radius > .5) discard;
    float softness = 1.0 - smoothstep(.12, .5, radius);
    float groundFade = smoothstep(.1, .9, vHeight);
    float ceilingFade = 1.0 - smoothstep(19.0, 22.0, vHeight);
    float distanceFade = smoothstep(1.5, 4.0, vDistance) * (1.0 - smoothstep(35.0, 110.0, vDistance));
    gl_FragColor = vec4(uColor, .58 * softness * groundFade * ceilingFade * distanceFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** One soft-point draw with deterministic immutable buffers; all motion runs on the GPU. */
export function createGlacierWeather(map: CustomMapData, quality: EnvironmentQualityProfile): THREE.Points | undefined {
  if (map.id !== 'winter_glacier_rink') return;
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const density = Math.min(1.65, Math.sqrt(half.x * half.z / (24 * 12)));
  const count = Math.round((quality.tier === 'high' ? 600 : quality.tier === 'balanced' ? 300 : 100) * density);
  const positions = new Float32Array(count * 3), seeds = new Float32Array(count * 4);
  let state = 0x9e3779b9;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const reachX = half.x + 10, reachZ = half.z + 8;
  for (let index = 0; index < count; index++) {
    seeds.set([(random() * 2 - 1) * reachX, (random() * 2 - 1) * reachZ, random() * 22, .85 + random() * .7], index * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-reachX - 1, 0, -reachZ - 1), new THREE.Vector3(reachX + 2.5, 22, reachZ + 1));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#dce6e9') } },
    vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: true,
  });
  const weather = new THREE.Points(geometry, material); weather.name = WEATHER_NAME;
  weather.userData.glacierWeather = true; weather.userData.flakeCount = count; weather.userData.quality = quality.tier;
  return weather;
}

/** The normal weather tick passes its existing clock; no per-flake work or allocation. */
export function updateGlacierWeatherForScene(scene: THREE.Scene, nowMs: number): void {
  if (!Number.isFinite(nowMs)) return;
  updateGlacierWeather(scene.getObjectByName(WEATHER_NAME), nowMs);
}

/** Accept a target collected by the shared visual frame without another scene search. */
export function updateGlacierWeather(weather: THREE.Object3D | undefined, nowMs: number): void {
  if (!Number.isFinite(nowMs)) return;
  if (!(weather instanceof THREE.Points) || !weather.userData.glacierWeather) return;
  const material = weather.material;
  if (material instanceof THREE.ShaderMaterial && material.uniforms.uTime) material.uniforms.uTime.value = Math.max(0, nowMs) * .001;
}
