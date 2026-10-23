import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { planLiveTeamSafeAim } from '../../src/components/grifball/aiTeamSafeAimRuntime';
import { applySimTeamSafeAim } from '../../src/sim/teamSafeAim';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { triggerCombatantAttackAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import type { SimCombatPriorityMemory } from '../../src/sim/grifballCombatPriorities';
import { createAIMatchContext } from '../../src/game/aiMatchContext';
import { createSimGrifballActorStepOptions } from '../../src/sim/grifballActorOwner';
import { stepSimulation } from '../../src/sim/step';

const noop = () => {}, dt = 1 / 60;
const knobs: AIResolvedKnobs = { difficulty: 'normal', reactionLatency: .15, anticipationFactor: .5,
  movementComplexity: 0, weaponSwapIQ: 0, aiPlaystyle: 50, weaponPrioritization: 0 };
const memory = (): SimCombatPriorityMemory => ({ aiState: 'APPROACHING', timer: 0, swayTimer: 0,
  cooldownMultiplier: 1, coordCommitTimer: 0, pendingPostEvasionCharge: false });
function fixture(id = 'bot') {
  const f = createBotParityFixture(id, true, { gameMode: 'grifball', maxHP: 20, weaponReadyTime: 0,
    enableHammerSwordTrade: false, enableSwordTrade: false });
  const ally = createOfflineBotCombatant({ id: 'ally', playerName: 'Ally', team: 'blue', spawnPos: new THREE.Vector3(1.5, 0, 3),
    yaw: 0, hue: 0, difficulty: 'normal', settings: f.state.settings, modelType: 'medium' });
  ally.hp = ally.maxHp = 20; ally.invulnerabilityTimer = ally.respawnTimer = 0; ally.weaponState = 'ready';
  f.state.otherPlayers.set(ally.id, ally);
  f.map.objects = []; f.map.arenaRadius = 40; f.map.mapShape = 'circle';
  f.state.punchMap = f.map;
  f.bot.pos.set(0, 0, 0); f.bot.vel.set(0, 0, 0); f.bot.yaw = Math.PI;
  f.bot.aiState = 'APPROACHING'; f.bot.aiTimer = f.bot.aiCoordCommitTimer = f.bot.swapLockoutTimer = 0;
  f.target.pos.set(0, 0, 4); f.target.vel.set(0, 0, 0);
  const [actor, enemy] = f.sim.combatants;
  f.sim.combatExecution = 'live-mixed-v1'; f.sim.localPlayerId = 'observer'; f.sim.localPlayerIsObserver = true;
  f.sim.match.phase = 'playing'; f.sim.map = structuredClone(f.map);
  actor.id = id; enemy.id = f.target.id;
  const friendly = structuredClone(actor); friendly.id = ally.id; f.sim.combatants.push(friendly);
  f.sim.combatants.push({ ...structuredClone(actor), id: 'observer', controller: 'remote', alive: false, hp: 0,
    respawnTimer: 1000, pos: { x: 35, y: 0, z: 35 } });
  const sync = () => {
    for (const [source, dest] of [[f.bot, actor], [f.target, enemy], [ally, friendly]] as const) {
      dest.pos = { ...source.pos }; dest.vel = { ...source.vel }; dest.yaw = source.yaw + Math.PI;
      dest.team = source.team; dest.hp = dest.maxHp = source.hp; dest.alive = true; dest.controller = 'ai';
      dest.invulnerabilityTimer = dest.respawnTimer = dest.weaponReadyTimer = dest.swapLockoutTimer = 0;
      dest.weapon = source.activeWeapon === 'sword' ? 'sword' : source.activeWeapon === 'ball' ? 'ball' : 'hammer';
      dest.weaponState = source.weaponState === 'swing_up' ? 'windup' : 'idle';
      dest.attackKind = dest.weaponState === 'idle' ? 'none' : dest.weapon === 'sword' ? 'slash' : 'strike';
      dest.weaponPhaseElapsed = 0;
    }
  };
  sync();
  const derived = deriveAIParams(f.state.settings, knobs), getMatchScoreContext = () => ({ scorePlayer: 0, scoreEnemy: 0 });
  const targets = createTacticalTargetCallbacksForState({ getState: () => f.state, getMainAI: () => f.state.otherPlayers.get('main_ai'),
    getRosterAI: () => [...f.state.otherPlayers.values()], resolveRosterSlot: () => ({ difficulty: 'normal' } as any),
    resolveBotKnobs: () => knobs, resolveBotDerived: () => derived, getMatchScoreContext });
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: f.state }, threeRef: { current: f.refs },
    mai: () => f.state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs, resolveBotDerived: () => derived,
    resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS, getMatchScoreContext, ...targets,
    grifballEnemyGoalPos: () => ({ x: 0, y: 0, z: 30 }), getActiveCustomMap: () => f.map, getTargetPlayerModel: () => null,
    constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: 40 }),
    recordCombatantObservation: noop, tryEnterPressureState: () => false, tryStartComboOnHit: () => false,
    recoverCombatantAltitude: () => false, clearPressureTarget: noop, startAIHammerJump: () => false, isTargetOnCooldown: () => false,
    triggerCombatantAttack: (self, weapon, melee = false) => triggerCombatantAttackAction({ self, weapon, melee, recordHammerAttack: noop, playSwing: noop }),
    triggerCombatantLunge: (self, lungeDir, pos, vel) => triggerCombatantLungeAction({ self, lungeDir, pos, vel, settings: f.state.settings, playDash: noop }),
    swapCombatantWeapon: noop, playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop });
  return { ...f, ally, actor, enemy, friendly, sync, update };
}

