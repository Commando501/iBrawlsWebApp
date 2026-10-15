import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { startAIHammerJumpForCombatant } from '../../src/components/grifball/combatantActions';
import { triggerEnemyHammerSwingForCombatant } from '../../src/components/grifball/enemyWeaponActions';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import { validateScriptedActorDecision, type ScriptedActorDecisionOwner } from '../../src/sim/scriptedActorDecision';
import { validateScriptedCombatInput, type ScriptedCombatCommand } from '../../src/sim/scriptedCombatInput';
import { setSimCarrier, placeCombatantsAtSpawns } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { stepCombatantWeapons, tickRespawns } from '../../src/sim/weapons';

const noop = () => {};
const cases = ['ground', 'heading', 'zero-heading', 'tiny-heading', 'rising', 'unlimited', 'disabled', 'exhausted'] as const;
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30]) for (const kind of cases)
  test(`scheduled hammer jump ${id}/${sign}/${dt}/${kind}`, () => {
    const f = attachLungeRuntime(createBotParityFixture(id, true, { hammerSlamWindupTime: .08, hammerSlamAttackTime: .04,
      hammerJumpAirLimit: kind === 'disabled' ? 0 : kind === 'unlimited' ? 10 : 1 }));
    const { bot, target, sim, state } = f, [actor, enemy] = sim.combatants;
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
    actor.id = id; enemy.id = target.id; actor.controller = enemy.controller = 'ai';
    actor.weapon = bot.activeWeapon = 'hammer'; actor.weaponReadyTimer = actor.swapLockoutTimer = actor.invulnerabilityTimer = enemy.invulnerabilityTimer = 0;
    actor.hp = actor.maxHp = bot.hp = bot.maxHp = 20; enemy.hp = enemy.maxHp = target.hp = target.maxHp = 20;
    const air = ['rising', 'unlimited', 'exhausted'].includes(kind);
    bot.pos.set(0, air ? 1 : 0, 0); bot.vel.set(0, air ? 2 : 0, 0); bot.isJumping = air;
    bot.aiHammerJumpsInAir = actor.hammerJumpsInAir = kind === 'unlimited' ? 12 : kind === 'exhausted' ? 1 : 0;
    actor.pos = { ...bot.pos }; actor.vel = { ...bot.vel }; actor.isJumping = air; actor.grounded = !air;
    bot.yaw = sign > 0 ? Math.PI : 0; actor.yaw = sign > 0 ? 0 : Math.PI;
    target.pos.set(0, 0, sign * 2); enemy.pos = { ...target.pos };
    sim.combatants.push({ ...structuredClone(enemy), id: 'player', controller: 'remote', team: actor.team, pos: { x: -30, y: 0, z: -30 } });
    let restored = JSON.parse(JSON.stringify(sim));
    const heading = kind === 'heading' ? { x: sign * 3, y: 2, z: sign * 4 }
      : kind === 'zero-heading' ? { x: 0, y: 0, z: 0 } : kind === 'tiny-heading' ? { x: .001, y: 0, z: 0 } : undefined;
    const accepted = !['disabled', 'exhausted'].includes(kind);
    let launchTick = 0, impactTick = 0, launches = 0, priorVy = bot.vel.y;
    for (let tick = 1; tick <= 180; tick++) {
      withSimulationRandom(() => assert.fail('hammer jump actuation must not draw RNG'), tick * dt, () => {
        f.weaponFrame(dt);
        if ((bot.hammerJumpWindowTimer ?? 0) > 0) bot.hammerJumpWindowTimer = Math.max(0, bot.hammerJumpWindowTimer! - dt);
        f.gravityPrelude(bot, dt);
        if (tick === 1) assert.equal(startAIHammerJumpForCombatant({ self: bot, settings: state.settings, vel: bot.vel,
          horizontalHeading: heading && new THREE.Vector3(heading.x, heading.y, heading.z), jumpType: 'defensive',
          onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot), playSwing: noop, playJump: noop }), accepted);
        const constrain = () => constrainCombatantToArenaBounds({ pos: bot.pos, vel: bot.vel, activeCustomMap: f.map, arenaRadius: f.map.arenaRadius });
        if (resolvePreGroundMovementRecoveryForCombatant({ self: bot, pos: bot.pos, vel: bot.vel, dt,
          movementComplexity: 0, swayTimer: 0, toTarget: target.pos.clone().sub(bot.pos),
          recoverCombatantAltitude: () => false, constrainCombatantToArena: constrain }) === 'continue') bot.vel.set(0, 0, 0);
        f.visuals(dt);
      });
      const advance = (own: typeof sim) => stepSimulation(own, {}, { settings: own.settings, dt,
        scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' }, prepare: () => 'engagement',
          resolve: ({ state: current }) => ({ kind: 'handled', action: { ...idleAction(), aim: current.combatants[0].yaw },
            ...(tick === 1 ? { commandVersion: 'scripted-combat-v4', commands: [{ kind: 'hammer-jump', jumpType: 'defensive', ...(heading ? { heading } : {}) }] } : {}) }) } });
      const events = advance(sim), replayEvents = advance(restored);
      assert.deepEqual(restored, sim); assert.deepEqual(replayEvents, events);
      if ([4, 12, 100].includes(tick)) restored = JSON.parse(JSON.stringify(restored)); // Preserve a queued main launch or an ordinary airborne strike.
      for (const axis of ['x', 'y', 'z'] as const) {
        assert.ok(Math.abs(actor.pos[axis] - bot.pos[axis]) < 1e-7, `position ${tick}/${axis}: ${actor.pos[axis]} vs ${bot.pos[axis]}`);
        assert.ok(Math.abs(actor.vel[axis] - bot.vel[axis]) < 1e-7, `velocity ${tick}/${axis}: ${actor.vel[axis]} vs ${bot.vel[axis]}`);
      }
      assert.equal(actor.hammerJumpsInAir, bot.aiHammerJumpsInAir ?? 0, `budget ${tick}`);
      assert.equal(!!actor.hammerJumpPlanned, !!bot.hammerJumpPlanned, `plan ${tick}`);
      assert.equal(actor.hammerJumpType, bot.hammerJumpType); assert.equal(actor.isJumping, !!bot.isJumping);
      assert.equal(actor.hammerJumpWindowTimer, bot.hammerJumpWindowTimer ?? 0, `window ${tick}`);
      assert.equal(enemy.hp, target.hp, `damage ${tick}`);
      const phase = bot.weaponState === 'ready' ? 'idle' : bot.weaponState === 'swing_up' ? 'windup' : bot.weaponState === 'swing_down' ? 'active' : 'recovering';
      assert.equal(actor.weaponState, phase, `phase ${tick}`);
      if (bot.vel.y > 5 && bot.vel.y > priorVy + 5) { launches++; launchTick = tick; } priorVy = bot.vel.y;
      if (!impactTick && target.hp < 20) impactTick = tick;
      if (tick === 1 && accepted) {
        assert.equal(actor.weaponState, 'windup');
        if (id === 'main_ai') { assert.equal(actor.hammerJumpPlanned, true); assert.ok(actor.vel.y < 3); }
        else { assert.equal(actor.vel.y, 7.2 + state.settings.hammerJumpPower); assert.equal(actor.hammerJumpsInAir, kind === 'unlimited' ? 13 : 1); }
        if (id === 'main_ai') assert.equal(actor.lastHammerAttackTimeMs, dt * 1000);
        else assert.equal(actor.lastHammerAttackTimeMs, undefined, 'ordinary jump retains the production timestamp behavior');
        if (id === 'ordinary' && kind === 'heading') assert.equal(actor.vel.x, sign * 3 / Math.sqrt(29) * 6.5 * (1 - 5 * dt));
      }
    }
    assert.equal(launches, Number(accepted));
    if (accepted) assert.equal(launchTick, id === 'main_ai' ? dt === 1 / 60 ? 8 : 5 : 1);
    if (accepted && !air) { assert.ok(impactTick > 1, 'actual impact must damage the nearby target'); assert.equal(target.hp, 19); }
    assert.equal(actor.pos.y, 0); assert.equal(actor.isJumping, false); assert.equal(actor.hammerJumpsInAir, 0);
  });

