import * as THREE from 'three';
import {
  BALL_REST_Y,
  predictThrowTrajectory,
  type BallArenaBounds,
  type Vec3,
} from '../../game/grifballBall';
import {
  resolveRunnerThrowAllowed,
  resolveTrajectoryLineColor,
  resolveTrajectoryLineThickness,
} from '../../game/runnerBallSettings';
import { getForwardHeadingForYaw } from '../../game/yaw';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

const TRAJECTORY_COLOR = '#ff2b2b';
const TRAJECTORY_SAMPLES = 32;
const TRAJECTORY_Y_OFFSET = 0.05;
const TRAJECTORY_DASH_LENGTH = 0.95;
const TRAJECTORY_DASH_GAP = 0.42;
const THROW_START_HEIGHT = 1.1;

type ThrowTrajectoryInput = {
  from: Vec3;
  dir: Vec3;
  speed: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function speedForCharge(state: GrifballRuntimeState, charge: number): number {
  const minSpeed = state.settings.grifballPassSpeedMin ?? 9;
  const maxSpeed = state.settings.grifballPassSpeedMax ?? 26;
  return minSpeed + clamp01(charge) * (maxSpeed - minSpeed);
}

function resolveThrowTrajectoryInput(
  state: GrifballRuntimeState,
  chargingHolderId: string | null
): ThrowTrajectoryInput | null {
  if (!chargingHolderId || state.settings.gameMode !== 'grifball' || !resolveRunnerThrowAllowed(state.settings)) return null;
  const ball = state.grifball.ball;
  if (ball.state !== 'held' || ball.holderId !== chargingHolderId) return null;

  if (chargingHolderId === 'player') {
    const forward = getForwardHeadingForYaw(state.yaw);
    return {
      from: {
        x: state.playerPos.x,
        y: state.playerPos.y + THROW_START_HEIGHT,
        z: state.playerPos.z,
      },
      dir: { x: forward.x, y: 0, z: forward.z },
      speed: speedForCharge(state, state.grifballPassCharge),
    };
  }

  const combatant = state.otherPlayers.get(chargingHolderId);
  if (!combatant || combatant.hp <= 0 || (combatant.respawnTimer ?? 0) > 0) return null;
  const forward = getForwardHeadingForYaw(combatant.yaw);
  const charge = clamp01(combatant.grifballPassCharge ?? 0);
  return {
    from: {
      x: combatant.pos.x,
      y: combatant.pos.y + THROW_START_HEIGHT,
      z: combatant.pos.z,
    },
    dir: { x: forward.x, y: 0, z: forward.z },
    speed: speedForCharge(state, charge),
  };
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function disposeObjectGeometryAndMaterial(object: THREE.Object3D): void {
  const mesh = object as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) disposeMaterial(mesh.material);
}

function clearTrajectoryDashGroup(group: THREE.Group): void {
  for (const child of group.children) {
    disposeObjectGeometryAndMaterial(child);
  }
  group.clear();
}

function ensureThrowTrajectoryVisuals(refs: GrifballThreeRefs): void {
  if (!refs.scene) return;

  if (!refs.grifballThrowTrajectoryLine) {
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: TRAJECTORY_COLOR,
        dashSize: 0.75,
        gapSize: 0.35,
        linewidth: 3,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      })
    );
    line.frustumCulled = false;
    line.renderOrder = 70;
    refs.scene.add(line);
    refs.grifballThrowTrajectoryLine = line;
  }

  if (!refs.grifballThrowTrajectoryDashes) {
    const dashes = new THREE.Group();
    dashes.frustumCulled = false;
    dashes.renderOrder = 72;
    refs.scene.add(dashes);
    refs.grifballThrowTrajectoryDashes = dashes;
  }

  if (!refs.grifballThrowTrajectoryMarker) {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.48, 32),
      new THREE.MeshBasicMaterial({
        color: TRAJECTORY_COLOR,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.frustumCulled = false;
    marker.renderOrder = 71;
    refs.scene.add(marker);
    refs.grifballThrowTrajectoryMarker = marker;
  }
}

function applyThrowTrajectoryStyle(
  refs: GrifballThreeRefs,
  color: string,
  thickness: number
): void {
  const line = refs.grifballThrowTrajectoryLine;
  if (line?.material instanceof THREE.LineDashedMaterial) {
    line.material.color.set(color);
    line.material.linewidth = Math.max(1, thickness * 24);
  }

  const marker = refs.grifballThrowTrajectoryMarker;
  if (marker?.material instanceof THREE.MeshBasicMaterial) {
    marker.material.color.set(color);
  }
  if (marker && marker.userData.trajectoryThickness !== thickness) {
    marker.geometry.dispose();
    marker.geometry = new THREE.RingGeometry(0.34, 0.34 + thickness, 32);
    marker.userData.trajectoryThickness = thickness;
  }
}