for (const weapon of ['hammer', 'sword', 'ball'] as const) for (const model of ['medium', 'large'] as const)
  for (const crouch of [false, true]) test(`planned ${weapon} hits an enemy without allied damage: ${model}/${crouch}`, () => {
    const f = fixture(); f.bot.activeWeapon = weapon; f.ally.modelType = model; f.ally.isCrouching = crouch;
    if (weapon === 'sword') { f.target.pos.z = 2; f.ally.pos.set(1.3, 0, 1.5); }
    if (weapon === 'ball') { f.target.pos.set(-.25, 0, 1.1); f.ally.pos.set(.8, 0, .9); }
    const plan = planLiveTeamSafeAim(f.state, f.bot, f.bot.yaw, false, f.map, f.target.id);
    assert.equal(plan.kind, 'aim'); if (plan.kind !== 'aim') return;
    f.bot.yaw = Math.atan2(-plan.heading.x, -plan.heading.z);
    f.impact(f.bot.id);
    assert.ok(f.target.hp < 20, 'use the real impact resolver, not a predicted hit count');
    assert.equal(f.ally.hp, 20, 'real friendly fire must miss the ally');
  });

for (const id of ['main_ai', 'bot']) for (const attack of ['slam', 'swipe', 'slash', 'punch'] as const)
  test(`production updater offsets a committed ${attack} ${id} and follows through`, () => {
    const f = fixture(id);
    if (attack === 'slash') { f.bot.activeWeapon = 'sword'; f.target.pos.z = 2; f.ally.pos.set(1.3, 0, 1.5); }
    if (attack === 'punch') { f.bot.activeWeapon = 'ball'; f.target.pos.set(-.25, 0, 1.1); f.ally.pos.set(.8, 0, .9); }
    f.attack(attack === 'swipe'); f.bot.aiState = 'COOLDOWN'; f.bot.aiTimer = 1;
    const random = seededRandom(15); let offsetFrames = 0;
    for (let tick = 0; tick < 35; tick++) {
      withSimulationRandom(random, tick * dt, () => f.update(id, dt));
      if (Math.abs(Math.sin(f.bot.yaw)) > .1) offsetFrames++;
      f.visuals(dt);
      assert.equal(f.ally.hp, 20, `ally survives frame ${tick}`);
    }
    assert.ok(offsetFrames > 0); assert.ok(f.target.hp < 20, 'do not solve friendly fire by never striking');
  });

test('live AI and composed simulator find a lane and attack after friendly crowding', () => {
  const f = fixture(); f.ally.pos.set(0, 0, .6); f.target.pos.z = 5; f.sync();
  const mem = memory(), context = createAIMatchContext(), liveRandom = seededRandom(9), simRandom = seededRandom(9);
  const control = { scriptedBots: { bot: 'normal' }, configs: { bot: { knobs, derived: deriveAIParams(f.state.settings, knobs), flags: NEUTRAL_PERSONALITY_FLAGS } },
    memories: { bot: mem, target: memory(), ally: memory() }, matchContext: context, random: simRandom, isObserverMode: true,
    getScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0 }), navigation: {}, spawnPoints: f.map.spawnPoints };
  let repositioned = false;
  for (let tick = 0; tick < 600; tick++) {
    withSimulationRandom(liveRandom, tick * dt, () => f.update('bot', dt)); f.visuals(dt);
    stepSimulation(f.sim, {}, createSimGrifballActorStepOptions(f.sim, control, dt));
    repositioned ||= Math.hypot(f.bot.pos.x, f.bot.pos.z) > .5;
    assert.equal(f.ally.hp, 20); assert.equal(f.friendly.hp, 20);
    if (f.target.hp < 20 && f.enemy.hp < 20) break;
  }
  assert.ok(repositioned); assert.ok(f.target.hp < 20); assert.ok(f.enemy.hp < 20);
});