for (const id of ['main_ai', 'ordinary']) for (const reason of ['swap', 'dash', 'windup', 'active', 'recovery'] as const)
  test(`hammer jump commitment guards ${id}/${reason}`, () => {
    const f = boundaryFixture(id), { bot, actor, state, sim } = f;
    actor.vel = { x: 0, y: 0, z: 0 }; bot.vel.set(0, 0, 0);
    if (reason === 'swap') bot.swapCooldownTimer = actor.weaponReadyTimer = .2;
    if (reason === 'dash') bot.aiDashRemaining = actor.dashRemaining = .2;
    if (reason === 'windup') { bot.weaponState = 'swing_up'; actor.weaponState = 'windup'; }
    if (reason === 'active') { bot.weaponState = 'swing_down'; actor.weaponState = 'active'; }
    if (reason === 'recovery') { bot.weaponState = 'recovering'; actor.weaponState = 'recovering'; }
    const expected = id === 'ordinary' && ['swap', 'dash'].includes(reason);
    assert.equal(startAIHammerJumpForCombatant({ self: bot, settings: state.settings, vel: bot.vel,
      onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot), playSwing: noop, playJump: noop }), expected);
    stepCombatantWeapons(sim, actor, idleAction(), sim.settings, 0, [], 'intent', [{ kind: 'hammer-jump', jumpType: 'offensive' }], undefined, undefined, true, {});
    assert.equal(actor.vel.y, bot.vel.y); assert.equal(actor.hammerJumpsInAir, bot.aiHammerJumpsInAir ?? 0);
    assert.equal(!!actor.hammerJumpPlanned, !!bot.hammerJumpPlanned); assert.equal(actor.hammerJumpType, bot.hammerJumpType);
    if (expected) assert.equal(actor.weaponState, 'windup');
  });

