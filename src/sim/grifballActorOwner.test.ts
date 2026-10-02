import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, defaultGrifballMap } from './factory';
import { createAIMatchContext } from '../game/aiMatchContext';
import { deriveAIParams } from '../game/aiTuning';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';
import { createSimGrifballActorStepOptions, type SimGrifballActorControl } from './grifballActorOwner';
import { stepSimulation } from './step';
import { idleAction } from './actions';
import { validateScriptedAIMobility } from './scriptedAIMobility';
import { createRng } from './rng';
import { setSimCarrier } from './grifball';
import type { ScriptedObjectivePlanner } from './scriptedObjectivePlanner';
function fixture(id = 'ordinary') {
  const state = createMatch({ map: structuredClone(defaultGrifballMap()), seed: 33, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', maxHP: 50, weaponReadyTime: 0 } });
  const [actor, target, player] = state.combatants;
  actor.id = id; target.id = 'target'; player.id = state.localPlayerId = 'player';
  actor.controller = target.controller = 'ai'; player.controller = 'remote';
  actor.team = 'blue'; target.team = player.team = 'red'; actor.weapon = target.weapon = 'hammer';
  actor.pos = { x: 0, y: 0, z: -7 }; target.pos = { x: 0, y: 0, z: 7 }; player.pos = { x: 25, y: 0, z: 25 };
  state.match.phase = 'playing'; state.map.objects = []; state.map.arenaRadius = 30;
  for (const c of state.combatants) {
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 };
  }
  const initial: SimCombatPriorityMemory = { aiState: 'APPROACHING', timer: .1, cooldownMultiplier: 1,
    swayTimer: 0, coordCommitTimer: 0, pendingPostEvasionCharge: false };
  const memories = { [id]: { ...initial }, target: { ...initial } };
  const knobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5, movementComplexity: 0,
    weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 0 };
  const matchContext = createAIMatchContext(), owners = { [id]: 'normal', target: 'normal' };
  return { state, actor, target, player, memories, matchContext, knobs, owners };
}


function controlFor(f: ReturnType<typeof fixture>, random: () => number): SimGrifballActorControl {
  return { scriptedBots: f.owners, configs: Object.fromEntries(Object.keys(f.owners).map(id => [id, {
    knobs: { ...f.knobs }, derived: deriveAIParams(f.state.settings, f.knobs),
    flags: { skipPressure: false, feintBias: 1, spacingBand: 1 },
  }])), memories: f.memories, matchContext: f.matchContext, random,
    getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }), isObserverMode: true,
    navigation: {}, spawnPoints: [{ x: -12, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }] };
}
function plannerFor(c: SimGrifballActorControl): ScriptedObjectivePlanner {
  return { version: 'scripted-objective-planner-v1', scriptedBots: c.scriptedBots, plan: c.matchContext.grifballTeamPlan,
    punchControl: { version: 'scripted-carrier-punch-v1', cooldowns: Object.fromEntries(Object.keys(c.scriptedBots).map(id => [id, 0])) },
    passControl: 'scripted-pass-v1' };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60]) for (const weapon of [0, 50, 100])
  test(`composed actor chooses targets and fights from its own state ${id}/${dt}/${weapon}`, t => {
    const f = fixture(id); f.knobs.weaponPrioritization = weapon; f.knobs.weaponSwapIQ = 70; f.knobs.movementComplexity = 80;
    let run = { state: f.state, memories: f.memories, matchContext: f.matchContext, randomState: createRng(63).getState() };
    let restored = structuredClone(run);
    const caches = new WeakMap<typeof run, SimGrifballActorControl['navigation']>();
    let ground = 0, flights = 0, changedWeapon = false, frames = 0, firstDamage: number | undefined;
    const advance = (r: typeof run) => {
      const rng = createRng(0); rng.setState(r.randomState);
      const own = { ...f, ...r, actor: r.state.combatants[0], target: r.state.combatants[1], player: r.state.combatants[2] };
      const control = controlFor(own, rng.next);
      if (!caches.has(r)) caches.set(r, {});
      control.navigation = caches.get(r)!;
      const events = stepSimulation(r.state, {}, createSimGrifballActorStepOptions(r.state, control, dt));
      r.randomState = rng.getState(); return events;
    };
    for (let tick = 1; tick <= Math.ceil(25 / dt); tick++) {
      const events = advance(run), replayEvents = advance(restored);
      frames = tick;
      if (firstDamage === undefined && run.state.combatants.slice(0, 2).some(c => c.hp < 50)) firstDamage = tick;
      assert.deepEqual(replayEvents, events); assert.deepEqual(restored, run, `checkpoint continuation at ${tick}`);
      for (const record of events.actorDecisionFrame!.decisions) {
        assert.equal(record.kind, 'handled'); ground += Number(!!record.ground); flights += Number(!!record.flightTargetId);
      }
      changedWeapon ||= run.state.combatants.slice(0, 2).some(c => c.weapon === 'sword');
      if ([1, 90, 210, 600, 1000].includes(tick)) restored = structuredClone(run);
      // Keep the initial 300-frame continuation coverage, then require actual
      // damage within a bounded 25-second encounter. This is execution coverage;
      // time to first impact remains a separate quality-acceptance observation.
      if (tick >= 300 && run.state.combatants.slice(0, 2).some(c => c.hp < 50)) break;
    }
    t.diagnostic(`frames=${frames}; firstDamageSeconds=${(firstDamage ?? 0) * dt}`);
    assert.ok(ground > 0); assert.ok(run.state.combatants.slice(0, 2).some(c => c.hp < 50), 'must inflict real damage');
    assert.equal(run.matchContext.coordinator.engagements.get(id), 'target');
    const learned = [...run.matchContext.playerModels.values()];
    assert.ok(learned.some(model => model.damageDealtCount > 0), 'actual damage must update the shared opponent models');
    if (weapon === 0) assert.ok(learned.some(model => model.hammerAttacks > 0), 'ground attacks must record accepted swings');
    else assert.ok(learned.some(model => model.weaponSwaps > 0), 'accepted weapon changes must update learning');
    if (weapon === 100) { assert.ok(flights > 0, 'sword policy must actually traverse flight'); assert.ok(changedWeapon); }
  });

