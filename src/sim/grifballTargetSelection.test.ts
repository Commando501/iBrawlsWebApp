import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from './factory';
import { resolveSimGrifballTargetSelection } from './grifballTargetSelection';
import { createAIMatchContext } from '../game/aiMatchContext';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createOfflineBotCombatant } from '../game/roster';
import { getBestTacticalTargetFromState } from '../components/grifball/tacticalTargets';
import type { LungeAIMemory } from './scriptedLungeFeedback';
import type { GrifballAssignment } from '../game/aiGrifballTeamPlan';
import { selectAIEngagementTarget } from '../game/aiEngagementTarget';
import { stepSimulation } from './step';
import { idleAction } from './actions';
import { resolveSimGrifballCombatObservation } from './grifballCombatObservation';

const referencePath = '../../output/m7-target-selection-reference';
const liveSelect = process.env.M7_TARGET_SELECTION_REFERENCE
  ? (await import(referencePath)).getBestTacticalTargetFromState : getBestTacticalTargetFromState;
function fixture(id = 'ordinary') {
  const sim = createMatch({ seed: 65, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 3 },
    settings: { aiDifficulty: 'normal', maxHP: 20 } });
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: sim.settings, multiplayerRole: null, isMultiplayer: false });
  live.isObserverMode = false; live.otherPlayers.clear(); live.localPlayerTeam = 'red'; live.arenaRadius = sim.map.arenaRadius;
  const ids = [id, 'near', 'far', 'player'];
  const memories: Record<string, LungeAIMemory> = {};
  sim.localPlayerId = 'player'; sim.match.phase = 'playing';
  for (const [i, c] of sim.combatants.entries()) {
    c.id = ids[i]; c.team = i === 0 ? 'blue' : 'red'; c.controller = i === 3 ? 'remote' : 'ai';
    c.pos = { x: [0, 3, 7, 30][i], y: 0, z: 0 }; c.vel = { x: 0, y: 0, z: 0 };
    c.invulnerabilityTimer = c.respawnTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0; c.hp = c.maxHp = 20;
    memories[c.id] = { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 };
  }
  const aiContext = createAIMatchContext(), owners: Record<string, string> = { [id]: 'normal', near: 'normal', far: 'normal' };
  const context = { plan: aiContext.grifballTeamPlan, coordinator: aiContext.coordinator, memories, aiPlaystyle: 50, spatialIQ: 70, isObserverMode: false };
  const sync = () => {
    for (const c of sim.combatants.filter(c => c.id !== 'player')) {
      const bot = createOfflineBotCombatant({ id: c.id, playerName: c.id, team: c.team,
        spawnPos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z), yaw: 0, hue: 0, difficulty: owners[c.id], settings: sim.settings });
      Object.assign(bot, { hp: c.hp, maxHp: c.maxHp, activeWeapon: c.weapon,
        weaponState: c.weaponState === 'idle' ? 'ready' : c.weaponState === 'windup' ? 'swing_up' : c.weaponState === 'active' ? 'swing_down' : c.weaponState,
        invulnerabilityTimer: c.invulnerabilityTimer, respawnTimer: c.respawnTimer, aiState: memories[c.id].aiState, aiTimer: memories[c.id].timer });
      live.otherPlayers.set(c.id, bot);
    }
    const p = sim.combatants[3]; live.playerHP = p.hp; live.playerMaxHP = p.maxHp; live.playerRespawnTimer = p.respawnTimer;
    live.playerInvulnerabilityTimer = p.invulnerabilityTimer; live.playerPos.set(p.pos.x, p.pos.y, p.pos.z); live.playerVel.set(p.vel.x, p.vel.y, p.vel.z);
    live.activeWeapon = p.weapon; live.pWeaponState = 'ready'; live.pSwordState = 'ready';
    live.aiMatchContext.coordinator = context.coordinator; live.isObserverMode = context.isObserverMode;
  };
  const run = () => resolveSimGrifballTargetSelection(sim, id, owners, context);
  return { sim, live, self: sim.combatants[0], near: sim.combatants[1], far: sim.combatants[2], context, owners, sync, run };
}

for (const id of ['ordinary', 'main_ai']) for (const difficulty of ['easy', 'normal', 'hard', 'nightmare'])
  for (const weapon of ['hammer', 'sword'] as const) for (const situation of ['ready', 'recovering', 'protected', 'injured', 'coordinated'])
    test(`ranking agrees with live ${id}/${difficulty}/${weapon}/${situation}`, () => {
      const f = fixture(id); f.owners[id] = difficulty; f.self.weapon = weapon;
      if (situation === 'recovering') f.context.memories.far = { aiState: 'COOLDOWN', timer: 1, cooldownMultiplier: 1 };
      if (situation === 'protected') f.near.invulnerabilityTimer = 1;
      if (situation === 'injured') f.far.hp = 10;
      if (situation === 'coordinated') {
        f.context.coordinator.priorityTargetId = 'far'; f.context.coordinator.taggerBotId = 'near';
        f.context.coordinator.recentTags.set('far', new Map([['near', 2]]));
      }
      f.sync(); const before = structuredClone({ sim: f.sim, context: f.context });
      const expected = liveSelect({ state: f.live, botId: id, botPos: new THREE.Vector3(), difficulty,
        mainAI: f.live.otherPlayers.get('main_ai'), rosterAI: [...f.live.otherPlayers.values()],
        resolveBotKnobs: () => ({ aiPlaystyle: f.context.aiPlaystyle }), resolveBotDerived: () => ({ spatialIQ: f.context.spatialIQ }) });
      assert.equal(f.run()?.id, expected?.id); assert.deepEqual({ sim: f.sim, context: f.context }, before);
      if (difficulty === 'normal') assert.equal(f.run()?.id, ['recovering', 'protected', 'injured'].includes(situation) ? 'far' : 'near');
    });