for (const dt of [1 / 60, 1 / 30]) for (const reason of ['disabled', 'exhausted', 'radius', 'death', 'carrier', 'valid'] as const)
  test(`queued hammer jump rechecks impact ${dt}/${reason}`, () => {
    const f = boundaryFixture(), { actor, bot, sim, state } = f;
    Object.assign(state.settings, { hammerSlamWindupTime: .08, hammerSlamAttackTime: .04 });
    Object.assign(sim.settings, state.settings);
    assert.equal(startAIHammerJumpForCombatant({ self: bot, settings: state.settings, vel: bot.vel,
      onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot), playSwing: noop, playJump: noop }), true);
    stepCombatantWeapons(sim, actor, idleAction(), sim.settings, 0, [], 'intent', [{ kind: 'hammer-jump', jumpType: 'offensive' }], undefined, undefined, true, {});
    if (reason === 'disabled') state.settings.hammerJumpAirLimit = sim.settings.hammerJumpAirLimit = 0;
    if (reason === 'exhausted') bot.aiHammerJumpsInAir = actor.hammerJumpsInAir = 1;
    if (reason === 'radius') state.settings.hammerJumpTriggerRadius = sim.settings.hammerJumpTriggerRadius = .01;
    if (reason === 'death') { bot.hp = actor.hp = 0; bot.respawnTimer = actor.respawnTimer = 3; actor.alive = false; }
    if (reason === 'carrier') {
      setGrifballCarrierForState({ state, id: bot.id, carrying: true }); setSimCarrier(actor, true, sim.settings, sim);
    }
    for (let tick = 0; tick < 60; tick++) {
      f.visuals(dt); stepCombatantWeapons(sim, actor, idleAction(), sim.settings, dt, [], 'animation');
      assert.equal(actor.vel.y, bot.vel.y); assert.equal(!!actor.hammerJumpPlanned, !!bot.hammerJumpPlanned);
      assert.equal(actor.hammerJumpType, bot.hammerJumpType); assert.equal(actor.hammerJumpsInAir, bot.aiHammerJumpsInAir ?? 0);
    }
    assert.equal(actor.vel.y, reason === 'valid' ? 7.2 + sim.settings.hammerJumpPower : 0);
    if (reason === 'death') {
      tickRespawns(sim, sim.settings, 3.1, [actor]);
      assert.equal(actor.alive, true); assert.equal(actor.hammerJumpPlanned, false); assert.equal(actor.hammerJumpType, undefined);
      assert.equal(actor.hammerJumpsInAir, 0);
    } else assert.equal(actor.hammerJumpPlanned, false, 'impact consumes even a rejected plan');
  });

function boundaryFixture(id = 'main_ai') {
  const f = createBotParityFixture(id); const [actor, target] = f.sim.combatants;
  f.sim.combatExecution = 'live-mixed-v1'; f.sim.localPlayerId = 'player'; f.sim.match.phase = 'playing';
  actor.id = id; actor.controller = 'ai'; actor.weapon = 'hammer'; actor.weaponReadyTimer = actor.swapLockoutTimer = actor.invulnerabilityTimer = 0;
  target.id = 'player'; target.controller = 'remote'; target.pos = { x: 30, y: 0, z: 30 };
  const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' },
    prepare: () => 'engagement', resolve: () => ({ kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v4',
      commands: [{ kind: 'hammer-jump', jumpType: 'defensive' }] }) };
  return { ...f, actor, owner };
}