for (const id of ['main_ai', 'ordinary']) for (const flight of [false, true])
  test(`composed no-target recovery adopts its feedback ${id}/${flight}`, () => {
    const f = fixture(id); f.target.alive = false; f.target.hp = 0; f.target.respawnTimer = 3;
    f.memories[id].postLungeDecisionTimer = .5; f.matchContext.feintCooldowns.set(id, .7);
    if (flight) Object.assign(f.actor, { isLunging: true, lungeTargetId: 'target', lungeTimer: .2,
      lungeDir: { x: 0, y: 0, z: 1 }, lungeStartPos: { ...f.actor.pos } });
    const control = controlFor(f, () => .9), initialSway = f.memories[id].swayTimer;
    const events = stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, control));
    const record = events.actorDecisionFrame!.decisions[0];
    assert.ok(record.noTarget); assert.equal(record.kind, 'handled');
    assert.equal(f.memories[id].aiState, record.noTarget.memory.aiState); assert.equal(f.memories[id].timer, record.noTarget.memory.timer);
    assert.equal(f.memories[id].swayTimer, initialSway); assert.equal(f.matchContext.feintCooldowns.get(id), .7);
    if (flight) { assert.equal(f.actor.isLunging, false); assert.equal(f.memories[id].lastLungeOutcome, 'target_dead'); }
    else close(f.memories[id].postLungeDecisionTimer!, .5 - 1 / 60);
  });

for (const dt of [1 / 30, 1 / 60]) for (const initialState of ['COOLDOWN', 'CHARGE_ATTACK'] as const)
  test(`objective priority preserves shared reload and adaptive clocks ${dt}/${initialState}`, () => {
    const f = fixture(); f.target.pos = { x: 25, y: 0, z: 25 };
    const memory = f.memories[f.actor.id]; memory.aiState = initialState; memory.timer = .4; memory.postLungeDecisionTimer = .5;
    f.matchContext.feintCooldowns.set(f.actor.id, .9);
    const control = controlFor(f, () => .9); control.planner = plannerFor(control);
    const events = stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, control, dt));
    const record = events.actorDecisionFrame!.decisions[0];
    assert.equal(record.kind, 'objective'); assert.equal(record.objective?.kind, 'support');
    assert.equal(memory.aiState, initialState === 'COOLDOWN' ? 'COOLDOWN' : 'APPROACHING');
    close(memory.timer!, initialState === 'COOLDOWN' ? .4 - dt : 0);
    close(memory.postLungeDecisionTimer!, .5 - dt); assert.equal(f.matchContext.feintCooldowns.get(f.actor.id), .9);
    assert.equal(memory.swayTimer, 0);
  });

for (const id of ['main_ai', 'ordinary']) test(`carrier punch reload reaches combat memory ${id}`, () => {
  const f = fixture(id); f.target.pos = { x: 0, y: 0, z: -5.5 };
  f.state.match.ball.state = 'held'; f.state.match.ball.holderId = f.actor.id;
  setSimCarrier(f.actor, true, f.state.settings, f.state);
  f.actor.weaponReadyTimer = 0;
  const control = controlFor(f, () => .9); control.planner = plannerFor(control);
  const events = stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, control));
  const record = events.actorDecisionFrame!.decisions[0];
  assert.equal(record.kind, 'objective'); assert.equal(record.objective?.reason, 'punch');
  assert.equal(f.memories[id].aiState, 'COOLDOWN'); assert.ok(f.memories[id].timer! > 0, 'punch must adopt a positive reload');
  assert.equal(f.memories[id].timer, control.planner.punchControl!.cooldowns[id]);
});

test('target selection switches after its previous opponent dies', () => {
  const f = fixture(), control = controlFor(f, () => .9); control.isObserverMode = false;
  stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, control));
  assert.equal(f.matchContext.coordinator.engagements.get(f.actor.id), 'target');
  f.target.alive = false; f.target.hp = 0; f.target.respawnTimer = 3;
  stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, control));
  assert.equal(f.matchContext.coordinator.engagements.get(f.actor.id), 'player');
});

