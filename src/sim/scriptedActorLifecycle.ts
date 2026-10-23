import * as THREE from 'three';
import { getOptimalGrifballSpawnPoint } from '../components/grifball/arenaSpawns';
import { clearBotComboState, getOrCreateBotPsychState, resetAIMatchContext, type AIMatchContext } from '../game/aiMatchContext';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { isPsychPressureEnabled, notifyBotKill } from '../game/aiPsychologicalPressure';
import { isSkillCalibrationEnabled, recordCalibrationDeath, recordCalibrationKill } from '../game/aiSkillCalibration';
import type { UniversalSettings } from '../types';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';
import { isMixedPlayer, type SimCombatant, type SimState } from './simState';
import type { ScriptedCombatLearning } from './scriptedCombatLearning';

/** Additional state owned by the composed AI host and included in its checkpoints. */
export interface ScriptedActorLifecycle {
  memories: Record<string, SimCombatPriorityMemory>;
  pressure: Readonly<Record<string, { aggression: number }>>;
  spawnPoints: readonly { x: number; y: number; z: number }[];
}
export interface RosterActorLifecycle {
  impact(actor: SimCombatant, target: SimCombatant, kind: 'melee' | 'lunge', trade?: boolean, targetWasLunging?: boolean): void;
  respawn(actor: SimCombatant): void;
}

export function validateScriptedActorLifecycle(control: ScriptedCombatLearning): void {
  const lifecycle = control.lifecycle;
  if (!lifecycle) return;
  if (!Array.isArray(lifecycle.spawnPoints) || lifecycle.spawnPoints.some(p => !p || ![p.x, p.y, p.z].every(Number.isFinite)) ||
    !(control.matchContext.comboState instanceof Map) || !(control.matchContext.psychState instanceof Map))
    throw new Error('Invalid scripted actor lifecycle owner');
  for (const id of Object.keys(control.scriptedBots)) {
    const memory = lifecycle.memories?.[id], pressure = lifecycle.pressure?.[id];
    if (!memory || !pressure || !Number.isFinite(pressure.aggression) || pressure.aggression < 0 ||
      ![memory.timer ?? 0, memory.swayTimer, memory.coordCommitTimer, memory.cooldownMultiplier].every(Number.isFinite) ||
      memory.cooldownMultiplier !== 1 || typeof memory.pendingPostEvasionCharge !== 'boolean')
      throw new Error(`Invalid scripted lifecycle authority: ${id}`);
  }
}

/** Called only at resolved impacts and actual revivals; never inferred from a
 * later aggregate kill list, which would change the next actor's observations. */
export function createScriptedActorLifecycle(state: SimState, control: ScriptedCombatLearning,
  settings: UniversalSettings): RosterActorLifecycle | undefined {
  const lifecycle = control.lifecycle;
  if (!lifecycle) return;
  const ai = control.matchContext, tuning = resolveBehaviorTuning(settings);
  const owns = (c: SimCombatant) => Object.hasOwn(control.scriptedBots, c.id);
  const death = (c: SimCombatant, markRespawning: boolean) => {
    if (c.hp > 0 || !owns(c)) return;
    if (markRespawning) lifecycle.memories[c.id].aiState = 'RESPAWNING';
    // Preserve the live callbacks' main-slot calibration ownership.
    if (c.id === 'main_ai' && isSkillCalibrationEnabled(control.scriptedBots[c.id]))
      recordCalibrationDeath(ai, c.id, (state.combatTimeMs ?? 0) / 1000, tuning.calibrationWindowSize);
  };
  return {
    impact(actor, target, kind, trade = false, targetWasLunging = false) {
      const local = isMixedPlayer(state, actor);
      if (!local && !owns(actor)) return;
      if (local && control.isObserverMode) return;
      death(target, local || kind === 'melee' || trade || target.id === 'main_ai');
      if (trade) {
        if (!local) death(actor, false);
        // Local trades consume surviving AI flight without running its finish
        // callback. Roster trades already finish their surviving flights.
        if (local && target.hp > 0 && targetWasLunging && owns(target)) {
          lifecycle.memories[target.id].aiState = 'COOLDOWN';
          lifecycle.memories[target.id].timer = settings.swordLungeReload ?? 1.2;
        }
        return; // Live trades do not record psychological/calibration kills.
      }
      if (local || target.hp > 0 || actor.team === target.team) return;
      const difficulty = control.scriptedBots[actor.id];
      if (isSkillCalibrationEnabled(difficulty))
        recordCalibrationKill(ai, actor.id, (state.combatTimeMs ?? 0) / 1000, tuning.calibrationWindowSize);
      if (!isPsychPressureEnabled(difficulty, lifecycle.pressure[actor.id].aggression)) return;
      const excluded = state.combatants.filter(c => c.id !== target.id && c.hp > 0 && c.respawnTimer <= 0 &&
        !(isMixedPlayer(state, c) && control.isObserverMode)).map(c => new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z));
      const spawn = getOptimalGrifballSpawnPoint(state.map,
        lifecycle.spawnPoints.map(p => new THREE.Vector3(p.x, p.y, p.z)), excluded);
      notifyBotKill(getOrCreateBotPsychState(ai, actor.id, tuning.tempoCycleDuration), {
        victimId: target.id, spawnX: spawn.x, spawnZ: spawn.z, lungeKill: kind === 'lunge', duration: tuning.postKillPressureDuration,
      });
      lifecycle.memories[actor.id].pressureTargetId = undefined;
      // A lunge's completed frame writes its selected reload/pressure state after
      // post-kill bookkeeping; it must not lose the reload on objective handoff.
      if (actor.id !== 'main_ai' && kind !== 'lunge') lifecycle.memories[actor.id].aiState = 'APPROACHING';
    },
    respawn(actor) {
      if (!owns(actor)) return;
      Object.assign(lifecycle.memories[actor.id], { aiState: 'APPROACHING', timer: 0,
        lastLungeOutcome: undefined, lastLungeTargetId: undefined, postLungeDecisionTimer: 0,
        pendingPostEvasionCharge: false, coordCommitTimer: 0, pressureTargetId: undefined });
      clearBotComboState(ai, actor.id);
    },
  };
}

/** Fresh headless session only, paired with a freshly created physical match.
 * A goal/round reset must not call this. Persistent browser fingerprints are
 * deliberately not loaded by the headless host. References remain stable. */
export function resetSimGrifballActorSession(control: {
  matchContext: AIMatchContext; memories: Record<string, SimCombatPriorityMemory>;
  planner?: { punchControl?: { cooldowns: Record<string, number> } };
}): void {
  resetAIMatchContext(control.matchContext);
  for (const memory of Object.values(control.memories)) {
    for (const key of Object.keys(memory)) delete memory[key as keyof SimCombatPriorityMemory];
    Object.assign(memory, { aiState: 'APPROACHING', timer: 0, swayTimer: 0, coordCommitTimer: 0,
      cooldownMultiplier: 1, pendingPostEvasionCharge: false });
  }
  const cooldowns = control.planner?.punchControl?.cooldowns;
  if (cooldowns) for (const id of Object.keys(cooldowns)) cooldowns[id] = 0;
}