for (const version of ['scripted-combat-v1', 'scripted-combat-v2', 'scripted-combat-v3'] as const)
  test(`hammer jump refuses ${version}`, () => {
    const f = boundaryFixture();
    assert.throws(() => validateScriptedActorDecision(f.sim, f.owner, f.actor.id, { kind: 'handled', action: idleAction(), commandVersion: version,
      commands: [{ kind: 'hammer-jump', jumpType: 'defensive' }] }, f.sim.settings, true));
  });

test('hammer jump v4 refuses precomputed and unprepared authority and detaches its heading', () => {
  const f = boundaryFixture(), command: ScriptedCombatCommand = { kind: 'hammer-jump', jumpType: 'offensive', heading: { x: 3, y: 0, z: 4 } };
  const input = { version: 'scripted-combat-v4' as const, scriptedBots: f.owner.scriptedBots, commands: { main_ai: [command] } };
  const before = structuredClone(f.sim);
  assert.throws(() => validateScriptedCombatInput(f.sim, input, {}, f.sim.settings));
  assert.throws(() => validateScriptedActorDecision(f.sim, f.owner, 'main_ai', { kind: 'handled', action: idleAction(), commandVersion: input.version,
    commands: [command] }, f.sim.settings)); assert.deepEqual(f.sim, before);
  const validated = validateScriptedCombatInput(f.sim, input, {}, f.sim.settings, { actorId: 'main_ai', mobility: false, dash: false })!;
  command.heading!.x = 99; assert.equal((validated.main_ai[0] as typeof command).heading!.x, 3);
});

for (const reason of ['nan-heading', 'type', 'mobility', 'second-attack'] as const) test(`hammer jump refuses malformed/conflicting ${reason}`, () => {
  const f = boundaryFixture();
  const commands: ScriptedCombatCommand[] = [{ kind: 'hammer-jump', jumpType: 'defensive', heading: { x: 0, y: 0, z: 1 } }];
  if (reason === 'nan-heading') (commands[0] as Extract<ScriptedCombatCommand, { kind: 'hammer-jump' }>).heading!.x = NaN;
  if (reason === 'type') (commands[0] as any).jumpType = 'invalid';
  if (reason === 'second-attack') commands.push({ kind: 'melee', weapon: 'hammer', swipe: false });
  assert.throws(() => validateScriptedCombatInput(f.sim, { version: 'scripted-combat-v4', scriptedBots: f.owner.scriptedBots, commands: { main_ai: commands } }, {},
    f.sim.settings, { actorId: 'main_ai', mobility: reason === 'mobility', dash: false }));
});

test('full simulation placement clears a queued jump without adding optional state to legacy actors', () => {
  const f = boundaryFixture(); f.actor.hammerJumpPlanned = true; f.actor.hammerJumpType = 'defensive';
  placeCombatantsAtSpawns(f.sim, f.sim.settings);
  assert.equal(f.actor.hammerJumpPlanned, false); assert.equal(f.actor.hammerJumpType, undefined);
  assert.equal(Object.hasOwn(f.sim.combatants[1], 'hammerJumpPlanned'), false);
});

for (const z of [-2, 5.2]) test(`main jump uses downward impact geometry against target z=${z}`, () => {
  const f = boundaryFixture(), { actor, bot, target, sim, state } = f, enemy = sim.combatants[1];
  Object.assign(state.settings, { hammerSlamWindupTime: .08, hammerSlamAttackTime: .04, attackRadius: 4.5, attackRange: 3.2 });
  Object.assign(sim.settings, state.settings);
  // Make the fixture's second actor a roster target in both hosts.
  enemy.id = target.id; enemy.controller = 'ai'; sim.localPlayerId = 'absent-player';
  target.pos.set(0, 0, z); enemy.pos = { ...target.pos };
  enemy.invulnerabilityTimer = 0; enemy.hp = enemy.maxHp = 20;
  bot.yaw = Math.PI; actor.yaw = 0; actor.pos = { ...bot.pos };
  assert.equal(startAIHammerJumpForCombatant({ self: bot, settings: state.settings, vel: bot.vel,
    onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot), playSwing: noop, playJump: noop }), true);
  stepCombatantWeapons(sim, actor, idleAction(), sim.settings, 0, [], 'intent', [{ kind: 'hammer-jump', jumpType: 'offensive' }], undefined, undefined, true, {});
  for (let tick = 0; tick < 60; tick++) {
    f.visuals(1 / 60); stepCombatantWeapons(sim, actor, idleAction(), sim.settings, 1 / 60, [], 'animation');
    assert.equal(enemy.hp, target.hp);
  }
  assert.equal(enemy.hp, z < 0 ? 19 : 20);
  assert.equal(actor.hammerJumpPlanned, false);
});
