import { createBotParityFixture } from './grifballBotExecutionParity';
import { addParityActor, parityRecorder } from './grifballMultiActorParity';
import { PREMADE_MAPS } from '../../src/game/premadeMaps';
import { toGrifballArena } from '../../src/game/grifballMaps';
import { tickRespawns } from '../../src/sim/weapons';
import { defaultGrifballMap } from '../../src/sim/factory';
import type { CustomMapData } from '../../src/types';

const custom = (id: string, points: { x: number; y: number; z: number }[], team = true): CustomMapData => ({
  ...structuredClone(defaultGrifballMap()), id, spawnPoints: points,
  teamSpawns: team ? { blue: points, red: points.map(p => ({ ...p, x: -p.x })) } : {},
});
export const SPAWN_PARITY_MAPS: CustomMapData[] = [
  ...PREMADE_MAPS.map(m => structuredClone(toGrifballArena(m))),
  custom('acceptance-spawn-empty', []),
  custom('acceptance-spawn-single', [{ x: 10, y: 0, z: 0 }]),
  custom('acceptance-spawn-ties', [{ x: 10, y: 0, z: -4 }, { x: 10, y: 0, z: 4 }]),
  custom('acceptance-spawn-fallback', [{ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], false),
  custom('acceptance-spawn-elevation', [{ x: 10, y: 2, z: -4 }, { x: 10, y: 5, z: 4 }]),
];
export interface SpawnParityCase { map: CustomMapData; team: 'blue' | 'red'; reverse: boolean; player: 'alive' | 'dead' | 'observer' }
export const SPAWN_PARITY_CASES: SpawnParityCase[] = SPAWN_PARITY_MAPS.flatMap(map =>
  (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
    (['alive', 'dead', 'observer'] as const).map(player => ({ map, team, reverse, player })))));

/** Compare the production roster respawn boundary before any AI movement is allowed. */
export function runSpawnParityTrace(spec: SpawnParityCase) {
  const f = createBotParityFixture('main_ai', spec.player === 'observer');
  const { sim, state } = f;
  delete f.map.teamSpawns;
  Object.assign(f.map, structuredClone(spec.map)); sim.map = structuredClone(spec.map);
  sim.combatExecution = 'live-roster-v2';
  const pairs = [[f.bot, sim.combatants[0]], [f.target, sim.combatants[1]],
    addParityActor(f, 'waiting', spec.team, 0, 0), addParityActor(f, 'blocker', spec.team, 0, 0)] as const;
  for (const team of ['blue', 'red'] as const) sim.spawns[team] = structuredClone(spec.map.teamSpawns?.[team]?.length
    ? spec.map.teamSpawns[team] : spec.map.spawnPoints);
  const cluster = sim.spawns[spec.team], occupied = cluster[0] ?? { x: 0, y: 0, z: 0 };
  state.playerPos.set(occupied.x, occupied.y, occupied.z);
  if (spec.player === 'dead') { state.playerHP = 0; state.playerRespawnTimer = 10; }
  if (spec.player === 'alive') sim.combatants.push({ ...structuredClone(sim.combatants[0]), id: 'player', controller: 'remote',
    pos: { ...occupied }, alive: true, hp: 20, respawnTimer: 0 });
  for (const [index, [a, b]] of pairs.entries()) {
    a.team = b.team = spec.team; b.id = a.id; b.controller = 'ai';
    if (index === 3) {
      const p = cluster[1] ?? { x: 15, y: 0, z: 15 };
      a.pos.set(p.x, p.y, p.z); b.pos = { ...p }; a.hp = b.hp = 1;
    } else {
      a.hp = b.hp = 0; b.alive = false;
      a.respawnTimer = b.respawnTimer = index === 2 ? 2 / 60 : 1 / 60;
      a.maxHp = b.maxHp = index + 2;
      a.pos.set(index, 0, index); b.pos = { x: index, y: 0, z: index };
      a.vel.set(2, 3, 4); b.vel = { x: 2, y: 3, z: 4 };
      a.activeWeapon = b.weapon = 'sword';
    }
  }
  if (spec.reverse) { state.otherPlayers = new Map([...state.otherPlayers].reverse()); sim.combatants.reverse(); }
  const record = parityRecorder(), frames = [];
  for (let tick = 1; tick <= 3; tick++) {
    f.respawns(1 / 60); tickRespawns(sim, sim.settings, 1 / 60);
    for (const [a, b] of pairs.slice(0, 3)) {
      record.compare(tick, `${a.id}.health`, a.hp, b.hp);
      record.compare(tick, `${a.id}.alive`, a.hp > 0, b.alive);
      record.compare(tick, `${a.id}.respawn`, a.respawnTimer, b.respawnTimer, 1e-6);
      record.compare(tick, `${a.id}.shield`, a.invulnerabilityTimer, b.invulnerabilityTimer, 1e-6);
      if (b.alive) {
        record.compare(tick, `${a.id}.yaw`, a.yaw, b.yaw, 1e-6);
        record.compare(tick, `${a.id}.weapon`, a.activeWeapon, b.weapon);
      }
      for (const axis of ['x', 'y', 'z'] as const) {
        record.compare(tick, `${a.id}.pos.${axis}`, a.pos[axis], b.pos[axis], 1e-6);
        record.compare(tick, `${a.id}.vel.${axis}`, a.vel[axis], b.vel[axis], 1e-6);
      }
    }
    frames.push({ tick, live: pairs.map(([c]) => ({ id: c.id, hp: c.hp, pos: c.pos.toArray(), yaw: c.yaw })),
      headless: pairs.map(([, c]) => ({ id: c.id, hp: c.hp, pos: { ...c.pos }, yaw: c.yaw })) });
  }
  return { name: `${spec.map.id}/${spec.team}/${spec.reverse}/${spec.player}`, ticks: 3, ...record.result(), frames };
}
export const runSpawnParity = () => SPAWN_PARITY_CASES.map(runSpawnParityTrace);
