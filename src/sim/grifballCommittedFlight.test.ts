import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createAIMatchContext } from '../game/aiMatchContext';
import { resolveSimGrifballCombatObservation, retainSimGrifballCombatObservation } from './grifballCombatObservation';
import { resolveSimGrifballCombatPriorities, type SimCombatPriorityMemory } from './grifballCombatPriorities';
import { stepSimulation, type StepOptions } from './step';
import { idleAction } from './actions';
import { createRng } from './rng';
import { validateScriptedActorDecision, type ScriptedActorDecision } from './scriptedActorDecision';
import { stepCombatantWeapons } from './weapons';
import { finishAIHorizontalMotion } from '../game/aiDashMotion';
import { createBotParityFixture } from '../../scripts/sim/grifballBotExecutionParity';
import { attachLungeRuntime } from '../../scripts/sim/grifballLungeFixture';
function fixture(id = 'ordinary') {
  const state = createMatch({ seed: 8, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 },
    settings: { aiDifficulty: 'normal', maxHP: 20, weaponReadyTime: 0, weaponSwapLockout: .4 } });
  const [actor, target, player] = state.combatants;
  actor.id = id; target.id = 'target'; player.id = state.localPlayerId = 'player';
  actor.controller = target.controller = 'ai'; player.controller = 'remote';
  actor.team = 'blue'; target.team = player.team = 'red'; actor.weapon = 'sword';
  actor.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 2 }; player.pos = { x: 30, y: 0, z: 30 };
  for (const c of state.combatants) {
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.vel = { x: 0, y: 0, z: 0 };
  }
  state.match.phase = 'playing';
  const memory: SimCombatPriorityMemory = { aiState: 'APPROACHING', timer: .3, cooldownMultiplier: 1,
    swayTimer: .4, coordCommitTimer: 0, pendingPostEvasionCharge: false };
  const memories = { [id]: { ...memory }, target: { ...memory } }, owners = { [id]: 'normal' };
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
    playstyleFactor: .5, weaponSwapIQ: 0, weaponPrioritization: 100, pressureAggression: 50, spacingFactor: 1 };
  const matchContext = createAIMatchContext();
  return { state, actor, target, player, memories, owners, tuning, matchContext };
}

