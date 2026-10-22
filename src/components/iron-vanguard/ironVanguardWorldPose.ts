import * as THREE from 'three';

const position = new THREE.Vector3();
const scale = new THREE.Vector3();

// Animation layers refresh their subtree before reading it. Reading those
// matrices avoids walking and recomposing the entire ancestor chain per joint.
export function worldPositionFromMatrix(object: THREE.Object3D): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
}

export function worldQuaternionFromMatrix(object: THREE.Object3D): THREE.Quaternion {
  const rotation = new THREE.Quaternion();
  object.matrixWorld.decompose(position, rotation, scale);
  return rotation;
}
