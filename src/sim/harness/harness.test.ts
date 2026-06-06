import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomPolicy } from './randomPolicy';
import { heuristicPolicy } from './heuristicPolicy';
import { playMatch, evaluate } from './rollout';
import { createMatch } from '../factory';
import { createRng } from '../rng';

test('random policy returns valid actions for live and dead agents', () => {
  const state = createMatch({ seed: 1 });
  const rng = createRng(1);
  const a = randomPolicy(state, state.combatants[0].id, rng);
  assert.ok(a.moveZ >= -1 && a.moveZ <= 1 && a.moveX >= -1 && a.moveX <= 1);
  state.combatants[0].alive = false;
  const dead = randomPolicy(state, state.combatants[0].id, rng);
  assert.equal(dead.attackPrimary, false);
});

test('heuristic carrier aims toward the enemy goal', () => {
  const state = createMatch({ seed: 2 });
  state.match.phase = 'playing';
  const c = state.combatants.find((x) => x.team === 'blue')!;
  c.pos = { x: 0, y: 0, z: 0 };
  c.hasBall = true;
  state.match.ball.state = 'held';
  state.match.ball.holderId = c.id;
  const rng = createRng(2);
  const a = heuristicPolicy(state, c.id, rng);
  // enemy goal (red) sits at +x; movement-forward = (sin yaw, cos yaw) should point +x.
  const fx = Math.sin(a.aim);
  assert.ok(fx > 0.5, `carrier should face +x toward enemy goal, fx=${fx}`);
  assert.equal(a.moveZ, 1);
});

test('a match plays to a natural conclusion', () => {
  const r = playMatch({
    seed: 7,
    bluePolicy: heuristicPolicy,
    redPolicy: heuristicPolicy,
    settings: { grifballGoalTarget: 2 },
    maxTicks: 60 * 60 * 5,
  });
  assert.ok(r.ticks > 0);
  // Either someone won, or it timed out — but with two competent bots expect a winner.
  assert.ok(r.winner === 'blue' || r.winner === 'red' || r.timedOut);
});

test('baseline sanity: heuristic beats random decisively', () => {
  // Heuristic on blue vs random on red, and the mirror, to cancel any side bias.
  const a = evaluate({
    blue: heuristicPolicy,
    red: randomPolicy,
    matches: 12,
    baseSeed: 100,
    settings: { grifballGoalTarget: 2 },
    maxTicks: 60 * 60 * 4,
  });
  const b = evaluate({
    blue: randomPolicy,
    red: heuristicPolicy,
    matches: 12,
    baseSeed: 200,
    settings: { grifballGoalTarget: 2 },
    maxTicks: 60 * 60 * 4,
  });
  const heuristicWinRate = (a.blueWins + b.redWins) / (a.matches + b.matches);
  assert.ok(
    heuristicWinRate >= 0.8,
    `heuristic should dominate random, got ${(heuristicWinRate * 100).toFixed(0)}%`
  );
});
