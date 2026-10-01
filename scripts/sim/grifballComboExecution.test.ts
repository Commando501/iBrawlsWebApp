import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { resolveAIComboOrchestrationForCombatant } from '../../src/components/grifball/aiComboOrchestrationRuntime';
import { swapCombatantWeaponAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAICombatRangeFrame } from '../../src/components/grifball/aiCombatRangeRuntime';
import { resolveAICombatDangerZone } from '../../src/game/aiCombatDecision';
import { canApplyAITacticalWeaponSwap } from '../../src/game/aiTacticalWeaponSwap';
import { canStartAIWeaponAction } from '../../src/game/aiWeaponTiming';
import { createBotComboState, type BotComboState, type AIComboId } from '../../src/game/aiComboEngine';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballComboInput } from '../../src/sim/grifballComboInput';
import type { TacticalAIMemory } from '../../src/sim/grifballTacticalWeaponChoice';
import { createRng } from '../../src/sim/rng';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import type { ScriptedCombatCommand } from '../../src/sim/scriptedCombatInput';

const dt = 1 / 60;
const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
  playstyleFactor: .5, weaponSwapIQ: 0, weaponPrioritization: 50, spacingFactor: 1 };
const combos: AIComboId[] = ['mixup', 'safe_finish', 'bait_smash', 'double_tap'];

