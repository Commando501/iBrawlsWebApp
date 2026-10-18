import * as THREE from 'three';
import type { CustomMapData } from '../../types';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';

const WEATHER_NAME = 'rainy_weather';
const vertexShader = `
  attribute vec4 aSeed;
  uniform float uTime;
  varying float vHeight;
  varying float vDistance;
  void main() {
    float height = mod(aSeed.z - uTime * aSeed.w, 24.0);
    vec3 drop = vec3(aSeed.x + height * .055, height, aSeed.y) + position;
    vec4 viewPosition = modelViewMatrix * vec4(drop, 1.0);
    vHeight = drop.y;
    vDistance = length(viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const fragmentShader = `
  uniform vec3 uColor;
  varying float vHeight;
  varying float vDistance;
  void main() {
    float groundFade = smoothstep(.08, 1.0, vHeight);
    float ceilingFade = 1.0 - smoothstep(21.0, 24.0, vHeight);
    float distanceFade = 1.0 - smoothstep(28.0, 90.0, vDistance);
    gl_FragColor = vec4(uColor, .28 * groundFade * ceilingFade * distanceFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** One transparent draw and immutable vertex buffers; falling motion stays on the GPU. */
export function createRainyWeather(map: CustomMapData, quality: EnvironmentQualityProfile): THREE.LineSegments | undefined {
  if (map.id !== 'rainy_industrial_streets') return;
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const density = Math.min(2.1, Math.sqrt(half.x * half.z / (24 * 12)));
  const count = Math.round((quality.tier === 'high' ? 1000 : quality.tier === 'balanced' ? 480 : 180) * density);
  const positions = new Float32Array(count * 6), seeds = new Float32Array(count * 8);
  let state = 0x9e3779b9;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const reachX = half.x + 12, reachZ = half.z + 10;
  for (let index = 0; index < count; index++) {
    const x = (random() * 2 - 1) * reachX, z = (random() * 2 - 1) * reachZ;
    const phase = random() * 24, speed = 14 + random() * 8, length = .32 + random() * .3;
    positions.set([0, 0, 0, .055 * length, length, 0], index * 6);
    seeds.set([x, z, phase, speed, x, z, phase, speed], index * 8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-reachX, 0, -reachZ), new THREE.Vector3(reachX + 1.5, 25, reachZ));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#91a5b2') } },
    vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: true,
  });
  const weather = new THREE.LineSegments(geometry, material); weather.name = WEATHER_NAME;
  weather.userData.rainyWeather = true; weather.userData.dropCount = count; weather.userData.quality = quality.tier;
  return weather;
}

/** The normal weather tick passes its existing clock; no per-drop work or allocation. */
export function updateRainyWeatherForScene(scene: THREE.Scene, nowMs: number): void {
  if (!Number.isFinite(nowMs)) return;
  const weather = scene.getObjectByName(WEATHER_NAME);
  if (!(weather instanceof THREE.LineSegments) || !weather.userData.rainyWeather) return;
  const material = weather.material;
  if (material instanceof THREE.ShaderMaterial && material.uniforms.uTime) material.uniforms.uTime.value = Math.max(0, nowMs) * .001;
}
