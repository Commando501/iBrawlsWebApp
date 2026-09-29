import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_COMBAT_CASES } from './grifballRoundCombatParity';
import { runRoundFrameTrace } from './grifballRoundFrameParity';

for (const { round, combat } of ROUND_COMBAT_CASES) test(`round combat ${round.map.id}/${round.mirror}/${round.reverse}/${round.winner}/${combat.attack}/${combat.impactTick}/${combat.hp}`, () => {
  const trace = runRoundFrameTrace(round, undefined, combat);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const { round, combat } of ROUND_COMBAT_CASES.filter(c => c.round.mirror && c.round.reverse && c.combat.hp === 1 && c.combat.impactTick === 16))
  for (const at of [15, 16, 22, 39]) test(`round combat snapshot ${round.map.id}/${round.winner}/${combat.attack}/${at}`, () => {
    const trace = runRoundFrameTrace(round, at, combat);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
