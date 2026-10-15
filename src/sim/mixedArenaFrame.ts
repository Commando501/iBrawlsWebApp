import * as THREE from 'three';
import { resolveCombatantBodyCollisions } from '../components/grifball/bodyCollisions';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import type { SimState } from './simState';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';

/** Final offline live frame: local/roster body separation, then arena bounds.
 * Observer mode intentionally retains the production exclusion of body collisions. */
export function finishSimMixedArenaFrame(state: SimState, memories?: Readonly<Record<string, SimCombatPriorityMemory>>) {
  if (state.combatExecution !== 'live-mixed-v1') throw new Error('Mixed arena frame requires mixed execution');
  const actors = state.combatants.map(actor => ({ actor, id: actor.id,
    pos: new THREE.Vector3(actor.pos.x, actor.pos.y, actor.pos.z),
    vel: new THREE.Vector3(actor.vel.x, actor.vel.y, actor.vel.z),
    isCrouching: actor.isCrouching, modelType: actor.modelType }));
  const local = actors.find(c => c.id === state.localPlayerId);
  if (!local) throw new Error('Mixed arena frame requires its local camera/player');
  if (!state.localPlayerIsObserver) {
    const main = actors.find(c => c.id === 'main_ai');
    resolveCombatantBodyCollisions([
      ...(local.actor.hp > 0 ? [local] : []),
      ...(main && main.actor.hp > 0 && memories?.main_ai?.aiState !== 'RESPAWNING' ? [main] : []),
      ...actors.filter(c => c !== local && c !== main && c.actor.hp > 0 && c.actor.respawnTimer <= 0),
    ]);
  }
  for (const c of actors) {
    if (c === local && state.localPlayerIsObserver) continue;
    constrainCombatantToArenaBounds({ pos: c.pos, vel: c.vel, activeCustomMap: state.map, arenaRadius: state.map.arenaRadius });
    Object.assign(c.actor.pos, c.pos); Object.assign(c.actor.vel, c.vel);
  }
}
