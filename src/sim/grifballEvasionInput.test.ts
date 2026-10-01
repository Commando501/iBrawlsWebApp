import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSimGrifballEvasionInput } from './grifballEvasionInput';
import { createMatch } from './factory';
import { idleAction } from './actions';
import { stepSimulation } from './step';
import { stepCombatantWeapons } from './weapons';
import { validateScriptedCombatInput } from './scriptedCombatInput';

function fixture() {
  const state = createMatch({ seed: 7, teamSizes: { blue: 1, red: 2 }, combatExecution: 'live-mixed-v1',
    settings: { aiDifficulty: 'normal', swordLungeSpeed: 24, attackRadius: 2, aiTuneHammerWindupSeconds: .32 } });
  const [actor, target, player] = state.combatants;
  state.localPlayerId = player.id = 'player'; player.controller = 'remote'; state.match.phase = 'playing';
  actor.id = 'main_ai'; target.id = 'target'; actor.controller = target.controller = 'ai';
  actor.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 8 }; player.pos = { x: 30, y: 0, z: 30 };
  actor.weapon = 'hammer'; target.weapon = 'sword'; actor.weaponReadyTimer = actor.swapLockoutTimer = 0;
  target.isLunging = true; target.lungeDir = { x: 0, y: 0, z: -1 }; target.lungeTargetId = actor.id; target.lungeStartPos = { ...target.pos };
  actor.dashCooldownTimer = 2;
  const authority = { main_ai: 'normal' };
  const memory = { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 };
  const memories: Record<string, typeof memory> = { main_ai: { ...memory }, target: { ...memory } };
  let draws = 0;
  const context: Parameters<typeof resolveSimGrifballEvasionInput>[4] = {
    motionPhase: 'after-engagement-gravity', observation: { targetId: target.id, distanceToTarget: 8, combatDistanceToTarget: 8,
      toTarget: { x: 0, z: 8 }, resolvedAiReach: 3 },
    weaponFrame: { activeWeapon: 'hammer', weaponState: 'ready', canStartWeaponAction: true,
      readinessRemaining: 0, observedSwapLockout: 0, currentSwapLockout: 0 },
    pendingPostEvasionCharge: false, bulltrueCounter: null, defensiveEvasionMult: 1, spatialIQ: 80, swayTimer: 0,
    random: () => { draws++; return .01; },
  };
  const resolve = () => resolveSimGrifballEvasionInput(state, actor.id, authority, memories, context);
  return { state, actor, target, player, authority, memories, context, resolve, draws: () => draws };
}

for (const reason of ['legacy', 'combat-mode', 'paused', 'remote', 'local', 'neural', 'authority', 'dead', 'respawn', 'flight',
  'carrier', 'own-memory', 'target-memory', 'dead-target', 'friendly-target', 'missing-target', 'duplicate-target'] as const)
  test(`evasion adapter explicitly hands off ${reason} without RNG or state mutation`, () => {
    const f = fixture();
    if (reason === 'legacy') f.state.combatExecution = 'legacy-v1';
    if (reason === 'combat-mode') f.state.mode = 'combat';
    if (reason === 'paused') f.state.match.phase = 'countdown';
    if (reason === 'remote') f.actor.controller = 'remote';
    if (reason === 'local') f.state.localPlayerId = f.actor.id;
    if (reason === 'neural') f.authority.main_ai = 'neural-net';
    if (reason === 'authority') delete (f.authority as Record<string, string>).main_ai;
    if (reason === 'dead') f.actor.hp = 0;
    if (reason === 'respawn') f.actor.respawnTimer = 1;
    if (reason === 'flight') f.actor.isLunging = true;
    if (reason === 'carrier') f.state.match.ball.holderId = f.actor.id;
    if (reason === 'own-memory') delete f.memories.main_ai;
    if (reason === 'target-memory') delete f.memories.target;
    if (reason === 'dead-target') f.target.hp = 0;
    if (reason === 'friendly-target') f.target.team = f.actor.team;
    if (reason === 'missing-target') f.context.observation.targetId = 'absent';
    if (reason === 'duplicate-target') f.state.combatants.push(structuredClone(f.target));
    const before = structuredClone(f.state), memory = structuredClone(f.memories);
    assert.equal(f.resolve(), null); assert.equal(f.draws(), 0); assert.deepEqual(f.state, before); assert.deepEqual(f.memories, memory);
  });

for (const field of ['distance', 'reach', 'direction', 'readiness', 'spatial', 'phase', 'rng'] as const)
  test(`evasion adapter rejects invalid ${field}`, () => {
    const f = fixture();
    if (field === 'distance') f.context.observation.combatDistanceToTarget = NaN;
    if (field === 'reach') f.context.observation.resolvedAiReach = -1;
    if (field === 'direction') f.context.observation.toTarget.x = Infinity;
    if (field === 'readiness') f.context.weaponFrame.readinessRemaining = -1;
    if (field === 'spatial') f.context.spatialIQ = 101;
    if (field === 'phase') (f.context as any).motionPhase = 'default';
    if (field === 'rng') (f.context as any).random = undefined;
    assert.throws(f.resolve); assert.equal(f.draws(), 0);
  });

