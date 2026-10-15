import { usesRosterLifecycle, type SimCombatant, type SimState } from './simState';

/** Pure prediction shared by tactical observations and the actual revival owner.
 * Re-evaluate per actor: earlier revivals in a frame become occupied positions. */
export function selectSimRespawnPosition(state: SimState, actor: SimCombatant) {
  const cluster = state.spawns[actor.team] ?? [];
  const index = state.combatants.filter(c => c.team === actor.team).indexOf(actor);
  let spawn = cluster.length ? cluster[index % cluster.length] : { x: 0, y: 0, z: 0 };
  if (usesRosterLifecycle(state)) {
    const occupied = state.combatants.filter(c => c !== actor && c.alive && c.hp > 0 && c.respawnTimer <= 0);
    let bestClearance = -1;
    for (const point of cluster) {
      let clearance = Infinity;
      for (const other of occupied) clearance = Math.min(clearance,
        (point.x - other.pos.x) ** 2 + (point.y - other.pos.y) ** 2 + (point.z - other.pos.z) ** 2);
      // Strict comparison preserves authored spawn order when clearance ties.
      if (clearance > bestClearance) { bestClearance = clearance; spawn = point; }
    }
  }
  return { x: spawn.x, y: spawn.y, z: spawn.z };
}
