import test from 'node:test';
import assert from 'node:assert/strict';
import { STATIONARY_GEOMETRY_CASES, LUNGE_GEOMETRY_CASES } from './grifballGeometryParity';
import { runBotExecutionParityTrace } from './grifballBotExecutionParity';
import { LUNGE_PARITY_ACTORS, runLungeParityTrace } from './grifballLungeParity';
import { createMatch } from '../../src/sim/factory';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import { respawnCombatant, stepCombatantWeapons } from '../../src/sim/weapons';
import { placeCombatantsAtSpawns } from '../../src/sim/grifball';
import type { SimCombatExecution } from '../../src/sim/simState';

for (const id of ['main_ai', 'bot_2']) for (const observer of [false, true]) for (const spec of STATIONARY_GEOMETRY_CASES) {
  test(`stationary geometry ${id} observer=${observer} ${spec.name}`, () => {
    const trace = runBotExecutionParityTrace(spec, id, observer, 'live-roster-v2');
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
}

function geometryMatch(execution: SimCombatExecution = 'live-roster-v2') {
  const s = createMatch({ seed: 7, combatExecution: execution, teamSizes: { blue: 1, red: 1 },
    settings: { swordLungeSpeed: 30, attackRange: 3, attackRadius: 1.5 } });
  s.match.phase = 'playing';
  const [self, rival] = s.combatants;
  self.pos = { x: 0, y: 0, z: 0 }; self.yaw = 0; self.weapon = 'sword';
  rival.pos = { x: 1.6, y: 0, z: .5 }; self.lungeTargetId = rival.id;
  for (const c of s.combatants) { c.hp = c.maxHp = 20; c.weaponReadyTimer = c.invulnerabilityTimer = 0; }
  return s;
}

test('Large model contact survives a committed-flight JSON snapshot, respawn and round reset', () => {
  const s = geometryMatch(), [self, rival] = s.combatants;
  self.isCrouching = rival.isCrouching = true; rival.modelType = 'large';
  stepCombatantWeapons(s, self, { ...idleAction(), attackSecondary: true }, s.settings, 0, []);
  const restored = JSON.parse(JSON.stringify(s));
  const actions = { [self.id]: { ...idleAction(), crouch: true }, [rival.id]: { ...idleAction(), crouch: true } };
  for (let tick = 0; tick < 120; tick++) {
    stepSimulation(s, actions); stepSimulation(restored, actions);
    assert.deepEqual(restored, s);
  }
  assert.equal(rival.hp, 19); assert.equal(self.lungeOutcome, 'hit');
  respawnCombatant(s, rival, s.settings); assert.equal(rival.modelType, 'large');
  placeCombatantsAtSpawns(s, s.settings); assert.equal(rival.modelType, 'large');
});

test('older v2 snapshots without a model use medium hit geometry', () => {
  const older = geometryMatch(), explicit = structuredClone(older);
  for (const c of explicit.combatants) c.modelType = 'medium';
  for (const s of [older, explicit]) stepCombatantWeapons(s, s.combatants[0], { ...idleAction(), attackSecondary: true }, s.settings, 0, []);
  for (let tick = 0; tick < 120; tick++) {
    stepSimulation(older, {}); stepSimulation(explicit, {});
    const normalized = structuredClone(explicit);
    for (const c of normalized.combatants) delete c.modelType;
    assert.deepEqual(older, normalized);
  }
  assert.equal(older.combatants[1].hp, 20); assert.equal(older.combatants[0].lungeOutcome, 'miss_timeout');
});

for (const execution of ['legacy-v1', 'live-player-v1', 'live-roster-v1'] as const) {
  test(`${execution} retains its previous geometry even if model metadata is supplied`, () => {
    for (const lunge of [false, true]) {
      const baseline = geometryMatch(execution);
      // Combat execution versions preserve melee geometry. Loose-ball body
      // collisions independently use model dimensions, so keep the ball clear.
      baseline.match.ball.pos = { x: -15, y: .35, z: -15 };
      const tagged = structuredClone(baseline);
      for (const c of tagged.combatants) c.modelType = 'large';
      for (let tick = 0; tick < 120; tick++) {
        for (const s of [baseline, tagged]) stepSimulation(s, { [s.combatants[0].id]: {
          ...idleAction(), attackPrimary: !lunge && tick === 0, attackSecondary: lunge && tick === 0,
        } });
        const normalized = structuredClone(tagged);
        for (const c of normalized.combatants) delete c.modelType;
        assert.deepEqual(baseline, normalized);
      }
    }
  });
}
for (const { id, targetId } of LUNGE_PARITY_ACTORS) for (const observer of [false, true]) for (const spec of LUNGE_GEOMETRY_CASES) {
  test(`lunge geometry ${id}->${targetId} observer=${observer} ${spec.name}`, () => {
    const trace = runLungeParityTrace(spec, id, observer, 'live-roster-v2', targetId);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
}
