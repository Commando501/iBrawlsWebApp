import { createBotParityFixture } from './grifballBotExecutionParity';
import { addParityActor, parityRecorder } from './grifballMultiActorParity';
import { SPAWN_PARITY_MAPS } from './grifballSpawnParity';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { tickRespawns } from '../../src/sim/weapons';
import type { Combatant, CustomMapData } from '../../src/types';
import type { SimCombatant, SimState } from '../../src/sim/simState';

export interface MixedSpawnCase {
  map: CustomMapData; team: 'blue' | 'red'; reverse: boolean; playerTick: 1 | 2 | 3;
}
export const MIXED_SPAWN_CASES: MixedSpawnCase[] = SPAWN_PARITY_MAPS.flatMap(map =>
  (['blue', 'red'] as const).flatMap(team => [false, true].flatMap(reverse =>
    ([1, 2, 3] as const).map(playerTick => ({ map, team, reverse, playerTick })))));

/** Isolated respawn boundary: one local human and seven bots; no movement or attacks. */
export function runMixedSpawnTrace(spec: MixedSpawnCase, snapshotAt?: number) {
  const f = createBotParityFixture('main_ai', false, {}, 'rival', spec.map);
  const { state, sim } = f;
  const other = spec.team === 'blue' ? 'red' : 'blue';
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
  state.localPlayerTeam = spec.team;
  const pairs: (readonly [Combatant, SimCombatant])[] = [[f.bot, sim.combatants[0]], [f.target, sim.combatants[1]]];
  for (let i = 0; i < 5; i++) pairs.push(addParityActor(f, `extra-${i}`, i < 2 ? spec.team : other, 0, 0));
  // Half-tick margins make before/same/after ordering independent of float residue.
  const player: SimCombatant = { ...structuredClone(sim.combatants[0]), id: 'player', controller: 'remote', team: spec.team,
    alive: false, hp: 0, maxHp: sim.settings.maxHP, respawnTimer: (spec.playerTick - .5) / 60,
    invulnerabilityTimer: 0, pos: { x: 40, y: 0, z: 0 }, vel: { x: 2, y: 3, z: 4 }, weapon: 'sword', yaw: .7 };
  sim.combatants.push(player);
  state.playerHP = 0; state.playerMaxHP = player.maxHp; state.playerRespawnTimer = player.respawnTimer;
  state.playerInvulnerabilityTimer = 0; state.playerVel.set(2, 3, 4); state.activeWeapon = 'sword'; state.yaw = player.yaw + Math.PI;
  for (const [i, [a, b]] of pairs.entries()) {
    b.id = a.id; a.team = b.team = i === 0 || i === 2 || i === 3 ? spec.team : other;
    a.hp = b.hp = 0; b.maxHp = a.maxHp; b.alive = false; a.respawnTimer = b.respawnTimer = 1.5 / 60;
    a.invulnerabilityTimer = b.invulnerabilityTimer = 0;
    a.pos.set(i, 0, i); b.pos = { x: i, y: 0, z: i };
    a.vel.set(2, 3, 4); b.vel = { x: 2, y: 3, z: 4 };
    a.activeWeapon = b.weapon = 'sword'; b.yaw = a.yaw;
  }
  if (spec.reverse) { state.otherPlayers = new Map([...state.otherPlayers].reverse()); sim.combatants.reverse(); }
  const record = parityRecorder(), frames = [];
  let restored: SimState | undefined;
  const stepRespawns = (s: SimState) => {
    const local = s.combatants.find(c => c.id === s.localPlayerId)!;
    // Match live ownership: local player first, then stored roster order.
    tickRespawns(s, s.settings, 1 / 60, [local]);
    tickRespawns(s, s.settings, 1 / 60, s.combatants.filter(c => c !== local));
  };
  for (let tick = 1; tick <= 5; tick++) {
    updatePlayerRespawnForState({ state, dt: 1 / 60, isMultiplayer: false,
      getMainAi: () => state.otherPlayers.get('main_ai'), activeCustomMap: f.map, spawnPoints: [], playRespawn() {} });
    f.respawns(1 / 60);
    stepRespawns(sim);
    if (restored) {
      stepRespawns(restored);
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim));
    }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    const live = [{ id: 'player', team: state.localPlayerTeam, hp: state.playerHP, maxHp: state.playerMaxHP,
      shield: state.playerInvulnerabilityTimer, respawn: Math.max(0, state.playerRespawnTimer), weapon: state.activeWeapon,
      pos: state.playerPos.toArray(), vel: state.playerVel.toArray(), yaw: state.yaw },
    ...pairs.map(([a]) => ({ id: a.id, team: a.team, hp: a.hp, maxHp: a.maxHp,
      shield: a.invulnerabilityTimer ?? 0, respawn: a.respawnTimer ?? 0, weapon: a.activeWeapon,
      pos: a.pos.toArray(), vel: a.vel.toArray(), yaw: a.yaw }))];
    const headless = [player, ...pairs.map(([, b]) => b)].map(b => ({ id: b.id, team: b.team, hp: b.hp, maxHp: b.maxHp,
      shield: b.invulnerabilityTimer, respawn: b.respawnTimer, weapon: b.weapon,
      pos: [b.pos.x, b.pos.y, b.pos.z], vel: [b.vel.x, b.vel.y, b.vel.z], yaw: b.yaw + Math.PI }));
    for (const [i, a] of live.entries()) {
      const b = headless[i], alive = tick >= (i === 0 ? spec.playerTick : 2);
      record.compare(tick, `${a.id}.headless.expectedAlive`, (i === 0 ? player : pairs[i - 1][1]).alive, alive);
      for (const field of ['team', 'hp', 'maxHp', 'shield', 'respawn', 'weapon'] as const)
        record.compare(tick, `${a.id}.${field}`, a[field], b[field], 1e-6);
      for (const axis of [0, 1, 2]) {
        record.compare(tick, `${a.id}.pos.${axis}`, a.pos[axis], b.pos[axis], 1e-6);
        record.compare(tick, `${a.id}.vel.${axis}`, a.vel[axis], b.vel[axis], 1e-6);
      }
      // Independent lifecycle checks also reject two identically broken engines.
      for (const [side, actor] of [['live', a], ['headless', b]] as const) {
        record.compare(tick, `${a.id}.${side}.expectedHealth`, actor.hp, alive ? actor.maxHp : 0);
        record.compare(tick, `${a.id}.${side}.expectedShield`, actor.shield, alive ? sim.settings.respawnInvulnerabilityDuration : 0);
        record.compare(tick, `${a.id}.${side}.retainsWeapon`, actor.weapon, 'sword');
        if (alive) {
          for (const axis of [0, 1, 2]) record.compare(tick, `${a.id}.${side}.stopped.${axis}`, actor.vel[axis], 0);
          const radius = Math.hypot(actor.pos[0], actor.pos[2]);
          if (radius > .001) {
            record.compare(tick, `${a.id}.${side}.inwardX`, -Math.sin(actor.yaw), -actor.pos[0] / radius, 1e-6);
            record.compare(tick, `${a.id}.${side}.inwardZ`, -Math.cos(actor.yaw), -actor.pos[2] / radius, 1e-6);
          }
        }
        else {
          const initial = i === 0 ? [40, 0, 0] : [i - 1, 0, i - 1];
          for (const axis of [0, 1, 2]) {
            record.compare(tick, `${a.id}.${side}.pendingPosition.${axis}`, actor.pos[axis], initial[axis]);
            record.compare(tick, `${a.id}.${side}.pendingVelocity.${axis}`, actor.vel[axis], [2, 3, 4][axis]);
          }
        }
      }
      if (alive) for (const fn of [Math.sin, Math.cos]) record.compare(tick, `${a.id}.heading`, fn(a.yaw), fn(b.yaw), 1e-6);
    }
    frames.push({ tick, live, headless });
  }
  return { name: `${spec.map.id}/${spec.team}/${spec.reverse}/player-${spec.playerTick}`, ticks: 5, ...record.result(), frames };
}
export const runMixedSpawnParity = () => MIXED_SPAWN_CASES.map(spec => runMixedSpawnTrace(spec));