test('rejected main jump clears its old plan before the timed dash counter', () => {
  const f = fixture(); f.actor.dashRemaining = .2; f.actor.dashDir = { x: 1, y: 0, z: 0 };
  f.actor.hammerJumpPlanned = true; f.actor.hammerJumpType = 'defensive';
  const memory = structuredClone(f.memories), before = structuredClone(f.state), decision = f.resolve()!;
  assert.deepEqual(decision.commands.map(c => c.kind), ['hammer-jump', 'melee']);
  assert.equal(decision.frame.isEvadingLunge, false); assert.equal(decision.motion.hammerJumpPlanned, false);
  assert.equal(decision.motion.weaponState, 'swing_up'); assert.equal(decision.weaponFrame.weaponState, 'ready', 'timed counter retains the cached live decision state');
  assert.deepEqual(f.state, before); assert.deepEqual(f.memories, memory);
  assert.throws(() => validateScriptedCombatInput(f.state, { version: 'scripted-combat-v4', scriptedBots: f.authority,
    commands: { main_ai: decision.commands } }, {}, f.state.settings, { actorId: 'main_ai', mobility: false, dash: true }));
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: { version: 'scripted-actor-decision-v1',
    scriptedBots: f.authority, prepare: () => 'engagement', resolve: () => ({ kind: 'handled', action: idleAction(), ...decision }) } });
  assert.equal(f.actor.hammerJumpPlanned, false); assert.equal(f.actor.hammerJumpType, undefined);
  assert.equal(f.actor.weaponState, 'windup'); assert.equal(f.actor.isJumping, false);
  for (let i = 0; i < 60; i++) stepCombatantWeapons(f.state, f.actor, idleAction(), f.state.settings, 1 / 60, [], 'animation');
  assert.equal(f.actor.hammerJumpsInAir, 0); assert.equal(f.actor.vel.y, 0, 'counter impact cannot launch the rejected plan');
});

test('accepted v5 jump cannot restart its swing with a trailing counter', () => {
  const f = fixture();
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: { version: 'scripted-actor-decision-v1',
    scriptedBots: f.authority, prepare: () => 'engagement', resolve: () => ({ kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v5',
      commands: [{ kind: 'hammer-jump', jumpType: 'defensive' }, { kind: 'melee', weapon: 'sword', swipe: false }] }) } });
  assert.equal(f.actor.hammerJumpPlanned, true); assert.equal(f.actor.weapon, 'hammer'); assert.equal(f.actor.attackKind, 'strike');
  assert.equal(f.actor.lastSwordAttackTimeMs, undefined);
});

test('local flight direction uses its committed vector even with a custom player ID', () => {
  const f = fixture(); f.actor.weapon = 'sword'; f.context.weaponFrame.activeWeapon = 'sword';
  f.context.weaponFrame.canStartWeaponAction = false; f.actor.dashCooldownTimer = 0;
  f.state.localPlayerId = f.target.id = 'custom-local'; f.context.observation.targetId = f.target.id;
  f.target.controller = 'remote'; f.target.lungeDir = { x: 1, y: 0, z: 0 }; f.target.vel = { x: 0, y: 0, z: 20 };
  const result = f.resolve()!;
  assert.equal(result.mobility?.kind, 'spatial-dodge'); assert.equal(Math.abs(result.mobility!.direction.x), 0);
  assert.equal(Math.abs(result.mobility!.direction.z), 1);
});

test('main jump projection resets an earlier recovery clock after the caller readies its weapon', () => {
  const f = fixture(); f.actor.weaponState = 'recovering'; f.actor.weaponPhaseElapsed = .4;
  const decision = f.resolve()!;
  assert.equal(decision.motion.weaponState, 'swing_up'); assert.equal(decision.motion.weaponTimer, 0);
  assert.equal(f.actor.weaponPhaseElapsed, .4, 'projection leaves engine execution to the scheduler');
});

test('v5 retains prefix, rejected jump and counter order in a four-command sequence', () => {
  const f = fixture(); f.actor.weapon = 'sword'; f.actor.weaponState = 'recovering'; f.actor.attackKind = 'slash';
  f.actor.dashRemaining = .2; f.actor.dashDir = { x: 1, y: 0, z: 0 };
  f.actor.hammerJumpPlanned = true; f.actor.hammerJumpType = 'defensive';
  const decision = f.resolve()!;
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: { version: 'scripted-actor-decision-v1',
    scriptedBots: f.authority, prepare: () => 'engagement', resolve: () => ({ kind: 'handled', action: idleAction(), ...decision,
      commands: [{ kind: 'revert-weapon-feint' }, { kind: 'swap', weapon: 'hammer' }, ...decision.commands] }) } });
  assert.equal(f.actor.weapon, 'hammer'); assert.equal(f.actor.weaponState, 'windup'); assert.equal(f.actor.attackKind, 'strike');
  assert.equal(f.actor.hammerJumpPlanned, false); assert.equal(f.actor.hammerJumpsInAir, 0);
});

for (const kind of ['lunge', 'swap', 'hammer-jump'] as const) test(`v5 forbids ${kind} after a jump attempt`, () => {
  const f = fixture();
  const second = kind === 'lunge' ? { kind, targetId: f.target.id, direction: { x: 0, y: 0, z: 1 } }
    : kind === 'swap' ? { kind, weapon: 'sword' as const } : { kind, jumpType: 'defensive' as const };
  assert.throws(() => validateScriptedCombatInput(f.state, { version: 'scripted-combat-v5', scriptedBots: f.authority,
    commands: { main_ai: [{ kind: 'hammer-jump', jumpType: 'defensive' }, second] } }, {}, f.state.settings,
    { actorId: 'main_ai', mobility: false, dash: false }));
});
