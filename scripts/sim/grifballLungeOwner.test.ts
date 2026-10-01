import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { tryStartComboOnHitForState } from '../../src/components/grifball/combatantCombos';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import { tryEnterCombatantPressureState } from '../../src/components/grifball/matchPressure';
import { recordLocalPlayerDamageTakenObservation } from '../../src/components/grifball/playerModelObservations';
import { recordBotDamageTagForState } from '../../src/components/grifball/aiBookkeeping';
import { createBotCoordinator } from '../../src/game/aiBotCoordinator';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { createMatch } from '../../src/sim/factory';
import { NEURAL_NET_DIFFICULTY } from '../../src/game/neuralBrains';
import { createRng } from '../../src/sim/rng';
import type { ScriptedLungeFeedback } from '../../src/sim/scriptedLungeFeedback';

const dt = 1 / 60, knobs = { difficulty: 'normal', weaponSwapIQ: 100, weaponPrioritization: 50 };
const cases = ['hit', 'hit-lethal', 'timeout', 'boundary', 'target-dead', 'friendly', 'trade', 'trade-self-dead', 'trade-target-dead', 'paired', 'paired-reversed', 'airborne', 'shield', 'trade-both-dead', 'skip-pressure'] as const;
for (const [id, targetId] of [['main_ai', 'target'], ['bot_2', 'main_ai']]) for (const mixed of [false, true])
  for (const pressure of [false, true]) for (const mirror of [false, true]) for (const kind of cases)
    test(`lunge owner ${id}/${mixed}/${pressure}/${mirror}/${kind}: independent flight feedback and restore`, () => {
      const base = createBotParityFixture(id, true, { enableSwordTrade: false, enableHammerSwordTrade: false, aiDifficulty: 'normal' }, targetId);
      const liveRng = createRng(7), simRng = createRng(7), cooldownMultiplier = pressure ? .7 : 1.6;
      const scoreContext = { scorePlayer: 5, scoreEnemy: 1, killsToWin: 10 };
      const f = attachLungeRuntime(base, { cooldownMultiplier,
        tryEnterPressureState: (botId, targetId, targetHp, targetInvuln) => tryEnterCombatantPressureState({
          bot: base.state.otherPlayers.get(botId), targetId, targetHp, targetInvuln, pressureAggression: pressure ? 80 : 0, skipPressure: kind === 'skip-pressure',
          settings: base.state.settings, scoreContext }),
        recordBotDamageTag: (botId, targetId) => recordBotDamageTagForState({ state: base.state, botId, targetId, isMultiplayer: false }),
        tryStartComboOnHit: (botId, targetId, openingWeapon) => tryStartComboOnHitForState({ state: base.state, botId, targetId, openingWeapon,
          bot: base.state.otherPlayers.get(botId), candidate: getTacticalTargetByIdFromState(base.state, botId, targetId, [...base.state.otherPlayers.values()]), knobs, random: liveRng.next }),
      });
      const { sim, state, bot, target } = f, [self, rival] = sim.combatants;
      sim.combatExecution = mixed ? 'live-mixed-v1' : 'live-roster-v2'; sim.match.phase = 'playing';
      self.id = id; rival.id = targetId; self.controller = rival.controller = 'ai'; target.aiState = 'APPROACHING';
      self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 5 }; target.pos.set(0, 0, 5);
      self.weapon = bot.activeWeapon = 'sword'; self.yaw = 0; rival.yaw = Math.PI;
      self.hp = self.maxHp = bot.hp = bot.maxHp = 20; rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
      self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
      if (mixed) { sim.localPlayerId = 'player'; state.isObserverMode = false; state.localPlayerTeam = 'blue';
        sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: 'blue', pos: { x: 40, y: 0, z: 0 } }); }
      if (kind === 'shield') target.invulnerabilityTimer = rival.invulnerabilityTimer = 10;
      if (kind === 'timeout') { rival.pos.x = target.pos.x = 15; }
      if (kind === 'boundary') { self.pos.z = bot.pos.z = sim.map.arenaRadius - 1; rival.pos.z = target.pos.z = 0; }
      if (kind === 'hit-lethal' || kind === 'trade-target-dead' || kind === 'trade-both-dead') rival.hp = target.hp = 1;
      if (kind === 'trade-self-dead' || kind === 'trade-both-dead') self.hp = bot.hp = 1;
      if (kind === 'target-dead') { rival.hp = target.hp = 0; rival.alive = false; target.respawnTimer = rival.respawnTimer = 10; }
      if (kind === 'friendly') rival.team = target.team = self.team;
      if (kind === 'airborne') { self.pos.y = bot.pos.y = rival.pos.y = target.pos.y = 3; self.isJumping = bot.isJumping = rival.isJumping = target.isJumping = true; self.grounded = rival.grounded = false; }
      if (mirror) { self.team = bot.team = 'red'; rival.team = target.team = kind === 'friendly' ? 'red' : 'blue';
        self.pos.z *= -1; bot.pos.z *= -1; rival.pos.z *= -1; target.pos.z *= -1; self.yaw = Math.PI; rival.yaw = 0; }
      for (const actor of [self, rival]) { actor.pos.z = actor.pos.z || 0; }
      const paired = kind.startsWith('paired'), trade = paired || kind.startsWith('trade');
      if (trade) {
        state.settings.enableSwordTrade = sim.settings.enableSwordTrade = true; rival.weapon = target.activeWeapon = 'sword';
        // A recent completed attack trades without an additional melee impact.
        rival.lastSwordAttackTimeMs = 0; target.lastSwordAttackTime = 1_000_000;
      } else if (kind === 'hit' || kind === 'skip-pressure') { rival.weaponState = 'recovering'; rival.attackKind = 'slash'; rival.weaponPhaseElapsed = 0;
        rival.weaponTimer = sim.settings.swordSlashReload; target.activeWeapon = rival.weapon = 'sword'; target.weaponState = 'recovering'; }
      const start = (live: typeof bot, actor: typeof self, targetId: string, direction: number) => {
        live.aiState = 'LUNGING'; live.aiTimer = 0; live.activeWeapon = actor.weapon = 'sword';
        triggerCombatantLungeAction({ self: live, settings: state.settings, lungeDir: new THREE.Vector3(0, 0, direction), pos: live.pos, vel: live.vel, playDash: () => {} });
        actor.lungeTargetId = targetId; stepCombatantWeapons(sim, actor, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
      };
      start(bot, self, rival.id, mirror ? -1 : 1); if (paired) start(target, rival, self.id, mirror ? 1 : -1);
      if (kind === 'paired-reversed') { sim.combatants.splice(0, 2, rival, self); state.otherPlayers = new Map([[target.id, target], [bot.id, bot]]); }
      const control: ScriptedLungeFeedback = { version: 'scripted-lunge-feedback-v1', knobs: { [id]: knobs, [targetId]: knobs },
        memories: { [id]: { aiState: bot.aiState, timer: 0, cooldownMultiplier }, [targetId]: { aiState: target.aiState, timer: 0, cooldownMultiplier } },
        pressure: { [id]: { aggression: pressure ? 80 : 0, skip: kind === 'skip-pressure' }, [targetId]: { aggression: pressure ? 80 : 0, skip: kind === 'skip-pressure' } },
        scoreContext, combos: new Map(), models: new Map(), coordinator: createBotCoordinator(), random: simRng.next };
      const snapshot = (feedback: ScriptedLungeFeedback) => ({ memories: feedback.memories, combos: [...feedback.combos], models: [...feedback.models],
        coordinator: { ...feedback.coordinator, recentTags: [...feedback.coordinator.recentTags].map(([key, tags]) => [key, [...tags]]),
          engagements: [...feedback.coordinator.engagements], tacticalEngagements: [...feedback.coordinator.tacticalEngagements] } });
      let restored: { state: typeof sim; control: ScriptedLungeFeedback; rng: ReturnType<typeof createRng> } | undefined;
      const step = (s: typeof sim, c: ScriptedLungeFeedback) => {
        // General AI clocks are held on both hosts; this suite owns finish feedback, not the full scheduler.
        return stepSimulation(s, { [id]: { ...idleAction(), aim: self.yaw }, [targetId]: { ...idleAction(), aim: rival.yaw } }, { settings: s.settings, scriptedLungeFeedback: c });
      };
      for (let tick = 1; tick <= 65; tick++) {
        f.frame(false, false, () => {
          for (const live of kind === 'paired-reversed' ? [target, bot] : [bot, target]) if (live.hp > 0) {
            tickCombatantInvulnerability(live, dt);
            if (kind === 'airborne') f.gravityPrelude(live);
            if (live === bot) f.flight(); else if (paired) f.targetFlight();
          }
        });
        step(sim, control);
        for (const [live, actor] of [[bot, self], [target, rival]] as const) {
          assert.equal(actor.hp, live.hp, `hp ${tick}/${live.id}`); assert.equal(actor.isLunging, !!live.isLunging);
          const memory = control.memories[live.id];
          if (live.aiLastLungeOutcome) {
            assert.equal(memory.aiState, live.aiState); assert.equal(memory.timer, live.aiTimer);
            assert.equal(memory.lastLungeOutcome, live.aiLastLungeOutcome); assert.equal(memory.lastLungeTargetId, live.aiLastLungeTargetId);
            assert.equal(memory.postLungeDecisionTimer, live.aiPostLungeDecisionTimer); assert.equal(memory.pressureTargetId, live.aiPressureTargetId);
          }
          for (const axis of ['x','y','z'] as const) { assert.ok(Math.abs(actor.pos[axis] - live.pos[axis]) < 1e-8, `pose ${tick}/${live.id}/${axis}`); assert.ok(Math.abs(actor.vel[axis] - live.vel[axis]) < 1e-8, `velocity ${tick}/${live.id}/${axis}`); }
        }
        assert.deepEqual(control.combos, state.aiMatchContext.comboState); assert.deepEqual(control.models, state.aiMatchContext.playerModels);
        assert.deepEqual(control.coordinator, state.aiMatchContext.coordinator); assert.equal(simRng.getState(), liveRng.getState());
        if (restored) { step(restored.state, restored.control); assert.deepEqual(restored.state, sim); assert.deepEqual(snapshot(restored.control), snapshot(control)); assert.equal(restored.rng.getState(), simRng.getState()); }
        if (tick === 1) {
          const copy = JSON.parse(JSON.stringify({ state: sim, feedback: snapshot(control), rng: simRng.getState() })); const rng = createRng(0); rng.setState(copy.rng);
          const c = copy.feedback.coordinator;
          restored = { state: copy.state, rng, control: { ...control, memories: copy.feedback.memories, models: new Map(copy.feedback.models), combos: new Map(copy.feedback.combos), random: rng.next,
            coordinator: { ...c, recentTags: new Map(c.recentTags.map(([key, tags]: [string, any]) => [key, new Map(tags)])), engagements: new Map(c.engagements), tacticalEngagements: new Map(c.tacticalEngagements) } } };
        }
      }
      const expected = kind === 'timeout' || kind === 'shield' ? 'miss_timeout' : kind === 'boundary' ? 'miss_arena' : kind === 'target-dead' || kind === 'friendly' ? 'target_dead' : 'hit';
      if (kind !== 'trade-self-dead' && kind !== 'trade-both-dead') {
        assert.equal(control.memories[id].lastLungeOutcome, expected);
        assert.equal(control.memories[id].aiState, pressure && expected === 'hit' && target.hp > 0 && kind !== 'skip-pressure' ? 'PRESSURING' : 'COOLDOWN');
      }
      else assert.equal(control.memories[id].lastLungeOutcome, undefined);
    });


