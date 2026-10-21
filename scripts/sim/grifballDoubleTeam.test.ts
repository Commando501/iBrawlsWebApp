import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpposedDecisionTrace, type TankContestOpening } from './grifballOpposedDecisionIntegration';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from '../../src/game/grifballPlayerStyles';

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
function trace(style: GrifballPlayerStyle, team: 'blue' | 'red', reverse: boolean, main: boolean,
  strength = 1, threshold = 1.5, opening: TankContestOpening = 'opening') {
  return runOpposedDecisionTrace({ mode: 'contested', team, reverse, main, seed: 17 }, 'tank-contest', undefined,
    { defender: { x: 5, z: 0 }, cover: { x: 40, z: 18 }, passingEnabled: false },
    { teamSize: 4, tankOpening: opening, botStyles: { escort: style, support_1: style, support_2: style }, tactics: {
      doubleTeamAgencyStrength: strength, tankDoubleThreshold: threshold, defenseEnabled: false, stylesEnabled: false, safetyFirst: true } });
}
const secondary = (t: ReturnType<typeof trace>) => t.tankSamples[0].assignments.find(a => a.tanking?.mode === 'punish')!;

for (const style of styles) for (const team of ['blue', 'red'] as const) for (const reverse of [false, true]) for (const main of [false, true])
  test(`live double-team choice consumes ${style}/${team}/reverse=${reverse}/main=${main}`, () => {
    const t = trace(style, team, reverse, main), a = secondary(t), d = a.tanking!.doubleTeam!;
    assert.equal(t.failureCount, 0, JSON.stringify(t.failures)); assert.equal(t.frames.length, 300);
    assert.equal(d.style, style); assert.equal(d.strength, 1); assert.equal(a.team, team);
    assert.equal(a.tanking!.doubleCommit, true, 'clear opening must be usable by every style');
    const action = t.tankActions.find(action => action.id === a.id && action.assignments.find(o => o.id === a.id)?.tanking?.doubleCommit);
    assert.ok(action, 'supporting tank must execute an autonomous attack');
    assert.ok(t.targetLookups.some(lookup => lookup.id === a.id && lookup.target === 'defender' && lookup.tick <= action.tick));
    assert.ok(t.impacts.some(impact => impact.id === a.id && impact.tick >= action.tick && impact.victims.includes('defender')),
      'the chosen partner must land real damage');
    const reserve = action.assignments.find(o => o.id === a.tanking!.recoveryId)!;
    assert.equal(reserve.tanking!.attack, false); assert.notEqual(reserve.id, a.id);
    assert.ok(t.tankSamples.some(s => s.tick > action.tick && !s.assignments.find(o => o.id === a.id)?.tanking?.doubleCommit));
  });

for (const style of styles) test(`live ${style} value boundary distinguishes joining from covering`, () => {
  const control = trace('balanced', 'blue', false, false, 0, 15);
  const a = secondary(control), score = a.tanking!.candidates.find(c => c.targetId === a.tanking!.targetId)!.score;
  const t = trace(style, 'blue', false, false, 1, score + .5), first = secondary(t);
  assert.equal(t.failureCount, 0, JSON.stringify(t.failures));
  assert.equal(first.tanking!.doubleCommit, style === 'enforcer');
  const zero = trace(style, 'blue', false, false, 0, 15);
  assert.deepEqual(zero, control, 'zero strength must preserve all live frames, actions and impacts');
});

for (const opening of ['ready', 'short-window', 'shared-blast', 'late-cover'] as const)
  test(`live Enforcer retains the ${opening} refusal`, () => {
    const t = trace('enforcer', 'blue', false, true, 1, 0, opening);
    assert.equal(t.failureCount, 0, JSON.stringify(t.failures));
    assert.ok(t.tankSamples[0].assignments.every(a => !a.tanking?.doubleCommit));
  });
