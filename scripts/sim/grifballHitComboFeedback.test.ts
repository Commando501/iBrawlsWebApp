import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { tryStartComboOnHitForState } from '../../src/components/grifball/combatantCombos';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import { resolveAIComboOrchestrationForCombatant } from '../../src/components/grifball/aiComboOrchestrationRuntime';
import { resolveAICombatRangeFrame } from '../../src/components/grifball/aiCombatRangeRuntime';
import { swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { canStartAIWeaponAction } from '../../src/game/aiWeaponTiming';
import { canApplyAITacticalWeaponSwap } from '../../src/game/aiTacticalWeaponSwap';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballComboInput } from '../../src/sim/grifballComboInput';
import { stepSimulation } from '../../src/sim/step';
import { createRng } from '../../src/sim/rng';
import { NEURAL_NET_DIFFICULTY } from '../../src/game/neuralBrains';
import { idleAction } from '../../src/sim/actions';
import type { ScriptedMeleeFeedback } from '../../src/sim/scriptedMeleeFeedback';
import type { TacticalAIMemory } from '../../src/sim/grifballTacticalWeaponChoice';

const dt = 1 / 60;
const knobs = { difficulty: 'normal', weaponSwapIQ: 100, weaponPrioritization: 50 };
const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
  playstyleFactor: .5, ...knobs, spacingFactor: 1 };

function fixture(id = 'bot_2', profile: 'live-roster-v2' | 'live-mixed-v1' = 'live-roster-v2', seed = 3) {
  const liveRng = createRng(seed), simRng = createRng(seed);
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', weaponSwapLockout: .05, weaponReadyTime: .05 }, 'target', undefined,
    (botId, targetId, openingWeapon, opts) => tryStartComboOnHitForState({ state: f.state, botId, targetId, openingWeapon,
      bot: f.state.otherPlayers.get(botId), candidate: getTacticalTargetByIdFromState(f.state, botId, targetId, [...f.state.otherPlayers.values()]),
      knobs: control.knobs[botId], ...opts, random: liveRng.next }));
  const { sim, bot, target } = f, [self, rival] = sim.combatants;
  sim.combatExecution = profile; sim.match.phase = 'playing'; self.id = id; rival.id = target.id;
  self.controller = rival.controller = 'ai';
  self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 2 }; self.yaw = 0;
  self.weaponReadyTimer = self.swapLockoutTimer = self.invulnerabilityTimer = rival.invulnerabilityTimer = 0;
  rival.hp = rival.maxHp = target.hp;
  if (profile === 'live-mixed-v1') {
    sim.localPlayerId = 'player'; f.state.isObserverMode = false; f.state.localPlayerTeam = self.team;
    sim.combatants.push({ ...structuredClone(rival), id: 'player', team: self.team, controller: 'remote', pos: { x: 40, y: 0, z: 0 } });
  }
  const memory: TacticalAIMemory = { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 };
  const control: ScriptedMeleeFeedback = { version: 'scripted-melee-feedback-v1', knobs: { [id]: knobs },
    memories: { [id]: { ...memory }, [target.id]: { ...memory } }, combos: new Map(), random: simRng.next };
  return { ...f, self, rival, control, liveRng, simRng, memory };
}

