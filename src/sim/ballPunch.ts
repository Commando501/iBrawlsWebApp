import { advancePunch, beginPunch, findPunchHitTarget, type PunchActor } from '../game/ballPunch';
import { combatExecutionForActor, type SimCombatant, type SimState } from './simState';

export function simPunchActor(c: SimCombatant, playerView = false): PunchActor {
  const pitch = playerView ? c.pitch ?? 0 : 0;
  return { ...c, eyeHeight: playerView ? 1.65 - (c.crouchAmount ?? 0) : c.isCrouching ? .9 : 1.2,
    heading: { x: Math.sin(c.yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(c.yaw) * Math.cos(pitch) } };
}
const targets = (state: SimState, c: SimCombatant, includeTeammates = false) => state.combatants.filter(t =>
  t.id !== c.id && (includeTeammates || t.team !== c.team) && t.alive && t.hp > 0 && t.respawnTimer <= 0 && t.invulnerabilityTimer <= 0);

export function startSimPunch(state: SimState, c: SimCombatant): void {
  c.punchAttack = beginPunch(simPunchActor(c, combatExecutionForActor(state, c) === 'live-player-v1'), targets(state, c), state.settings, state.map);
}

export function stepSimPunch(state: SimState, c: SimCombatant, dt: number): void {
  if (c.weapon !== 'ball' || !c.alive || !['windup', 'active'].includes(c.weaponState)) { delete c.punchAttack; return; }
  const actor = simPunchActor(c, combatExecutionForActor(state, c) === 'live-player-v1'), candidates = targets(state, c);
  c.punchAttack ??= beginPunch(actor, candidates, state.settings, state.map);
  advancePunch(actor, c.punchAttack, candidates, state.settings, dt, state.map);
}

export function simPunchHitTarget(state: SimState, c: SimCombatant): SimCombatant | undefined {
  const actor = simPunchActor(c, combatExecutionForActor(state, c) === 'live-player-v1');
  if (c.punchAttack?.targetId) actor.heading = c.punchAttack.direction;
  const target = findPunchHitTarget(actor, targets(state, c, true), state.map);
  return target ? state.combatants.find(t => t.id === target.id) : undefined;
}
