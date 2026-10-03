import { combatExecutionForActor, isRosterExecution, weaponAttackCooldown, type SimCombatant, type SimState, type SimCombatExecution } from './simState';
import type { UniversalSettings } from '../types';
import { observeGrifballSpace } from '../game/aiGrifballSpace';
import { createGrifballTacticalSnapshot } from '../game/grifballTacticalContract';
import { defaultGrifballTactics, type GrifballTacticsConfig } from '../game/grifballTacticsConfig';
import { resolveHammerSlamTiming } from '../game/hammerSlamTiming';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import { selectSimRespawnPosition } from './spawns';

/** Remaining headless timers are NOT elapsed live animation timers. */
export function observeSimGrifballSpace(c: SimCombatant, settings: UniversalSettings, execution: SimCombatExecution = 'legacy-v1', scriptedMovement = false) {
  // Generic input execution advances dash and gravity concurrently. Only the
  // explicitly owned scripted roster path waits for airborne recovery first.
  const observation = observeGrifballSpace(settings, c.weapon, 'ready', 0, 0, c.pos.y, c.vel.y, 18, 2.8,
    { dashRemaining: c.dashRemaining, dashWaitsForLanding: scriptedMovement && isRosterExecution(execution) });
  const timing = resolveHammerSlamTiming(settings);
  const windup = c.weapon === 'hammer' ? timing.windupTime + timing.attackTime
    : c.weapon === 'sword' ? settings.swordSlashSpeed : (settings.hammerMeleeSpeed ?? 0.24);
  const lockout = Math.max(weaponAttackCooldown(c, execution), c.weaponReadyTimer, 0);
  observation.phase = c.weaponState === 'idle' ? 'ready' : c.weaponState;
  observation.attackIn = c.isLunging || c.weaponState === 'active' ? 0
    : c.weaponState === 'windup' ? Math.max(0, c.weaponTimer)
    : Math.max(lockout, c.weaponState === 'recovering' || c.weaponState === 'swapping' ? c.weaponTimer : 0) + windup;
  if (execution === 'live-player-v1' && !c.isLunging) {
    const melee = settings.hammerMeleeSpeed ?? .24;
    const primaryImpact = c.weapon === 'hammer' ? timing.windupTime + timing.attackTime
      : c.weapon === 'sword' ? (settings.swordSlashSpeed ?? .22) * .5 : melee + Math.max(.03, melee * .5);
    if (c.weaponState === 'windup' && (c.attackKind === 'slash' || c.attackKind === 'swipe')) {
      const duration = c.attackKind === 'slash' ? (settings.swordSlashSpeed ?? .22) : melee;
      const untilHit = duration * .5 - (c.weaponPhaseElapsed ?? 0);
      const recovery = c.attackKind === 'slash' ? (settings.swordSlashReload ?? .6) : (settings.hammerMeleeReload ?? .5);
      observation.attackIn = untilHit > 0 ? untilHit : c.weaponTimer + recovery + primaryImpact;
    } else if (c.weaponState === 'windup') {
      observation.attackIn = c.weaponTimer + (c.attackKind === 'strike' ? timing.attackTime : Math.max(.03, melee * .5));
    } else if (c.weaponState === 'active') {
      observation.attackIn = Math.max(0, c.weaponTimer);
    } else {
      observation.attackIn = Math.max(lockout, c.weaponState === 'recovering' ? c.weaponTimer : 0) + primaryImpact;
    }
  }
  if (isRosterExecution(execution) && !c.isLunging) {
    const melee = settings.hammerMeleeSpeed ?? .24;
    const primaryImpact = c.weapon === 'hammer' ? timing.windupTime + timing.attackTime
      : c.weapon === 'sword' ? (settings.swordSlashSpeed ?? .22) * .5 : melee + Math.max(.03, melee * .5);
    if (c.weaponState === 'windup') {
      const strike = c.attackKind === 'strike' ? timing.attackTime
        : c.attackKind === 'swipe' ? (melee ? melee * .6 : .14)
        : c.attackKind === 'punch' ? Math.max(.03, melee * .5) : 0;
      observation.attackIn = c.weaponTimer + strike;
    } else if (c.weaponState === 'active') {
      // The slash already hit at the windup boundary; follow-through is not a fresh threat.
      observation.attackIn = c.weaponTimer + (c.attackKind === 'slash' ? (settings.swordSlashReload ?? .6) + primaryImpact : 0);
    } else {
      observation.attackIn = Math.max(lockout, c.weaponState === 'recovering' ? c.weaponTimer : 0) + primaryImpact;
    }
  }
  if (execution !== 'legacy-v1') {
    // Expose the same observable tactical phases as the live animation owner.
    // Spent slash/swipe follow-through is recovery, even while the mesh still swings.
    const swipe = c.attackKind === 'swipe';
    observation.phase = c.weaponState === 'idle' ? 'ready'
      : c.weaponState === 'recovering' ? swipe ? 'melee_recover' : 'recovering'
      : c.weaponState === 'windup' ? swipe ? isRosterExecution(execution) ? 'melee_up' : 'melee_swing'
        : c.attackKind === 'slash' && execution === 'live-player-v1' ? 'slashing' : 'swing_up'
      : c.weaponState === 'active' ? swipe ? 'melee_down' : c.attackKind === 'slash' ? 'recovering' : 'swing_down'
      : c.weaponState;
    if (execution === 'live-player-v1' && c.weaponState === 'windup' && (swipe || c.attackKind === 'slash')) {
      const duration = swipe ? (settings.hammerMeleeSpeed ?? .24) : (settings.swordSlashSpeed ?? .22);
      if ((c.weaponPhaseElapsed ?? 0) >= duration * .5) observation.phase = swipe ? 'melee_recover' : 'recovering';
    }
    if (c.isLunging) observation.phase = 'lunging';
  }
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
  /** Current observed pickup input, supplied separately from control ownership.
   * Omitted means unknown; this never issues an action or changes simulator state. */
  pickupRequests?: Readonly<Record<string, boolean | undefined>>;
}) {
  if (state.mode !== 'grifball') throw new Error('Tactical observations require Grifball mode.');
  const scripted = (c: SimCombatant) => c.controller === 'ai' && !isNeuralNetDifficulty(state.settings.aiDifficulty)
    && Object.prototype.hasOwnProperty.call(options.scriptedBots, c.id)
    && !isNeuralNetDifficulty(options.scriptedBots[c.id]);
  const pickupRequested = (id: string) => options.pickupRequests && Object.prototype.hasOwnProperty.call(options.pickupRequests, id)
    ? options.pickupRequests[id] : undefined;
  const participants = state.combatants.filter(c => !(state.combatExecution === 'live-mixed-v1' && state.localPlayerIsObserver && c.id === state.localPlayerId));
  const roster = participants.map(c => ({ id: c.id, team: c.team, controller: c.controller,
    difficulty: options.scriptedBots[c.id] ?? state.settings.aiDifficulty, scripted: scripted(c) }));
  // Versioned execution aims along +sin/+cos; live model yaw is offset by PI.
  // Preserve the original observation contract for legacy training callers.
  const headingSign = !state.combatExecution || state.combatExecution === 'legacy-v1' ? -1 : 1;
  // The live mixed snapshot always observes the local player before roster actors,
  // independently of the simulator's serialized actor storage order.
  const observedActors = state.combatExecution === 'live-mixed-v1'
    ? [...participants].sort((a, b) => Number(b.id === state.localPlayerId) - Number(a.id === state.localPlayerId))
    : participants;
  const respawningActors = participants.filter(c => !c.alive && c.respawnTimer > 0);
  if (state.combatExecution === 'live-mixed-v1')
    respawningActors.sort((a, b) => Number(a.id === state.localPlayerId) - Number(b.id === state.localPlayerId));
  return createGrifballTacticalSnapshot({
    match: state.match, settings: state.settings, map: state.map, arenaRadius: state.map.arenaRadius,
    tactics: options.tactics ?? defaultGrifballTactics(), roster,
    players: observedActors.filter(c => c.alive && c.hp > 0 && c.respawnTimer <= 0).map(c => ({
      id: c.id, team: c.team, scripted: scripted(c), difficulty: options.scriptedBots[c.id] ?? state.settings.aiDifficulty, pos: c.pos, vel: c.vel, height: c.pos.y,
      heading: { x: headingSign * Math.sin(c.yaw), z: headingSign * Math.cos(c.yaw) }, pickupRequested: pickupRequested(c.id),
      space: observeSimGrifballSpace(c, state.settings, combatExecutionForActor(state, c), scripted(c)),
    })),
    goals: { blue: state.goalPlates.find(p => p.team === 'blue')?.position ?? null, red: state.goalPlates.find(p => p.team === 'red')?.position ?? null },
    respawns: respawningActors.map(c => {
      return { id: c.id, team: c.team, pos: selectSimRespawnPosition(state, c),
        seconds: c.respawnTimer, speed: 5.2 * state.settings.speedForward / 100 };
    }),
  });
}
