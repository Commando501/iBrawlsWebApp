import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { createBotComboState } from '../game/aiComboEngine';
import { createSimGrifballTacticalSnapshot } from './grifballTacticalAdapter';
import { resolveSimGrifballComboInput } from './grifballComboInput';
import { stepSimulation } from './step';

function fixture() {
  const state = createMatch({ seed: 1, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 },
    settings: { aiDifficulty: 'normal', attackRange: 2, attackRadius: 2 } });
  state.match.phase = 'playing'; const [self, target] = state.combatants;
  self.controller = target.controller = 'ai'; self.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 5 };
  self.weapon = 'sword'; target.weapon = 'hammer'; self.weaponReadyTimer = self.swapLockoutTimer = 0;
  self.invulnerabilityTimer = target.invulnerabilityTimer = 0;
  const owners = { [self.id]: 'normal' }, plan = createGrifballTeamPlanState();
  plan.snapshot = createSimGrifballTacticalSnapshot(state, { scriptedBots: owners });
  plan.assignments.set(self.id, { botId: self.id, team: self.team, role: 'lead', slot: 0, destination: { x: 0, z: 0 },
    anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Assigned combo' });
  const memory = { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 };
  const memories = { [self.id]: { ...memory }, [target.id]: { ...memory } };
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
    playstyleFactor: .5, weaponSwapIQ: 0, weaponPrioritization: 50, spacingFactor: 1 };
  const context = { comboState: { ...createBotComboState('mixup', target.id), stepIndex: 2 },
    tacticalWeapon: null, swapFeintActive: false, random: () => .5 };
  const decide = () => resolveSimGrifballComboInput(state, plan, self.id, owners, tuning, memories, context);
  return { state, self, target, owners, plan, memories, tuning, context, decide };
}

for (const airborne of [false, true]) test(`combo lunge uses its own current target and commits a normalized heading: ${airborne}`, () => {
  const f = fixture(); if (airborne) f.target.pos.y = 2;
  const before = structuredClone({ state: f.state, memories: f.memories, plan: f.plan, combo: f.context.comboState });
  const result = f.decide()!; assert.ok(result);
  const command = result.scriptedCombat.commands[f.self.id][0];
  assert.equal(command.kind, 'lunge'); if (command.kind !== 'lunge') assert.fail('expected lunge');
  assert.equal(command.targetId, f.target.id); assert.equal(result.frame.mode, 'sync_return'); assert.equal(result.comboState, null);
  const distance = Math.hypot(5, airborne ? 2 : 0);
  assert.equal(command.direction.x, 0);
  assert.ok(Math.abs(command.direction.y - (airborne ? 2 : 0) / distance) < 1e-12);
  assert.ok(Math.abs(command.direction.z - 5 / distance) < 1e-12);
  assert.ok(result.lungeObservation);
  assert.ok(Math.abs(result.lungeObservation.distance - distance) < 1e-12);
  assert.deepEqual({ state: f.state, memories: f.memories, plan: f.plan, combo: f.context.comboState }, before);
  stepSimulation(f.state, { [f.self.id]: result.action }, { settings: f.state.settings, scriptedCombat: result.scriptedCombat });
  assert.equal(f.self.isLunging, true); assert.equal(f.self.lungeTargetId, f.target.id); assert.equal(f.self.lungeTimer, 0);
});

for (const reason of ['shield', 'target-changed', 'target-commit', 'reload', 'readiness', 'vertical-line', 'feint'] as const)
  test(`combo preserves abort/wait arbitration: ${reason}`, () => {
    const f = fixture();
    if (reason === 'shield') f.target.invulnerabilityTimer = 1;
    if (reason === 'target-changed') f.context.comboState.targetId = 'old-target';
    if (reason === 'target-commit') { f.context.comboState = { ...createBotComboState('bait_smash', f.target.id), stepIndex: 4 };
      f.target.weaponState = 'windup'; f.target.attackKind = 'strike'; }
    if (reason === 'reload') f.memories[f.self.id] = { ...f.memories[f.self.id], aiState: 'COOLDOWN' as never, timer: 1 };
    if (reason === 'readiness') f.self.weaponReadyTimer = 1;
    if (reason === 'vertical-line') { f.target.pos.y = 2; f.tuning.movementComplexity = 0; }
    if (reason === 'feint') { f.context.comboState = createBotComboState('double_tap', f.target.id); f.context.swapFeintActive = true; }
    const result = f.decide()!; assert.ok(result); assert.deepEqual(result.scriptedCombat.commands[f.self.id], []);
    assert.equal(result.comboState === null, ['shield', 'target-changed', 'target-commit'].includes(reason));
  });

test('missing target AI observations hand back control without consuming RNG', () => {
  const f = fixture(); delete f.memories[f.target.id]; let draws = 0;
  f.context.random = () => { draws++; return .5; };
  assert.equal(f.decide(), null); assert.equal(draws, 0);
  f.context.random = undefined as never; assert.throws(f.decide, /random stream/);
});

test('mixed local targets are observed without invented AI reload memory', () => {
  const f = fixture(); f.state.combatExecution = 'live-mixed-v1'; f.state.localPlayerId = f.target.id;
  f.target.controller = 'remote'; delete f.memories[f.target.id];
  const result = f.decide()!; assert.ok(result);
  assert.equal(result.scriptedCombat.commands[f.self.id][0].kind, 'lunge');
});

test('an independently seeded opening starts the production bait sequence', () => {
  const f = fixture(); f.context.comboState = null as never; f.tuning.weaponSwapIQ = 100;
  let draws = 0; f.context.random = () => { draws++; return 0; };
  const result = f.decide()!;
  assert.equal(draws, 1); assert.equal(result.comboState?.comboId, 'bait_smash');
  assert.equal(result.frame.aiState, 'CHARGE_ATTACK');
  assert.equal(result.comboState?.stepIndex, 1); assert.equal(result.comboState?.stepTimer, .32);
});

test('zero-delay tactical and opening-combo swaps retain their order even with no net weapon change', () => {
  const f = fixture(); f.context.comboState = null as never; f.context.tacticalWeapon = 'hammer' as never;
  f.context.random = () => 0; f.tuning.weaponSwapIQ = 100;
  f.state.settings.weaponReadyTime = f.state.settings.weaponSwapLockout = 0;
  const result = f.decide()!;
  assert.deepEqual(result.scriptedCombat.commands[f.self.id], [{ kind: 'swap', weapon: 'hammer' }, { kind: 'swap', weapon: 'sword' }]);
  assert.equal(result.comboState?.comboId, 'bait_smash');
  stepSimulation(f.state, { [f.self.id]: result.action }, { settings: f.state.settings, scriptedCombat: result.scriptedCombat });
  assert.equal(f.self.weapon, 'sword'); assert.equal(f.self.weaponReadyTimer, 0); assert.equal(f.self.swapLockoutTimer, 0);
});
