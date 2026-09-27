import type { SimCombatant, SimState } from './simState';
import type { UniversalSettings } from '../types';
import { observeGrifballSpace } from '../game/aiGrifballSpace';
import { createGrifballTacticalSnapshot } from '../game/grifballTacticalContract';
import { defaultGrifballTactics, type GrifballTacticsConfig } from '../game/grifballTacticsConfig';
import { resolveHammerSlamTiming } from '../game/hammerSlamTiming';
import { isNeuralNetDifficulty } from '../game/neuralBrains';

/** Remaining headless timers are NOT elapsed live animation timers. */
export function observeSimGrifballSpace(c: SimCombatant, settings: UniversalSettings) {
  const observation = observeGrifballSpace(settings, c.weapon, 'ready', 0, 0, c.pos.y, c.vel.y);
  const timing = resolveHammerSlamTiming(settings);
  const windup = c.weapon === 'hammer' ? timing.windupTime + timing.attackTime
    : c.weapon === 'sword' ? settings.swordSlashSpeed : (settings.hammerMeleeSpeed ?? 0.24);
  const lockout = Math.max(0, c.attackCooldown, c.weaponReadyTimer);
  observation.phase = c.weaponState === 'idle' ? 'ready' : c.weaponState;
  observation.attackIn = c.isLunging || c.weaponState === 'active' ? 0
    : c.weaponState === 'windup' ? Math.max(0, c.weaponTimer)
    : Math.max(lockout, c.weaponState === 'recovering' || c.weaponState === 'swapping' ? c.weaponTimer : 0) + windup;
  return observation;
}

/**
 * Opt-in observation adapter. The caller explicitly names scripted participants;
 * SimCombatant.controller is bookkeeping and cannot authorize control of an RL bot.
 * No action injection, model inputs, or stepSimulation behavior changes here.
 */
export function createSimGrifballTacticalSnapshot(state: SimState, options: {
  scriptedBots: Readonly<Record<string, string>>;
  tactics?: GrifballTacticsConfig;
}) {
  if (state.mode !== 'grifball') throw new Error('Tactical observations require Grifball mode.');
  const scripted = (c: SimCombatant) => Object.prototype.hasOwnProperty.call(options.scriptedBots, c.id)
    && !isNeuralNetDifficulty(options.scriptedBots[c.id]);
  const roster = state.combatants.map(c => ({ id: c.id, team: c.team, controller: c.controller,
    difficulty: options.scriptedBots[c.id] ?? state.settings.aiDifficulty, scripted: scripted(c) }));
  return createGrifballTacticalSnapshot({
    match: state.match, settings: state.settings, map: state.map, arenaRadius: state.map.arenaRadius,
    tactics: options.tactics ?? defaultGrifballTactics(), roster,
    players: state.combatants.filter(c => c.alive && c.hp > 0 && c.respawnTimer <= 0).map(c => ({
      id: c.id, team: c.team, scripted: scripted(c), difficulty: options.scriptedBots[c.id] ?? state.settings.aiDifficulty, pos: c.pos, vel: c.vel, height: c.pos.y,
      heading: { x: -Math.sin(c.yaw), z: -Math.cos(c.yaw) }, pickupRequested: undefined,
      space: observeSimGrifballSpace(c, state.settings),
    })),
    goals: { blue: state.goalPlates.find(p => p.team === 'blue')?.position ?? null, red: state.goalPlates.find(p => p.team === 'red')?.position ?? null },
    respawns: state.combatants.filter(c => !c.alive && c.respawnTimer > 0).map(c => {
      const cluster = state.spawns[c.team] ?? [];
      const index = state.combatants.filter(p => p.team === c.team).indexOf(c);
      return { id: c.id, team: c.team, pos: cluster[index % cluster.length] ?? { x: 0, z: 0 },
        seconds: c.respawnTimer, speed: 5.2 * state.settings.speedForward / 100 };
    }),
  });
}
