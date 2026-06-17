import * as THREE from 'three';
import { type Keybindings } from '../../types';
import { resolveDirectionalSpeedMultiplier } from '../../game/runnerBallSettings';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

type MutableRef<T> = { current: T };

type JoystickVector = {
  x: number;
  y: number;
};

const MOVE_DEADZONE = 0.18;
const BASE_WALK_SPEED = 5.8;

function spawnPlayerDashTrailParticle(refs: GrifballThreeRefs, playerPos: THREE.Vector3): void {
  if (Math.random() <= 0.15) return;

  const trailPos = playerPos.clone();
  trailPos.y += 0.5;
  const scene = refs.scene;
  if (!scene) return;

  const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#38bdf8'),
    transparent: true,
    opacity: 0.75,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(trailPos);
  mesh.position.x += (Math.random() - 0.5) * 0.3;
  mesh.position.y += (Math.random() - 0.5) * 0.5;
  mesh.position.z += (Math.random() - 0.5) * 0.3;
  scene.add(mesh);
  refs.damageExplosionParticles.push({
    mesh,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
    life: 0.0,
    maxLife: 0.25 + Math.random() * 0.15,
  });
}

export function updatePlayerHorizontalMovementForState({
  state,
  refs,
  dt,
  keysPressed,
  movementKeybindings,
  actionKeybindings,
  gamepad,
  mobileJoystick,
  mobileControlsActive,
  sprintToggleActiveRef,
  prevSprintInputRef,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  dt: number;
  keysPressed: Record<string, boolean>;
  movementKeybindings: Keybindings;
  actionKeybindings: Keybindings;
  gamepad: Gamepad | null;
  mobileJoystick: JoystickVector | null;
  mobileControlsActive: boolean;
  sprintToggleActiveRef: MutableRef<boolean>;
  prevSprintInputRef: MutableRef<boolean>;
}): void {
  if (state.playerInvulnerabilityTimer > 0) {
    state.playerInvulnerabilityTimer = Math.max(0, state.playerInvulnerabilityTimer - dt);
  }

  if (state.playerDashCooldownTimer > 0) {
    state.playerDashCooldownTimer = Math.max(0, state.playerDashCooldownTimer - dt);
  }

  if (state.playerSlideCooldownTimer > 0) {
    state.playerSlideCooldownTimer = Math.max(0, state.playerSlideCooldownTimer - dt);
  }

  const isPlayerDashing = state.playerDashRemaining > 0;
  if (isPlayerDashing) {
    state.playerDashRemaining = Math.max(0, state.playerDashRemaining - dt);

    const speed = state.settings.dashDistance / (state.settings.dashDuration || 0.25);
    state.playerVel.x = state.playerDashDir.x * speed;
    state.playerVel.z = state.playerDashDir.z * speed;

    spawnPlayerDashTrailParticle(refs, state.playerPos);
    return;
  }

  const targetCrouch = state.isCrouching ? 0.72 : 0.0;
  state.crouchAmount += (targetCrouch - state.crouchAmount) * 12.0 * dt;

  const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);
  const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

  const moveDirection = new THREE.Vector3(0, 0, 0);

  let moveForward = 0;
  let moveRight = 0;
  if (keysPressed[movementKeybindings.moveForward] || keysPressed['arrowup']) moveForward += 1;
  if (keysPressed[movementKeybindings.moveBackward] || keysPressed['arrowdown']) moveForward -= 1;
  if (keysPressed[movementKeybindings.moveRight] || keysPressed['arrowright']) moveRight += 1;
  if (keysPressed[movementKeybindings.moveLeft] || keysPressed['arrowleft']) moveRight -= 1;

  if (gamepad) {
    const lx = gamepad.axes[0];
    const ly = gamepad.axes[1];
    if (Math.abs(ly) > MOVE_DEADZONE) moveForward -= ly;
    if (Math.abs(lx) > MOVE_DEADZONE) moveRight += lx;
  }

  if (mobileControlsActive && mobileJoystick) {
    moveForward += mobileJoystick.y;
    moveRight += mobileJoystick.x;
  }

  const rawSlideConditionsMet =
    state.settings.enableSlide &&
    state.isCrouching &&
    moveForward > 0 &&
    !state.isJumping &&
    state.playerDashRemaining <= 0;

  if (!state.playerSlideActive) {
    if (rawSlideConditionsMet && state.playerSlideCooldownTimer <= 0) {
      state.playerSlideActive = true;
      state.playerSlideDistanceTraveled = 0.0;
      state.playerSlideLastPos.copy(state.playerPos);
    }
  } else if (!rawSlideConditionsMet) {
    state.playerSlideActive = false;
    state.playerSlideCooldownTimer = state.settings.slideCooldown ?? 1.5;
  } else {
    const dist = new THREE.Vector2(state.playerPos.x, state.playerPos.z).distanceTo(
      new THREE.Vector2(state.playerSlideLastPos.x, state.playerSlideLastPos.z)
    );
    state.playerSlideDistanceTraveled += dist;
    state.playerSlideLastPos.copy(state.playerPos);

    if (state.playerSlideDistanceTraveled >= (state.settings.slideDistance ?? 8.0)) {
      state.playerSlideActive = false;
      state.playerSlideCooldownTimer = state.settings.slideCooldown ?? 1.5;
    }
  }

  const gpSprint = gamepad ? gamepad.buttons[actionKeybindings.gamepadSprint ?? 10]?.pressed : false;
  const sprintInputDown = !!(keysPressed[actionKeybindings.sprint] || gpSprint);
  let sprintEngaged: boolean;
  if (actionKeybindings.holdToSprint === false) {
    if (sprintInputDown && !prevSprintInputRef.current) {
      sprintToggleActiveRef.current = !sprintToggleActiveRef.current;
    }
    sprintEngaged = sprintToggleActiveRef.current;
  } else {
    sprintEngaged = sprintInputDown;
  }
  prevSprintInputRef.current = sprintInputDown;

  const isSprinting =
    state.settings.enableSprint &&
    sprintEngaged &&
    moveForward > 0 &&
    !state.isCrouching &&
    !state.isJumping &&
    state.playerDashRemaining <= 0;
  const isSliding = state.playerSlideActive;

  let baseSpeed = BASE_WALK_SPEED;
  const isRunner = state.settings.gameMode === 'grifball' && state.activeWeapon === 'ball' && state.grifball.ball.holderId === 'player';
  if (state.isCrouching && !isRunner) {
    baseSpeed = isSliding ? BASE_WALK_SPEED * (state.settings.speedSlide / 100) : 2.5;
  } else if (isSprinting && !isRunner) {
    baseSpeed = BASE_WALK_SPEED * (state.settings.speedSprint / 100);
  }

  const inputLength = Math.sqrt(moveForward * moveForward + moveRight * moveRight);
  if (inputLength > 0) {
    const normForward = moveForward / inputLength;
    const normRight = moveRight / inputLength;

    const fMultiplier =
      normForward > 0
        ? resolveDirectionalSpeedMultiplier(state.settings, 'forward', isRunner)
        : normForward < 0
          ? resolveDirectionalSpeedMultiplier(state.settings, 'backward', isRunner)
          : 1.0;
    const sMultiplier = resolveDirectionalSpeedMultiplier(state.settings, 'side', isRunner);
    const analogScale = mobileControlsActive && inputLength < 1.0 ? inputLength : 1.0;

    moveDirection.addScaledVector(forwardDir, normForward * fMultiplier * baseSpeed * analogScale);
    moveDirection.addScaledVector(rightDir, normRight * sMultiplier * baseSpeed * analogScale);
  }

  state.playerVel.x = moveDirection.x;
  state.playerVel.z = moveDirection.z;
}

export function updatePlayerVerticalIntegrationForState({
  state,
  dt,
  gravityAcceleration,
  constrainCombatantToArena,
}: {
  state: GrifballRuntimeState;
  dt: number;
  gravityAcceleration: number;
  constrainCombatantToArena: (pos: THREE.Vector3, vel?: THREE.Vector3) => void;
}): void {
  if (state.isJumping) {
    state.playerVel.y -= gravityAcceleration * dt;
    state.playerPos.y += state.playerVel.y * dt;

    if (state.playerPos.y <= 0) {
      state.playerPos.y = 0;
      state.playerVel.y = 0;
      state.isJumping = false;
      state.pHammerJumpsInAir = 0;
    }
  } else {
    state.playerPos.y = 0;
    state.playerVel.y = 0;
  }

  state.playerPos.x += state.playerVel.x * dt;
  state.playerPos.z += state.playerVel.z * dt;
  constrainCombatantToArena(state.playerPos, state.playerVel);
}
