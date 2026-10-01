import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { resolveAIComboOrchestrationForCombatant } from '../../src/components/grifball/aiComboOrchestrationRuntime';
import { resolveAICombatRangeFrame } from '../../src/components/grifball/aiCombatRangeRuntime';
import { swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { advanceAIWeaponSwapFeint, tickFeintCooldown } from '../../src/game/aiMatchContext';
import { createBotComboState, type BotComboState } from '../../src/game/aiComboEngine';
import { canApplyAITacticalWeaponSwap } from '../../src/game/aiTacticalWeaponSwap';
import { resolveAICombatDangerZone } from '../../src/game/aiCombatDecision';
import { canStartAIWeaponAction } from '../../src/game/aiWeaponTiming';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballComboInput, type SimWeaponFeintMemory } from '../../src/sim/grifballComboInput';
import { type TacticalAIMemory } from '../../src/sim/grifballTacticalWeaponChoice';
import { createRng } from '../../src/sim/rng';
import { stepSimulation } from '../../src/sim/step';

const dt = 1 / 60;
for (const id of ['main_ai', 'bot_2']) for (const mirror of [false, true]) for (const combo of [false, true])
  for (const kind of ['ready', 'sword-up', 'sword-down', 'swipe-up', 'swipe-down', 'recovery', 'forbidden', 'hammer'] as const)
    test(`scheduled feint ${id}/${mirror}/${combo}/${kind}`, () => {
      const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', weaponReadyTime: .08, weaponSwapLockout: .45 });
      const { sim, state, bot, target } = f, [self, rival] = sim.combatants;
      sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
      self.id = id; rival.id = target.id; self.controller = rival.controller = 'ai';
      self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: mirror ? -2 : 2 }; target.pos.z = rival.pos.z;
      self.yaw = mirror ? Math.PI : 0; bot.yaw = self.yaw + Math.PI;
      if (mirror) { self.team = bot.team = 'red'; rival.team = target.team = 'blue'; }
      self.weapon = bot.activeWeapon = kind.startsWith('swipe') || kind === 'hammer' ? 'hammer' : 'sword';
      self.invulnerabilityTimer = rival.invulnerabilityTimer = rival.weaponReadyTimer = 0;
      rival.hp = rival.maxHp = target.hp;
      self.swapLockoutTimer = bot.swapLockoutTimer = .4; self.weaponReadyTimer = bot.swapCooldownTimer = .06;
      if (kind.endsWith('up') || kind.endsWith('down') || kind === 'recovery') {
        const swipe = kind.startsWith('swipe');
        bot.weaponState = kind === 'recovery' ? 'recovering' : kind.endsWith('up') ? swipe ? 'melee_up' : 'swing_up' : swipe ? 'melee_down' : 'swing_down';
        self.weaponState = kind === 'recovery' ? 'recovering' : kind.endsWith('up') ? 'windup' : 'active';
        self.attackKind = swipe ? 'swipe' : 'slash'; self.weaponPhaseElapsed = bot.weaponTimer = 0;
      }
      sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: self.team, pos: { x: 40, y: 0, z: 0 } });
      const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
        playstyleFactor: .5, weaponSwapIQ: 0, weaponPrioritization: kind === 'forbidden' ? 100 : 50, spacingFactor: 1 };
      const owners = { [id]: 'normal' }, liveRng = createRng(7), rng = createRng(7);
      const initial: TacticalAIMemory = { aiState: 'COOLDOWN', timer: 1, cooldownMultiplier: 1 };
      let liveMemory = { ...initial };
      const memory = { [id]: { ...initial }, [target.id]: { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 } };
      let feint: SimWeaponFeintMemory = { cooldownRemaining: .06, swapRemaining: dt / 2 };
      let simCombo: BotComboState | null = combo ? createBotComboState('safe_finish', target.id) : null;
      state.aiMatchContext.feintCooldowns.set(id, .06); state.aiMatchContext.weaponSwapFeintTimers.set(id, dt / 2);
      if (simCombo) state.aiMatchContext.comboState.set(id, { ...simCombo });
      const makePlan = (current: typeof sim) => {
        const plan = createGrifballTeamPlanState(); plan.snapshot = createSimGrifballTacticalSnapshot(current, { scriptedBots: owners });
        plan.assignments.set(id, { botId: id, team: self.team, role: 'lead', slot: 0, destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Feint encounter' });
        return plan;
      };
      let restored: { state: typeof sim; memory: typeof memory; feint: SimWeaponFeintMemory; combo: BotComboState | null; rng: ReturnType<typeof createRng> } | undefined;
      let reverts = 0;
      for (let tick = 1; tick <= 120; tick++) {
        let liveFrame!: ReturnType<typeof resolveAIComboOrchestrationForCombatant>;
        f.frame(false, false, () => {
          if (id !== 'main_ai') { bot.swapCooldownTimer = Math.max(0, (bot.swapCooldownTimer ?? 0) - dt); bot.swapLockoutTimer = Math.max(0, (bot.swapLockoutTimer ?? 0) - dt); }
          const range = resolveAICombatRangeFrame({ botPos: bot.pos, botVel: bot.vel, botIsCrouching: false, botIsJumping: false,
            targetIsCrouching: false, targetHp: target.hp, targetProtected: false, predictedTargetPos: target.pos,
            distanceToTarget: bot.pos.distanceTo(target.pos), activeWeapon: bot.activeWeapon as 'hammer' | 'sword',
            attackRange: state.settings.attackRange, attackRadius: state.settings.attackRadius, resolvedAiReach: state.settings.attackRange + state.settings.attackRadius * .75 });
          let activeWeapon = bot.activeWeapon, weaponState = bot.weaponState!;
          let ready = canStartAIWeaponAction({ ...liveMemory, swapCooldownTimer: bot.swapCooldownTimer });
          const lockout = bot.swapLockoutTimer ?? 0;
          tickFeintCooldown(state.aiMatchContext, id, dt);
          const expiry = advanceAIWeaponSwapFeint(state.aiMatchContext, id, dt, activeWeapon, weaponState, kind === 'forbidden');
          if (expiry.revert) { reverts++; bot.swapLockoutTimer = 0; swapCombatantWeaponAction({ self: bot, settings: state.settings, type: 'hammer', recordWeaponSwap: () => {} }); activeWeapon = 'hammer'; weaponState = 'ready'; }
          liveFrame = resolveAIComboOrchestrationForCombatant({ state, self: bot, aiContext: state.aiMatchContext, botId: id,
            target: { ...target, weaponState: target.weaponState!, isLunging: false, isCrouching: false },
            frame: { pos: bot.pos, vel: bot.vel, ...liveMemory, weaponState }, activeWeapon, canStartWeaponAction: ready,
            tacticalWeapon: null, swapFeintActive: expiry.swapFeintActive, targetProtected: false, targetAirborne: false,
            hasVerticalLungeLine: true, targetIsLunging: false, dt, difficulty: 'normal', ...tuning, ...range,
            distanceToTarget: bot.pos.distanceTo(target.pos), minLungeRange: resolveAICombatDangerZone(state.settings, target.activeWeapon) * .85, maxLungeRange: Math.min(18, state.settings.swordLungeDistance),
            resolvedAiReach: state.settings.attackRange + state.settings.attackRadius * .75,
            swapLockoutRemaining: lockout, cooldownMultiplier: 1, getTargetPlayerModel: () => null, random: liveRng.next,
            applyTacticalWeapon: requestedWeapon => {
              if (canApplyAITacticalWeaponSwap({ activeWeapon, requestedWeapon, weaponState, swapLockoutTimer: bot.swapLockoutTimer ?? 0, swordForbidden: false, hammerForbidden: kind === 'forbidden' })) {
                swapCombatantWeaponAction({ self: bot, settings: state.settings, type: requestedWeapon, setLockout: true, recordWeaponSwap: () => {} }); activeWeapon = requestedWeapon; weaponState = 'ready'; ready = false;
              }
              return { activeWeapon, weaponState, canStartWeaponAction: ready };
            }, triggerCombatantAttack: (_self, _weapon, swipe) => f.attack(swipe),
            triggerCombatantLunge: () => assert.fail('stationary close encounter'), recordCombatantObservation: () => {} });
        });
        const advance = (current: typeof sim, memories: typeof memory, oldFeint: SimWeaponFeintMemory, oldCombo: BotComboState | null, random: ReturnType<typeof createRng>) => {
          let result!: NonNullable<ReturnType<typeof resolveSimGrifballComboInput>>;
          stepSimulation(current, {}, { settings: current.settings, scriptedActorDecisions: {
            version: 'scripted-actor-decision-v1', scriptedBots: owners, resolve: ({ clockPhase }) => {
              const before = structuredClone({ current, memories, oldFeint, oldCombo });
              result = resolveSimGrifballComboInput(current, makePlan(current), id, owners, tuning, memories,
                { comboState: oldCombo, tacticalWeapon: null, swapFeintActive: (oldFeint.swapRemaining ?? 0) > 0,
                  weaponFeintMemory: oldFeint, random: random.next }, dt, clockPhase)!;
              assert.deepEqual({ current, memories, oldFeint, oldCombo }, before);
              memories[id] = { ...memories[id], aiState: result.frame.aiState, timer: Math.max(0, (result.frame.timer ?? 0) - dt) };
              return { kind: 'handled', action: result.action, commands: result.scriptedCombat.commands[id], commandVersion: result.scriptedCombat.version };
            },
          } });
          return result;
        };
        const result = advance(sim, memory, feint, simCombo, rng); feint = result.weaponFeintMemory!; simCombo = result.comboState;
        assert.deepEqual(result.frame, liveFrame, `decision ${tick}`);
        assert.deepEqual(simCombo, state.aiMatchContext.comboState.get(id) ?? null);
        assert.equal(feint.cooldownRemaining, state.aiMatchContext.feintCooldowns.get(id)); assert.equal(feint.swapRemaining, state.aiMatchContext.weaponSwapFeintTimers.get(id));
        assert.equal(rng.getState(), liveRng.getState());
        liveMemory = { ...liveMemory, aiState: liveFrame.aiState, timer: Math.max(0, (liveFrame.timer ?? 0) - dt) };
        assert.equal(self.weapon, bot.activeWeapon); assert.equal(rival.hp, target.hp, `damage ${tick}`);
        assert.equal(self.weaponReadyTimer, bot.swapCooldownTimer); assert.equal(self.swapLockoutTimer, bot.swapLockoutTimer);
        const phase = bot.weaponState === 'ready' ? 'idle' : ['swing_up', 'melee_up'].includes(bot.weaponState!) ? 'windup' : ['swing_down', 'melee_down'].includes(bot.weaponState!) ? 'active' : 'recovering';
        assert.equal(self.weaponState, phase); assert.ok(Math.abs((self.weaponPhaseElapsed ?? 0) - (bot.weaponTimer ?? 0)) < 1e-6);
        if (tick === 1) {
          assert.equal(self.weaponReadyTimer, .06 - dt, 'expiry retains existing readiness');
          assert.equal(feint.swapRemaining, kind.endsWith('up') || kind.endsWith('down') ? dt / 2 : undefined, 'committed phases defer expiry');
          if (kind === 'ready' || kind === 'recovery') { assert.equal(self.weapon, 'hammer'); assert.equal(self.swapLockoutTimer, 0); }
        }
        if (restored) {
          const own = advance(restored.state, restored.memory, restored.feint, restored.combo, restored.rng);
          restored.feint = own.weaponFeintMemory!; restored.combo = own.comboState;
          assert.deepEqual(restored.state, sim); assert.deepEqual(restored.memory, memory); assert.deepEqual(restored.feint, feint); assert.deepEqual(restored.combo, simCombo); assert.equal(restored.rng.getState(), rng.getState());
        }
        if (tick === 1) { const copy = JSON.parse(JSON.stringify({ state: sim, memory, feint, combo: simCombo })); const copyRng = createRng(0); copyRng.setState(rng.getState()); restored = { ...copy, rng: copyRng }; }
      }
      assert.equal(reverts, kind === 'forbidden' || kind === 'hammer' || kind.startsWith('swipe') ? 0 : 1);
      assert.equal(feint.swapRemaining, undefined); assert.equal(feint.cooldownRemaining, undefined);
      if (combo && kind === 'ready') assert.equal(target.hp, 19, 'combo follow-up must land after expiry and reload');
    });