for (const profile of ['live-roster-v2', 'live-mixed-v1'] as const) for (const id of ['main_ai', 'bot_2'])
  for (const combo of combos) for (const seed of [3, 7]) for (const mirrored of [false, true])
    test(`${profile}/${id}/${combo}/${seed}/mirror-${mirrored}: independently execute the complete stationary combo`, () => {
      const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', weaponSwapLockout: .05, weaponReadyTime: .05 });
      const { sim, bot, target } = f, [self, rival] = sim.combatants;
      sim.combatExecution = profile; sim.match.phase = 'playing'; self.id = id; rival.id = target.id;
      self.controller = rival.controller = 'ai'; self.weapon = bot.activeWeapon = combo === 'double_tap' ? 'sword' : 'hammer';
      self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 2 };
      self.yaw = 0; self.swapLockoutTimer = bot.swapLockoutTimer = 0;
      self.weaponReadyTimer = self.invulnerabilityTimer = rival.weaponReadyTimer = rival.invulnerabilityTimer = 0;
      rival.hp = rival.maxHp = target.hp;
      if (mirrored) {
        self.team = bot.team = 'red'; rival.team = target.team = 'blue';
        rival.pos.z = -2; target.pos.z = -2; self.yaw = Math.PI; bot.yaw = 0;
      }
      if (profile === 'live-mixed-v1') {
        sim.localPlayerId = 'player'; f.state.isObserverMode = false; f.state.localPlayerTeam = self.team;
        sim.combatants.push({ ...structuredClone(rival), id: 'player', team: self.team, controller: 'remote', pos: { x: 40, y: 0, z: 0 } });
      }
      const owners = { [id]: 'normal' };
      const makePlan = (s: typeof sim) => {
        const plan = createGrifballTeamPlanState(); plan.snapshot = createSimGrifballTacticalSnapshot(s, { scriptedBots: owners });
        plan.assignments.set(id, { botId: id, team: self.team, role: 'lead', slot: 0, destination: { x: 0, z: 0 },
          anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Combo encounter' });
        return plan;
      };
      const liveRng = createRng(seed), simRng = createRng(seed), restoredRng = createRng(0);
      const initial: TacticalAIMemory = { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 };
      let liveMemory = { ...initial }, memories = { [id]: { ...initial }, [target.id]: { ...initial } };
      let simCombo: BotComboState | null = createBotComboState(combo, target.id);
      f.state.aiMatchContext.comboState.set(id, createBotComboState(combo, target.id));
      let restored: { state: typeof sim; memories: typeof memories; combo: BotComboState | null } | undefined;
      let commits = 0, swaps = 0;
      for (let tick = 1; tick <= 150; tick++) {
        let liveFrame!: ReturnType<typeof resolveAIComboOrchestrationForCombatant>;
        f.frame(false, false, () => {
          if (id !== 'main_ai') {
            bot.swapCooldownTimer = Math.max(0, (bot.swapCooldownTimer ?? 0) - dt);
            bot.swapLockoutTimer = Math.max(0, (bot.swapLockoutTimer ?? 0) - dt);
          }
          const range = resolveAICombatRangeFrame({ botPos: bot.pos, botVel: bot.vel, botIsCrouching: false, botIsJumping: false,
            targetIsCrouching: false, targetHp: target.hp, targetProtected: false, predictedTargetPos: target.pos,
            distanceToTarget: bot.pos.distanceTo(target.pos), activeWeapon: bot.activeWeapon as 'hammer' | 'sword',
            attackRange: f.state.settings.attackRange, attackRadius: f.state.settings.attackRadius,
            resolvedAiReach: f.state.settings.attackRange + f.state.settings.attackRadius * .75 });
          let weaponState = bot.weaponState!, activeWeapon = bot.activeWeapon;
          let canStart = canStartAIWeaponAction({ ...liveMemory, swapCooldownTimer: bot.swapCooldownTimer });
          liveFrame = resolveAIComboOrchestrationForCombatant({ state: f.state, self: bot, aiContext: f.state.aiMatchContext, botId: id,
            target: { ...target, weaponState: target.weaponState!, isLunging: false, isCrouching: false },
            frame: { pos: bot.pos, vel: bot.vel, ...liveMemory, weaponState }, activeWeapon, canStartWeaponAction: canStart,
            tacticalWeapon: null, swapFeintActive: false, targetProtected: false, targetAirborne: false,
            hasVerticalLungeLine: true, targetIsLunging: false, dt, difficulty: 'normal', ...tuning, ...range,
            distanceToTarget: bot.pos.distanceTo(target.pos), minLungeRange: resolveAICombatDangerZone(f.state.settings, target.activeWeapon) * .85,
            maxLungeRange: Math.min(18, f.state.settings.swordLungeDistance),
            resolvedAiReach: f.state.settings.attackRange + f.state.settings.attackRadius * .75,
            swapLockoutRemaining: bot.swapLockoutTimer ?? 0, cooldownMultiplier: 1, getTargetPlayerModel: () => null, random: liveRng.next,
            applyTacticalWeapon: requestedWeapon => {
              if (canApplyAITacticalWeaponSwap({ activeWeapon, requestedWeapon, weaponState, swapLockoutTimer: bot.swapLockoutTimer ?? 0,
                swordForbidden: false, hammerForbidden: false })) {
                swaps++; swapCombatantWeaponAction({ self: bot, settings: f.state.settings, type: requestedWeapon, setLockout: true, recordWeaponSwap: () => {} });
                activeWeapon = requestedWeapon; weaponState = 'ready'; canStart = false;
              }
              return { activeWeapon, weaponState, canStartWeaponAction: canStart };
            },
            triggerCombatantAttack: (_self, _weapon, swipe) => { commits++; f.attack(swipe); },
            triggerCombatantLunge: () => assert.fail('close stationary target must not induce a lunge'), recordCombatantObservation: () => {} });
        });
        const before = structuredClone({ sim, memories, simCombo });
        const input = resolveSimGrifballComboInput(sim, makePlan(sim), id, owners, tuning, memories,
          { comboState: simCombo, tacticalWeapon: null, swapFeintActive: false, random: simRng.next })!;
        assert.ok(input); assert.deepEqual({ sim, memories, simCombo }, before);
        for (const command of input.scriptedCombat.commands[id]) if (command.kind === 'melee') {
          assert.equal(command.swipe, combo !== 'mixup' && seed === 7, 'fixed seeds exercise both hammer choices and retain sword slash');
        }
        assert.deepEqual(input.frame, liveFrame, `decision ${tick}`);
        assert.deepEqual(input.comboState, f.state.aiMatchContext.comboState.get(id) ?? null);
        assert.equal(simRng.getState(), liveRng.getState());
        liveMemory = { ...liveMemory, aiState: liveFrame.aiState, timer: Math.max(0, (liveFrame.timer ?? 0) - dt) };
        memories[id] = { ...memories[id], aiState: input.frame.aiState, timer: Math.max(0, (input.frame.timer ?? 0) - dt) };
        simCombo = input.comboState;
        stepSimulation(sim, { [id]: input.action }, { settings: sim.settings, scriptedCombat: input.scriptedCombat });
        if (restored) {
          const own = resolveSimGrifballComboInput(restored.state, makePlan(restored.state), id, owners, tuning, restored.memories,
            { comboState: restored.combo, tacticalWeapon: null, swapFeintActive: false, random: restoredRng.next })!;
          assert.deepEqual(own, input);
          restored.combo = own.comboState;
          restored.memories[id] = { ...restored.memories[id], aiState: own.frame.aiState, timer: Math.max(0, (own.frame.timer ?? 0) - dt) };
          stepSimulation(restored.state, { [id]: own.action }, { settings: restored.state.settings, scriptedCombat: own.scriptedCombat });
          assert.deepEqual(restored.state, sim); assert.deepEqual(restored.memories, memories); assert.equal(restoredRng.getState(), simRng.getState());
        }
        if (tick === 2) { restored = JSON.parse(JSON.stringify({ state: sim, memories, combo: simCombo })); restoredRng.setState(simRng.getState()); }
        assert.equal(self.weapon, bot.activeWeapon);
        const phase = bot.weaponState === 'ready' ? 'idle' : ['swing_up', 'melee_up'].includes(bot.weaponState!) ? 'windup'
          : ['swing_down', 'melee_down'].includes(bot.weaponState!) ? 'active' : 'recovering';
        assert.equal(self.weaponState, phase, `phase ${tick}`);
        assert.ok(Math.abs((self.weaponPhaseElapsed ?? 0) - (bot.weaponTimer ?? 0)) < 1e-6);
        assert.equal(self.weaponReadyTimer, bot.swapCooldownTimer); assert.equal(self.swapLockoutTimer, bot.swapLockoutTimer);
        assert.equal(rival.hp, target.hp, `impact ${tick}`);
      }
      assert.equal(commits, 1); assert.equal(target.hp, 19); assert.equal(simCombo, null);
      assert.equal(swaps, combo === 'safe_finish' ? 0 : combo === 'bait_smash' ? 2 : 1);
    });

for (const id of ['main_ai', 'bot_2']) for (const weapon of ['hammer', 'sword'] as const)
  for (const replace of [false, true]) test(`${id}/${weapon}/replace-${replace}: recovery swap preserves or replaces the live animation`, () => {
    const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', hammerReloadTime: .7, swordSlashReload: .3,
      weaponSwapLockout: .1, weaponReadyTime: replace ? 0 : .05 });
    const { sim, bot, target } = f, [self, rival] = sim.combatants;
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing'; self.id = id; rival.id = target.id;
    self.controller = 'ai'; self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 2 }; self.yaw = 0;
    self.weapon = bot.activeWeapon = weapon; self.weaponState = bot.weaponState = 'recovering';
    self.attackKind = weapon === 'hammer' ? 'strike' : 'slash'; self.weaponPhaseElapsed = bot.weaponTimer = .1;
    self.weaponTimer = self.attackCooldown = (weapon === 'hammer' ? .7 : .3) - .1;
    self.swapLockoutTimer = bot.swapLockoutTimer = self.weaponReadyTimer = self.invulnerabilityTimer = rival.invulnerabilityTimer = 0;
    rival.hp = rival.maxHp = target.hp; const desired: 'hammer' | 'sword' = weapon === 'hammer' ? 'sword' : 'hammer';
    for (let tick = 1; tick <= 100; tick++) {
      f.frame(false, false, () => {
        if (id !== 'main_ai') { bot.swapCooldownTimer = Math.max(0, (bot.swapCooldownTimer ?? 0) - dt); bot.swapLockoutTimer = Math.max(0, (bot.swapLockoutTimer ?? 0) - dt); }
        if (tick === 1) {
          swapCombatantWeaponAction({ self: bot, settings: f.state.settings, type: desired, setLockout: true, recordWeaponSwap: () => {} });
          if (replace) f.attack();
        }
      });
      const commands: ScriptedCombatCommand[] = tick === 1 ? [{ kind: 'swap', weapon: desired },
        ...(replace ? [{ kind: 'melee' as const, weapon: desired, swipe: false }] : [])] : [];
      stepSimulation(sim, { [id]: idleAction() }, { settings: sim.settings,
        scriptedCombat: { version: 'scripted-combat-v1', scriptedBots: { [id]: 'normal' }, commands: { [id]: commands } } });
      const observedPhase = String(bot.weaponState);
      const phase = observedPhase === 'ready' ? 'idle' : observedPhase === 'swing_up' ? 'windup' : observedPhase === 'swing_down' ? 'active' : 'recovering';
      assert.equal(self.weapon, bot.activeWeapon); assert.equal(self.weaponState, phase, `phase ${tick}`);
      assert.ok(Math.abs((self.weaponPhaseElapsed ?? 0) - (bot.weaponTimer ?? 0)) < 1e-6);
      assert.equal(rival.hp, target.hp); assert.equal(self.weaponReadyTimer, bot.swapCooldownTimer);
    }
    assert.equal(target.hp, replace ? 19 : 20); assert.equal(self.weaponState, 'idle');
  });