test('construction is read-only and hooks cannot be reused in a later frame', () => {
  const f = fixture(), control = controlFor(f, () => assert.fail('construction consumed randomness'));
  const before = structuredClone(f), options = createSimGrifballActorStepOptions(f.state, control);
  assert.deepEqual(f, before);
  f.state.tick++;
  assert.throws(() => options.scriptedActorDecisions!.beginTurn!({ state: f.state, actorId: f.actor.id, dt: 1 / 60, clockPhase: 'after-swap-tick' }), /own frame/);
});

for (const fault of ['missing-config', 'difficulty', 'missing-memory', 'cooldown-scale', 'planner-context', 'planner-cooldowns'])
  test(`composed owner rejects ${fault}`, () => {
    const f = fixture(), c = controlFor(f, () => .9);
    if (fault === 'missing-config') delete (c.configs as any)[f.actor.id];
    if (fault === 'difficulty') c.configs[f.actor.id].knobs.difficulty = 'hard';
    if (fault === 'missing-memory') delete c.memories[f.actor.id];
    if (fault === 'cooldown-scale') c.memories[f.actor.id].cooldownMultiplier = 2;
    if (fault.startsWith('planner')) { c.planner = plannerFor(c);
      if (fault === 'planner-context') c.planner.plan = createAIMatchContext().grifballTeamPlan;
      else delete c.planner.punchControl!.cooldowns[f.actor.id]; }
    assert.throws(() => createSimGrifballActorStepOptions(f.state, c), /configuration|share actor/);
  });

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60]) for (const motion of ['dash', 'slide'])
  test(`sequential combo lunge preempts existing ${motion} without spending its motion ${id}/${dt}`, () => {
    const f = fixture(id), control = controlFor(f, () => .9);
    f.actor.weapon = 'sword';
    if (motion === 'dash') { f.actor.dashRemaining = .2; f.actor.dashDir = { x: 1, y: 0, z: 0 }; }
    else f.actor.slideActive = true;
    const before = { ...f.actor.pos }, options = createSimGrifballActorStepOptions(f.state, control, dt);
    // Controlled actuation check; autonomous selection is covered above.
    options.scriptedActorDecisions!.resolve = () => ({ kind: 'handled', action: idleAction(),
      commandVersion: 'scripted-combat-v6', commands: [{ kind: 'lunge', targetId: f.target.id, direction: { x: 0, y: 0, z: 1 } }] });
    // Only the first actor uses this controlled command.
    const resolve = options.scriptedActorDecisions!.resolve;
    options.scriptedActorDecisions!.resolve = ctx => ctx.actorId === id ? resolve(ctx) : { kind: 'handled', action: idleAction(),
      commandVersion: 'scripted-combat-v6', commands: [] };
    stepSimulation(f.state, {}, options);
    assert.equal(f.actor.isLunging, true); assert.equal(f.actor.lungeTimer, 0);
    assert.deepEqual(f.actor.pos, before);
    assert.equal(f.actor.dashRemaining, motion === 'dash' ? .2 : 0); assert.equal(f.actor.slideActive, motion === 'slide');
  });

for (const sequential of [false, true]) for (const kind of ['emergency-hop', 'spatial-dodge'] as const)
  test(`mobility preserves the live sequential ${kind} eligibility: ${sequential}`, () => {
    const f = fixture();
    if (kind === 'emergency-hop') f.actor.slideActive = true;
    else f.actor.dashRemaining = .15;
    const command = { version: 'scripted-ai-mobility-v2' as const, kind, direction: { x: 1, z: 0 } };
    const validate = () => validateScriptedAIMobility(f.state, f.actor.id, command, idleAction(), true, false, false, sequential);
    if (sequential) assert.deepEqual(validate(), command);
    else assert.throws(validate, /uncommitted armed engagement/);
    if (kind === 'spatial-dodge') {
      f.actor.dashCooldownTimer = .1;
      assert.throws(validate, /uncommitted armed engagement/, 'a current cooldown still prevents restarting a dodge');
    }
  });

for (const id of ['main_ai', 'ordinary']) test(`airborne carrier hands off and retains possession ${id}`, () => {
  const f = fixture(id), control = controlFor(f, () => .9); control.planner = plannerFor(control);
  f.state.match.ball.state = 'held'; f.state.match.ball.holderId = id;
  setSimCarrier(f.actor, true, f.state.settings, f.state);
  f.actor.pos.y = 2; f.actor.isJumping = true;
  const events = stepSimulation(f.state, {}, createSimGrifballActorStepOptions(f.state, control));
  assert.equal(events.actorDecisionFrame!.decisions[0].kind, 'handled');
  assert.ok(f.actor.pos.y < 2, 'carrier gravity must advance');
  assert.equal(f.actor.weapon, 'ball'); assert.equal(f.state.match.ball.holderId, id);
});
