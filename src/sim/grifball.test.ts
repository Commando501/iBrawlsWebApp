import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, resolveSimSettings } from './factory';
import { SIM_DT } from './step';
import { idleAction } from './actions';
import {
  tickGrifballObjective,
  setSimCarrier,
  placeCombatantsAtSpawns,
  throwSimPass,
} from './grifball';

const settings = resolveSimSettings();

/** Put a fresh match straight into the live 'playing' phase. */
function playingMatch(seed: number) {
  const state = createMatch({ seed });
  state.match.phase = 'playing';
  state.match.phaseTimer = 0;
  return state;
}

test('carrier pickup grants the punch weapon, configured runner HP, and heals to full', () => {
  const state = playingMatch(1);
  const c = state.combatants.find((x) => x.team === 'blue')!;
  const tuned = { ...settings, grifballRunnerHealth: 4 } as any;
  c.hp = 1;
  setSimCarrier(c, true, tuned);
  assert.equal(c.weapon, 'ball');
  assert.equal(c.maxHp, 4);
  assert.equal(c.hp, c.maxHp, 'healed to full on pickup');
  assert.equal(c.hasBall, true);
});

test('carrier health regenerates after the configured delay and rate', () => {
  const state = playingMatch(9);
  const c = state.combatants.find((x) => x.team === 'blue')!;
  const tuned = {
    ...settings,
    grifballRunnerHealth: 4,
    grifballRunnerHealDelay: 0.5,
    grifballRunnerHealRate: 2,
  } as any;
  state.match.ball.state = 'held';
  state.match.ball.holderId = c.id;
  setSimCarrier(c, true, tuned);
  c.hp = 2;

  tickGrifballObjective(state, tuned, 0.25);
  assert.equal(c.hp, 2, 'healing waits through the delay window');

  for (let i = 0; i < 30; i++) {
    tickGrifballObjective(state, tuned, 0.1);
  }

  assert.equal(c.hp, 4);
});

test('dropping the ball reverts the loadout and clamps HP', () => {
  const state = playingMatch(2);
  const c = state.combatants.find((x) => x.team === 'red')!;
  setSimCarrier(c, true, settings);
  setSimCarrier(c, false, settings);
  assert.equal(c.weapon, 'hammer');
  assert.equal(c.maxHp, settings.maxHP ?? 1);
  assert.ok(c.hp <= c.maxHp);
  assert.equal(c.hasBall, false);
});

test('a goal credits the carrier team and triggers the scored phase', () => {
  const state = playingMatch(3);
  const carrier = state.combatants.find((c) => c.team === 'blue')!;
  const redPlate = state.goalPlates.find((p) => p.team === 'red')!;
  state.match.ball.state = 'held';
  state.match.ball.holderId = carrier.id;
  setSimCarrier(carrier, true, settings);
  carrier.pos = { x: redPlate.position.x, y: 0, z: redPlate.position.z };

  const ev = tickGrifballObjective(state, settings, SIM_DT);
  assert.equal(ev.goal, 'blue');
  assert.equal(state.scores.blue.goals, 1);
  assert.equal(state.match.phase, 'scored');
  // Ball resets to idle home, carrier perks reverted.
  assert.equal(state.match.ball.holderId, null);
  assert.equal(carrier.weapon, 'hammer');
});

test('reaching the goal target ends the match', () => {
  const state = playingMatch(4);
  const target = state.match.goalTarget;
  const carrier = state.combatants.find((c) => c.team === 'blue')!;
  const redPlate = state.goalPlates.find((p) => p.team === 'red')!;

  for (let g = 0; g < target; g++) {
    // Re-enter playing each round (scored -> playing) and re-score.
    state.match.phase = 'playing';
    state.match.phaseTimer = 0;
    state.match.ball.state = 'held';
    state.match.ball.holderId = carrier.id;
    setSimCarrier(carrier, true, settings);
    carrier.pos = { x: redPlate.position.x, y: 0, z: redPlate.position.z };
    tickGrifballObjective(state, settings, SIM_DT);
  }
  assert.equal(state.scores.blue.goals, target);
  assert.equal(state.match.winningTeam, 'blue');
});

