import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, deserialize } from 'node:v8';
import { beginAICoordinationFrame, publishGrifballTacticalEngagements } from '../game/aiCoordinationFrame';
import { createBotCoordinator, notifyBotDamageTag, registerBotEngagement, setTacticalBotEngagements,
  getBotCoordRole, shouldDeferCoordinatedAttack } from '../game/aiBotCoordinator';
import { createGrifballTeamPlanState, type GrifballAssignment, type GrifballTacticalPlayer } from '../game/aiGrifballTeamPlan';
import { createMatch } from './factory';
import { stepSimulation } from './step';
import { idleAction } from './actions';
import { defaultGrifballTactics } from '../game/grifballTacticsConfig';
import { tickGrifballObjective, reconcileSimCarrier } from './grifball';
import { validateScriptedCoordination, type ScriptedCoordination } from './scriptedCoordination';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const checkpoint = <T>(x: T): T => deserialize(serialize(x));

for (const dt of [1 / 60, 1 / 30]) for (const remaining of [0, .5, 1, 1.5])
  test(`frame clock expires inclusively and restores tactical engagements ${dt}/${remaining}`, () => {
    const c = createBotCoordinator(); notifyBotDamageTag(c, 'bot', 'target', remaining * dt);
    c.priorityAge = 2 - remaining * dt;
    setTacticalBotEngagements(c, [['bot', { targetId: 'tactical', role: 'pressure' }]]);
    registerBotEngagement(c, 'temporary', 'last-frame');
    beginAICoordinationFrame(c, dt, 2);
    assert.equal(c.priorityTargetId, remaining <= 1 ? undefined : 'target');
    if (remaining <= 1) { assert.equal(c.priorityAge, 0); assert.equal(c.recentTags.size, 0); }
    else { close(c.priorityAge, 2 - .5 * dt); close(c.recentTags.get('target')!.get('bot')!, .5 * dt); }
    assert.deepEqual([...c.engagements], [['bot', 'tactical']]);
  });

function assignment(botId: string, punish: boolean): GrifballAssignment {
  return { botId, team: 'blue', role: 'lead', slot: 0, destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 },
    carrierId: null, reason: 'test', tanking: { mode: punish ? 'punish' : 'engage', targetId: 'target',
      partnerId: null, recoveryId: null, attack: true, doubleCommit: false, reason: 'test', candidates: [] } };
}
test('publication selects only committed tactical threats and assigns attack phases', () => {
  const c = createBotCoordinator(), plan = createGrifballTeamPlanState();
  const players: GrifballTacticalPlayer[] = ['pressure', 'flanker', 'cover', 'ordinary', 'target'].map(id => ({
    id, team: id === 'target' ? 'red' : 'blue', pos: { x: id === 'target' ? 1 : 0, z: 0 }, vel: { x: 0, z: 0 }, scripted: true }));
  for (const id of ['pressure', 'flanker', 'cover', 'ordinary', 'missing']) plan.assignments.set(id, assignment(id, id === 'flanker'));
  plan.assignments.get('cover')!.tanking!.attack = false;
  delete plan.assignments.get('ordinary')!.tanking;
  setTacticalBotEngagements(c, [['old', { targetId: 'old-target', role: 'punisher' }]]);
  publishGrifballTacticalEngagements(c, plan, players);
  assert.deepEqual([...c.tacticalEngagements], [['pressure', { targetId: 'target', role: 'pressure' }], ['flanker', { targetId: 'target', role: 'flanker' }]]);
  assert.deepEqual([...c.engagements], [['pressure', 'target'], ['flanker', 'target']]);
  const input = { coordinator: c, botId: 'flanker', targetId: 'target', difficulty: 'normal', commitTimer: 0, allyAttacking: false };
  assert.equal(getBotCoordRole(input), 'flanker'); assert.equal(shouldDeferCoordinatedAttack(input), true);
  assert.equal(shouldDeferCoordinatedAttack({ ...input, commitTimer: .38 }), false);
  publishGrifballTacticalEngagements(c, createGrifballTeamPlanState(), players);
  assert.equal(c.engagements.size, 0); assert.equal(c.tacticalEngagements.size, 0);
});