for (const id of ['main_ai', 'bot_2']) for (const mixed of [false, true])
  test(`${id}/mixed-${mixed}: independently chosen combo lunge continues through real contact`, () => {
    const f = attachLungeRuntime(createBotParityFixture(id, true, { aiDifficulty: 'normal', attackRange: 2, attackRadius: 2 }));
    const { sim, bot, target } = f, [self, rival] = sim.combatants;
    sim.combatExecution = mixed ? 'live-mixed-v1' : 'live-roster-v2'; sim.match.phase = 'playing';
    self.id = id; rival.id = target.id; self.controller = rival.controller = 'ai';
    self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 5 }; target.pos.set(0, 0, 5);
    self.weapon = bot.activeWeapon = 'sword'; self.yaw = 0;
    self.swapLockoutTimer = bot.swapLockoutTimer = self.weaponReadyTimer = self.invulnerabilityTimer = rival.invulnerabilityTimer = 0;
    rival.hp = rival.maxHp = target.hp;
    if (mixed) { sim.localPlayerId = 'player'; f.state.isObserverMode = false; f.state.localPlayerTeam = 'blue';
      sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: 'blue', pos: { x: 40, y: 0, z: 0 } }); }
    const owners = { [id]: 'normal' }, plan = createGrifballTeamPlanState();
    plan.snapshot = createSimGrifballTacticalSnapshot(sim, { scriptedBots: owners });
    plan.assignments.set(id, { botId: id, team: self.team, role: 'lead', slot: 0, destination: { x: 0, z: 0 },
      anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Assigned lunge' });
    const comboState = { ...createBotComboState('mixup', target.id), stepIndex: 2 };
    const memory: TacticalAIMemory = { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 };
    f.state.aiMatchContext.comboState.set(id, { ...comboState });
    const input = resolveSimGrifballComboInput(sim, plan, id, owners, tuning,
      { [id]: memory, [target.id]: memory }, { comboState, tacticalWeapon: null, swapFeintActive: false, random: () => .5 })!;
    assert.ok(input); assert.equal(input.scriptedCombat.commands[id][0].kind, 'lunge');
    let restored: typeof sim | undefined;
    for (let tick = 1; tick <= 45; tick++) {
      f.frame(false, false, () => {
        if (tick === 1) {
          const frame = resolveAIComboOrchestrationForCombatant({ state: f.state, self: bot, aiContext: f.state.aiMatchContext, botId: id,
            target: { ...target, weaponState: target.weaponState!, isLunging: false, isCrouching: false },
            frame: { pos: bot.pos, vel: bot.vel, ...memory, weaponState: 'ready' }, activeWeapon: 'sword', canStartWeaponAction: true,
            tacticalWeapon: null, swapFeintActive: false, targetProtected: false, targetAirborne: false,
            hasVerticalLungeLine: true, targetIsLunging: false, dt, difficulty: 'normal', ...tuning,
            attackDistanceToTarget: bot.pos.distanceTo(target.pos), combatDistanceToTarget: bot.pos.distanceTo(target.pos), distanceToTarget: bot.pos.distanceTo(target.pos),
            minLungeRange: resolveAICombatDangerZone(f.state.settings, target.activeWeapon) * .85, maxLungeRange: Math.min(18, f.state.settings.swordLungeDistance),
            resolvedAiReach: 3.5, stationarySwingReach: 2.2, swapLockoutRemaining: 0, cooldownMultiplier: 1,
            getTargetPlayerModel: () => null, random: () => .5,
            applyTacticalWeapon: () => assert.fail('ready lunge step must retain sword'), triggerCombatantAttack: () => assert.fail('must choose lunge'),
            triggerCombatantLunge: (actor, dir, pos, vel) => triggerCombatantLungeAction({ self: actor, lungeDir: dir, pos, vel, settings: f.state.settings, playDash: () => {} }),
            recordCombatantObservation: () => {} });
          assert.deepEqual(frame, input.frame); bot.aiState = frame.aiState; bot.aiTimer = frame.timer;
        } else { bot.aiTimer = Math.max(0, (bot.aiTimer ?? 0) - dt); f.flight(); }
      });
      stepSimulation(sim, { [id]: tick === 1 ? input.action : idleAction() },
        { settings: sim.settings, ...(tick === 1 ? { scriptedCombat: input.scriptedCombat } : {}) });
      if (restored) { stepSimulation(restored, { [id]: idleAction() }, { settings: restored.settings }); assert.deepEqual(restored, sim); }
      if (tick === 1) { restored = JSON.parse(JSON.stringify(sim)); assert.equal(self.lungeTimer, 0); }
      assert.equal(self.isLunging, !!bot.isLunging); assert.equal(self.weapon, bot.activeWeapon); assert.equal(rival.hp, target.hp);
      for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(Math.abs(self.pos[axis] - bot.pos[axis]) < 1e-8, `${tick}/position/${axis}`);
        assert.ok(Math.abs(self.vel[axis] - bot.vel[axis]) < 1e-8, `${tick}/velocity/${axis}`);
      }
    }
    assert.equal(target.hp, 19); assert.equal(self.lungeOutcome, 'hit'); assert.equal(bot.aiLastLungeOutcome, 'hit');
  });
