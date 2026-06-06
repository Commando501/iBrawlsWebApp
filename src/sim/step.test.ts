import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveSimSettings } from './factory';
import { stepSimulation, SIM_DT } from './step';
import { hashState } from './hash';
import { tickGrifballObjective, setSimCarrier } from './grifball';
import { createRng } from './rng';
import { type ActionsById, type ActionInput } from './actions';
import { findCombatant } from './simState';

/** Deterministic scripted actions for every combatant from a seeded stream. */
function scriptedActions(state: ReturnType<typeof createMatch>, rng = createRng(0)): ActionsById {
  const out: ActionsById = {};
  for (const c of state.combatants) {
    const a: ActionInput = {
      moveX: rng.range(-1, 1),
      moveZ: rng.range(-1, 1),
      aim: rng.range(-Math.PI, Math.PI),
      jump: rng.chance(0.02),
      dash: rng.chance(0.05),
      crouch: rng.chance(0.1),
      attackPrimary: rng.chance(0.15),
      attackSecondary: rng.chance(0.08),
      passCharge: rng.next(),
      swapWeapon: rng.chance(0.01),
    };
    out[c.id] = a;
  }
  return out;
}

function runMatch(seed: number, ticks: number): string {
  const state = createMatch({ seed });
  const settings = resolveSimSettings();
  const actionRng = createRng(seed ^ 0x9e3779b9);
  for (let i = 0; i < ticks; i++) {
    stepSimulation(state, scriptedActions(state, actionRng), { settings });
  }
  return hashState(state);
}

test('full match is deterministic: same seed + actions => identical state hash', () => {
  const a = runMatch(123, 1200);
  const b = runMatch(123, 1200);
  assert.equal(a, b);
});

test('different seeds diverge', () => {
  assert.notEqual(runMatch(1, 800), runMatch(2, 800));
});

test('per-tick hashes match across two independent runs', () => {
  const s1 = createMatch({ seed: 55 });
  const s2 = createMatch({ seed: 55 });
  const settings = resolveSimSettings();
  const r1 = createRng(999);
  const r2 = createRng(999);
  for (let i = 0; i < 400; i++) {
    stepSimulation(s1, scriptedActions(s1, r1), { settings });
    stepSimulation(s2, scriptedActions(s2, r2), { settings });
    assert.equal(hashState(s1), hashState(s2), `diverged at tick ${i}`);
  }
});

test('countdown advances to playing after the countdown duration', () => {
  const state = createMatch({ seed: 7 });
  assert.equal(state.match.phase, 'countdown');
  const settings = resolveSimSettings();
  // countdownDuration default 3s.
  let startedAt = -1;
  for (let i = 0; i < 200; i++) {
    const ev = stepSimulation(state, {}, { settings });
    if (ev.startedPlaying) startedAt = i;
  }
  assert.ok(startedAt >= 0, 'should have started playing');
  assert.equal(state.match.phase, 'playing');
  // ~180 ticks (3s / (1/60)).
  assert.ok(Math.abs(startedAt - 179) <= 2, `startedAt=${startedAt}`);
});

test('a carrier standing on the enemy plate scores for their team', () => {
  const state = createMatch({ seed: 11 });
  const settings = resolveSimSettings();
  // Skip countdown.
  for (let i = 0; i < 200 && state.match.phase !== 'playing'; i++) {
    stepSimulation(state, {}, { settings });
  }
  assert.equal(state.match.phase, 'playing');

  const carrier = state.combatants.find((c) => c.team === 'blue')!;
  // Give them the ball and place them over the red (enemy) goal plate.
  const redPlate = state.goalPlates.find((p) => p.team === 'red')!;
  state.match.ball.state = 'held';
  state.match.ball.holderId = carrier.id;
  setSimCarrier(carrier, true, settings);
  carrier.pos = { x: redPlate.position.x, y: 0, z: redPlate.position.z };

  const ev = tickGrifballObjective(state, settings, SIM_DT);
  assert.equal(ev.goal, 'blue');
  assert.equal(state.scores.blue.goals, 1);
  assert.equal(state.match.phase, 'scored');
});

test('a hostile melee strike kills and drops the ball loose', () => {
  const state = createMatch({ seed: 21 });
  const settings = resolveSimSettings();
  for (let i = 0; i < 200 && state.match.phase !== 'playing'; i++) {
    stepSimulation(state, {}, { settings });
  }

  const attacker = state.combatants.find((c) => c.team === 'blue')!;
  const victim = state.combatants.find((c) => c.team === 'red')!;
  // Victim carries the ball; attacker faces and stands next to them.
  state.match.ball.state = 'held';
  state.match.ball.holderId = victim.id;
  setSimCarrier(victim, true, settings);
  victim.invulnerabilityTimer = 0;
  victim.pos = { x: 0, y: 0, z: 0 };
  attacker.pos = { x: -1.5, y: 0, z: 0 };
  attacker.weapon = 'hammer';
  attacker.weaponState = 'idle';
  attacker.attackCooldown = 0;
  // Aim from attacker (-1.5,0) toward victim (0,0): forward must point +x.
  // forward = (sin yaw, cos yaw); +x heading is yaw = +PI/2.
  attacker.yaw = Math.PI / 2;

  // Carrier has 2 hp, so it needs two connecting hits.
  // Drive the attacker's swing FSM to completion repeatedly until the kill lands.
  let killed = false;
  for (let i = 0; i < 240 && !killed; i++) {
    stepSimulation(
      state,
      {
        [attacker.id]: {
          moveX: 0, moveZ: 0, aim: Math.PI / 2,
          jump: false, dash: false, crouch: false,
          attackPrimary: true, attackSecondary: false, passCharge: 0, swapWeapon: false,
        },
      },
      { settings }
    );
    if (!findCombatant(state, victim.id)!.alive) killed = true;
  }
  assert.ok(killed, 'victim should be killed by repeated hammer strikes');
  assert.equal(state.scores.blue.kills, 1);
  // The dead carrier no longer holds the ball (it dropped loose where they fell).
  assert.notEqual(state.match.ball.holderId, victim.id);
  assert.equal(findCombatant(state, victim.id)!.hasBall, false);
});
