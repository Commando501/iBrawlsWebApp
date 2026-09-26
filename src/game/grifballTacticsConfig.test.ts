import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { seededRandom, simulationRandom, simulationTimestamp, withSimulationRandom } from './simulationRandom';

test('versioned configuration round trips, isolates overrides, rejects malformed inputs', () => {
  const config = defaultGrifballTactics(); config.teams.red = { lateralSpacing: 10 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  assert.equal(resolveTeamTactics(config, 'blue').lateralSpacing, 4);
  assert.equal(resolveTeamTactics(config, 'red').lateralSpacing, 10);
  for (const value of [null, { ...config, schemaVersion: 99 }, { ...config, teams: { red: { lateralSpacing: NaN } } }, { ...config, teams: { blue: { enabled: 1 } } }, { ...config, defaults: {} }, { ...config, teams: { green: {} } }, { ...config, teams: { red: { typo: 5 } } }]) assert.throws(() => validateGrifballTactics(value));
});

const scene = (): GrifballTacticalSnapshot => ({ round: 1, playing: true, ball: { x: 0, z: 0 }, holderId: 'carrier', spacing: 4, goals: { blue: { x: -40, z: 0 }, red: { x: 40, z: 0 } }, tactics: defaultGrifballTactics(), players: [
  { id: 'carrier', team: 'blue', pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, scripted: false },
  ...['blue', 'red'].flatMap(team => [0, 1, 2].map(i => ({ id: `${team}${i}`, team, pos: { x: 8, z: i * 4 }, vel: { x: 0, z: 0 }, scripted: true }))),
] });
test('live tuning changes team destinations; disabled spacing falls back and disabled roles clear formations', () => {
  const snapshot = scene(); const state = createGrifballTeamPlanState();
  updateGrifballTeamPlan(state, snapshot, 0.01);
  const originalRed = [...state.assignments.values()].filter(a => a.team === 'red').map(a => a.destination);
  snapshot.tactics!.teams.blue = { leadForward: 12, safetyFirst: true };
  updateGrifballTeamPlan(state, snapshot, 0.01);
  assert.deepEqual([...state.assignments.values()].filter(a => a.team === 'red').map(a => a.destination), originalRed);
  assert.equal([...state.assignments.values()].find(a => a.team === 'blue' && a.role === 'lead')!.destination.x, 12);
  snapshot.tactics!.teams.blue.spacingEnabled = false;
  updateGrifballTeamPlan(state, snapshot, 0.01);
  assert.equal([...state.assignments.values()].find(a => a.team === 'blue' && a.role === 'lead')!.destination.x, 6.5);
  snapshot.tactics!.teams.blue.enabled = false;
  updateGrifballTeamPlan(state, snapshot, 0.01);
  assert.ok([...state.assignments.values()].filter(a => a.team === 'blue').every(a => a.role === 'chaser' && a.slot === -1));
});
test('seeded decisions repeat and scoped clock/random restore after errors', () => {
  const run = () => { const random = seededRandom(42); return withSimulationRandom(random, 2, () => [simulationRandom(), simulationRandom(), simulationTimestamp()]); };
  assert.deepEqual(run(), run());
  assert.throws(() => withSimulationRandom(seededRandom(42), 2, () => { throw new Error('test'); }));
  assert.ok(simulationTimestamp() > 1e12);
});