function flightFixture(id = 'ordinary') {
  const f = fixture(id);
  f.target.pos = { x: 8, y: 0, z: 12 };
  Object.assign(f.actor, { isLunging: true, lungeTimer: .1, lungeTargetId: 'player',
    lungeDir: { x: 0, y: 0, z: 1 }, lungeStartPos: { ...f.actor.pos } });
  f.memories[id].aiState = 'LUNGING';
  return f;
}
function feedback(f: ReturnType<typeof fixture>, random = () => .99): NonNullable<StepOptions['scriptedLungeFeedback']> {
  return { version: 'scripted-lunge-feedback-v1', memories: f.memories,
    knobs: { [f.actor.id]: { difficulty: 'normal', weaponSwapIQ: 0, weaponPrioritization: 100 } },
    combos: f.matchContext.comboState, models: f.matchContext.playerModels, coordinator: f.matchContext.coordinator,
    pressure: { [f.actor.id]: { aggression: 0 } }, scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random };
}
function decision(f: ReturnType<typeof fixture>): Extract<ScriptedActorDecision, { kind: 'handled' }> {
  return { kind: 'handled', action: { ...idleAction(), aim: .8 }, flightTargetId: 'target',
    commandVersion: 'scripted-combat-v6', commands: [] };
}
function advance(f: ReturnType<typeof fixture>, dt: number, resolve = () => decision(f), withFeedback = true) {
  return stepSimulation(f.state, {}, { dt, scriptedLungeFeedback: withFeedback ? feedback(f) : undefined,
    scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
      prepare: () => 'engagement', resolve } });
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const phase of ['LUNGING', 'CHARGE_ATTACK'] as const)
    test(`scheduled flight matches live travel and finish motion ${id}/${dt}/${phase}`, () => {
      const f = flightFixture(id); f.actor.pos.y = 1; f.actor.vel.y = 2; f.actor.isJumping = true;
      f.actor.lungeStartPos = { ...f.actor.pos }; f.memories[id].aiState = phase;
      f.actor.attackCooldown = .5; f.actor.weaponReadyTimer = .4; f.actor.swapLockoutTimer = .3;
      f.actor.dashRemaining = .2; f.actor.dashDir = { x: 1, y: 0, z: 0 };
      const live = attachLungeRuntime(createBotParityFixture(id, true, f.state.settings));
      Object.assign(live.bot, { activeWeapon: 'sword', isLunging: true, lungeTimer: .1,
        lungeTargetDir: { ...f.actor.lungeDir }, lungeStartPos: { ...f.actor.lungeStartPos },
        isJumping: true, aiState: phase });
      live.bot.pos.set(f.actor.pos.x, f.actor.pos.y, f.actor.pos.z);
      live.bot.vel.set(f.actor.vel.x, f.actor.vel.y, f.actor.vel.z);
      live.target.pos.set(f.target.pos.x, f.target.pos.y, f.target.pos.z);
      live.flight(dt);
      finishAIHorizontalMotion(live.bot, { pos: live.bot.pos, vel: live.bot.vel, aiState: live.bot.aiState });
      const events = advance(f, dt);
      for (const axis of ['x', 'y', 'z'] as const) {
        close(f.actor.pos[axis], live.bot.pos[axis]); close(f.actor.vel[axis], live.bot.vel[axis]);
      }
      close(f.actor.lungeTimer, .1 + dt); close(f.actor.attackCooldown, .5 - dt);
      close(f.actor.weaponReadyTimer, .4 - dt); close(f.actor.swapLockoutTimer, .3 - dt);
      assert.equal(f.actor.dashRemaining, .2, 'flight must not spend the deferred dash duration');
      assert.equal(f.actor.yaw, .8); assert.equal(f.actor.lungeTargetId, 'target');
      assert.deepEqual(f.actor.lungeDir, { x: 0, y: 0, z: 1 });
      assert.equal(events.actorDecisionFrame!.decisions[0].flightTargetId, 'target');
    });

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  test(`current selected target receives flight contact and finish feedback ${id}/${dt}`, () => {
    const f = flightFixture(id); f.target.pos = { x: 0, y: 0, z: 1.5 + 24 * dt };
    f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = false;
    const previousHp = f.target.hp;
    advance(f, dt);
    assert.equal(f.target.hp, previousHp - 1); assert.equal(f.player.hp, f.player.maxHp);
    assert.equal(f.actor.isLunging, false); assert.equal(f.actor.lungeOutcome, 'hit');
    assert.equal(f.memories[id].lastLungeTargetId, 'target');
    assert.equal(f.memories[id].lastLungeOutcome, 'hit');
    assert.equal(f.matchContext.playerModels.get(id)?.lungeHits, 1);
  });

