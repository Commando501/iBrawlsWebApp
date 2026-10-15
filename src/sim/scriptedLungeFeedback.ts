import * as THREE from 'three';
import { finishAISwordLungeWithVitals } from '../components/grifball/aiSwordLungeFinishRuntime';
import { tryEnterCombatantPressureState } from '../components/grifball/matchPressure';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { notifyBotDamageTag, type BotCoordinatorState } from '../game/aiBotCoordinator';
import { resolveAIHitCombo } from '../game/aiHitCombo';
import { createPlayerModel, observePlayerDamageDealt, observePlayerDamageReceived, observePlayerCounter, type PlayerModel } from '../game/aiPlayerModel';
import type { AIMatchScoreContext } from '../game/aiTuning';
import type { Combatant, UniversalSettings } from '../types';
import { isMixedPlayer, type SimCombatant, type SimState } from './simState';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';
import { validateScriptedMeleeFeedback, type ScriptedMeleeFeedback } from './scriptedMeleeFeedback';

export interface LungeAIMemory extends TacticalAIMemory {
  lastLungeOutcome?: Combatant['aiLastLungeOutcome'];
  lastLungeTargetId?: string;
  postLungeDecisionTimer?: number;
  pressureTargetId?: string;
}
export interface ScriptedLungeFeedback extends Omit<ScriptedMeleeFeedback, 'version' | 'memories'> {
  version: 'scripted-lunge-feedback-v1';
  memories: Record<string, LungeAIMemory>;
  /** Effective aggression after personality/match tuning, supplied by the host. */
  pressure: Readonly<Record<string, { aggression: number; skip?: boolean }>>;
  scoreContext: AIMatchScoreContext;
  models: Map<string, PlayerModel>;
  coordinator: BotCoordinatorState;
}
export interface RosterLungeFeedback {
  impact(attacker: SimCombatant, target: SimCombatant, trade: boolean): void;
  finish(actor: SimCombatant, outcome: NonNullable<SimCombatant['lungeOutcome']>, targetId: string | undefined, damageAlreadyRecorded: boolean): void;
}

export function validateScriptedLungeFeedback(state: SimState, control: ScriptedLungeFeedback | undefined, settings: UniversalSettings) {
  if (!control) return;
  if (control.version !== 'scripted-lunge-feedback-v1' || !(control.models instanceof Map) ||
    !(control.coordinator?.recentTags instanceof Map) || !control.pressure ||
    !Number.isFinite(control.scoreContext?.scorePlayer) || !Number.isFinite(control.scoreContext?.scoreEnemy) ||
    control.scoreContext.killsToWin !== undefined && (!Number.isFinite(control.scoreContext.killsToWin) || control.scoreContext.killsToWin <= 0))
    throw new Error('Invalid scripted lunge feedback owner');
  validateScriptedMeleeFeedback(state, { ...control, version: 'scripted-melee-feedback-v1' }, settings);
  for (const id of Object.keys(control.knobs)) {
    const pressure = Object.hasOwn(control.pressure, id) ? control.pressure[id] : null;
    if (!pressure || !Number.isFinite(pressure.aggression) || pressure.aggression < 0 ||
      pressure.skip !== undefined && typeof pressure.skip !== 'boolean' ||
      !Number.isFinite(control.memories[id]?.cooldownMultiplier) || control.memories[id].cooldownMultiplier < 0)
      throw new Error(`Missing or invalid lunge tuning for ${id}`);
  }
}

/** Finish events run during the actor's flight, before the next roster decision.
 * Caller memory is separate from simulation/RL state and must be checkpointed
 * with the caller's RNG. This does not advance general AI or coordinator clocks. */
