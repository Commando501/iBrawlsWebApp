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
  damageAlreadyRecorded?: boolean;
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

  // main_ai is a roster combatant too. Legacy aliases are not updated by
  // damage/trades and must not decide whether this target survived contact.
  const target = state.otherPlayers.get(targetId);
  return {
    hp: target?.hp ?? 0,
    invulnerabilityTimer: target?.invulnerabilityTimer ?? 0,
  };
};

export function finishAISwordLungeForCombatant(context: AISwordLungeFinishContext & { frame: AISwordLungeFinishFrame }): void {
  finishAISwordLungeWithVitals({ ...context,
    targetVitals: context.targetId ? getCombatantTargetVitals(context.state, context.targetId) : { hp: 0, invulnerabilityTimer: 0 } });
}

/** Shared completion owner. Each host supplies its current post-contact vitals;
 * callbacks own pressure, combo selection and adaptive observations. */
export function finishAISwordLungeWithVitals({
  state,
  self,
  frame,
  botId,
  cooldownMultiplier = 1,
  outcome = 'miss_timeout',
  targetId,
  damageAlreadyRecorded = false,
  recordCombatantObservation,
  recordBotDamageTag,
  tryEnterPressureState,
  tryStartComboOnHit,
  targetVitals,
}: Omit<AISwordLungeFinishContext, 'state' | 'self'> & {
  state: Pick<GrifballRuntimeState, 'settings'>;
  self: Pick<Combatant, 'isLunging' | 'weaponState' | 'aiLastLungeOutcome' | 'aiLastLungeTargetId' |
    'aiPostLungeDecisionTimer' | 'lungeStartPos' | 'aiTimer' | 'isJumping' | 'vel'>;
  targetVitals: { hp: number; invulnerabilityTimer: number };
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
    if (!damageAlreadyRecorded) recordCombatantObservation(botId, (model) => observePlayerDamageDealt(model));

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

/** Finish another roster actor's traded flight before its next AI tick can hit again. */
export function finishTradedAISwordLungeForCombatant(context: Omit<AISwordLungeFinishContext, 'outcome' | 'damageAlreadyRecorded'>): void {
  const self = context.self;
  const result = finishAISwordLungeFrameForCombatant({ ...context, outcome: 'hit', damageAlreadyRecorded: true,
    pos: self.pos, vel: self.vel, aiState: self.aiState, timer: self.aiTimer ?? 0, weaponState: self.weaponState ?? 'ready' });
  self.aiState = result.aiState;
  self.aiTimer = result.timer;
}
