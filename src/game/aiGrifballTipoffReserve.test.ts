import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTipoffReserve, isTipoffReserveCovering, type TipoffReserveCandidate } from './aiGrifballTipoffReserve';
import type { GrifballTacticalPlayer } from './aiGrifballTeamPlan';

const candidate = (
  botId: string,
  arrival: number,
  covered = false,
  rejection: string | null = null,
): TipoffReserveCandidate => ({ botId, arrival, covered, rejection });
const point = { x: -10, z: 0 };

test('reserve selection retains an eligible incumbent through positional changes and returning teammates', () => {
  const bids = [candidate('a', 2), candidate('b', 0.1, true)];
  const result = chooseTipoffReserve(bids, 'a', point, 3);
  assert.equal(result.selectedId, 'a');
  assert.equal(result.covered, false);
  assert.match(result.reason, /moving into rear coverage/);
  bids[0].covered = true;
  assert.equal(chooseTipoffReserve(bids, 'a', point, 3).selectedId, 'a');
});

test('vacant rear coverage favors established cover, then arrival and stable ID', () => {
  const bids = [candidate('z', 0.1), candidate('b', 1, true), candidate('a', 1, true)];
  const original = structuredClone(bids);
  const selected = chooseTipoffReserve(bids, 'gone', point, 3);
  assert.equal(selected.selectedId, 'a');
  assert.equal(selected.covered, true);
  assert.deepEqual(chooseTipoffReserve([...bids].reverse(), 'gone', point, 3), selected);
  assert.deepEqual(bids, original);
  assert.equal(chooseTipoffReserve([candidate('b', 1), candidate('a', 0.5)], null, point, 3).selectedId, 'a');
});

test('reserve selection cannot use rejected or unreachable actors and reports empty coverage', () => {
  for (const reason of ['Collector', 'Attacking', 'Airborne', 'Recovery', 'Screen challenge', 'No route']) {
    const next = chooseTipoffReserve([candidate('a', 0, true, reason), candidate('b', 2)], 'a', point, 3);
    assert.equal(next.selectedId, 'b');
    assert.equal(next.candidates[0].rejection, reason);
  }
  const none = chooseTipoffReserve([candidate('a', Infinity, true), candidate('b', 0, true, 'Busy')], 'a', point, 3);
  assert.equal(none.selectedId, null);
  assert.equal(none.covered, false);
});

test('rear coverage uses real readiness, depth and lane width with mirrored and rotated goals', () => {
  for (const angle of [0, Math.PI, Math.PI / 3]) {
    const rotate = (x: number, z: number) => ({
      x: 4 + x * Math.cos(angle) - z * Math.sin(angle),
      z: 2 + x * Math.sin(angle) + z * Math.cos(angle),
    });
    const ball = rotate(0, 0),
      rear = rotate(-10, 0);
    const p: GrifballTacticalPlayer = {
      id: 'reserve',
      team: 'blue',
      scripted: true,
      pos: rotate(-9, 3),
      vel: { x: 0, z: 0 },
      space: {
        weapon: 'hammer',
        phase: 'ready',
        speed: 5.2,
        reach: 3,
        blastRadius: 2,
        attackIn: 0.3,
        lungeReach: 0,
        lungeSpeed: 0,
        mobileIn: 0,
      },
    };
    assert.equal(isTipoffReserveCovering(p, ball, rear, 3), true);
    for (const [x, z, expected] of [
      [-8.99, 0, false],
      [-15, 3.01, false],
      [-20, 0, true],
    ] as const) {
      p.pos = rotate(x, z);
      assert.equal(isTipoffReserveCovering(p, ball, rear, 3), expected);
    }
    for (const phase of ['recovering', 'lunging', 'swing_up']) {
      p.space!.phase = phase;
      assert.equal(isTipoffReserveCovering(p, ball, rear, 3), false);
    }
    p.space!.phase = 'ready';
    p.height = 1;
    assert.equal(isTipoffReserveCovering(p, ball, rear, 3), false);
    p.height = 0;
    p.space!.mobileIn = 0.1;
    assert.equal(isTipoffReserveCovering(p, ball, rear, 3), false);
    p.space!.mobileIn = 0;
    assert.equal(isTipoffReserveCovering(p, ball, ball, 3), false);
  }
});