for (const kind of ['swap', 'revert', 'melee', 'restart'] as const)
  test(`scheduled flight commits ${kind} before travel`, () => {
    const f = flightFixture(), d = decision(f), before = structuredClone(f.actor.pos);
    d.commands = kind === 'swap' ? [{ kind: 'swap', weapon: 'hammer' }]
      : kind === 'revert' ? [{ kind: 'revert-weapon-feint' }]
      : kind === 'melee' ? [{ kind: 'melee', weapon: 'sword', swipe: false }]
      : [{ kind: 'lunge', targetId: 'target', direction: { x: 1, y: 0, z: 0 } }];
    advance(f, 1 / 60, () => d);
    if (kind === 'restart') {
      assert.deepEqual(f.actor.pos, before); assert.equal(f.actor.lungeTimer, 0);
      assert.deepEqual(f.actor.lungeDir, { x: 1, y: 0, z: 0 });
    } else {
      close(f.actor.pos.z, .4); close(f.actor.lungeTimer, .1 + 1 / 60);
      assert.equal(f.actor.weapon, kind === 'melee' ? 'sword' : 'hammer');
      if (kind === 'melee') { assert.equal(f.actor.weaponState, 'windup'); assert.equal(f.actor.lastAttackTick, 0); }
      if (kind === 'swap') close(f.actor.swapLockoutTimer, 1); // Live AI enforces a one-second minimum.
    }
  });

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  for (const sign of [-1, 1]) test(`composed flight priorities and checkpoints ${id}/${dt}/${sign}`, () => {
    const initial = flightFixture(id); initial.target.pos.x *= sign;
    initial.actor.lungeDir.z *= sign; initial.target.pos.z *= sign;
    initial.matchContext.feintCooldowns.set(id, .5);
    let run = { ...initial, randomState: createRng(9).getState() };
    let restored = structuredClone(run);
    const tick = (f: typeof run) => {
      const random = createRng(0); random.setState(f.randomState);
      const before = { timer: f.memories[id].timer!, sway: f.memories[id].swayTimer };
      const events = stepSimulation(f.state, {}, { dt, scriptedLungeFeedback: feedback(f, random.next),
        scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: f.owners,
          prepare: () => 'engagement', resolve: () => {
            const observation = resolveSimGrifballCombatObservation(f.state, id, 'target', f.owners, f.tuning, dt, undefined, true)!;
            assert.equal(observation.committedFlight, true);
            const result = resolveSimGrifballCombatPriorities(f.state, id, f.owners, f.tuning, f.memories,
              { observation, matchContext: f.matchContext, random: random.next, scoreContext: { scorePlayer: 0, scoreEnemy: 0 },
                spatialIQ: 80, defensiveEvasionMult: 1, resolvedDangerZone: 3 }, dt)!;
            assert.equal(result.mode, 'continue');
            close(f.memories[id].timer!, before.timer - dt); close(f.memories[id].swayTimer, before.sway + dt);
            return result.decision;
          } } });
      f.randomState = random.getState(); return events;
    };
    for (let frame = 0; frame < 12; frame++) {
      const events = tick(run), restoredEvents = tick(restored);
      assert.deepEqual(restoredEvents, events); assert.deepEqual(restored, run);
      assert.equal(run.actor.isLunging, true); assert.equal(run.actor.lungeTargetId, 'target');
      if ([1, 5, 9].includes(frame)) restored = structuredClone(run);
    }
    close(run.matchContext.feintCooldowns.get(id)!, .5 - dt * 12);
  });

for (const invalid of ['unprepared', 'grounded', 'carrier', 'friendly', 'dead-target', 'old-version', 'missing-commands',
  'movement', 'attack', 'no-feedback', 'mismatched-lunge'] as const)
  test(`reject invalid scheduled flight ownership: ${invalid}`, () => {
    const f = flightFixture(), d = decision(f);
    if (invalid === 'grounded') f.actor.isLunging = false;
    if (invalid === 'carrier') f.actor.hasBall = true;
    if (invalid === 'friendly') f.target.team = f.actor.team;
    if (invalid === 'dead-target') f.target.alive = false;
    if (invalid === 'old-version') d.commandVersion = 'scripted-combat-v5';
    if (invalid === 'missing-commands') delete d.commands;
    if (invalid === 'movement') d.action.moveX = 1;
    if (invalid === 'attack') d.action.attackPrimary = true;
    if (invalid === 'mismatched-lunge') d.commands = [{ kind: 'lunge', targetId: 'player', direction: { x: 1, y: 0, z: 0 } }];
    if (invalid === 'no-feedback') assert.throws(() => advance(f, 1 / 60, () => d, false), /finish feedback owner/);
    else assert.throws(() => validateScriptedActorDecision(f.state,
      { version: 'scripted-actor-decision-v1', scriptedBots: f.owners, resolve: () => d },
      f.actor.id, d, f.state.settings, invalid !== 'unprepared'), /exclusive current armed engagement/);
  });

