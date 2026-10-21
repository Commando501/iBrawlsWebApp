import * as THREE from 'three';

type RippleUniforms = {
  runnerRippleColor: THREE.IUniform<THREE.Color>;
  runnerRippleTime: THREE.IUniform<number>;
  runnerRippleStrength: THREE.IUniform<number>;
  runnerRippleOriginY: THREE.IUniform<number>;
};

const ripples = new WeakMap<THREE.Material, RippleUniforms>();

/** Animate the actual armor surface, including skinned meshes, without extra draw calls. */
export function syncRunnerShieldRipple(
  material: THREE.Material,
  color: THREE.Color | null,
  elapsedSeconds: number,
  originY: number,
): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  let uniforms = ripples.get(material);
  if (!uniforms) {
    if (!color) return;
    uniforms = {
      runnerRippleColor: { value: new THREE.Color() },
      runnerRippleTime: { value: 0 },
      runnerRippleStrength: { value: 0 },
      runnerRippleOriginY: { value: 0 },
    };
    ripples.set(material, uniforms);
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    const rippleUniforms = uniforms;
    material.onBeforeCompile = function (shader, renderer) {
      previousCompile.call(this, shader, renderer);
      Object.assign(shader.uniforms, rippleUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float runnerRippleOriginY;
varying float vRunnerRippleHeight;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
vRunnerRippleHeight = (modelMatrix * vec4(transformed, 1.0)).y - runnerRippleOriginY;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 runnerRippleColor;
uniform float runnerRippleTime;
uniform float runnerRippleStrength;
varying float vRunnerRippleHeight;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float runnerWave = 0.5 + 0.5 * sin(vRunnerRippleHeight * 10.0 - runnerRippleTime * 7.0);
float runnerBand = pow(runnerWave, 6.0) * runnerRippleStrength;
diffuseColor.rgb = mix(diffuseColor.rgb, runnerRippleColor, runnerBand * 0.95);
totalEmissiveRadiance += runnerRippleColor * runnerBand * 0.8;`);
    };
    material.customProgramCacheKey = () => `${previousKey}|runner-shield-ripple-v1`;
    material.needsUpdate = true;
  }
  if (color) uniforms.runnerRippleColor.value.copy(color);
  uniforms.runnerRippleStrength.value = color ? 1 : 0;
  uniforms.runnerRippleTime.value = elapsedSeconds;
  uniforms.runnerRippleOriginY.value = originY;
}
