import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize } from 'node:v8';
import { createMatch } from './factory';
import { resolveSimGrifballAdaptiveTuning, type SimAdaptiveTuningOwner } from './grifballAdaptiveTuning';
import { resolveAICombatTuningPreludeForCombatant } from '../components/grifball/aiCombatTuningPreludeRuntime';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { createAIMatchContext } from '../game/aiMatchContext';
import { notifyBotKill } from '../game/aiPsychologicalPressure';
import { resolveSimGrifballCombatObservation } from './grifballCombatObservation';
import { stepSimulation } from './step';
import { idleAction } from './actions';
import type { ScriptedActorDecisionOwner } from './scriptedActorDecision';

function fixture(difficulty = 'normal') {
  const state = createMatch({ seed: 57, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal' } });
  const [first, second, player] = state.combatants;
  first.id = 'ordinary'; second.id = 'main_ai'; first.controller = second.controller = 'ai';
  second.team = first.team === 'red' ? 'blue' : 'red';
  state.localPlayerId = player.id = 'player'; player.controller = 'remote'; state.match.phase = 'playing';
  for (const [i, c] of state.combatants.entries()) {
    c.pos = { x: -15 + i * 15, y: 0, z: 10 }; c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
  }
  const owner: SimAdaptiveTuningOwner = { matchContext: createAIMatchContext(), memory: { postLungeDecisionTimer: .1 },
    knobs: { difficulty, reactionLatency: .2, anticipationFactor: .4, movementComplexity: 80,
      weaponSwapIQ: 80, aiPlaystyle: 50, weaponPrioritization: 50 },
    derived: { spatialIQ: 70, feintChance: 20, pressureAggression: 50, mechanicAware: true },
    flags: { skipPressure: false, feintBias: 1, spacingBand: 1 }, score: { scorePlayer: 0, scoreEnemy: 0 } };
  const owners = { ordinary: difficulty, main_ai: difficulty };
  return { state, first, second, owner, owners, run: (dt = 1 / 60) => resolveSimGrifballAdaptiveTuning(state, first.id, owners, owner, dt) };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
// Caller persistence must preserve Maps and planner Infinity sentinels. This
// test uses binary serialization; bare JSON is not an AIMatchContext codec.
const checkpoint = <T>(value: T): T => deserialize(serialize(value));

for (const difficulty of ['easy', 'normal', 'hard', 'custom']) for (const lead of [-6, 0, 6]) for (const dt of [1 / 60, 1 / 30])
  test(`adaptive prelude matches live with shared memory ${difficulty}/${lead}/${dt}`, () => {
    const f = fixture(difficulty); f.owner.score = { scorePlayer: Math.max(0, -lead), scoreEnemy: Math.max(0, lead) };
    const reference = structuredClone(f.owner), physical = structuredClone(f.state);
    const self = { aiPostLungeDecisionTimer: reference.memory.postLungeDecisionTimer };
    const expected = resolveAICombatTuningPreludeForCombatant({ state: { settings: f.state.settings, aiMatchContext: reference.matchContext },
      self, botId: f.first.id, dt, tuning: resolveBehaviorTuning(f.state.settings), resolveBotKnobs: () => reference.knobs,
      resolveBotDerived: () => reference.derived, resolveBotFlags: () => reference.flags, getMatchScoreContext: () => reference.score });
    const result = f.run(dt)!;
    assert.deepEqual(result, expected); assert.deepEqual(f.owner.matchContext, reference.matchContext);
    close(f.owner.memory.postLungeDecisionTimer!, .1 - dt); assert.deepEqual(f.state, physical);
    assert.equal(result.psychState, f.owner.matchContext.psychState.get(f.first.id));
    assert.equal(result.calibrationEnabled, difficulty === 'normal' || difficulty === 'hard');
    assert.equal(result.effectivePressureAggression, lead === -6 ? 64 : lead === 6 ? 36 : 50);
    close(result.effectiveReactionLatency, difficulty === 'easy' ? .2 : .124);
    close(result.psychState.tempoTimer, 4.5 - dt);
  });

test('calibration, tempo flip and expired kill pressure affect the same turn', () => {
  const f = fixture();
  f.owner.matchContext.skillCalibration.set(f.first.id, { snapshots: [{ botKill: 0, botDeath: 10,
    dodgeAttempts: 0, dodgeSuccesses: 0, counterAttempts: 0, counterSuccesses: 0 }] });
  f.owner.matchContext.psychState.set(f.first.id, { tempoPhase: 'fast', tempoTimer: .01, standoffTimer: 2,
    postKill: { victimId: 'victim', spawnX: 1, spawnZ: 2, timerRemaining: .01, lungeKill: true } });
  const result = f.run()!;
  const magnitude = (1 - .5 / 10.5) * .35 * .125;
  close(result.tunedReactionLatency, .2 * (1 - magnitude)); close(result.tunedAnticipationFactor, .4 * (1 + magnitude));
  close(result.effectiveReactionLatency, result.tunedReactionLatency * 1.38);
  assert.equal(result.psychState.tempoPhase, 'slow'); assert.equal(result.psychState.tempoTimer, 9);
  assert.equal(result.postKillPressure, undefined); assert.equal(result.psychState.standoffTimer, 2);
  notifyBotKill(result.psychState, { victimId: 'next', spawnX: 0, spawnZ: 0, lungeKill: false });
  assert.equal(f.owner.matchContext.psychState.get(f.first.id)!.postKill!.victimId, 'next');
  const next = f.run()!; assert.equal(next.postKillPressure, next.psychState.postKill);
  close(next.postKillPressure!.timerRemaining, 2.75 - 1 / 60);
});

test('disabled psychology still ticks; unrelated memory and absent lunge clock stay untouched', () => {
  const f = fixture('easy'); f.owner.memory = {};
  f.owner.matchContext.feintCooldowns.set('ordinary', 2);
  f.owner.matchContext.coordinator.recentTags.set('target', new Map([['ordinary', 3]]));
  const untouched = structuredClone({ feints: f.owner.matchContext.feintCooldowns, coordinator: f.owner.matchContext.coordinator });
  const result = f.run()!;
  assert.equal(result.psychEnabled, false); close(result.psychState.tempoTimer, 4.5 - 1 / 60);
  assert.deepEqual(f.owner.memory, {}); assert.equal(f.owner.matchContext.skillCalibration.size, 0);
  assert.deepEqual({ feints: f.owner.matchContext.feintCooldowns, coordinator: f.owner.matchContext.coordinator }, untouched);
});

for (const kind of ['dead', 'respawn', 'paused', 'local', 'remote', 'unowned', 'neural', 'duplicate'] as const)
  test(`inactive or unowned ${kind} leaves adaptive memory untouched`, () => {
    const f = fixture();
    if (kind === 'dead') f.first.alive = false;
    if (kind === 'respawn') f.first.respawnTimer = 1;
    if (kind === 'paused') f.state.match.phase = 'countdown';
    if (kind === 'local') f.state.localPlayerId = f.first.id;
    if (kind === 'remote') f.first.controller = 'remote';
    if (kind === 'unowned') delete (f.owners as Record<string, string>).ordinary;
    if (kind === 'neural') f.owners.ordinary = 'neural-net';
    if (kind === 'duplicate') f.state.combatants.push(structuredClone(f.first));
    const before = structuredClone(f.owner); assert.equal(f.run(), null); assert.deepEqual(f.owner, before);
  });
for (const kind of ['timer', 'knob', 'difficulty', 'score', 'context', 'dt'] as const)
  test(`invalid adaptive ${kind} rejects before mutation`, () => {
    const f = fixture();
    if (kind === 'timer') f.owner.memory.postLungeDecisionTimer = NaN;
    if (kind === 'knob') f.owner.knobs.reactionLatency = Infinity;
    if (kind === 'difficulty') f.owner.knobs.difficulty = 'easy';
    if (kind === 'score') f.owner.score.killsToWin = 0;
    if (kind === 'context') f.owner.matchContext.psychState = {} as never;
    const before = structuredClone(f.owner);
    assert.throws(() => f.run(kind === 'dt' ? 0 : undefined), /adaptive|Adaptive/); assert.deepEqual(f.owner, before);
  });

for (const reverse of [false, true]) for (const dt of [1 / 60, 1 / 30]) for (const objective of [false, true])
  test(`scheduled tuning survives persistence and objective handoff ${reverse}/${dt}/${objective}`, () => {
    const f = fixture(); if (reverse) f.state.combatants.splice(0, 2, f.second, f.first);
    let replayState = checkpoint(f.state);
    const memories = { ordinary: { postLungeDecisionTimer: .1 }, main_ai: { postLungeDecisionTimer: .2 } };
    let replayMemory = checkpoint(memories), replayContext = checkpoint(f.owner.matchContext);
    let objectiveTurns = 0;
    const advance = (state: typeof f.state, memory: typeof memories, context: typeof f.owner.matchContext) => {
      const calls: string[] = [];
      const tuned = new Map<string, NonNullable<ReturnType<typeof f.run>>>();
      const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
        beginTurn: ({ state: current, actorId, clockPhase }) => {
          assert.equal(clockPhase, 'after-swap-tick'); calls.push(actorId);
          const before = memory[actorId as keyof typeof memory].postLungeDecisionTimer;
          const result = resolveSimGrifballAdaptiveTuning(current, actorId, f.owners,
            { ...f.owner, matchContext: context, memory: memory[actorId as keyof typeof memory] }, dt)!;
          close(memory[actorId as keyof typeof memory].postLungeDecisionTimer, Math.max(0, before - dt)); tuned.set(actorId, result);
          if (calls.length === 2) assert.ok(context.psychState.has(calls[0]));
        },
        resolve: ({ state: current, actorId }) => {
          const result = tuned.get(actorId); if (!result) throw new Error('Missing begin-turn adaptive tuning');
          const observation = resolveSimGrifballCombatObservation(current, actorId,
            actorId === 'ordinary' ? 'main_ai' : 'ordinary', f.owners, result, dt)!;
          if (current.combatants.find(c => c.id === actorId)!.hasBall) assert.equal(observation, null);
          else assert.ok(observation);
          assert.equal(result.psychState, context.psychState.get(actorId));
          return { kind: 'handled', action: idleAction() };
        } };
      const events = stepSimulation(state, {}, { settings: state.settings, dt, scriptedActorDecisions: owner,
        ...(objective ? { scriptedPlanner: { version: 'scripted-objective-planner-v1' as const,
          scriptedBots: f.owners, plan: context.grifballTeamPlan } } : {}) });
      assert.deepEqual(calls, state.combatants.filter(c => c.id !== state.localPlayerId).map(c => c.id));
      objectiveTurns += events.actorDecisionFrame!.decisions.filter(d => d.kind === 'objective').length;
      return events;
    };
    for (let tick = 0; tick < 120; tick++) {
      assert.deepEqual(advance(f.state, memories, f.owner.matchContext), advance(replayState, replayMemory, replayContext));
      assert.deepEqual(f.state, replayState); assert.deepEqual(memories, replayMemory); assert.deepEqual(f.owner.matchContext, replayContext);
      if ([0, 5, 60].includes(tick)) {
        replayState = checkpoint(replayState); replayMemory = checkpoint(replayMemory); replayContext = checkpoint(replayContext);
      }
    }
    if (objective) assert.ok(objectiveTurns > 0, 'must exercise turns that bypass combat resolution');
  });

test('begin-turn validation and inactive suppression precede caller memory effects', () => {
  const f = fixture(), before = structuredClone(f.state);
  const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
    beginTurn: 1 as never, resolve: () => assert.fail('invalid callback') };
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: owner }), /begin-turn/);
  assert.deepEqual(f.state, before);
  owner.beginTurn = () => assert.fail('inactive turn'); f.state.match.phase = 'countdown'; f.state.match.phaseTimer = 0;
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: owner });
});