test('late teammate entry cancels an unsafe windup, but not completed sword damage/recovery', () => {
  const f = fixture(); f.ally.pos.set(15, 0, 0); f.attack(); f.bot.aiState = 'COOLDOWN'; f.bot.aiTimer = 1;
  for (let tick = 0; tick < 8; tick++) { f.update('bot', dt); f.visuals(dt); }
  assert.equal(f.bot.weaponState, 'swing_up');
  f.ally.pos.copy(f.target.pos);
  f.update('bot', dt); f.visuals(1);
  assert.equal(f.bot.weaponState, 'ready'); assert.equal(f.target.hp, 20); assert.equal(f.ally.hp, 20);
  f.bot.activeWeapon = 'sword'; f.bot.weaponState = 'swing_down'; f.bot.weaponTimer = 0; f.bot.aiTimer = 1;
  f.update('bot', dt);
  assert.equal(f.bot.weaponState, 'swing_down', 'a completed contact must still pay its recovery');
});

test('safe aim placement can damage two enemies in the same real hammer impact', () => {
  const f = fixture(); f.ally.pos.set(3, 0, 3);
  const second = createOfflineBotCombatant({ id: 'second', playerName: 'Second', team: 'red', spawnPos: new THREE.Vector3(-1, 0, 4),
    yaw: 0, hue: 0, difficulty: 'normal', settings: f.state.settings });
  second.hp = second.maxHp = 20; second.invulnerabilityTimer = second.respawnTimer = 0;
  f.state.otherPlayers.set(second.id, second);
  const plan = planLiveTeamSafeAim(f.state, f.bot, f.bot.yaw, false, f.map, f.target.id);
  assert.equal(plan.kind, 'aim'); if (plan.kind !== 'aim') return;
  f.bot.yaw = Math.atan2(-plan.heading.x, -plan.heading.z); f.impact(f.bot.id);
  assert.ok(f.target.hp < 20); assert.ok(second.hp < 20); assert.equal(f.ally.hp, 20);
});

for (const phase of ['countdown', 'scored', 'matchEnd'] as const) test(`teammate-aware movement stays paused during ${phase}`, () => {
  const f = fixture(); f.ally.pos.set(0, 0, .6); f.state.grifball.phase = f.sim.match.phase = phase;
  assert.equal(planLiveTeamSafeAim(f.state, f.bot, f.bot.yaw, false, f.map).kind, 'unchanged');
  const before = structuredClone(f.actor);
  assert.equal(applySimTeamSafeAim(f.sim, f.actor, memory(), { x: 0, z: 0, vy: 0, lunging: false }, dt, true), false);
  assert.deepEqual(f.actor, before);
});

test('simulator rejects new blocked lunges without cancelling flights already launched', () => {
  const f = fixture(); f.actor.weapon = 'sword'; f.actor.isLunging = true; f.actor.lungeDir = { x: 0, y: 0, z: 1 };
  f.enemy.pos.z = 9; f.friendly.pos = { x: 0, y: 0, z: 3 }; const mem = memory();
  const start = { x: 0, z: 0, vy: 0, lunging: false };
  assert.equal(applySimTeamSafeAim(f.sim, f.actor, mem, start, dt, true, f.enemy.id), true);
  assert.equal(f.actor.isLunging, false); assert.equal(mem.aiState, 'SIDE_STEPPING');
  f.actor.isLunging = true;
  assert.equal(applySimTeamSafeAim(f.sim, f.actor, mem, { ...start, lunging: true }, dt, true, f.enemy.id), false);
  assert.equal(f.actor.isLunging, true);
});

test('local human teammates are included; spectators and respawning allies are excluded', () => {
  const f = fixture(); f.state.otherPlayers.delete('ally'); f.state.isObserverMode = false;
  f.state.localPlayerTeam = 'blue'; f.state.playerPos.copy(f.target.pos); f.state.playerInvulnerabilityTimer = 0;
  assert.equal(planLiveTeamSafeAim(f.state, f.bot, f.bot.yaw, false, f.map).kind, 'hold');
  f.state.playerRespawnTimer = 1;
  assert.equal(planLiveTeamSafeAim(f.state, f.bot, f.bot.yaw, false, f.map).kind, 'unchanged');
  f.state.playerRespawnTimer = 0; f.state.isObserverMode = true;
  assert.equal(planLiveTeamSafeAim(f.state, f.bot, f.bot.yaw, false, f.map).kind, 'unchanged');
});
