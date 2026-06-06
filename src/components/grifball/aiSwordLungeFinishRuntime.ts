import * as THREE from 'three';
import { type AILungeOutcome } from '../../game/aiCombatDecision';
import { type AIBehaviorState, type Combatant, type WeaponState } from '../../types';
import {
  observePlayerDamageDealt,
  observePlayerLungeEnd,
  type PlayerModelObserver,
} from './playerModelObservations';
import { type GrifballRuntimeState } from './runtimeState';

export interface AISwordLungeFinishFrame {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  aiState: AIBehaviorState | undefined;
  timer: number;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

interface AISwordLungeFinishContext {
  state: GrifballRuntimeState;
  self: Combatant;
  botId: string;
  cooldownMultiplier?: number;
  outcome?: AILungeOutcome;
  targetId?: string;
  recordCombatantObservation: (botId: string, observe: PlayerModelObserver) => void;
  recordBotDamageTag: (botId: string, targetId: string) => void;
  tryEnterPressureState: (
    botId: string,
    targetId: string,
    targetHp: number,
    targetInvulnerabilityTimer: number
  ) => boolean;
  tryStartComboOnHit: (botId: string, targetId: string, openingWeapon: 'sword') => void;
}

export interface AISwordLungeFinishResult {
  aiState: AIBehaviorState | undefined;
  timer: number;
  weaponState: WeaponState | 'slashing' | 'recovering';
}

const getCombatantTargetVitals = (
  state: GrifballRuntimeState,
  targetId: string
): { hp: number; invulnerabilityTimer: number } => {
  if (targetId === 'player') {
    return {
      hp: state.playerHP,
      invulnerabilityTimer: state.playerInvulnerabilityTimer,
    };
  }

  if (targetId === 'main_ai') {
    return {
      hp: state.aiHP ?? 0,
      invulnerabilityTimer: state.aiInvulnerabilityTimer ?? 0,
    };
  }

  const target = state.otherPlayers.get(targetId);
  return {
    hp: target?.hp ?? 0,
    invulnerabilityTimer: target?.invulnerabilityTimer ?? 0,
  };
};

export function finishAISwordLungeForCombatant({
  state,
  self,
  frame,
  botId,
  cooldownMultiplier = 1,
  outcome = 'miss_timeout',
  targetId,
  recordCombatantObservation,
  recordBotDamageTag,
  tryEnterPressureState,
  tryStartComboOnHit,
}: AISwordLungeFinishContext & {
  frame: AISwordLungeFinishFrame;
}): void {
  self.isLunging = false;
  self.weaponState = 'ready';
  self.aiLastLungeOutcome = outcome;
  self.aiLastLungeTargetId = targetId;
  self.aiPostLungeDecisionTimer = outcome === 'miss_timeout' || outcome === 'miss_arena' ? 1.35 : 0.35;

  const lungeStart = self.lungeStartPos ?? frame.pos;
  const lungeTraveled = Math.hypot(frame.pos.x - lungeStart.x, frame.pos.z - lungeStart.z);
  const lungeHit = outcome === 'hit';
  recordCombatantObservation(botId, (model) => observePlayerLungeEnd(model, lungeTraveled, lungeHit));

  let enteredPressure = false;
  if (outcome === 'hit' && targetId) {
    recordBotDamageTag(botId, targetId);
    recordCombatantObservation(botId, (model) => observePlayerDamageDealt(model));

    const targetVitals = getCombatantTargetVitals(state, targetId);
    enteredPressure = tryEnterPressureState(
      botId,
      targetId,
      targetVitals.hp,
      targetVitals.invulnerabilityTimer
    );
    if (targetVitals.hp > 0) {
      tryStartComboOnHit(botId, targetId, 'sword');
    }
  }

  if (!enteredPressure) {
    frame.aiState = 'COOLDOWN';
    frame.timer = (state.settings.swordLungeReload ?? 1.2) * cooldownMultiplier;
  } else {
    frame.aiState = 'PRESSURING';
    frame.timer = self.aiTimer ?? frame.timer;
  }
  frame.weaponState = 'ready';

  if (frame.pos.y > 0.01 || Math.abs(frame.vel.y) > 0.01) {
    frame.vel.x = 0;
    frame.vel.z = 0;
    frame.vel.y = Math.min(frame.vel.y, 0);
    self.isJumping = true;
  } else {
    frame.vel.set(0, 0, 0);
    self.isJumping = false;
  }

  self.vel.copy(frame.vel);
}

export function finishAISwordLungeFrameForCombatant({
  pos,
  vel,
  aiState,
  timer,
  weaponState,
  ...context
}: AISwordLungeFinishContext & AISwordLungeFinishFrame): AISwordLungeFinishResult {
  const frame: AISwordLungeFinishFrame = {
    pos,
    vel,
    aiState,
    timer,
    weaponState,
  };

  finishAISwordLungeForCombatant({
    ...context,
    frame,
  });

  return {
    aiState: frame.aiState,
    timer: frame.timer,
    weaponState: frame.weaponState,
  };
}
