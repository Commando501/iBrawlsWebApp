import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveSimSettings, DEFAULT_KILL_TARGET } from './factory';
import { stepSimulation, SIM_DT } from './step';
import { tickCombat } from './combat';
import { hashState } from './hash';
import { createRng } from './rng';
import { awardTeamKill, getTeamTally } from '../game/teamScoring';
import { type ActionsById, type ActionInput } from './actions';
import { findCombatant } from './simState';

const settings = resolveSimSettings(undefined, 'combat');

test('combat 1v1 builds two solo teams, no ball plates, kill target set', () => {
  const s = createMatch({ seed: 1, mode: 'combat', combat: { teamSizes: [1, 1] } });
  assert.equal(s.mode, 'combat');
  assert.equal(s.combatants.length, 2);
  assert.equal(new Set(s.combatants.map((c) => c.team)).size, 2);
  assert.equal(s.goalPlates.length, 0);
  assert.equal(s.match.goalTarget, DEFAULT_KILL_TARGET);
});

test('combat free-for-all gives every combatant its own team', () => {
  const s = createMatch({ seed: 2, mode: 'combat', combat: { teamSizes: [1, 1, 1, 1] } });
  assert.equal(s.combatants.length, 4);
  assert.equal(new Set(s.combatants.map((c) => c.team)).size, 4);
});

test('combat team deathmatch groups members into teams', () => {
  const s = createMatch({ seed: 3, mode: 'combat', combat: { teamSizes: [2, 2] } });
  assert.equal(s.combatants.length, 4);
  const teams = new Map<string, number>();
  for (const c of s.combatants) teams.set(c.team, (teams.get(c.team) ?? 0) + 1);
  assert.deepEqual([...teams.values()].sort(), [2, 2]);
});

test('combatants spawn alive and not on top of each other', () => {
  const s = createMatch({ seed: 4, mode: 'combat', combat: { teamSizes: [1, 1, 1, 1] } });
  const seen = new Set<string>();
  for (const c of s.combatants) {
    assert.ok(c.alive && c.hp === c.maxHp);
    const key = `${c.pos.x},${c.pos.z}`;
    assert.ok(!seen.has(key), `duplicate spawn ${key}`);
    seen.add(key);
  }
});

test('reaching the kill target ends the match for the leading team', () => {
  const s = createMatch({ seed: 5, mode: 'combat', combat: { teamSizes: [1, 1], killTarget: 3 } });
  s.match.phase = 'playing';
  // t0 racks up kills.
  for (let i = 0; i < 3; i++) awardTeamKill(s.scores, 't0');
  const ev = tickCombat(s, settings, SIM_DT);
  assert.equal(ev.matchEnded, true);
  assert.equal(s.match.winningTeam, 't0');
  assert.equal(s.match.phase, 'matchEnd');
});

test('match does not end before any team reaches the target', () => {
  const s = createMatch({ seed: 6, mode: 'combat', combat: { teamSizes: [1, 1], killTarget: 3 } });
  s.match.phase = 'playing';
  awardTeamKill(s.scores, 't0');
  awardTeamKill(s.scores, 't1');
  const ev = tickCombat(s, settings, SIM_DT);
  assert.equal(ev.matchEnded, false);
  assert.equal(s.match.winningTeam, null);
});

test('countdown advances to playing then the match runs', () => {
  const s = createMatch({ seed: 7, mode: 'combat', combat: { teamSizes: [1, 1] } });
  assert.equal(s.match.phase, 'countdown');
  let started = false;
  for (let i = 0; i < 200; i++) {
    const ev = stepSimulation(s, {}, { settings });
    if (ev.startedPlaying) started = true;
  }
  assert.ok(started);
  assert.equal(s.match.phase, 'playing');
});

test('a combat match is deterministic for a given seed + actions', () => {
  const run = (seed: number) => {
    const s = createMatch({ seed, mode: 'combat', combat: { teamSizes: [1, 1, 1, 1], killTarget: 5 } });
    const rng = createRng(seed ^ 0x1234);
    for (let t = 0; t < 600; t++) {
      const acts: ActionsById = {};
      for (const c of s.combatants) {
        const a: ActionInput = {
          moveX: rng.range(-1, 1), moveZ: rng.range(-1, 1), aim: rng.range(-Math.PI, Math.PI),
          jump: rng.chance(0.02), dash: rng.chance(0.05), crouch: false,
          attackPrimary: rng.chance(0.2), attackSecondary: rng.chance(0.05),
          pickup: false,
          passCharge: 0, swapWeapon: rng.chance(0.01),
        };
        acts[c.id] = a;
      }
      stepSimulation(s, acts, { settings });
    }
    return hashState(s);
  };
  assert.equal(run(42), run(42));
});

test('a melee kill in combat credits the attacker team and counts toward the target', () => {
  const s = createMatch({ seed: 8, mode: 'combat', combat: { teamSizes: [1, 1], killTarget: 25 } });
  for (let i = 0; i < 200 && s.match.phase !== 'playing'; i++) stepSimulation(s, {}, { settings });

  const atk = s.combatants[0];
  const vic = s.combatants[1];
  vic.pos = { x: 0, y: 0, z: 0 };
  vic.invulnerabilityTimer = 0;
  atk.pos = { x: 0, y: 0, z: -1.5 };
  atk.yaw = 0; // forward = (sin0, cos0) = +z toward the victim
  atk.weapon = 'hammer';
  atk.weaponState = 'idle';
  atk.attackCooldown = 0;

  let killed = false;
  for (let i = 0; i < 120 && !killed; i++) {
    stepSimulation(s, {
      [atk.id]: {
        moveX: 0, moveZ: 0, aim: 0, jump: false, dash: false, crouch: false,
        attackPrimary: true, attackSecondary: false, pickup: false, passCharge: 0, swapWeapon: false,
      },
    }, { settings });
    if (!findCombatant(s, vic.id)!.alive) killed = true;
  }
  assert.ok(killed, 'victim should die');
  assert.ok(getTeamTally(s.scores, atk.team).kills >= 1);
});
