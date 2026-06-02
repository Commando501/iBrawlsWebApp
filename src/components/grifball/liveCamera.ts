import * as THREE from 'three';
import { type CustomMapData, type Keybindings } from '../../types';
import { getCollisionResolvedCameraPos } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';
import { type SpectateTargetData, type SpectateTargetRole } from './spectateTargets';

export interface LiveCameraFrameState {
  lastFovTime?: number;
}

export const updateLiveCameraFovForState = ({
  state,
  camera,
  keysPressed,
  keybindings,
  frameState,
  now = performance.now(),
}: {
  state: GrifballRuntimeState;
  camera: THREE.PerspectiveCamera;
  keysPressed: Record<string, boolean>;
  keybindings: Keybindings;
  frameState: LiveCameraFrameState;
  now?: number;
}): void => {
  if (frameState.lastFovTime === undefined) {
    frameState.lastFovTime = now;
  }
  const fovDt = Math.min(0.1, (now - frameState.lastFovTime) / 1000);
  frameState.lastFovTime = now;

  let targetFov = 75;
  if (!state.isObserverMode && state.playerHP > 0) {
    let moveForward = 0;
    if (keysPressed[keybindings.moveForward] || keysPressed.arrowup) moveForward += 1;
    if (keysPressed[keybindings.moveBackward] || keysPressed.arrowdown) moveForward -= 1;

    const isSprinting =
      state.settings.enableSprint &&
      keysPressed[keybindings.sprint] &&
      moveForward > 0 &&
      !state.isCrouching &&
      !state.isJumping &&
      state.playerDashRemaining <= 0;
    const isSliding = state.settings.enableSlide && state.playerSlideActive;

    targetFov = isSprinting ? 86 : isSliding ? 78 : 75;
  }

  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 8.0 * fovDt;
    camera.updateProjectionMatrix();
  }
};

export const updateLiveCameraTransformForState = ({
  state,
  camera,
  getSpectateTargetData,
  getActiveCustomMap,
}: {
  state: GrifballRuntimeState;
  camera: THREE.PerspectiveCamera;
  getSpectateTargetData: (target: SpectateTargetRole) => SpectateTargetData;
  getActiveCustomMap: () => CustomMapData | null;
}): void => {
  if (state.isObserverMode) {
    if (state.observerCamMode === 'free') {
      const lookTarget = new THREE.Vector3(0, 0, -1);
      lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch);
      lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

      camera.position.copy(state.playerPos);
      camera.lookAt(camera.position.clone().add(lookTarget));
    } else if (state.observerCamMode === 'third') {
      const targetData = getSpectateTargetData(state.observerTarget);
      const targetEyePos = targetData.pos.clone();
      targetEyePos.y += 1.65 - (targetData.isCrouching ? 0.72 : 0);

      const offset = new THREE.Vector3(0, 0, state.observerOrbitDistance);
      offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

      const cameraPos = targetEyePos.clone().add(offset);
      const activeCustomMap = getActiveCustomMap();
      const customMapObjects = (activeCustomMap && activeCustomMap.objects) || [];
      const arenaRadius = activeCustomMap ? activeCustomMap.arenaRadius : state.arenaRadius;
      const resolvedPos = getCollisionResolvedCameraPos(targetEyePos, cameraPos, arenaRadius, customMapObjects);

      camera.position.copy(resolvedPos);
      camera.lookAt(targetEyePos);
    } else if (state.observerCamMode === 'first') {
      const targetData = getSpectateTargetData(state.observerTarget);
      const currentCameraY = 1.65 - (targetData.isCrouching ? 0.72 : 0) + targetData.pos.y;
      camera.position.set(targetData.pos.x, currentCameraY, targetData.pos.z);

      const lookTarget = new THREE.Vector3(0, 0, -1);
      lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), targetData.pitch);
      lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetData.yaw);

      camera.lookAt(camera.position.clone().add(lookTarget));
    }
    return;
  }

  const lookTarget = new THREE.Vector3(0, 0, -1);
  lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch);
  lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

  const currentCameraY = 1.65 - state.crouchAmount + state.playerPos.y;
  camera.position.set(state.playerPos.x, currentCameraY, state.playerPos.z);
  camera.lookAt(camera.position.clone().add(lookTarget));
};
