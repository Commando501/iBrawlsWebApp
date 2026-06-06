import * as THREE from 'three';
import { type Combatant } from '../../types';
import { type AIEngagementFrame } from './aiEngagementFrameRuntime';
import { type AIPostKillPressureFrame } from './aiPostKillPressureRuntime';
import { type GrifballAIObjectiveFrame } from './grifballAIObjectiveMovement';

export interface GrifballAIObjectiveFrameLocals {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: GrifballAIObjectiveFrame['aiState'];
  timer: GrifballAIObjectiveFrame['timer'];
  dashRemaining: number;
  slideActive: boolean;
  weaponState: GrifballAIObjectiveFrame['weaponState'];
}

export function createGrifballAIObjectiveFrameFromLocals(
  locals: GrifballAIObjectiveFrameLocals
): GrifballAIObjectiveFrame {
  return {
    pos: locals.pos,
    vel: locals.vel,
    yaw: locals.yaw,
    aiState: locals.aiState,
    timer: locals.timer,
    dashRemaining: locals.dashRemaining,
    slideActive: locals.slideActive,
    weaponState: locals.weaponState,
  };
}

export function applyGrifballAIObjectiveFrameToLocals(
  frame: GrifballAIObjectiveFrame
): Omit<GrifballAIObjectiveFrameLocals, 'pos' | 'vel'> {
  return {
    yaw: frame.yaw,
    aiState: frame.aiState,
    timer: frame.timer,
    dashRemaining: frame.dashRemaining,
    slideActive: frame.slideActive,
    weaponState: frame.weaponState,
  };
}

export interface AIPostKillPressureFrameLocals {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  aiState: AIPostKillPressureFrame['aiState'];
  timer: AIPostKillPressureFrame['timer'];
  swayTimer: number;
  activeWeapon: Combatant['activeWeapon'];
}

export function createAIPostKillPressureFrameFromLocals(
  locals: AIPostKillPressureFrameLocals
): AIPostKillPressureFrame {
  return {
    pos: locals.pos,
    vel: locals.vel,
    yaw: locals.yaw,
    aiState: locals.aiState,
    timer: locals.timer,
    swayTimer: locals.swayTimer,
    activeWeapon: locals.activeWeapon,
  };
}

export function applyAIPostKillPressureFrameToLocals(
  frame: AIPostKillPressureFrame
): Omit<AIPostKillPressureFrameLocals, 'pos' | 'vel'> {
  return {
    yaw: frame.yaw,
    aiState: frame.aiState,
    timer: frame.timer,
    swayTimer: frame.swayTimer,
    activeWeapon: frame.activeWeapon,
  };
}

export interface AIEngagementFrameLocals {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  aiState: AIEngagementFrame['aiState'];
  timer: AIEngagementFrame['timer'];
  dashCooldownTimer: AIEngagementFrame['dashCooldownTimer'];
  slideCooldownTimer: number;
  hammerJumpCooldownTimer: AIEngagementFrame['hammerJumpCooldownTimer'];
}

export function createAIEngagementFrameFromLocals(
  locals: AIEngagementFrameLocals
): AIEngagementFrame {
  return {
    pos: locals.pos,
    vel: locals.vel,
    aiState: locals.aiState,
    timer: locals.timer,
    dashCooldownTimer: locals.dashCooldownTimer,
    slideCooldownTimer: locals.slideCooldownTimer,
    hammerJumpCooldownTimer: locals.hammerJumpCooldownTimer,
  };
}

export function applyAIEngagementFrameToLocals(
  frame: AIEngagementFrame
): Omit<AIEngagementFrameLocals, 'pos' | 'vel'> {
  return {
    aiState: frame.aiState,
    timer: frame.timer,
    dashCooldownTimer: frame.dashCooldownTimer,
    slideCooldownTimer: frame.slideCooldownTimer,
    hammerJumpCooldownTimer: frame.hammerJumpCooldownTimer,
  };
}
