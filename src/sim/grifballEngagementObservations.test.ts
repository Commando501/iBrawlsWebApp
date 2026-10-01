import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize } from 'node:v8';
import { createMatch } from './factory';
import { createAIMatchContext } from '../game/aiMatchContext';
import { getPlayerModelSnapshot, observePlayerDamageDealt } from '../game/aiPlayerModel';
import { recordSimGrifballEngagementObservations } from './grifballEngagementObservations';
import { resolveSimGrifballCombatObservation } from './grifballCombatObservation';
import { recordAIEngagementApproachObservations } from '../components/grifball/playerModelObservations';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { stepSimulation } from './step';
import { idleAction } from './actions';

function fixture(distance = 10, local = true) {
  const state = createMatch({ seed: 83, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', speedForward: 100 } });
  const [bot, other, player] = state.combatants;
  bot.id = 'ordinary'; other.id = 'main_ai'; bot.controller = other.controller = 'ai';
  player.id = state.localPlayerId = 'player'; player.controller = 'remote';
  bot.team = 'blue'; other.team = local ? 'blue' : 'red'; player.team = 'red'; state.match.phase = 'playing';
  bot.pos = { x: 3, y: 0, z: 4 }; bot.vel = { x: 3, y: 0, z: 4 };
  other.pos = { x: 3, y: 0, z: 4 + distance }; player.pos = { ...other.pos }; player.vel = { x: 6, y: 0, z: 8 };
  for (const c of state.combatants) c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
  const owners = { ordinary: 'normal', main_ai: 'normal' };
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 0, playstyleFactor: .5 };
  const observation = resolveSimGrifballCombatObservation(state, bot.id, local ? player.id : other.id, owners, tuning)!;
  const matchContext = createAIMatchContext();
  return { state, bot, other, player, owners, tuning, observation, matchContext };
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

for (const distance of [14.999, 15, 15.001]) for (const nowSeconds of [.249, .25, .5])
  for (const local of [false, true]) for (const isObserverMode of [false, true])
    test(`live/headless sample ownership and boundaries ${distance}/${nowSeconds}/${local}/${isObserverMode}`, () => {
      const f = fixture(distance, local), before = structuredClone(f.state);
      const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: f.state.settings,
        multiplayerRole: null, isMultiplayer: false });
      live.aiMatchContext = createAIMatchContext(); live.isObserverMode = isObserverMode; live.arenaRadius = f.state.map.arenaRadius;
      live.playerPos.set(f.player.pos.x, 0, f.player.pos.z); live.playerVel.set(6, 0, 8);
      recordAIEngagementApproachObservations({ state: live, botId: f.bot.id, botPos: f.bot.pos, botVel: f.bot.vel,
        targetId: f.observation.targetId, distanceToTarget: f.observation.prediction.distanceToTarget,
        nowSeconds, mapShape: f.state.map.mapShape });
      assert.equal(recordSimGrifballEngagementObservations(f.state, f.bot.id, f.owners, f.observation,
        { matchContext: f.matchContext, nowSeconds, isObserverMode }), true);
      assert.deepEqual(f.matchContext.playerModels, live.aiMatchContext.playerModels); assert.deepEqual(f.state, before);
      const model = f.matchContext.playerModels.get(f.bot.id)!;
      const speedSample = f.observation.prediction.distanceToTarget < 15;
      assert.equal(model.sampleCount, Number(nowSeconds >= .25) + Number(speedSample));
      assert.equal(f.matchContext.playerModels.has('player'), local && !isObserverMode);
      assert.equal(f.matchContext.playerModels.has('main_ai'), false, 'AI target samples itself on its own turn');
      const alpha = resolveBehaviorTuning(f.state.settings).playerModelEmaAlpha;
      close(model.approachSpeed, .5 + (speedSample ? alpha * .5 : 0));
      assert.equal(model.lastPositionSampleTime, nowSeconds >= .25 ? nowSeconds : 0);
    });