test('flight observations remain explicit and cannot survive the end of flight', () => {
  const f = flightFixture();
  assert.equal(resolveSimGrifballCombatObservation(f.state, f.actor.id, 'target', f.owners, f.tuning), null);
  const observation = resolveSimGrifballCombatObservation(f.state, f.actor.id, 'target', f.owners, f.tuning, 1 / 60, undefined, true)!;
  assert.ok(observation); f.actor.isLunging = false;
  assert.equal(retainSimGrifballCombatObservation(f.state, f.actor.id, f.owners, observation), null);
});

test('legacy flight keeps its locked target and rejects direct contact on grounded actors', () => {
  const f = flightFixture(), originalYaw = f.actor.yaw;
  stepSimulation(f.state, {});
  assert.equal(f.actor.lungeTargetId, 'player'); assert.equal(f.actor.yaw, originalYaw);
  f.actor.isLunging = false;
  assert.throws(() => stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'flight'), /existing roster flight/);
});

for (const id of ['main_ai', 'ordinary']) test(`composed combo restarts flight without later clocks: ${id}`, () => {
  const f = flightFixture(id); f.target.pos = { x: 0, y: 0, z: 10 };
  f.matchContext.comboState.set(id, { comboId: 'mixup', targetId: 'target', stepIndex: 2, stepTimer: 0 });
  const before = structuredClone(f.memories[id]);
  advance(f, 1 / 60, () => {
    const observation = resolveSimGrifballCombatObservation(f.state, id, 'target', f.owners, f.tuning, 1 / 60, undefined, true)!;
    const result = resolveSimGrifballCombatPriorities(f.state, id, f.owners, f.tuning, f.memories,
      { observation, matchContext: f.matchContext, random: () => .99, scoreContext: { scorePlayer: 0, scoreEnemy: 0 },
        spatialIQ: 80, defensiveEvasionMult: 1, resolvedDangerZone: 3 })!;
    assert.equal(result.mode, 'sync_return'); return result.decision;
  });
  assert.deepEqual(f.actor.pos, { x: 0, y: 0, z: 0 }); assert.equal(f.actor.lungeTimer, 0);
  assert.equal(f.memories[id].timer, before.timer); assert.equal(f.memories[id].swayTimer, before.swayTimer);
});

for (const id of ['main_ai', 'ordinary']) for (const mobility of ['hop', 'dodge'])
  test(`composed evasion during flight preserves flight precedence ${id}/${mobility}`, () => {
    const f = flightFixture(id); f.target.pos = { x: 0, y: 0, z: 3 };
    f.target.weapon = 'sword'; f.target.weaponState = 'windup'; f.target.attackKind = 'slash'; f.target.weaponTimer = 1;
    // Preserve flight precedence while evading a real incoming lunge, not a
    // stationary slash that does not trigger this policy.
    Object.assign(f.target, { isLunging: true, lungeTimer: 0,
      lungeDir: { x: 0, y: 0, z: -1 }, lungeStartPos: { ...f.target.pos } });
    f.actor.dashCooldownTimer = mobility === 'hop' ? 2 : 0;
    f.state.settings.enableSwordTrade = false;
    const events = advance(f, 1 / 60, () => {
      const observation = resolveSimGrifballCombatObservation(f.state, id, 'target', f.owners, f.tuning, 1 / 60, undefined, true)!;
      const result = resolveSimGrifballCombatPriorities(f.state, id, f.owners, f.tuning, f.memories,
        { observation, matchContext: f.matchContext, random: () => mobility === 'dodge' ? 0 : .99, scoreContext: { scorePlayer: 0, scoreEnemy: 0 },
          spatialIQ: 80, defensiveEvasionMult: 1, resolvedDangerZone: 3 })!;
      assert.equal(result.decision.mobility?.kind, mobility === 'hop' ? 'emergency-hop' : 'spatial-dodge');
      assert.equal(result.decision.holdAfterEvasion, false); return result.decision;
    });
    assert.ok(events.actorDecisionFrame!.decisions[0].mobility);
    assert.equal(events.actorDecisionFrame!.decisions[0].dash, undefined);
    assert.equal(f.actor.isLunging, true); close(f.actor.lungeTimer, .1 + 1 / 60);
    if (mobility === 'dodge') { close(f.actor.pos.z, .4); assert.equal(f.actor.dashRemaining, f.state.settings.dashDuration); }
    else assert.ok(f.actor.pos.y > 0);
  });