for (const kind of ['carrier', 'flight', 'no-target'] as const) test(`prelude still owns ${kind} turns before selection`, () => {
  const f = fixture();
  if (kind === 'carrier') { f.first.weapon = 'ball'; f.first.hasBall = true; f.state.match.ball.holderId = f.first.id; }
  if (kind === 'flight') f.first.isLunging = true;
  if (kind === 'no-target') { f.second.alive = false; f.state.combatants[2].alive = false; }
  f.owner.memory.postLungeDecisionTimer = .001;
  assert.ok(f.run()); assert.equal(f.owner.memory.postLungeDecisionTimer, 0);
});

test('begin-turn uses effective settings after physical clocks and before preparation', () => {
  const f = fixture(), settings = { ...f.state.settings, aiTuneTempoCycleDuration: 2 };
  let calls = 0; const dt = 1 / 60;
  f.first.weaponReadyTimer = f.first.swapLockoutTimer = dt / 2;
  const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: { ordinary: 'normal' },
    beginTurn: ({ state, actorId }) => {
      calls++; assert.equal(state.settings, settings);
      assert.equal(f.first.weaponReadyTimer, 0); assert.equal(f.first.swapLockoutTimer, 0);
      const result = resolveSimGrifballAdaptiveTuning(state, actorId, f.owners, f.owner, dt)!;
      close(result.psychState.tempoTimer, 1 - dt);
    }, prepare: () => { assert.equal(calls, 1); close(f.owner.memory.postLungeDecisionTimer!, .1 - dt); return 'default'; },
    resolve: () => ({ kind: 'handled', action: idleAction() }) };
  stepSimulation(f.state, {}, { settings, dt, scriptedActorDecisions: owner }); assert.equal(calls, 1);
});
