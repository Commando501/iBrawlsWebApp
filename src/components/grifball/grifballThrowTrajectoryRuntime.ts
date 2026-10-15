import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
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
const TRAJECTORY_SAMPLES = 128;
const TRAJECTORY_Y_OFFSET = 0.05;
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

function ensureThrowTrajectoryVisuals(refs: GrifballThreeRefs): void {
  if (!refs.scene) return;

  if (!refs.grifballThrowTrajectoryLine) {
    const line = new Line2(
      new LineGeometry(),
      new LineMaterial({
        color: TRAJECTORY_COLOR,
        linewidth: 1.4,
        worldUnits: false,
        alphaToCoverage: true,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      })
    );
    line.frustumCulled = false;
    line.renderOrder = 70;
    refs.scene.add(line);
    refs.grifballThrowTrajectoryLine = line;
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
  if (line) {
    line.material.color.set(color);
    // Keep the existing stored thickness scale, rendered as a uniform screen-space width.
    line.material.linewidth = Math.max(1, thickness * 100);
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
  if (refs.grifballThrowTrajectoryMarker) refs.grifballThrowTrajectoryMarker.visible = false;
}

export function disposeGrifballThrowTrajectoryVisualForRefs(refs: GrifballThreeRefs): void {
  if (refs.grifballThrowTrajectoryLine) {
    refs.grifballThrowTrajectoryLine.parent?.remove(refs.grifballThrowTrajectoryLine);
    refs.grifballThrowTrajectoryLine.geometry.dispose();
    disposeMaterial(refs.grifballThrowTrajectoryLine.material);
    refs.grifballThrowTrajectoryLine = null;
  }
  if (refs.grifballThrowTrajectoryMarker) {
    refs.grifballThrowTrajectoryMarker.parent?.remove(refs.grifballThrowTrajectoryMarker);
    refs.grifballThrowTrajectoryMarker.geometry.dispose();
    disposeMaterial(refs.grifballThrowTrajectoryMarker.material);
    refs.grifballThrowTrajectoryMarker = null;
  }
}

export function updateGrifballThrowTrajectoryVisualForState({
  state,
  refs,
  chargingHolderId,
  arenaBounds,
  visualOrigin,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  chargingHolderId: string | null;
  arenaBounds?: BallArenaBounds | null;
  visualOrigin?: THREE.Vector3;
}): void {
  const trajectoryInput = resolveThrowTrajectoryInput(state, chargingHolderId);
  if (!trajectoryInput || !refs.scene) {
    hideGrifballThrowTrajectoryVisualForRefs(refs);
    return;
  }

  ensureThrowTrajectoryVisuals(refs);
  const line = refs.grifballThrowTrajectoryLine;
  const marker = refs.grifballThrowTrajectoryMarker;
  if (!line || !marker) return;
  const color = resolveTrajectoryLineColor(state.settings);
  const thickness = resolveTrajectoryLineThickness(state.settings);
  applyThrowTrajectoryStyle(refs, color, thickness);

  const points = predictThrowTrajectory({
    ...trajectoryInput,
    samples: TRAJECTORY_SAMPLES,
    arenaBounds: arenaBounds ?? { arenaRadius: state.arenaRadius },
  }).map((point) => new THREE.Vector3(point.x, point.y + TRAJECTORY_Y_OFFSET, point.z));

  // A linear offset over the whole flight preserves the parabolic curvature and landing.
  // Pulling only the first few samples to the hand creates a visible S-bend.
  if (visualOrigin) {
    const offset = visualOrigin.clone().sub(points[0]);
    for (let index = 0; index < points.length; index += 1) {
      points[index].addScaledVector(offset, 1 - index / (points.length - 1));
    }
  }

  line.geometry.dispose();
  line.geometry = new LineGeometry().setPositions(points.flatMap(point => [point.x, point.y, point.z]));
  line.visible = true;

  const landing = points[points.length - 1];
  marker.position.set(landing.x, BALL_REST_Y + TRAJECTORY_Y_OFFSET, landing.z);
  marker.visible = true;
}
