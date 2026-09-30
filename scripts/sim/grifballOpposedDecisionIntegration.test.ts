import test from 'node:test';
import assert from 'node:assert/strict';
import { OPPOSED_DECISION_CASES, runOpposedDecisionTrace, validateOpeningCombatCredit, validateOpeningPossession, validateMainJumpCommitments } from './grifballOpposedDecisionIntegration';

test('late main jump retains a verifiable commitment without inventing an impact', () => {
  const requests = [{ tick: 299, accepted: true }], dt = 1 / 60;
  const frames = [299, 300].map((tick, index) => ({ tick, actors: [{ id: 'main_ai', hp: 1, weapon: 'hammer',
    weaponState: 'swing_up', weaponTimer: (index + 1) * dt, jumpPlanned: true }] }));
  const validate = (f = frames, impacts: { tick: number }[] = [], deaths: { tick: number; id: string }[] = []) =>
    validateMainJumpCommitments(requests, impacts, deaths, f, .28, .12, dt);
  assert.deepEqual(validate(), { failures: [], pending: [299] });
  assert.deepEqual(validate(frames, [{ tick: 323 }]), { failures: [], pending: [299] }, 'future evidence cannot resolve an observed commitment');
  assert.deepEqual(validate([...frames, { tick: 323, actors: [] }], [{ tick: 323 }]), { failures: [], pending: [] });
  assert.deepEqual(validate(frames, [], [{ tick: 300, id: 'main_ai' }]), { failures: [], pending: [] });
  for (const defect of ['clock', 'phase', 'weapon', 'plan', 'dead', 'missing-frame', 'overdue']) {
    const f = structuredClone(frames), actor = f[1].actors[0];
    if (defect === 'clock') actor.weaponTimer = dt;
    if (defect === 'phase') actor.weaponState = 'ready';
    if (defect === 'weapon') actor.weapon = 'sword';
    if (defect === 'plan') actor.jumpPlanned = false;
    if (defect === 'dead') actor.hp = 0;
    if (defect === 'missing-frame') f.shift();
    if (defect === 'overdue') f[1].tick = 325;
    assert.ok(validate(f).failures.length, defect);
  }
});

test('opening possession accounts for a second carrier death and pickup through every frame', () => {
  // Retained departing-carrier replay: carrier dies at 8, escort picks up at
  // 70 and dies at 133, then defender recovers at 150.
  const pickups = [{ tick: 70, id: 'escort' }, { tick: 150, id: 'defender' }];
  const deaths = [{ tick: 8, id: 'carrier' }, { tick: 133, id: 'escort' }];
  const frames = Array.from({ length: 150 }, (_, index) => {
    const tick = index + 1;
    const holderId = tick < 8 ? 'carrier' : tick < 70 ? null : tick < 133 ? 'escort' : tick < 150 ? null : 'defender';
    return { tick, ball: { state: holderId ? 'held' : 'loose', holderId },
      actors: ['carrier', 'escort', 'defender'].map(id => ({ id,
        hp: deaths.some(death => death.id === id && death.tick <= tick) ? 0 : 1,
        weapon: id === holderId ? 'ball' : 'hammer' })) };
  });
  assert.deepEqual(validateOpeningPossession('carrier', frames, pickups, deaths), []);
  assert.deepEqual(validateOpeningPossession('carrier', frames.slice(0, 140), pickups.slice(0, 1), deaths), []);
  for (const defect of ['missing-pickup', 'missing-death', 'wrong-death', 'wrong-holder', 'wrong-state', 'dead-holder',
    'wrong-weapon', 'duplicate-pickup', 'duplicate-death', 'out-of-window', 'fractional-tick', 'reordered', 'missing-frame']) {
    const f = structuredClone(frames), p = structuredClone(pickups), d = structuredClone(deaths);
    if (defect === 'missing-pickup') p.pop();
    if (defect === 'missing-death') d.pop();
    if (defect === 'wrong-death') d[1].id = 'defender';
    if (defect === 'wrong-holder') f[149].ball.holderId = 'escort';
    if (defect === 'wrong-state') f[149].ball.state = 'loose';
    if (defect === 'dead-holder') f[149].actors[2].hp = 0;
    if (defect === 'wrong-weapon') f[149].actors[2].weapon = 'hammer';
    if (defect === 'duplicate-pickup') p.push({ ...p[1] });
    if (defect === 'duplicate-death') d.push({ ...d[1] });
    if (defect === 'out-of-window') p.push({ tick: 151, id: 'escort' });
    if (defect === 'fractional-tick') p[0].tick += .5;
    if (defect === 'reordered') p.reverse();
    if (defect === 'missing-frame') f.splice(90, 1);
    assert.ok(validateOpeningPossession('carrier', f, p, d).length, defect);
  }
  // Objective pickup precedes melee death in a frame, never the reverse.
  const sameFrame = structuredClone(frames);
  sameFrame[69].ball = { state: 'loose', holderId: null };
  sameFrame[69].actors[1].hp = 0;
  sameFrame[69].actors[1].weapon = 'hammer';
  assert.deepEqual(validateOpeningPossession('carrier', sameFrame.slice(0, 70), pickups.slice(0, 1),
    [deaths[0], { tick: 70, id: 'escort' }]), []);
  assert.ok(validateOpeningPossession('carrier', sameFrame.slice(0, 70), [{ tick: 8, id: 'escort' }], deaths.slice(0, 1)).length);
});

test('opening combat credit permits a real second kill but rejects missing, duplicated or misplaced credit', () => {
  const actors = [{ id: 'defender', kills: 2, deaths: 0 }, { id: 'carrier', kills: 0, deaths: 1 }, { id: 'escort', kills: 0, deaths: 1 }];
  const impacts = [{ tick: 8, id: 'defender', victims: ['carrier'] }, { tick: 100, id: 'defender', victims: ['escort'] }];
  const deaths = [{ tick: 8, id: 'carrier' }, { tick: 100, id: 'escort' }];
  assert.deepEqual(validateOpeningCombatCredit(actors, impacts, deaths), []);
  for (const defect of ['missing-credit', 'wrong-owner', 'missing-impact', 'duplicate-impact', 'missing-death', 'wrong-time']) {
    const a = structuredClone(actors), i = structuredClone(impacts), d = structuredClone(deaths);
    if (defect === 'missing-credit') a[0].kills = 1;
    if (defect === 'wrong-owner') { a[0].kills = 1; a[1].kills = 1; }
    if (defect === 'missing-impact') i.pop();
    if (defect === 'duplicate-impact') i.push({ ...i[1] });
    if (defect === 'missing-death') d.pop();
    if (defect === 'wrong-time') d[1].tick++;
    assert.ok(validateOpeningCombatCredit(a, i, d).length, defect);
  }
});

for (const spec of OPPOSED_DECISION_CASES) test(`opposed decision ${JSON.stringify(spec)}`, () => {
  const trace = runOpposedDecisionTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 150);
});
for (const mode of ['punch-first', 'hammer-first', 'contested'] as const) {
  for (const reverse of [false, true]) test(`opposed decisions repeat: ${mode}/${reverse}`, () => {
    const spec = { mode, team: 'blue' as const, reverse, main: true };
    assert.deepEqual(runOpposedDecisionTrace(spec), runOpposedDecisionTrace(spec));
  });
}
