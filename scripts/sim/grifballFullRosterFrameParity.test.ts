import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_ROSTER_FRAME_CASES, runFullRosterFrameTrace } from './grifballFullRosterFrameParity';

for (const spec of FULL_ROSTER_FRAME_CASES) test(`mixed eight frame ${spec.round.map.id}/${spec.round.player}/${spec.round.mirror}/${spec.round.reverse}/${spec.round.winner}/${spec.combat.attack}`, () => {
  const trace = runFullRosterFrameTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const spec of FULL_ROSTER_FRAME_CASES.filter(s => s.round.player && s.round.mirror && s.round.reverse && !s.round.winner && s.combat.attack === 'slash'))
  for (const at of [15, 16, 29, 185]) test(`mixed eight snapshot ${spec.round.map.id}/${at}`, () => {
    const trace = runFullRosterFrameTrace(spec, at);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
