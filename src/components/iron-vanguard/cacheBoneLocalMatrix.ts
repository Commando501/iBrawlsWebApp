import * as THREE from 'three';

/** Rig bones are driven by position/quaternion/scale, never by direct matrix writes.
 * IK and rendering revisit each bone several times per frame. Compose only when
 * its local pose changed; Three still propagates changed parent world matrices.
 */
export function cacheBoneLocalMatrix(bone: THREE.Bone): void {
  const compose = bone.updateMatrix;
  let px = NaN, py = NaN, pz = NaN;
  let qx = NaN, qy = NaN, qz = NaN, qw = NaN;
  let sx = NaN, sy = NaN, sz = NaN;
  bone.updateMatrix = function () {
    const p = this.position, q = this.quaternion, s = this.scale;
    if (p.x === px && p.y === py && p.z === pz &&
        q.x === qx && q.y === qy && q.z === qz && q.w === qw &&
        s.x === sx && s.y === sy && s.z === sz) return;
    compose.call(this);
    px = p.x; py = p.y; pz = p.z;
    qx = q.x; qy = q.y; qz = q.z; qw = q.w;
    sx = s.x; sy = s.y; sz = s.z;
  };
}