function controlFixture() {
  const sim = createMatch({ seed: 27, teamSizes: { blue: 1, red: 1 } });
  sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
  sim.combatants.forEach((c, i) => { c.id = i ? 'target' : 'owner'; c.controller = 'ai'; });
  const rng = createRng(7);
  const control: ScriptedLungeFeedback = { version: 'scripted-lunge-feedback-v1', knobs: { owner: knobs },
    memories: { owner: { aiState: 'LUNGING', timer: 0, cooldownMultiplier: 1 }, target: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 } },
    pressure: { owner: { aggression: 50 } }, scoreContext: { scorePlayer: 0, scoreEnemy: 0 },
    combos: new Map(), models: new Map(), coordinator: createBotCoordinator(), random: rng.next };
  return { sim, control, rng };
}
for (const lethal of [false, true]) test(`turn completion sees resolved flight memory before later actor: lethal=${lethal}`, () => {
  const { sim, control } = controlFixture(), [self, target] = sim.combatants;
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
  sim.combatants.push({ ...structuredClone(target), id: 'player', controller: 'remote', pos: { x: 25, y: 0, z: 25 } });
  self.pos = { x: 0, y: 0, z: 0 }; self.weapon = 'sword'; self.isLunging = true;
  self.lungeStartPos = { ...self.pos }; self.lungeDir = { x: 0, y: 0, z: 1 }; self.lungeTargetId = target.id;
  target.pos = { x: 0, y: 0, z: 1.7 }; target.hp = target.maxHp = lethal ? 1 : 20;
  for (const c of sim.combatants) c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
  const completed: string[] = [], decisions: string[] = [];
  const events = stepSimulation(sim, {}, { settings: sim.settings, scriptedLungeFeedback: control,
    scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { owner: 'normal', target: 'normal' },
      resolve: ({ actorId }) => {
        decisions.push(actorId);
        if (actorId === 'target') { assert.deepEqual(completed, ['owner']); assert.equal(control.memories.owner.aiState, 'PRESSURING'); }
        return { kind: 'handoff', reason: 'existing flight or observation' };
      },
      completeTurn: ({ actorId }) => {
        completed.push(actorId);
        if (actorId === 'owner') {
          assert.equal(self.isLunging, false); assert.equal(control.memories.owner.lastLungeOutcome, 'hit');
          assert.equal(control.memories.owner.aiState, lethal ? 'COOLDOWN' : 'PRESSURING');
          assert.equal(target.hp, lethal ? 0 : 19);
        }
      },
    } });
  assert.deepEqual(completed, lethal ? ['owner'] : ['owner', 'target']); assert.deepEqual(decisions, completed);
  assert.equal(events.kills.length, lethal ? 1 : 0);
});
for (const defect of ['version', 'legacy', 'local', 'remote', 'absent', 'duplicate', 'neural', 'random', 'memory', 'models', 'coordinator',
  'pressure', 'inherited-pressure', 'pressure-nan', 'pressure-negative', 'pressure-skip', 'multiplier', 'score', 'win-target', 'combos', 'overlap'])
  test(`lunge feedback rejects ${defect} before mutation`, () => {
    const { sim, control, rng } = controlFixture(); const c = control as any;
    if (defect === 'version') c.version = 'bad';
    if (defect === 'legacy') sim.combatExecution = 'legacy-v1';
    if (defect === 'local') { sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'owner'; }
    if (defect === 'remote') sim.combatants[0].controller = 'remote';
    if (defect === 'absent') c.knobs.absent = knobs;
    if (defect === 'duplicate') sim.combatants.push(structuredClone(sim.combatants[0]));
    if (defect === 'neural') c.knobs.owner = { ...knobs, difficulty: NEURAL_NET_DIFFICULTY };
    if (defect === 'random') c.random = null;
    if (defect === 'memory') delete c.memories.target;
    if (defect === 'models') c.models = {};
    if (defect === 'coordinator') c.coordinator.recentTags = [];
    if (defect === 'pressure') c.pressure = {};
    if (defect === 'inherited-pressure') c.pressure = Object.create({ owner: { aggression: 50 } });
    if (defect === 'pressure-nan') c.pressure.owner.aggression = NaN;
    if (defect === 'pressure-negative') c.pressure.owner.aggression = -1;
    if (defect === 'pressure-skip') c.pressure.owner.skip = 'yes';
    if (defect === 'multiplier') c.memories.owner.cooldownMultiplier = Infinity;
    if (defect === 'score') c.scoreContext.scoreEnemy = NaN;
    if (defect === 'win-target') c.scoreContext.killsToWin = 0;
    if (defect === 'combos') c.combos = [];
    const before = structuredClone(sim), memory = structuredClone(control.memories), models = structuredClone(c.models), r = rng.getState();
    const melee = defect === 'overlap' ? { version: 'scripted-melee-feedback-v1' as const, knobs: control.knobs,
      memories: control.memories, combos: new Map(), random: control.random } : undefined;
    assert.throws(() => stepSimulation(sim, {}, { settings: sim.settings, scriptedLungeFeedback: control, scriptedMeleeFeedback: melee }));
    assert.deepEqual(sim, before); assert.deepEqual(control.memories, memory); assert.deepEqual(c.models, models); assert.equal(rng.getState(), r);
  });