export function hideGrifballThrowTrajectoryVisualForRefs(refs: GrifballThreeRefs): void {
  if (refs.grifballThrowTrajectoryLine) refs.grifballThrowTrajectoryLine.visible = false;
  if (refs.grifballThrowTrajectoryDashes) refs.grifballThrowTrajectoryDashes.visible = false;
  if (refs.grifballThrowTrajectoryMarker) refs.grifballThrowTrajectoryMarker.visible = false;
}

export function disposeGrifballThrowTrajectoryVisualForRefs(refs: GrifballThreeRefs): void {
  if (refs.grifballThrowTrajectoryLine) {
    refs.grifballThrowTrajectoryLine.parent?.remove(refs.grifballThrowTrajectoryLine);
    refs.grifballThrowTrajectoryLine.geometry.dispose();
    disposeMaterial(refs.grifballThrowTrajectoryLine.material);
    refs.grifballThrowTrajectoryLine = null;
  }
  if (refs.grifballThrowTrajectoryDashes) {
    refs.grifballThrowTrajectoryDashes.parent?.remove(refs.grifballThrowTrajectoryDashes);
    clearTrajectoryDashGroup(refs.grifballThrowTrajectoryDashes);
    refs.grifballThrowTrajectoryDashes = null;
  }
  if (refs.grifballThrowTrajectoryMarker) {
    refs.grifballThrowTrajectoryMarker.parent?.remove(refs.grifballThrowTrajectoryMarker);
    refs.grifballThrowTrajectoryMarker.geometry.dispose();
    disposeMaterial(refs.grifballThrowTrajectoryMarker.material);
    refs.grifballThrowTrajectoryMarker = null;
  }
}

function addThickTrajectoryDash(
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  color: string
): void {
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.03) return;

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 12, 1, false),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    })
  );
  mesh.position.copy(start).addScaledVector(delta, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  mesh.frustumCulled = false;
  mesh.renderOrder = 72;
  group.add(mesh);
}

function rebuildThickTrajectoryDashes(
  group: THREE.Group,
  points: THREE.Vector3[],
  radius: number,
  color: string
): void {
  clearTrajectoryDashGroup(group);
  if (points.length < 2) return;

  const cumulativeDistances: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeDistances[index] = cumulativeDistances[index - 1] + points[index].distanceTo(points[index - 1]);
  }
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];
  if (totalDistance <= 0.0001) return;

  const pointAtDistance = (targetDistance: number): THREE.Vector3 => {
    const clampedDistance = Math.min(totalDistance, Math.max(0, targetDistance));
    for (let index = 1; index < cumulativeDistances.length; index += 1) {
      if (cumulativeDistances[index] >= clampedDistance) {
        const previousDistance = cumulativeDistances[index - 1];
        const segmentDistance = cumulativeDistances[index] - previousDistance;
        const t = segmentDistance <= 0.0001 ? 0 : (clampedDistance - previousDistance) / segmentDistance;
        return points[index - 1].clone().lerp(points[index], t);
      }
    }
    return points[points.length - 1].clone();
  };

  const patternLength = TRAJECTORY_DASH_LENGTH + TRAJECTORY_DASH_GAP;
  for (let dashStartDistance = 0; dashStartDistance < totalDistance; dashStartDistance += patternLength) {
    const dashEndDistance = Math.min(dashStartDistance + TRAJECTORY_DASH_LENGTH, totalDistance);
    addThickTrajectoryDash(
      group,
      pointAtDistance(dashStartDistance),
      pointAtDistance(dashEndDistance),
      radius,
      color
    );
  }
}

export function updateGrifballThrowTrajectoryVisualForState({
  state,
  refs,
  chargingHolderId,
  arenaBounds,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  chargingHolderId: string | null;
  arenaBounds?: BallArenaBounds | null;
}): void {
  const trajectoryInput = resolveThrowTrajectoryInput(state, chargingHolderId);
  if (!trajectoryInput || !refs.scene) {
    hideGrifballThrowTrajectoryVisualForRefs(refs);
    return;
  }

  ensureThrowTrajectoryVisuals(refs);
  const line = refs.grifballThrowTrajectoryLine;
  const dashes = refs.grifballThrowTrajectoryDashes;
  const marker = refs.grifballThrowTrajectoryMarker;
  if (!line || !dashes || !marker) return;
  const color = resolveTrajectoryLineColor(state.settings);
  const thickness = resolveTrajectoryLineThickness(state.settings);
  applyThrowTrajectoryStyle(refs, color, thickness);

  const points = predictThrowTrajectory({
    ...trajectoryInput,
    samples: TRAJECTORY_SAMPLES,
    arenaBounds: arenaBounds ?? { arenaRadius: state.arenaRadius },
  }).map((point) => new THREE.Vector3(point.x, point.y + TRAJECTORY_Y_OFFSET, point.z));

  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points);
  line.computeLineDistances();
  line.visible = true;
  rebuildThickTrajectoryDashes(dashes, points, thickness, color);
  dashes.visible = true;

  const landing = points[points.length - 1];
  marker.position.set(landing.x, BALL_REST_Y + TRAJECTORY_Y_OFFSET, landing.z);
  marker.visible = true;
}