function fixture() {
  const state = createMatch({ seed: 72, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal' } });
  const [first, second, player] = state.combatants;
  first.id = 'ordinary'; second.id = 'main_ai'; first.controller = second.controller = 'ai'; first.team = second.team = 'blue';
  player.id = state.localPlayerId = 'player'; player.controller = 'remote'; player.team = 'red';
  state.match.phase = 'playing'; player.hasBall = true; player.weapon = 'ball';
  state.match.ball.state = 'held'; state.match.ball.holderId = player.id;
  first.pos = { x: -3, y: 0, z: 0 }; second.pos = { x: -4, y: 0, z: 2 }; player.pos = { x: 0, y: 0, z: 0 };
  for (const c of state.combatants) c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
  const plan = createGrifballTeamPlanState(), coordinator = createBotCoordinator();
  notifyBotDamageTag(coordinator, 'ordinary', 'player', 6); coordinator.priorityAge = 1;
  coordinator.engagements.set('stale', 'last-frame');
  const owners = { ordinary: 'normal', main_ai: 'normal' };
  const control: ScriptedCoordination = { version: 'scripted-coordination-v1', coordinator };
  return { state, first, second, player, plan, coordinator, control, owners };
}

for (const reverse of [false, true]) for (const dt of [1 / 60, 1 / 30])
  test(`scheduled coordinator publishes before actors and restores exactly ${reverse}/${dt}`, () => {
    const f = fixture(); if (reverse) f.state.combatants.splice(0, 2, f.second, f.first);
    let restored = checkpoint({ state: f.state, plan: f.plan, coordinator: f.coordinator });
    const advance = (host: typeof restored, tick: number) => {
      const calls: string[] = [];
      return stepSimulation(host.state, {}, { settings: host.state.settings, dt,
        scriptedCoordination: { version: 'scripted-coordination-v1', coordinator: host.coordinator },
        scriptedPlanner: { version: 'scripted-objective-planner-v1', scriptedBots: f.owners, plan: host.plan },
        scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
          beginTurn: ({ actorId }) => {
            close(host.coordinator.priorityAge, tick === 1 ? 1 + dt : dt);
            close(host.coordinator.recentTags.get('player')!.get('ordinary')!, 6 - tick * dt);
            assert.equal(host.coordinator.engagements.has('stale'), false);
            assert.ok(host.coordinator.tacticalEngagements.size > 0, 'fresh team engagement must exist before first actor');
            if (calls.length) assert.equal(host.coordinator.engagements.get('in-turn'), 'visible');
            else assert.equal(host.coordinator.engagements.has('in-turn'), false, 'last frame registration must clear');
            calls.push(actorId); registerBotEngagement(host.coordinator, 'in-turn', 'visible');
          }, resolve: () => ({ kind: 'handled', action: idleAction() }),
        } });
    };
    for (let tick = 1; tick <= 90; tick++) {
      const host = { state: f.state, plan: f.plan, coordinator: f.coordinator };
      assert.deepEqual(advance(host, tick), advance(restored, tick)); assert.deepEqual(host, restored);
      if ([1, 20, 45].includes(tick)) restored = checkpoint(restored);
    }
  });

for (const phase of ['countdown', 'scored', 'matchEnd'] as const)
  test(`advancing game frame ticks coordinator during inactive Grifball ${phase}`, () => {
    const f = fixture(); f.state.match.phase = phase; f.state.match.phaseTimer = 0;
    setTacticalBotEngagements(f.coordinator, [['old', { targetId: 'old-target', role: 'pressure' }]]);
    stepSimulation(f.state, {}, { settings: f.state.settings, scriptedCoordination: f.control,
      scriptedPlanner: { version: 'scripted-objective-planner-v1', scriptedBots: f.owners, plan: f.plan },
      scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
        beginTurn: () => assert.fail('inactive actor'), resolve: () => assert.fail('inactive actor') } });
    close(f.coordinator.priorityAge, 0); assert.equal(f.coordinator.tacticalEngagements.size, 0);
    assert.equal(f.coordinator.engagements.size, 0);
  });

test('effective TTL and newly revived actors see coordinator state at the same boundary', () => {
  const f = fixture(); f.first.alive = false; f.first.hp = 0; f.first.respawnTimer = 1 / 120;
  let revived = false;
  stepSimulation(f.state, {}, { settings: { ...f.state.settings, aiTunePriorityTargetTtl: .5 }, scriptedCoordination: f.control,
    scriptedPlanner: { version: 'scripted-objective-planner-v1', scriptedBots: f.owners, plan: f.plan },
    scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
      beginTurn: ({ state, actorId }) => { assert.equal(f.coordinator.priorityTargetId, undefined);
        if (actorId === 'ordinary') revived = state.combatants.find(c => c.id === actorId)!.alive; },
      resolve: () => ({ kind: 'handled', action: idleAction() }) } });
  assert.equal(revived, true); assert.equal(f.coordinator.priorityAge, 0);
});