for (const dt of [0, -1, NaN, Infinity]) test(`lunge owner rejects invalid timestep ${dt}`, () => {
  const { sim, control } = controlFixture(), before = structuredClone(sim);
  assert.throws(() => stepSimulation(sim, {}, { settings: sim.settings, scriptedLungeFeedback: control, dt })); assert.deepEqual(sim, before);
});
test('compatible melee and lunge owners share persistent memory without implicit feedback', () => {
  const { sim, control, rng } = controlFixture(), before = structuredClone(control.memories), r = rng.getState();
  const melee = { version: 'scripted-melee-feedback-v1' as const, knobs: control.knobs, memories: control.memories, combos: control.combos, random: control.random };
  stepSimulation(sim, {}, { settings: sim.settings, scriptedLungeFeedback: control, scriptedMeleeFeedback: melee });
  assert.deepEqual(control.memories, before); assert.equal(control.models.size, 0); assert.equal(control.combos.size, 0); assert.equal(rng.getState(), r);
});

for (const trade of [false, true]) for (const lethal of [false, true]) test(`roster flight into local player feedback trade-${trade}/lethal-${lethal}`, () => {
  const base = createBotParityFixture('owner', false, { enableSwordTrade: trade, enableHammerSwordTrade: false });
  const { control, rng } = controlFixture(), liveRng = createRng(7);
  const { state, sim, bot, target } = base, [self, player] = sim.combatants;
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
  self.id = 'owner'; self.controller = 'ai'; self.pos = { x: 0, y: 0, z: 0 }; self.yaw = 0; self.weapon = bot.activeWeapon = 'sword';
  self.hp = bot.hp = 20; self.weaponReadyTimer = self.invulnerabilityTimer = 0;
  player.id = 'player'; player.controller = 'remote'; player.team = state.localPlayerTeam = 'red';
  player.pos = { x: 0, y: 0, z: 5 }; state.playerPos.set(0, 0, 5); player.yaw = 0;
  player.hp = state.playerHP = lethal ? 1 : 20; player.invulnerabilityTimer = state.playerInvulnerabilityTimer = 0;
  player.weaponReadyTimer = state.swapCooldownTimer = 0; player.weapon = state.activeWeapon = 'sword';
  if (trade) { player.lastSwordAttackTimeMs = 0; state.lastPlayerSwordAttackTime = 1_000_000; }
  state.otherPlayers.delete(target.id); target.id = 'player'; target.pos = state.playerPos; target.activeWeapon = 'sword';
  const f = attachLungeRuntime(base, {
    recordPlayerDamageTaken: () => recordLocalPlayerDamageTakenObservation(state),
    recordBotDamageTag: (botId, targetId) => recordBotDamageTagForState({ state, botId, targetId, isMultiplayer: false }),
    tryEnterPressureState: (botId, targetId, targetHp, targetInvuln) => tryEnterCombatantPressureState({ bot: state.otherPlayers.get(botId), targetId, targetHp, targetInvuln,
      pressureAggression: 50, settings: state.settings, scoreContext: control.scoreContext }),
    tryStartComboOnHit: (botId, targetId, openingWeapon) => tryStartComboOnHitForState({ state, botId, targetId, openingWeapon, bot,
      candidate: getTacticalTargetByIdFromState(state, botId, targetId, [bot]), knobs, random: liveRng.next }),
  });
  bot.aiState = 'LUNGING'; bot.aiTimer = 0;
  triggerCombatantLungeAction({ self: bot, settings: state.settings, lungeDir: new THREE.Vector3(0, 0, 1), pos: bot.pos, vel: bot.vel, playDash: () => {} });
  self.lungeTargetId = 'player'; stepCombatantWeapons(sim, self, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
  for (let tick = 0; tick < 30 && bot.isLunging; tick++) {
    target.hp = state.playerHP; target.invulnerabilityTimer = state.playerInvulnerabilityTimer;
    f.frame(false, false, () => { f.flight(); });
    stepSimulation(sim, {}, { settings: sim.settings, scriptedLungeFeedback: control });
    assert.equal(self.hp, bot.hp); assert.equal(player.hp, state.playerHP); assert.equal(self.isLunging, !!bot.isLunging);
    assert.deepEqual(control.models, state.aiMatchContext.playerModels); assert.deepEqual(control.combos, state.aiMatchContext.comboState);
    assert.deepEqual(control.coordinator, state.aiMatchContext.coordinator); assert.equal(rng.getState(), liveRng.getState());
  }
  assert.equal(control.memories.owner.lastLungeOutcome, 'hit'); assert.equal(control.memories.owner.aiState, lethal ? 'COOLDOWN' : 'PRESSURING');
  assert.equal(control.memories.owner.timer, bot.aiTimer); assert.equal(player.hp, lethal ? 0 : 19);
});
