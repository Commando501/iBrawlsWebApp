import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { resolveSimGrifballCombatObservation, retainSimGrifballCombatObservation, type SimEngagementPreparation } from './grifballCombatObservation';
import { resolveSimGrifballComboInput } from './grifballComboInput';
import { resolveSimGrifballGroundOpportunityInput } from './grifballGroundOpportunityInput';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { idleAction } from './actions';
import { stepSimulation } from './step';

function fixture(id = 'ordinary', sign = 1) {
  const state = createMatch({ seed: 44, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', weaponReadyTime: 0, weaponSwapLockout: 0, attackRange: 3.2, attackRadius: 4.5,
      swordSlashSpeed: .12, maxHP: 20 } });
  const [self, target, player] = state.combatants; self.id = id; target.id = 'target'; target.team = 'red';
  self.controller = target.controller = 'ai'; player.id = state.localPlayerId = 'player'; player.controller = 'remote';
  player.pos = { x: 30, y: 0, z: 30 }; state.match.phase = 'playing';
  self.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 1.05, z: sign * 2.45 }; target.isJumping = true;
  self.weapon = 'sword'; target.weapon = 'hammer';
  for (const c of [self, target]) { c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 }; }
  const owners = { [id]: 'normal', target: 'normal' }, plan = createGrifballTeamPlanState();
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80, playstyleFactor: 1,
    weaponSwapIQ: 0, weaponPrioritization: 100, spacingFactor: 1, aggressiveLungeMult: 0, feintChance: 0 };
  const context: SimEngagementPreparation = { aiState: 'SIDE_STEPPING', swayTimer: 0,
    coordCommitTimer: .4, psychEnabled: true, standoffTimer: .7, resolvedDangerZone: 3 };
  const read = () => resolveSimGrifballCombatObservation(state, id, target.id, owners, tuning, 1 / 60, context)!;
  return { state, self, target, owners, plan, tuning, context, read };
}

test('prepared capture is detached and uses newly selected posture rather than last frame stance', () => {
  const f = fixture(); f.self.isCrouching = false;
  const before = structuredClone({ state: f.state, context: f.context }), observation = f.read();
  assert.equal(observation.preparation!.isCrouching, true); assert.equal(observation.range.enemyInKillRange, false);
  assert.ok(Math.abs(observation.range.verticalDeltaToTarget - 1.355) < 1e-12);
  assert.equal(observation.preparation!.coordCommitTimer, .4 + 1 / 60); assert.equal(observation.preparation!.standoffTimer, 0);
  assert.deepEqual({ state: f.state, context: f.context }, before);
  const persisted = JSON.parse(JSON.stringify(observation));
  assert.deepEqual(retainSimGrifballCombatObservation(f.state, f.self.id, f.owners, persisted), observation);
});
for (const defect of ['coord-clock', 'standoff-clock', 'sway-clock', 'danger-zone', 'psych-flag'] as const)
  test(`invalid preparation ${defect} refuses before state mutation`, () => {
    const f = fixture();
    if (defect === 'coord-clock') f.context.coordCommitTimer = NaN;
    if (defect === 'standoff-clock') f.context.standoffTimer = Infinity;
    if (defect === 'sway-clock') f.context.swayTimer = Infinity;
    if (defect === 'danger-zone') f.context.resolvedDangerZone = NaN;
    if (defect === 'psych-flag') f.context.psychEnabled = 1 as never;
    const before = structuredClone(f.state); assert.throws(f.read, /preparation/); assert.deepEqual(f.state, before);
  });
for (const defect of ['posture', 'coord', 'standoff'] as const) test(`retained preparation rejects malformed ${defect}`, () => {
  const f = fixture(), observation = f.read();
  if (defect === 'posture') observation.preparation!.isCrouching = 0 as never;
  if (defect === 'coord') observation.preparation!.coordCommitTimer = Infinity;
  if (defect === 'standoff') observation.preparation!.standoffTimer = NaN;
  assert.throws(() => retainSimGrifballCombatObservation(f.state, f.self.id, f.owners, observation), /preparation/);
});

for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30])
  for (const sway of [0, 1.5]) test(`scheduled preparation reaches range, attack and later roster actors ${id}/${sign}/${dt}/${sway}`, () => {
    const f = fixture(id, sign); f.self.isCrouching = sway === 1.5; f.context.swayTimer = sway;
    const memories = { [id]: { aiState: 'SIDE_STEPPING' as const, timer: 0, cooldownMultiplier: 1 },
      target: { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 } };
    let restored = JSON.parse(JSON.stringify(f.state));
    const ownMemory = structuredClone(f.context), restoredMemory = structuredClone(f.context);
    let laterObserved = 0;
    const advance = (state: typeof f.state, memory: typeof f.context, tick: number) => stepSimulation(state, {}, { settings: state.settings, dt,
      ...(tick === 1 ? { scriptedActorDecisions: { version: 'scripted-actor-decision-v1' as const, scriptedBots: f.owners,
        prepare: ({ actorId }: { actorId: string }) => actorId === id ? 'engagement' as const : 'default' as const,
        resolve: ({ actorId, state: current }: { actorId: string; state: typeof state }) => {
          if (actorId !== id) {
            laterObserved++; assert.equal(current.combatants[0].isCrouching, sway === 0);
            assert.equal(memory.coordCommitTimer, .4 + dt); assert.equal(memory.standoffTimer, 0);
            return { kind: 'handled' as const, action: idleAction() };
          }
          const observation = resolveSimGrifballCombatObservation(current, id, f.target.id, f.owners, f.tuning, dt, memory)!;
          assert.equal(observation.range.enemyInKillRange, sway === 1.5);
          Object.assign(memory, { coordCommitTimer: observation.preparation!.coordCommitTimer, standoffTimer: observation.preparation!.standoffTimer });
          const combo = resolveSimGrifballComboInput(current, f.plan, id, f.owners, f.tuning, memories,
            { observation, comboState: null, tacticalWeapon: null, swapFeintActive: false, random: () => .99 }, dt, 'after-swap-tick')!;
          assert.equal(combo.action.crouch, sway === 0);
          const ground = resolveSimGrifballGroundOpportunityInput(current, f.plan, id, f.owners, f.tuning, memories[id],
            { observation, targetMemory: memories.target, weaponFrame: combo.weaponFrame,
              comboActive: combo.frame.comboActive, feints: {}, random: () => .99 }, dt)!;
          assert.equal(ground.action.crouch, sway === 0);
          return { kind: 'handled' as const, action: ground.action, commandVersion: 'scripted-combat-v6' as const,
            commands: [...combo.scriptedCombat.commands[id], ...ground.scriptedCombat.commands[id]] };
        } } } : {}) });
    for (let tick = 1; tick <= 90; tick++) {
      const event = advance(f.state, ownMemory, tick), replay = advance(restored, restoredMemory, tick);
      assert.deepEqual(restored, f.state); assert.deepEqual(replay, event); assert.deepEqual(restoredMemory, ownMemory);
      if ([1, 5, 20].includes(tick)) restored = JSON.parse(JSON.stringify(restored));
      if (tick === 1) assert.equal(f.self.weaponState, sway === 1.5 ? 'windup' : 'idle');
    }
    assert.equal(laterObserved, 2); assert.equal(ownMemory.swayTimer, sway, 'preparation must not spend the later sway clock');
    if (sway === 1.5) assert.ok(f.target.hp < 20, 'the standing attack must reach actual damage');
    else assert.equal(f.target.hp, 20, 'the crouched range refusal must not invent an attack');
  });
