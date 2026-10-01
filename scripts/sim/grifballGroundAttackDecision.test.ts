import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { resolveAIGroundAttackOpportunityForCombatant } from '../../src/components/grifball/aiGroundAttackOpportunityRuntime';
import { canStartAIWeaponAction } from '../../src/game/aiWeaponTiming';
import { resolveSimGrifballGroundAttackInput } from '../../src/sim/grifballGroundAttackInput';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import type { AIBehaviorState } from '../../src/types';

const dt = 1 / 60;
const unexpected = () => { throw new Error('Stationary commitment must not invoke another attack branch'); };

for (const id of ['main_ai', 'bot_2']) for (const weapon of ['hammer', 'sword'] as const)
  for (const multiplier of [.75, 1.25]) test(`${id}/${weapon}/${multiplier}: independent readiness to commitment, impact and recovery`, () => {
    const f = createBotParityFixture(id, true);
    const { sim, bot, target } = f, [self, rival] = sim.combatants;
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
    self.id = id; self.controller = 'ai'; rival.id = target.id;
    self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 2 };
    self.weapon = bot.activeWeapon = weapon; self.yaw = 0;
    self.invulnerabilityTimer = rival.invulnerabilityTimer = rival.weaponReadyTimer = 0;
    self.weaponReadyTimer = bot.swapCooldownTimer = 3 * dt;
    rival.hp = rival.maxHp = target.hp;
    let liveMemory: { aiState: AIBehaviorState; timer: number } = { aiState: 'COOLDOWN', timer: dt / 2 };
    let simMemory = { ...liveMemory };
    let liveCommit = 0, simCommit = 0, liveHit = 0, simHit = 0;
    let continuation: typeof sim | undefined;
    for (let tick = 1; tick <= 180; tick++) {
      // Each host samples its own readiness and owns its own AI memory. The
      // tactical range opportunity is authored; this is not a whole AI match.
      f.frame(false, false, () => {
        // The main actor's swap clock belongs to weaponFrame; ordinary roster
        // readiness belongs to its AI prelude. Never advance either twice.
        if (id !== 'main_ai') bot.swapCooldownTimer = Math.max(0, bot.swapCooldownTimer! - dt);
        const frame = { pos: bot.pos, vel: bot.vel, ...liveMemory, weaponState: bot.weaponState! };
        const result = resolveAIGroundAttackOpportunityForCombatant({
          state: f.state, self: bot, frame, botId: id,
          target: { ...target, weaponState: target.weaponState ?? 'ready', isLunging: !!target.isLunging,
            isCrouching: !!target.isCrouching },
          targetAirborne: false, targetProtected: false, activeWeapon: weapon,
          canStartWeaponAction: canStartAIWeaponAction({ ...liveMemory, swapCooldownTimer: bot.swapCooldownTimer }),
          enemyInKillRange: !liveCommit, selfGrounded: true, slideActive: false, cooldownMultiplier: multiplier,
          swordForbidden: true, swapLockoutRemaining: 0, swapFeintActive: false, comboActive: false, feintChance: 0,
          lungeDistanceToTarget: 2, hasVerticalLungeLine: false, minLungeRange: 10, maxLungeRange: 15,
          combatDistanceToTarget: 2, distanceToTarget: 2, resolvedAiReach: 3, aggressiveLungeMult: 1,
          tunedAnticipationFactor: 0, playstyleFactor: .5,
          tuning: { weaponSwapFeintDelay: 0, lungeChanceAirborneBase: 0, lungeChanceAirborneAnticipation: 0,
            lungeChanceGroundBase: 0, lungeChanceGroundAnticipation: 0, lungeFakeoutForwardTimer: 0 },
          constrainCombatantToArena: () => {}, triggerCombatantAttack: () => f.attack(),
          applyTacticalWeapon: unexpected, startWeaponSwapFeintTimer: unexpected, commitFeint: unexpected,
          tryFeintRoll: unexpected, getTargetPlayerModel: unexpected, triggerCombatantLunge: unexpected,
          recordCombatantObservation: unexpected,
        });
        if (result.mode === 'sync_return') {
          liveCommit = tick; liveMemory = { aiState: result.aiState!, timer: result.timer! };
          assert.deepEqual([frame.vel.x, frame.vel.z], [0, 0]);
        } else liveMemory.timer = Math.max(0, liveMemory.timer - dt);
      });
      const input = resolveSimGrifballGroundAttackInput(sim, id, { [id]: 'normal' },
        { ...simMemory, enemyInKillRange: !simCommit, cooldownMultiplier: multiplier });
      const actions = { [id]: input?.action ?? { ...idleAction(), aim: self.yaw } };
      const options = input ? { scriptedObjective: input.scriptedObjective } : {};
      if (input) { simCommit = tick; simMemory = { aiState: input.aiState, timer: input.timer }; }
      else simMemory.timer = Math.max(0, simMemory.timer - dt);
      stepSimulation(sim, actions, options);
      if (continuation) { stepSimulation(continuation, actions, options); assert.deepEqual(continuation, sim); }
      if (tick === 4) continuation = JSON.parse(JSON.stringify(sim));
      if (!liveHit && target.hp < 20) liveHit = tick;
      if (!simHit && rival.hp < 20) simHit = tick;
      assert.deepEqual(simMemory, liveMemory, `AI memory at ${tick}`);
      const phase = bot.weaponState === 'ready' ? 'idle' : bot.weaponState === 'swing_up' ? 'windup'
        : bot.weaponState === 'swing_down' ? 'active' : 'recovering';
      assert.equal(self.weaponState, phase, `weapon phase at ${tick}`);
      assert.ok(Math.abs((self.weaponPhaseElapsed ?? 0) - (bot.weaponTimer ?? 0)) < 1e-6, `phase clock at ${tick}`);
      assert.equal(rival.hp, target.hp, `target health at ${tick}`);
      assert.deepEqual(self.pos, { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z });
    }
    // Repeated subtraction leaves a positive floating-point remainder on tick 3.
    assert.equal(liveCommit, 4); assert.equal(simCommit, 4);
    assert.ok(liveHit > liveCommit); assert.equal(simHit, liveHit);
    assert.equal(target.hp, 19); assert.equal(rival.hp, 19);
    assert.equal(self.weaponState, 'idle');
  });