test('a loose ball auto-returns home after the timeout', () => {
  const state = playingMatch(5);
  const ball = state.match.ball;
  ball.state = 'loose';
  ball.holderId = null;
  ball.pos = { x: 10, y: 0.35, z: 5 };
  ball.looseTimer = 0;
  const timeout = settings.grifballBallReturnTimeout ?? 8;
  // Step past the timeout with no one near it.
  const steps = Math.ceil(timeout / SIM_DT) + 2;
  for (let i = 0; i < steps; i++) tickGrifballObjective(state, settings, SIM_DT);
  assert.equal(ball.state, 'idle');
  assert.equal(ball.pos.x, ball.home.x);
  assert.equal(ball.pos.z, ball.home.z);
});

test('a free ball is not picked up by contact alone when live', () => {
  const state = playingMatch(6);
  const c = state.combatants.find((x) => x.team === 'blue')!;
  const ball = state.match.ball;
  ball.state = 'idle';
  ball.holderId = null;
  ball.pos = { x: c.pos.x, y: 0.35, z: c.pos.z };

  const ev = tickGrifballObjective(state, settings, SIM_DT);
  assert.equal(ev.pickup, null);
  assert.equal(ball.holderId, null);
  assert.equal(c.hasBall, false);
});

test('pickup action picks up an adjacent free ball when live', () => {
  const state = playingMatch(66);
  const c = state.combatants.find((x) => x.team === 'blue')!;
  const ball = state.match.ball;
  ball.state = 'idle';
  ball.holderId = null;
  ball.pos = { x: c.pos.x, y: 0.35, z: c.pos.z };

  const ev = tickGrifballObjective(state, settings, SIM_DT, {
    [c.id]: { ...idleAction(), pickup: true },
  });
  assert.equal(ev.pickup, c.id);
  assert.equal(ball.holderId, c.id);
  assert.equal(c.hasBall, true);
});

test('pickup action out of range does not pick up a free ball', () => {
  const state = playingMatch(67);
  const c = state.combatants.find((x) => x.team === 'blue')!;
  const ball = state.match.ball;
  ball.state = 'idle';
  ball.holderId = null;
  ball.pos = { x: c.pos.x + 10, y: 0.35, z: c.pos.z };

  const ev = tickGrifballObjective(state, settings, SIM_DT, {
    [c.id]: { ...idleAction(), pickup: true },
  });
  assert.equal(ev.pickup, null);
  assert.equal(ball.holderId, null);
  assert.equal(c.hasBall, false);
});

test('throwSimPass launches the ball and clears the carrier', () => {
  const state = playingMatch(7);
  const c = state.combatants.find((x) => x.team === 'blue')!;
  state.match.ball.state = 'held';
  state.match.ball.holderId = c.id;
  setSimCarrier(c, true, settings);
  c.yaw = 0;

  throwSimPass(state, c, 1, settings);
  assert.equal(state.match.ball.state, 'thrown');
  assert.equal(state.match.ball.holderId, null);
  assert.equal(c.hasBall, false);
  assert.equal(c.weapon, 'hammer');
  const speed = Math.hypot(state.match.ball.vel.x, state.match.ball.vel.z);
  assert.ok(speed > 0, 'ball should have horizontal velocity');
});

test('round reset re-spawns everyone and returns the ball', () => {
  const state = playingMatch(8);
  // Knock a combatant out of position and kill another.
  const a = state.combatants[0];
  const b = state.combatants[1];
  a.pos = { x: 0, y: 0, z: 0 };
  b.alive = false;
  b.hp = 0;
  placeCombatantsAtSpawns(state, settings);
  for (const c of state.combatants) {
    assert.ok(c.alive);
    assert.equal(c.hp, c.maxHp);
  }
});