for (const id of ['main_ai', 'bot_2']) for (const profile of ['live-roster-v2', 'live-mixed-v1'] as const)
  for (const kind of ['slam', 'swipe', 'slash']) for (const seed of [3, 7]) for (const mirror of [false, true])
    test(`${id}/${profile}/${kind}/${seed}/mirror-${mirror}: actual hit earns matching combo and follow-up`, () => {
      const f = fixture(id, profile, seed), { sim, self, rival, bot, target, control } = f;
      self.weapon = bot.activeWeapon = kind === 'slash' ? 'sword' : 'hammer';
      if (mirror) { self.team = bot.team = 'red'; rival.team = target.team = 'blue'; rival.pos.z = target.pos.z = -2; self.yaw = Math.PI; bot.yaw = 0; }
      let liveMemory = { ...f.memory }, followups = 0, earned = false;
      const owners = { [id]: 'normal' };
      const planFor = (state: typeof sim) => {
        const plan = createGrifballTeamPlanState(); plan.snapshot = createSimGrifballTacticalSnapshot(state, { scriptedBots: owners });
        plan.assignments.set(id, { botId: id, team: self.team, role: 'lead', slot: 0, destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Earned combo encounter' });
        return plan;
      };
      let restored: { state: typeof sim; control: ScriptedMeleeFeedback; rng: ReturnType<typeof createRng> } | undefined;
      for (let tick = 1; tick <= 180; tick++) {
        let input: ReturnType<typeof resolveSimGrifballComboInput> = null;
        if (control.combos.has(id)) input = resolveSimGrifballComboInput(sim, planFor(sim), id, owners, tuning, control.memories,
          { comboState: control.combos.get(id)!, tacticalWeapon: null, swapFeintActive: false, random: f.simRng.next });
        f.frame(tick === 1, kind === 'swipe', () => {
          if (id !== 'main_ai') { bot.swapCooldownTimer = Math.max(0, (bot.swapCooldownTimer ?? 0) - dt); bot.swapLockoutTimer = Math.max(0, (bot.swapLockoutTimer ?? 0) - dt); }
          if (!f.state.aiMatchContext.comboState.has(id)) return;
          const range = resolveAICombatRangeFrame({ botPos: bot.pos, botVel: bot.vel, botIsCrouching: false, botIsJumping: false,
            targetIsCrouching: false, targetHp: target.hp, targetProtected: false, predictedTargetPos: target.pos,
            distanceToTarget: bot.pos.distanceTo(target.pos), activeWeapon: bot.activeWeapon as 'hammer' | 'sword',
            attackRange: sim.settings.attackRange, attackRadius: sim.settings.attackRadius, resolvedAiReach: sim.settings.attackRange + sim.settings.attackRadius * .75 });
          let activeWeapon = bot.activeWeapon, weaponState = bot.weaponState!;
          let canStart = canStartAIWeaponAction({ ...liveMemory, swapCooldownTimer: bot.swapCooldownTimer });
          const frame = resolveAIComboOrchestrationForCombatant({ state: f.state, self: bot, aiContext: f.state.aiMatchContext, botId: id,
            target: { ...target, weaponState: target.weaponState!, isLunging: false, isCrouching: false },
            frame: { pos: bot.pos, vel: bot.vel, ...liveMemory, weaponState }, activeWeapon, canStartWeaponAction: canStart,
            tacticalWeapon: null, swapFeintActive: false, targetProtected: false, targetAirborne: false, hasVerticalLungeLine: true, targetIsLunging: false,
            dt, ...tuning, ...range, distanceToTarget: 2, minLungeRange: (sim.settings.attackRange + sim.settings.attackRadius * .85) * .85,
            maxLungeRange: Math.min(18, sim.settings.swordLungeDistance), resolvedAiReach: sim.settings.attackRange + sim.settings.attackRadius * .75,
            swapLockoutRemaining: bot.swapLockoutTimer ?? 0, cooldownMultiplier: 1, getTargetPlayerModel: () => null, random: f.liveRng.next,
            applyTacticalWeapon: requestedWeapon => {
              if (canApplyAITacticalWeaponSwap({ activeWeapon, requestedWeapon, weaponState, swapLockoutTimer: bot.swapLockoutTimer ?? 0, swordForbidden: false, hammerForbidden: false })) {
                swapCombatantWeaponAction({ self: bot, settings: sim.settings, type: requestedWeapon, setLockout: true, recordWeaponSwap: () => {} });
                activeWeapon = requestedWeapon; weaponState = 'ready'; canStart = false;
              }
              return { activeWeapon, weaponState, canStartWeaponAction: canStart };
            }, triggerCombatantAttack: (_self, _weapon, swipe) => { followups++; f.attack(swipe); },
            triggerCombatantLunge: () => assert.fail('stationary close encounter'), recordCombatantObservation: () => {} });
          assert.deepEqual(input?.frame, frame, `independent decision ${tick}`);
          liveMemory = { ...liveMemory, aiState: frame.aiState, timer: Math.max(0, (frame.timer ?? 0) - dt) };
        });
        const step = (state: typeof sim, feedback: ScriptedMeleeFeedback, decision: typeof input) => {
          if (decision) {
            if (decision.comboState) feedback.combos.set(id, decision.comboState); else feedback.combos.delete(id);
            (feedback.memories as Record<string, TacticalAIMemory>)[id] = { ...feedback.memories[id], aiState: decision.frame.aiState, timer: Math.max(0, (decision.frame.timer ?? 0) - dt) };
          }
          const action = decision?.action ?? { ...idleAction(), aim: self.yaw, attackPrimary: tick === 1 && kind !== 'swipe', attackSecondary: tick === 1 && kind === 'swipe' };
          stepSimulation(state, { [id]: action }, { settings: state.settings, scriptedMeleeFeedback: feedback, scriptedCombat: decision?.scriptedCombat });
        };
        step(sim, control, input);
        assert.equal(rival.hp, target.hp); assert.equal(self.weapon, bot.activeWeapon);
        assert.deepEqual(control.combos, f.state.aiMatchContext.comboState, `feedback ${tick}`);
        assert.equal(f.simRng.getState(), f.liveRng.getState(), `random ${tick}`);
        if (restored) {
          const own = restored.control.combos.has(id) ? resolveSimGrifballComboInput(restored.state, planFor(restored.state), id, owners, tuning, restored.control.memories,
            { comboState: restored.control.combos.get(id)!, tacticalWeapon: null, swapFeintActive: false, random: restored.rng.next }) : null;
          assert.deepEqual(own, input); step(restored.state, restored.control, own);
          assert.deepEqual(restored.state, sim); assert.deepEqual(restored.control.combos, control.combos); assert.equal(restored.rng.getState(), f.simRng.getState());
        } else if (control.combos.size) {
          earned = true;
          const snapshot = JSON.parse(JSON.stringify({ state: sim, memories: control.memories, combos: [...control.combos], rng: f.simRng.getState() }));
          const rng = createRng(0); rng.setState(snapshot.rng);
          restored = { state: snapshot.state, rng, control: { ...control, memories: snapshot.memories, combos: new Map(snapshot.combos), random: rng.next } };
        }
      }
      assert.ok(earned); assert.ok(followups > 0); assert.ok(rival.hp < 19, 'earned follow-up must land');
    });

for (const mode of ['lethal', 'shield', 'miss', 'punch', 'easy', 'existing', 'multi']) test(`melee feedback guard: ${mode}`, () => {
  const f = fixture(); const { self, rival, bot, target, sim, control } = f;
  if (mode === 'lethal') rival.hp = target.hp = 1;
  if (mode === 'shield') rival.invulnerabilityTimer = target.invulnerabilityTimer = 10;
  if (mode === 'miss') rival.pos.z = target.pos.z = 30;
  if (mode === 'punch') self.weapon = bot.activeWeapon = 'ball';
  if (mode === 'easy') (control.knobs as Record<string, typeof knobs>)[bot.id] = { ...knobs, difficulty: 'easy' };
  if (mode === 'existing') control.combos.set(bot.id, { comboId: 'safe_finish', targetId: 'untouched', stepIndex: 0, stepTimer: .07 });
  if (mode === 'multi') sim.combatants.push({ ...structuredClone(rival), id: 'second' });
  if (mode === 'multi') (control.memories as Record<string, TacticalAIMemory>).second = { ...f.memory };
  if (mode === 'existing') f.state.aiMatchContext.comboState = new Map(structuredClone([...control.combos]));
  if (mode === 'multi') { const other = { ...target, id: 'second', pos: target.pos.clone(), vel: target.vel.clone() }; f.state.otherPlayers.set(other.id, other); }
  const before = f.simRng.getState();
  for (let tick = 0; tick < 60; tick++) { f.frame(tick === 0); stepSimulation(sim, { [self.id]: { ...idleAction(), attackPrimary: tick === 0 } }, { settings: sim.settings, scriptedMeleeFeedback: control }); }
  assert.deepEqual(control.combos, f.state.aiMatchContext.comboState); assert.equal(f.simRng.getState(), f.liveRng.getState());
  if (mode === 'multi') { assert.equal(control.combos.get(bot.id)?.targetId, target.id); assert.notEqual(f.simRng.getState(), before); }
  else { assert.equal(f.simRng.getState(), before); assert.equal(control.combos.size, mode === 'existing' ? 1 : 0); }
});

for (const bad of ['version', 'legacy', 'authority', 'neural', 'random', 'memory', 'knobs']) test(`invalid feedback fails atomically: ${bad}`, () => {
  const f = fixture(); const c = f.control;
  if (bad === 'version') (c as any).version = 'bad';
  if (bad === 'legacy') f.sim.combatExecution = 'legacy-v1';
  if (bad === 'authority') (c.knobs as any).absent = knobs;
  if (bad === 'neural') f.sim.settings.aiDifficulty = NEURAL_NET_DIFFICULTY;
  if (bad === 'random') (c as any).random = undefined;
  if (bad === 'memory') delete (c.memories as any).target;
  if (bad === 'knobs') (c.knobs as any)[f.bot.id] = { ...knobs, weaponSwapIQ: NaN };
  const before = structuredClone(f.sim), rng = f.simRng.getState();
  assert.throws(() => stepSimulation(f.sim, {}, { settings: f.sim.settings, scriptedMeleeFeedback: c }));
  assert.deepEqual(f.sim, before); assert.equal(f.simRng.getState(), rng); assert.equal(c.combos.size, 0);
});

for (const lethalPlayer of [false, true]) test(`mixed splash selects first surviving victim in live order, lethal player ${lethalPlayer}`, () => {
  const f = fixture('bot_2', 'live-mixed-v1');
  const player = f.sim.combatants.find(c => c.id === 'player')!;
  player.team = f.state.localPlayerTeam = 'red'; player.pos = { x: 0, y: 0, z: 2 }; f.state.playerPos.set(0, 0, 2);
  player.hp = f.state.playerHP = lethalPlayer ? 1 : 20;
  for (let tick = 0; tick < 60; tick++) {
    f.frame(tick === 0);
    stepSimulation(f.sim, { [f.self.id]: { ...idleAction(), attackPrimary: tick === 0 } }, { settings: f.sim.settings, scriptedMeleeFeedback: f.control });
    assert.deepEqual(f.control.combos, f.state.aiMatchContext.comboState);
    assert.equal(f.simRng.getState(), f.liveRng.getState());
    assert.equal(player.hp, f.state.playerHP); assert.equal(f.rival.hp, f.target.hp);
  }
  assert.equal(f.control.combos.get('bot_2')?.targetId, lethalPlayer ? 'target' : 'player');
});

for (const dt of [0, -1, Infinity, NaN]) test(`invalid melee feedback timestep ${dt} is atomic`, () => {
  const f = fixture(), before = structuredClone(f.sim);
  assert.throws(() => stepSimulation(f.sim, {}, { settings: f.sim.settings, dt, scriptedMeleeFeedback: f.control }));
  assert.deepEqual(f.sim, before); assert.equal(f.control.combos.size, 0);
});

test('feedback uses own authority entries and stays opt-in', () => {
  const f = fixture(); (f.control as any).knobs = Object.create({ [f.bot.id]: knobs });
  const rng = f.simRng.getState();
  for (let tick = 0; tick < 60; tick++) stepSimulation(f.sim, { [f.self.id]: { ...idleAction(), attackPrimary: tick === 0 } }, { settings: f.sim.settings, scriptedMeleeFeedback: f.control });
  assert.equal(f.rival.hp, 19); assert.equal(f.control.combos.size, 0); assert.equal(f.simRng.getState(), rng);
  const other = fixture();
  for (let tick = 0; tick < 60; tick++) stepSimulation(other.sim, { [other.self.id]: { ...idleAction(), attackPrimary: tick === 0 } }, { settings: other.sim.settings });
  assert.equal(other.rival.hp, 19); assert.equal(other.control.combos.size, 0); assert.equal(other.simRng.getState(), rng);
});
