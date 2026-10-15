import fs from "node:fs";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const output = "output/iron-vanguard/runtime-v018/";
const data = fs.readFileSync(output + "hammer-v018-review.glb");
const gltf = await new GLTFLoader()
  .setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    "",
  );
assert.equal(gltf.animations.length, 1);
const clip = gltf.animations[0];
assert.ok(Math.abs(clip.duration - 70 / 30) < 1e-5);
const mixer = new THREE.AnimationMixer(gltf.scene);
const action = mixer.clipAction(clip);
action.setLoop(THREE.LoopOnce, 1);
action.clampWhenFinished = true;
action.play();
const meshes = [];
gltf.scene.traverse((object) => {
  if (object.isSkinnedMesh) meshes.push(object);
});
const body = meshes.find(
  (object) => object.morphTargetInfluences?.length === 70,
);
assert.ok(body);
assert.equal(meshes.length, 2);
const seek = (frame) => {
  // LoopOnce pauses at the endpoint; re-enable it before any subsequent seek.
  action.paused = false;
  action.enabled = true;
  mixer.setTime(frame / 30);
  gltf.scene.updateMatrixWorld(true);
  body.skeleton.update();
};
const refs = JSON.parse(
  fs.readFileSync(output + "native-joint-reference.json", "utf8"),
);
let maxJointError = 0;
let maxMorphError = 0;
const frames = [];
for (const row of refs) {
  seek(row.frame);
  let max = 0;
  for (const [name, reference] of Object.entries(row.joints)) {
    const bone = gltf.scene.getObjectByName(name);
    assert.ok(bone, name);
    const error =
      bone
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(new THREE.Vector3(...reference)) * 1000;
    max = Math.max(max, error);
  }
  for (let i = 0; i < 70; i++) {
    maxMorphError = Math.max(
      maxMorphError,
      Math.abs(body.morphTargetInfluences[i] - (i === row.frame % 70 ? 1 : 0)),
    );
  }
  maxJointError = Math.max(maxJointError, max);
  frames.push({ frame: row.frame, maxJointErrorMm: max });
}

// UV splitting and Meshopt reorder vertices. Match a deterministic sample by its
// posed frame-zero position, then follow those same vertices through the clip.
const surface = JSON.parse(
  fs.readFileSync(output + "native-surface-reference.json", "utf8"),
);
seek(0);
const cellSize = 0.002;
const grid = new Map();
const vertex = new THREE.Vector3();
const cell = (value) => Math.floor(value / cellSize);
const key = (x, y, z) => `${x},${y},${z}`;
for (let index = 0; index < body.geometry.attributes.position.count; index++) {
  body.getVertexPosition(index, vertex).applyMatrix4(body.matrixWorld);
  const id = key(cell(vertex.x), cell(vertex.y), cell(vertex.z));
  if (!grid.has(id)) grid.set(id, []);
  grid.get(id).push({ index, point: vertex.clone() });
}
const vertexMap = surface.positions[0].map((reference) => {
  const point = new THREE.Vector3(...reference);
  const center = reference.map(cell);
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const candidate of grid.get(
          key(center[0] + dx, center[1] + dy, center[2] + dz),
        ) ?? []) {
          const distance = point.distanceTo(candidate.point);
          if (distance < bestDistance) {
            bestIndex = candidate.index;
            bestDistance = distance;
          }
        }
      }
    }
  }
  assert.ok(
    bestDistance < 0.001,
    `Cannot map surface sample: ${bestDistance * 1000} mm`,
  );
  return bestIndex;
});
let maxSurfaceErrorMm = 0;
let squaredSurfaceError = 0;
let worstSurfaceFrame = 0;
for (let frame = 0; frame < surface.positions.length; frame++) {
  seek(frame);
  for (let sample = 0; sample < vertexMap.length; sample++) {
    body
      .getVertexPosition(vertexMap[sample], vertex)
      .applyMatrix4(body.matrixWorld);
    const error =
      vertex.distanceTo(
        new THREE.Vector3(...surface.positions[frame][sample]),
      ) * 1000;
    squaredSurfaceError += error * error;
    if (error > maxSurfaceErrorMm) {
      maxSurfaceErrorMm = error;
      worstSurfaceFrame = frame;
    }
  }
}
const report = {
  bytes: data.length,
  clip: clip.name,
  clipDuration: clip.duration,
  meshCount: meshes.length,
  morphCount: 70,
  jointCount: Object.keys(refs[0].joints).length,
  maxJointErrorMm: maxJointError,
  maxMorphError,
  surfaceSampleCount: vertexMap.length,
  surfaceFrames: surface.positions.length,
  maxSurfaceErrorMm,
  worstSurfaceFrame,
  rmsSurfaceErrorMm: Math.sqrt(
    squaredSurfaceError / (vertexMap.length * surface.positions.length),
  ),
  frames,
};
fs.writeFileSync(
  output + "three-runtime-validation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ ...report, frames: undefined }, null, 2));
assert.ok(maxJointError < 0.5, `Joint drift ${maxJointError} mm`);
assert.ok(maxMorphError < 0.0001, `Morph error ${maxMorphError}`);
assert.ok(maxSurfaceErrorMm < 1, `Surface drift ${maxSurfaceErrorMm} mm`);