test('retained distance gates speed sampling while position comes from the current turn', () => {
  const f = fixture(); f.bot.pos.x = 12; f.player.pos.z = 100;
  recordSimGrifballEngagementObservations(f.state, f.bot.id, f.owners, f.observation,
    { matchContext: f.matchContext, nowSeconds: .5, isObserverMode: false });
  const model = f.matchContext.playerModels.get('ordinary')!;
  assert.equal(model.sampleCount, 2); assert.equal(f.matchContext.playerModels.get('player')!.sampleCount, 2);
  const expected = createAIMatchContext();
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: f.state.settings, multiplayerRole: null, isMultiplayer: false });
  live.aiMatchContext = expected; live.arenaRadius = f.state.map.arenaRadius; live.isObserverMode = true;
  recordAIEngagementApproachObservations({ state: live, botId: f.bot.id, botPos: f.bot.pos, botVel: f.bot.vel,
    targetId: 'other', distanceToTarget: 10, nowSeconds: .5, mapShape: f.state.map.mapShape });
  assert.deepEqual(model, expected.playerModels.get('ordinary'));
  observePlayerDamageDealt(model); assert.equal(f.matchContext.playerModels.get('ordinary')!.damageDealtCount, 1);
  assert.ok(getPlayerModelSnapshot(f.matchContext, 'ordinary'), 'sampling and combat feedback share confidence');
});

for (const defect of ['time', 'observer', 'models', 'stale', 'actor', 'dead', 'carrier'] as const)
  test(`invalid or ineligible sample ${defect} has no model effects`, () => {
    const f = fixture(), context = { matchContext: f.matchContext, nowSeconds: .5, isObserverMode: false };
    if (defect === 'time') context.nowSeconds = NaN;
    if (defect === 'observer') context.isObserverMode = 1 as never;
    if (defect === 'models') context.matchContext.playerModels = {} as never;
    if (defect === 'stale') f.observation.tick++;
    if (defect === 'actor') f.observation.actorId = 'other';
    if (defect === 'dead') f.bot.alive = false;
    if (defect === 'carrier') f.bot.hasBall = true;
    const before = structuredClone(context.matchContext);
    const run = () => recordSimGrifballEngagementObservations(f.state, f.bot.id, f.owners, f.observation, context);
    if (defect === 'dead' || defect === 'carrier') assert.equal(run(), false);
    else assert.throws(run);
    assert.deepEqual(context.matchContext, before);
  });

for (const reverse of [false, true]) for (const dt of [1 / 60, 1 / 30])
  test(`scheduled samples are visible to later consumers and survive restoration ${reverse}/${dt}`, () => {
    const f = fixture(8); if (reverse) f.state.combatants.splice(0, 2, f.other, f.bot);
    let restoredState = structuredClone(f.state), restoredContext = createAIMatchContext();
    const checkpoint = <T>(x: T): T => deserialize(serialize(x));
    const advance = (state: typeof f.state, matchContext: typeof f.matchContext, nowSeconds: number) => {
      let localSpeedSamples = 0;
      const before = matchContext.playerModels.get('player')?.sampleCount ?? 0;
      const events = stepSimulation(state, {}, { settings: state.settings, dt, scriptedActorDecisions: {
        version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
        prepare: () => 'engagement',
        resolve: ({ state: current, actorId }) => {
          const observation = resolveSimGrifballCombatObservation(current, actorId, 'player', f.owners, f.tuning, dt)!;
          if (observation.prediction.distanceToTarget < 15) localSpeedSamples++;
          recordSimGrifballEngagementObservations(current, actorId, f.owners, observation,
            { matchContext, nowSeconds, isObserverMode: false }, dt);
          assert.ok(matchContext.playerModels.has(actorId), 'model must exist before feint/combo consumers');
          if (nowSeconds >= .25) assert.ok(getPlayerModelSnapshot(matchContext, 'player'), 'later consumers see accumulated samples');
          return { kind: 'handled', action: idleAction() };
        },
      } });
      const after = matchContext.playerModels.get('player')!.sampleCount;
      assert.ok(after - before === localSpeedSamples || after - before === localSpeedSamples + 1,
        'position is throttled across both observers; speed samples each engagement');
      return events;
    };
    for (let tick = 1; tick <= 90; tick++) {
      assert.deepEqual(advance(f.state, f.matchContext, tick * dt), advance(restoredState, restoredContext, tick * dt));
      assert.deepEqual(f.state, restoredState); assert.deepEqual(f.matchContext, restoredContext);
      if ([1, 20, 45].includes(tick)) { restoredState = checkpoint(restoredState); restoredContext = checkpoint(restoredContext); }
    }
  });