for (const defect of ['version', 'profile', 'planner', 'dt', 'age', 'tags', 'tag-time', 'orders', 'feedback'] as const)
  test(`invalid coordinator ${defect} rejects before frame mutation`, () => {
    const f = fixture(); let planner = true, dt = 1 / 60;
    if (defect === 'version') f.control.version = 'bad' as never;
    if (defect === 'profile') f.state.combatExecution = 'live-roster-v2';
    if (defect === 'planner') planner = false;
    if (defect === 'dt') dt = 0;
    if (defect === 'age') f.coordinator.priorityAge = Infinity;
    if (defect === 'tags') f.coordinator.recentTags = {} as never;
    if (defect === 'tag-time') f.coordinator.recentTags.get('player')!.set('ordinary', NaN);
    if (defect === 'orders') f.coordinator.tacticalEngagements.set('bad', { targetId: 'player', role: 'bad' as never });
    const before = structuredClone({ state: f.state, coordinator: f.coordinator });
    assert.throws(() => validateScriptedCoordination(f.state, f.control, planner,
      defect === 'feedback' ? createBotCoordinator() : f.coordinator, dt));
    assert.deepEqual({ state: f.state, coordinator: f.coordinator }, before);
  });

test('step validates a coordinator conflict before local movement', () => {
  const f = fixture(), before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, { player: { ...idleAction(), moveX: 1 } }, {
    settings: f.state.settings, scriptedCoordination: f.control,
    scriptedPlanner: { version: 'scripted-objective-planner-v1', scriptedBots: f.owners, plan: f.plan },
    scriptedLungeFeedback: { coordinator: createBotCoordinator() } as never,
  }), /share coordinator/);
  assert.deepEqual(f.state, before);
});

test('objective focus follows possession at the pre-pickup boundary and resets its age', () => {
  const state = createMatch({ seed: 9, combatExecution: 'live-mixed-v1' });
  const carrier = state.combatants[1], coordinator = createBotCoordinator();
  state.match.phase = 'playing'; state.match.ball.pos = { ...carrier.pos };
  carrier.invulnerabilityTimer = 0;
  coordinator.priorityTargetId = 'old'; coordinator.priorityAge = 7;
  const pickup = tickGrifballObjective(state, state.settings, 1 / 60, { [carrier.id]: { ...idleAction(), pickup: true } }, undefined, coordinator);
  assert.equal(pickup.pickup, carrier.id);
  assert.equal(coordinator.priorityTargetId, undefined, 'pickup is observed by the following objective frame');
  assert.equal(coordinator.priorityAge, 0);
  tickGrifballObjective(state, state.settings, 1 / 60, {}, undefined, coordinator);
  assert.equal(coordinator.priorityTargetId, carrier.id);
  coordinator.priorityAge = 7;
  tickGrifballObjective(state, state.settings, 1 / 60, {}, undefined, coordinator);
  assert.equal(coordinator.priorityAge, 0, 'possession continually refreshes combat focus');
});

test('round reset clears objective combat focus before fresh pickup', () => {
  const state = createMatch({ seed: 9, combatExecution: 'live-mixed-v1' }), coordinator = createBotCoordinator();
  state.match.phase = 'scored'; state.match.phaseTimer = state.settings.grifballRoundResetDelay!;
  state.match.ball.state = 'held'; state.match.ball.holderId = state.combatants[1].id;
  coordinator.priorityTargetId = state.match.ball.holderId; coordinator.priorityAge = 2;
  const event = tickGrifballObjective(state, state.settings, 1 / 60, {}, undefined, coordinator);
  assert.equal(event.roundReset, true); assert.equal(coordinator.priorityTargetId, undefined); assert.equal(coordinator.priorityAge, 0);
});

for (const matchingFocus of [false, true]) test(`late carrier death invalidates carrier plans and only its focus ${matchingFocus}`, () => {
  const f = fixture(), holder = f.state.combatants.find(c => c.id === 'player')!;
  const planner = { version: 'scripted-objective-planner-v1' as const, scriptedBots: f.owners,
    tactics: defaultGrifballTactics(), plan: f.plan };
  // Fixture ownership is explicit; no planner tick is needed to test late reconciliation.
  const carrierOrder = assignment('ordinary', false); carrierOrder.carrierId = holder.id;
  f.plan.assignments.set('ordinary', carrierOrder); f.plan.assignments.set('unrelated', assignment('unrelated', false));
  f.plan.signature = 'stale'; f.plan.untilRefresh = 2; f.plan.teamRefresh = { blue: 2 };
  f.coordinator.priorityTargetId = matchingFocus ? holder.id : 'other'; f.coordinator.priorityAge = 3;
  holder.hp = 0; holder.alive = false;
  assert.equal(reconcileSimCarrier(f.state, f.state.settings, planner, f.coordinator), true);
  assert.equal(f.state.match.ball.holderId, null); assert.equal(holder.hasBall, false);
  assert.equal(f.coordinator.priorityTargetId, matchingFocus ? undefined : 'other');
  assert.equal(f.coordinator.priorityAge, matchingFocus ? 0 : 3);
  assert.equal(f.plan.assignments.has('ordinary'), false); assert.equal(f.plan.assignments.has('unrelated'), true);
  assert.equal(f.plan.signature, ''); assert.equal(f.plan.untilRefresh, 0); assert.deepEqual(f.plan.teamRefresh, {});
});
