import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluationJobs, emptyTeamEvaluation, GrifballEvaluationTracker, summarizeEvaluation, type EvaluationReport, type EvaluationRequest, type EvaluationRun } from './grifballEvaluation';
import { defaultGrifballTactics, resolveTeamTactics } from './grifballTacticsConfig';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';

const request = (): EvaluationRequest => ({ scenario: 'escort', seed: 10, seeds: 3, seconds: 2, opponents: ['balanced', 'aggressive'], mirrored: true,
  baseline: defaultGrifballTactics(), candidate: defaultGrifballTactics() });
const report = (r = request()): EvaluationReport => ({ schemaVersion: 1, contractVersion: 1, status: 'complete', request: r, map: null, mapName: 'Test', arenaRadius: 60,
  mechanics: DEFAULT_ADMIN_SETTINGS, input: 'scripted-observer', totalRuns: createEvaluationJobs(r).length, runs: [] });
function runs(r: EvaluationReport): EvaluationRun[] {
  return createEvaluationJobs(r.request).map(job => ({ job, metrics: { blue: emptyTeamEvaluation(), red: emptyTeamEvaluation() },
    setup: { map: 'Test', mechanics: DEFAULT_ADMIN_SETTINGS, roster: [], holderId: null }, simulationCost: { samples: 120, meanMs: 1, maxMs: 2 } }));
}

test('schedule freezes focal tuning and holds the opponent constant across variants and sides', () => {
  const r = request(); r.candidate.teams.blue = { leadForward: 11 }; r.candidate.teams.red = { leadForward: 15 };
  const jobs = createEvaluationJobs(r); assert.equal(jobs.length, 24);
  r.candidate.teams.blue.leadForward = 2;
  for (let i = 0; i < jobs.length; i += 2) {
    const a = jobs[i], b = jobs[i + 1]; const other = b.focalTeam === 'blue' ? 'red' : 'blue';
    assert.equal(resolveTeamTactics(b.config, b.focalTeam).leadForward, 11);
    assert.deepEqual(resolveTeamTactics(a.config, other), resolveTeamTactics(b.config, other));
    assert.equal(a.seed, b.seed); assert.equal(a.mirrored, b.mirrored);
  }
  assert.throws(() => createEvaluationJobs({ ...r, seed: 0xffffffff }), /overflow/);
  assert.throws(() => createEvaluationJobs({ ...r, opponents: ['patient', 'patient'] }), /distinct/);
  assert.throws(() => createEvaluationJobs({ ...r, seeds: 1.5 }), /seeds/);
  assert.throws(() => createEvaluationJobs({ ...r, seconds: NaN }), /Duration/);
});

test('possession metrics preserve same-team passes, count steals and scoring once, and censor unfinished plays', () => {
  const tracker = new GrifballEvaluationTracker();
  const frame = { phase: 'playing' as const, holderTeam: 'blue' as string | null, holderId: 'b1' as string | null, goals: { blue: 0, red: 0 }, players: [], assignments: [] };
  tracker.sample(frame, 0); tracker.sample({ ...frame, holderTeam: null, holderId: null }, 1);
  tracker.sample({ ...frame, holderId: 'b2' }, 1);
  assert.equal(tracker.teams.blue.possessions, 1); assert.equal(tracker.teams.blue.turnovers, 0);
  tracker.sample({ ...frame, holderTeam: 'red', holderId: 'r1' }, 1);
  assert.equal(tracker.teams.blue.turnovers, 1); assert.equal(tracker.teams.blue.completedPossessions, 1);
  const scored = { ...frame, phase: 'scored' as const, holderTeam: null, holderId: null, goals: { blue: 0, red: 1 } };
  tracker.sample(scored, 1); tracker.sample(scored, 1);
  assert.equal(tracker.teams.red.goals, 1); assert.equal(tracker.teams.red.completedPossessions, 1);
  tracker.sample({ ...frame, goals: scored.goals }, 1);
  assert.equal(tracker.teams.blue.possessions, 2); assert.equal(tracker.teams.blue.completedPossessions, 1);
});

test('confidence intervals cluster sides and opponents by seed; missing opportunities remain unavailable', () => {
  const r = report(); r.runs = runs(r);
  for (const run of r.runs) if (run.job.variant === 'candidate') run.metrics[run.job.focalTeam].goals = run.job.seed - 9;
  const result = summarizeEvaluation(r, 'goalMargin');
  assert.equal(result.seeds, 3); assert.equal(result.pairedRuns, 12); assert.equal(result.mean, 2);
  assert.ok(Math.abs(result.high! - (2 + 4.303 / Math.sqrt(3))) < 1e-9);
  assert.equal(summarizeEvaluation(r, 'goalsPerPossession').mean, null);
  r.runs = r.runs.slice(0, 8);
  assert.equal(summarizeEvaluation(r, 'goalMargin').seeds, 1); assert.equal(summarizeEvaluation(r, 'goalMargin').low, null);
  r.runs = r.runs.slice(0, 2); assert.equal(summarizeEvaluation(r, 'goalMargin').mean, null);
});

test('actual positions determine pressure coverage and exposure; peaceful spacing earns no coverage sample', () => {
  const tracker = new GrifballEvaluationTracker();
  const space = { weapon: 'hammer', phase: 'ready', reach: 4, blastRadius: 2, speed: 5, mobileIn: 0, attackIn: 0.3, lungeReach: 0, lungeSpeed: 0 };
  const players = [
    { id: 'b', team: 'blue', pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, scripted: true, space },
    { id: 'ally', team: 'blue', pos: { x: 20, z: 0 }, vel: { x: 0, z: 0 }, scripted: true, space },
    { id: 'r', team: 'red', pos: { x: 40, z: 0 }, vel: { x: 0, z: 0 }, scripted: true, space },
  ];
  const assignment = { botId: 'b', team: 'blue', role: 'runner' as const, slot: 0, destination: { x: 30, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: 'b', reason: 'test' };
  const frame = { phase: 'playing' as const, holderTeam: 'blue', holderId: 'b', goals: { blue: 0, red: 0 }, players, assignments: [assignment] };
  tracker.sample(frame, 1); assert.equal(tracker.teams.blue.pressuredCarrierSeconds, 0);
  players[2].pos.x = 3; tracker.sample(frame, 1);
  assert.equal(tracker.teams.blue.uncoveredCarrierSeconds, 1); assert.equal(tracker.teams.blue.sharedExposureSeconds, 0);
  players[1].pos.x = 2; tracker.sample(frame, 1);
  assert.equal(tracker.teams.blue.uncoveredCarrierSeconds, 1); assert.equal(tracker.teams.blue.sharedExposureSeconds, 1);
  assert.equal(tracker.teams.blue.relevantBotSeconds, 2);
});
