import * as THREE from 'three';
import {
  V3_LOWER_BODY_SEAM_LINKS,
  getV3LowerBodySeamAnchorPair,
} from './v3LowerBodyContinuity';

export interface V3LowerBodyJointBridgeSet {
  root: THREE.Group;
  bridges: Record<string, THREE.Mesh>;
}

const BRIDGE_LINK_IDS = new Set([
  'lowerTorso-pelvis',
  'pelvis-thigh-left',
  'pelvis-thigh-right',
  'thigh-shin-left',
  'thigh-shin-right',
  'shin-foot-left',
  'shin-foot-right',
]);
const DEFAULT_BRIDGE_PROFILE = {
  width: 0.055,
  depth: 0.055,
};

const BRIDGE_PROFILES: Record<string, { width: number; depth: number }> = {
  'lowerTorso-pelvis': { width: 0.38, depth: 0.18 },
  'pelvis-thigh-left': { width: 0.16, depth: 0.12 },
  'pelvis-thigh-right': { width: 0.16, depth: 0.12 },
};

const makeBridgeMesh = (linkId: string): THREE.Mesh => {
  const material = new THREE.MeshStandardMaterial({
    color: '#111827',
    roughness: 0.85,
    metalness: 0.12,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = `v3LowerBodyJointBridge:${linkId}`;
  mesh.userData.v3LowerBodyJointBridge = true;
  mesh.userData.v3LowerBodyBridgeLinkId = linkId;
  mesh.scale.set(0, 0, 0);
  mesh.visible = false;
  return mesh;
};

export function createV3LowerBodyJointBridges(): V3LowerBodyJointBridgeSet {
  const root = new THREE.Group();
  root.name = 'v3LowerBodyJointBridges';
  root.userData.v3LowerBodyJointBridges = true;
  root.visible = false;
  const bridges = {} as Record<string, THREE.Mesh>;
  for (const definition of V3_LOWER_BODY_SEAM_LINKS) {
    if (!BRIDGE_LINK_IDS.has(definition.id)) continue;
    const mesh = makeBridgeMesh(definition.id);
    root.add(mesh);
    bridges[definition.id] = mesh;
  }
  return { root, bridges };
}

export function updateV3LowerBodyJointBridges(model: THREE.Object3D, visible = true): void {
  const bridgeSet = model.userData.v3LowerBodyJointBridges as V3LowerBodyJointBridgeSet | undefined;
  if (!bridgeSet) return;
  bridgeSet.root.visible = visible;
  model.updateMatrixWorld(true);
  const rootWorld = bridgeSet.root.getWorldPosition(new THREE.Vector3());
  for (const [linkId, mesh] of Object.entries(bridgeSet.bridges)) {
    const anchors = getV3LowerBodySeamAnchorPair(model, linkId);
    if (!anchors || !visible) {
      mesh.visible = false;
      continue;
    }
    const from = anchors.from.sub(rootWorld);
    const to = anchors.to.sub(rootWorld);
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    const delta = to.clone().sub(from);
    const profile = BRIDGE_PROFILES[linkId] ?? DEFAULT_BRIDGE_PROFILE;
    const length = Math.max(profile.width, delta.length());
    mesh.visible = true;
    mesh.position.copy(midpoint);
    mesh.scale.set(profile.width, length, profile.depth);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  }
}

export function setV3LowerBodyJointBridgesVisible(model: THREE.Object3D, visible: boolean): void {
  const bridgeSet = model.userData.v3LowerBodyJointBridges as V3LowerBodyJointBridgeSet | undefined;
  if (!bridgeSet) return;
  bridgeSet.root.visible = visible;
  for (const bridge of Object.values(bridgeSet.bridges)) {
    bridge.visible = visible;
  }
}