test('equal scores preserve local-first then roster order; observer mode excludes the local player', () => {
  const f = fixture(); for (const c of f.sim.combatants.slice(1)) c.pos.x = 3;
  assert.equal(f.run()!.id, 'player'); f.context.isObserverMode = true;
  assert.equal(f.run()!.id, 'near'); f.sim.combatants.splice(1, 2, f.far, f.near);
  assert.equal(f.run()!.id, 'far');
});

function assigned(f: ReturnType<typeof fixture>, targetId: string | null = 'far') {
  const a: GrifballAssignment = { botId: f.self.id, team: 'blue', role: 'lead', slot: 0,
    destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: null, reason: 'test',
    tanking: { mode: 'engage', targetId, partnerId: null, recoveryId: null, attack: true, doubleCommit: false, reason: 'test', candidates: [] } };
  f.context.plan.assignments.set(f.self.id, a);
  f.context.plan.snapshot = { round: 1, playing: true, holderId: null, ball: { x: 0, z: 0 }, spacing: 3,
    goals: { blue: null, red: null }, players: f.sim.combatants.map(c => ({ id: c.id, team: c.team,
      pos: { x: c.id === 'far' ? 2 : c.pos.x, z: 0 }, vel: { x: 0, z: 0 }, scripted: c.controller === 'ai' })) };
}
for (const finishing of ['none', 'lunge', 'dash', 'slide'] as const) test(`assignment selection respects finishing movement ${finishing}`, () => {
  const f = fixture(); assigned(f); f.context.memories.ordinary.aiState = 'PRESSURING'; f.context.memories.ordinary.pressureTargetId = 'player';
  if (finishing === 'lunge') f.self.isLunging = true;
  if (finishing === 'dash') f.self.dashRemaining = .2;
  if (finishing === 'slide') f.self.slideActive = true;
  assert.equal(f.run()?.id, finishing === 'none' ? 'far' : 'near');
});
test('assignment snapshot chooses the threat but selected target uses current pose and life', () => {
  const f = fixture(); assigned(f); f.far.pos.x = 22;
  const result = f.run()!; assert.equal(result.id, 'far'); assert.equal(result.pos.x, 22);
  result.pos.x = 123; assert.equal(f.far.pos.x, 22);
  f.far.alive = false; assert.equal(f.run(), null, 'missing assigned target must not select a different duel');
});
test('unassigned pressure lock overrides best only while pressuring and available', () => {
  const f = fixture(); f.context.memories.ordinary.pressureTargetId = 'far';
  assert.equal(f.run()!.id, 'near'); f.context.memories.ordinary.aiState = 'PRESSURING'; assert.equal(f.run()!.id, 'far');
  f.far.alive = false; assert.equal(f.run()!.id, 'near');
});
test('targetless assignment does not invoke best-target fallback', () => {
  let called = false;
  const target = selectAIEngagementTarget({ hasAssignment: true, assignmentThreat: null, finishingMovement: false,
    aiState: 'PRESSURING', pressureTargetId: 'locked', getById: () => { called = true; return {}; }, getBest: () => { called = true; return {}; } });
  assert.equal(target, null); assert.equal(called, false);
});
for (const kind of ['dead', 'respawn', 'paused', 'local', 'remote', 'neural', 'unowned'] as const)
  test(`target selection refuses inactive actor ${kind}`, () => {
    const f = fixture();
    if (kind === 'dead') f.self.alive = false;
    if (kind === 'respawn') f.self.respawnTimer = 1;
    if (kind === 'paused') f.sim.match.phase = 'countdown';
    if (kind === 'local') f.sim.localPlayerId = f.self.id;
    if (kind === 'remote') f.self.controller = 'remote';
    if (kind === 'neural') f.owners.ordinary = 'neural-net';
    if (kind === 'unowned') delete f.owners.ordinary;
    const before = structuredClone(f.context); assert.equal(f.run(), null); assert.deepEqual(f.context, before);
  });
test('target projection rejects missing AI memory rather than inventing a ready opponent', () => {
  const f = fixture(); delete f.context.memories.far;
  assert.throws(f.run, /Missing tactical target memory/);
});

for (const kind of ['teammate', 'dead', 'respawn', 'remote'] as const) test(`candidate filtering excludes ${kind}`, () => {
  const f = fixture();
  if (kind === 'teammate') f.near.team = 'blue';
  if (kind === 'dead') f.near.alive = false;
  if (kind === 'respawn') f.near.respawnTimer = 1;
  if (kind === 'remote') f.near.controller = 'remote';
  assert.equal(f.run()!.id, 'far');
});

for (const id of ['ordinary', 'main_ai']) for (const dt of [1 / 60, 1 / 30])
  test(`scheduled selection supplies retained engagement observations ${id}/${dt}`, () => {
    const f = fixture(id); const restored = structuredClone(f.sim); let selected = '';
    const advance = (state: typeof f.sim) => stepSimulation(state, {}, { settings: state.settings, dt,
      scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' },
        prepare: ({ state: current }) => {
          selected = resolveSimGrifballTargetSelection(current, id, f.owners, f.context)!.id; return 'engagement';
        }, resolve: ({ state: current }) => {
          const observation = resolveSimGrifballCombatObservation(current, id, selected, f.owners,
            { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 0, playstyleFactor: .5 }, dt)!;
          assert.equal(observation.targetId, 'near'); return { kind: 'handled', action: idleAction() };
        } } });
    for (let tick = 0; tick < 60; tick++) {
      assert.deepEqual(advance(f.sim), advance(restored)); assert.deepEqual(f.sim, restored);
    }
  });