test('lethal flight after a weapon swap still credits the sword', () => {
  const f = flightFixture(), d = decision(f);
  f.target.pos = { x: 0, y: 0, z: 1 }; f.target.hp = 1;
  f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = false;
  d.commands = [{ kind: 'swap', weapon: 'hammer' }];
  const events = advance(f, 1 / 60, () => d);
  assert.equal(f.actor.weapon, 'hammer'); assert.equal(f.actor.lungeOutcome, 'hit');
  assert.deepEqual(events.kills, [{ attackerId: f.actor.id, victimId: f.target.id, weapon: 'sword' }]);
});

for (const trade of [false, true]) test(`flight contact reports live trade return ${trade}`, () => {
  const f = flightFixture(); f.actor.lungeTargetId = 'target'; f.target.pos = { x: 0, y: 0, z: 1 };
  f.target.weapon = 'sword'; f.target.weaponState = 'windup'; f.target.attackKind = 'slash';
  f.state.settings.enableSwordTrade = trade;
  const result = stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'flight');
  assert.equal(result, trade ? 'trade_return' : undefined); assert.equal(f.actor.isLunging, false);
  assert.equal(f.actor.hp, f.actor.maxHp - Number(trade));
});

for (const id of ['main_ai', 'ordinary']) for (const dt of [1 / 30, 1 / 60])
  test(`scheduled flight swing animation matches the live roster ${id}/${dt}`, () => {
    const f = flightFixture(id); f.target.pos = { x: 2.5, y: 0, z: 6 };
    const live = attachLungeRuntime(createBotParityFixture(id, true, f.state.settings));
    Object.assign(live.bot, { activeWeapon: 'sword', isLunging: true, lungeTimer: .1,
      lungeTargetDir: { ...f.actor.lungeDir }, lungeStartPos: { ...f.actor.lungeStartPos }, aiState: 'LUNGING' });
    live.bot.yaw = .8 + Math.PI;
    live.target.pos.set(f.target.pos.x, f.target.pos.y, f.target.pos.z);
    const phases: Record<string, string> = { ready: 'idle', swing_up: 'windup', swing_down: 'active', recovering: 'recovering' };
    for (let tick = 0; tick < 10; tick++) {
      const d = decision(f);
      if (tick === 0) { d.commands = [{ kind: 'melee', weapon: 'sword', swipe: false }]; live.attack(); }
      const result = live.flight(dt);
      if (result !== 'trade_return') finishAIHorizontalMotion(live.bot, { pos: live.bot.pos, vel: live.bot.vel, aiState: live.bot.aiState });
      live.visuals(dt);
      advance(f, dt, () => d);
      assert.equal(f.actor.isLunging, true);
      assert.equal(f.actor.weaponState, phases[live.bot.weaponState!]);
      close(f.actor.weaponPhaseElapsed ?? 0, live.bot.weaponTimer ?? 0);
      close(f.actor.lungeTimer, live.bot.lungeTimer!);
      assert.equal(f.target.hp, live.target.hp);
    }
    assert.notEqual(f.actor.weaponState, 'windup', 'flight must not freeze the slash');
  });
