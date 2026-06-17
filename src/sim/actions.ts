/**
 * Per-combatant control input — the seam that replaces keyboard/gamepad/mobile
 * input reads inside the live `updatePhysics`. One {@link ActionInput} per agent
 * is fed into `stepSimulation` each tick; heuristic bots, RL policies, and the
 * (future) replay of recorded inputs all produce this same shape.
 *
 * This is the *continuous / intent* form. The RL-facing factorized discrete action
 * space (and its decode into this shape) lives in `src/sim/env/action.ts`.
 */

export interface ActionInput {
  /** Desired move direction, world-space, each in [-1, 1]. Magnitude > 1 is clamped. */
  moveX: number;
  moveZ: number;
  /** Desired facing yaw in radians. The physics step turns toward this. */
  aim: number;
  /** Hold to jump / hammer-jump (edge-detected by the weapon/physics step). */
  jump: boolean;
  /** Tap to dash in the current move direction. */
  dash: boolean;
  /** Hold to crouch / slide. */
  crouch: boolean;
  /** One-frame request to pick up an objective object in range. */
  pickup: boolean;
  /** Primary attack (hammer swing / sword slash / punch). */
  attackPrimary: boolean;
  /** Secondary action: sword lunge, or — while carrying the ball — pass/throw. */
  attackSecondary: boolean;
  /** Pass wind-up charge in [0, 1]; longer charge throws the ball farther. */
  passCharge: number;
  /** Request a weapon swap (hammer <-> sword); ignored while carrying the ball. */
  swapWeapon: boolean;
}

/** A neutral, do-nothing action. Used for absent agents and as a decode base. */
export function idleAction(): ActionInput {
  return {
    moveX: 0,
    moveZ: 0,
    aim: 0,
    jump: false,
    dash: false,
    crouch: false,
    pickup: false,
    attackPrimary: false,
    attackSecondary: false,
    passCharge: 0,
    swapWeapon: false,
  };
}

/** Map of combatant id -> action for a single tick. Missing ids default to idle. */
export type ActionsById = Record<string, ActionInput>;