export function createScriptedLungeFeedback(state: SimState, control: ScriptedLungeFeedback, settings: UniversalSettings): RosterLungeFeedback {
  const tuning = resolveBehaviorTuning(settings);
  const owns = (id: string) => Object.hasOwn(control.knobs, id);
  const observe = (id: string, fn: (model: PlayerModel) => void) => {
    let model = control.models.get(id);
    if (!model) {
      model = createPlayerModel({ emaAlpha: tuning.playerModelEmaAlpha, defaultLungeDistance: tuning.defaultLungeDistance, defaultReactionTime: tuning.defaultReactionTime });
      control.models.set(id, model);
    }
    fn(model);
  };
  const ai = (actor: SimCombatant) => actor.controller === 'ai' && !isMixedPlayer(state, actor);
  return {
    impact(attacker, target, trade) {
      if (!owns(attacker.id) && !owns(target.id)) return;
      if (trade) {
        // Live roster-vs-local trade bookkeeping is performed by the respective
        // finish owners; roster-vs-roster trades record damage before finishing.
        if (isMixedPlayer(state, target)) return;
        for (const actor of [attacker, target]) if (ai(actor)) {
          observe(actor.id, observePlayerDamageDealt); observe(actor.id, observePlayerDamageReceived);
        }
        if (ai(target)) observe(target.id, model => observePlayerCounter(model, true));
      } else if (ai(target) || isMixedPlayer(state, target)) observe(target.id, observePlayerDamageReceived);
    },
    finish(actor, outcome, targetId, damageAlreadyRecorded) {
      if (!owns(actor.id)) return;
      const memory = control.memories[actor.id], target = state.combatants.find(c => c.id === targetId);
      const point = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
      const self = { controller: 'ai' as const, isLunging: actor.isLunging, weaponState: 'ready' as const,
        aiState: memory.aiState, aiTimer: memory.timer, aiPressureTargetId: memory.pressureTargetId,
        aiLastLungeOutcome: memory.lastLungeOutcome, aiLastLungeTargetId: memory.lastLungeTargetId,
        aiPostLungeDecisionTimer: memory.postLungeDecisionTimer, lungeStartPos: actor.lungeStartPos,
        isJumping: actor.isJumping, vel: point(actor.vel) };
      const frame = { pos: point(actor.pos), vel: self.vel, aiState: memory.aiState, timer: memory.timer ?? 0, weaponState: 'ready' as const };
      finishAISwordLungeWithVitals({ state: { settings }, self, frame, botId: actor.id, outcome, targetId, damageAlreadyRecorded,
        cooldownMultiplier: memory.cooldownMultiplier, targetVitals: { hp: target?.hp ?? 0, invulnerabilityTimer: target?.invulnerabilityTimer ?? 0 },
        recordCombatantObservation: observe,
        recordBotDamageTag: (id, targetId) => notifyBotDamageTag(control.coordinator, id, targetId, tuning.damageTagTtl),
        tryEnterPressureState: (_id, targetId, targetHp, targetInvuln) => tryEnterCombatantPressureState({ bot: self, targetId, targetHp, targetInvuln,
          settings, scoreContext: control.scoreContext, pressureAggression: control.pressure[actor.id].aggression, skipPressure: control.pressure[actor.id].skip }),
        tryStartComboOnHit: (id, targetId, openingWeapon) => {
          const current = control.combos.get(id) ?? null;
          const combo = resolveAIHitCombo({ current, targetId, openingWeapon, botPos: actor.pos,
            target: target ? observeSimTacticalWeaponTarget(state, target, control.memories[target.id]) : null,
            settings, knobs: control.knobs[id], random: control.random });
          if (combo && combo !== current) control.combos.set(id, combo);
        },
      });
      Object.assign(memory, { aiState: frame.aiState, timer: frame.timer, lastLungeOutcome: self.aiLastLungeOutcome,
        lastLungeTargetId: self.aiLastLungeTargetId, postLungeDecisionTimer: self.aiPostLungeDecisionTimer });
      if (self.aiPressureTargetId !== undefined) memory.pressureTargetId = self.aiPressureTargetId;
      Object.assign(actor.vel, { x: self.vel.x, y: self.vel.y, z: self.vel.z }); actor.isJumping = self.isJumping;
    },
  };
}
