import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../game/grifballTacticsConfig';
import { createSimGrifballTacticalSnapshot } from './grifballTacticalAdapter';
import { resolveSimGrifballGroundOpportunityInput } from './grifballGroundOpportunityInput';

function fixture() {
  const state = createMatch({ seed: 7, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 }, settings: { aiDifficulty: 'normal' } });
  state.match.phase = 'playing';
  const [self, target] = state.combatants;
  self.controller = target.controller = 'ai'; self.weapon = 'hammer'; target.weapon = 'hammer';
  self.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 8 };
  self.weaponReadyTimer = self.swapLockoutTimer = self.invulnerabilityTimer = target.invulnerabilityTimer = 0;
  const owners = { [self.id]: 'normal' }, plan = createGrifballTeamPlanState();
  plan.snapshot = createSimGrifballTacticalSnapshot(state, { scriptedBots: owners });
  plan.assignments.set(self.id, { botId: self.id, team: self.team, role: 'lead', slot: 0,
    destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Ground opportunity',
    tuning: { ...defaultGrifballTactics().defaults, engagementDistance: 10 } });
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80, playstyleFactor: .5,
    weaponPrioritization: 50, spacingFactor: 1, aggressiveLungeMult: 1, feintChance: 100 };
  const memory = { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 };
  let draws = 0;
  const context: Parameters<typeof resolveSimGrifballGroundOpportunityInput>[6] = {
    weaponFrame: { activeWeapon: 'hammer', weaponState: 'ready', canStartWeaponAction: true,
      observedSwapLockout: 0, currentSwapLockout: 0, readinessRemaining: 0 },
    swapFeintActive: false, comboActive: false, feints: {}, random: () => { draws++; return .01; },
  };
  const decide = () => resolveSimGrifballGroundOpportunityInput(state, plan, self.id, owners, tuning, memory, context);
  return { state, self, target, owners, plan, tuning, memory, context, decide, draws: () => draws };
}

for (const gate of ['sampled-feint', 'cooldown', 'observed-lockout', 'sword-forbidden', 'combo'] as const)
  test(`ground feint respects ${gate} without consuming RNG`, () => {
    const f = fixture();
    if (gate === 'sampled-feint') f.context.swapFeintActive = true; // Timer has already expired this frame.
    if (gate === 'cooldown') f.context.feints.cooldownRemaining = 1;
    if (gate === 'observed-lockout') f.context.weaponFrame.observedSwapLockout = .1; // Current lockout was cleared by reversion.
    if (gate === 'sword-forbidden') f.tuning.weaponPrioritization = 0;
    if (gate === 'combo') f.context.comboActive = true;
    const result = f.decide()!;
    assert.deepEqual(result.scriptedCombat.commands[f.self.id], []); assert.equal(f.draws(), 0);
    assert.equal(result.needsMovement, true);
  });

test('ground opportunity retains sampled readiness after a preceding priority spends AI reload', () => {
  const f = fixture(); f.self.weapon = f.context.weaponFrame.activeWeapon = 'sword';
  f.tuning.feintChance = 0; f.memory.timer = 1;
  assert.equal(f.decide()!.scriptedCombat.commands[f.self.id][0]?.kind, 'lunge');
  f.context.weaponFrame.canStartWeaponAction = false; f.memory.timer = 0;
  assert.deepEqual(f.decide()!.scriptedCombat.commands[f.self.id], []);
});

test('decision construction copies memory and emits movement handoff after a weapon feint', () => {
  const f = fixture(), before = structuredClone({ state: f.state, plan: f.plan, memory: f.memory, feints: f.context.feints });
  const result = f.decide()!;
  assert.deepEqual(result.scriptedCombat.commands[f.self.id], [{ kind: 'swap', weapon: 'sword' }]);
  assert.ok(result.feints.cooldownRemaining! > 0); assert.ok(result.feints.swapRemaining! > 0);
  assert.equal(result.needsMovement, true); assert.equal(result.movement, undefined); assert.equal(f.draws(), 2);
  assert.deepEqual({ state: f.state, plan: f.plan, memory: f.memory, feints: f.context.feints }, before);
});

for (const unsupported of ['no-assignment', 'outside-area', 'remote', 'carrier', 'airborne', 'dead-target'] as const)
  test(`unsupported ${unsupported} returns control without a random draw`, () => {
    const f = fixture();
    if (unsupported === 'no-assignment') f.plan.assignments.clear();
    if (unsupported === 'outside-area') f.plan.assignments.get(f.self.id)!.tuning!.engagementDistance = 6;
    if (unsupported === 'remote') f.self.controller = 'remote';
    if (unsupported === 'carrier') f.self.hasBall = true;
    if (unsupported === 'airborne') { f.self.pos.y = 1; f.self.isJumping = true; f.self.grounded = false; }
    if (unsupported === 'dead-target') { f.target.hp = 0; f.target.alive = false; }
    const before = structuredClone(f.state);
    assert.equal(f.decide(), null); assert.equal(f.draws(), 0); assert.deepEqual(f.state, before);
  });

for (const defect of ['rng', 'readiness-clock', 'observed-lockout', 'current-lockout', 'feint-clock', 'readiness', 'sampled-feint', 'weapon'] as const)
  test(`invalid ground opportunity ${defect} rejects before memory or RNG mutation`, () => {
    const f = fixture();
    if (defect === 'rng') f.context.random = undefined as never;
    if (defect === 'readiness-clock') f.context.weaponFrame.readinessRemaining = NaN;
    if (defect === 'observed-lockout') f.context.weaponFrame.observedSwapLockout = -1;
    if (defect === 'current-lockout') f.context.weaponFrame.currentSwapLockout = Infinity;
    if (defect === 'feint-clock') f.context.feints.swapRemaining = -1;
    if (defect === 'readiness') f.context.weaponFrame.canStartWeaponAction = 1 as never;
    if (defect === 'sampled-feint') f.context.swapFeintActive = undefined as never;
    if (defect === 'weapon') f.context.weaponFrame.activeWeapon = 'ball';
    const before = structuredClone({ state: f.state, memory: f.memory, feints: f.context.feints });
    assert.throws(f.decide); assert.equal(f.draws(), 0);
    assert.deepEqual({ state: f.state, memory: f.memory, feints: f.context.feints }, before);
  });
