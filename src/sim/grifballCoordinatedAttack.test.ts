import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { idleAction } from './actions';
import { stepSimulation } from './step';
import { createBotCoordinator, registerBotEngagement } from '../game/aiBotCoordinator';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { shouldBlockCoordinatedAttackForFrame } from '../components/grifball/aiCoordinationRuntime';
import { resolveSimGrifballCombatObservation } from './grifballCombatObservation';
import { resolveSimGrifballCoordinatedAttack } from './grifballCoordinatedAttack';
import type { TacticalAIMemory } from './grifballTacticalWeaponChoice';

function fixture(difficulty = 'normal', main = false) {
  const state = createMatch({ seed: 12, combatExecution: 'live-mixed-v1', teamSizes: { blue: 3, red: 2 },
    settings: { aiDifficulty: difficulty, maxHP: 20 } });
  const [first, second, self, target, player] = state.combatants;
  [first.id, second.id, self.id, target.id, player.id] = [main ? 'main_ai' : 'a', 'n', 'z', 'target', 'player'];
  first.team = second.team = self.team = 'blue'; target.team = player.team = 'red';
  player.controller = 'remote'; state.localPlayerId = player.id; state.match.phase = 'playing';
  const owners: Record<string, string> = {}, memories: Record<string, TacticalAIMemory> = {};
  for (const [i, c] of state.combatants.entries()) {
    c.pos = { x: i * 5, y: 0, z: 0 }; c.vel = { x: 0, y: 0, z: 0 };
    c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
    if (c !== player) { c.controller = 'ai'; owners[c.id] = difficulty; memories[c.id] = { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 }; }
  }
  const coordinator = createBotCoordinator();
  for (const c of [first, second, self]) registerBotEngagement(coordinator, c.id, target.id);
  const context = { coordinator, memories, commitTimer: 2 };
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80, playstyleFactor: .5 };
  const read = () => {
    const observation = resolveSimGrifballCombatObservation(state, self.id, target.id, owners, tuning);
    if (!observation) throw new Error('fixture engagement unavailable');
    return observation;
  };
  const gate = () => resolveSimGrifballCoordinatedAttack(state, self.id, owners, read(), context)!.blocked;
  return { state, first, second, self, target, player, owners, context, read, gate, tuning };
}

for (const difficulty of ['easy', 'normal', 'hard']) for (const main of [false, true])
  for (const phase of ['ready', 'windup', 'active', 'recovering', 'swipe', 'flight', 'ai-lunge', 'ai-cooldown'] as const)
    test(`coordinated attack matches live phase gate ${difficulty}/${main}/${phase}`, () => {
      const f = fixture(difficulty, main); f.context.memories.target.aiState = 'COOLDOWN'; f.context.memories.target.timer = 1;
      const physical = phase === 'windup' || phase === 'active' || phase === 'recovering' ? phase : phase === 'swipe' ? 'windup' : 'idle';
      f.first.weaponState = physical; f.first.attackKind = phase === 'swipe' ? 'swipe' : 'strike'; f.first.isLunging = phase === 'flight';
      f.context.memories[f.first.id].aiState = phase === 'ai-lunge' ? 'LUNGING' : phase === 'ai-cooldown' ? 'COOLDOWN' : 'APPROACHING';
      const firstLive = { aiState: f.context.memories[f.first.id].aiState, isLunging: f.first.isLunging,
        weaponState: phase === 'windup' ? 'swing_up' : phase === 'active' ? 'swing_down' : phase === 'swipe' ? 'melee_up' : phase === 'recovering' ? 'recovering' : 'ready' };
      const before = structuredClone({ state: f.state, context: f.context });
      const result = f.gate();
      assert.equal(result, shouldBlockCoordinatedAttackForFrame({ coordinator: f.context.coordinator, botId: f.self.id,
        targetId: f.target.id, difficulty, commitTimer: 2, attackStaggerStep: resolveBehaviorTuning(f.state.settings).attackStaggerStep,
        targetWeaponState: 'recovering', targetRecovering: true, mainAI: main ? firstLive : undefined,
        otherPlayers: new Map([[f.first.id, firstLive]]) }));
      assert.equal(result, difficulty !== 'easy' && ['windup', 'active', 'flight', 'ai-lunge'].includes(phase));
      assert.deepEqual({ state: f.state, context: f.context }, before, 'gate does not spend memory or clocks');
    });

for (const phase of ['ready', 'windup', 'active', 'recovering', 'swipe', 'swipe-recovery', 'ai-cooldown'] as const)
  test(`punisher opening uses current target phase: ${phase}`, () => {
    const f = fixture(); f.target.weaponState = phase === 'windup' || phase === 'active' || phase === 'recovering' ? phase
      : phase === 'swipe' ? 'windup' : phase === 'swipe-recovery' ? 'recovering' : 'idle';
    f.target.attackKind = phase.startsWith('swipe') ? 'swipe' : 'strike';
    if (phase === 'ai-cooldown') { f.context.memories.target.aiState = 'COOLDOWN'; f.context.memories.target.timer = 1; }
    assert.equal(f.gate(), ['ready', 'swipe', 'swipe-recovery'].includes(phase));
  });

for (const role of ['pressure', 'flanker', 'punisher'] as const) for (const offset of [-.001, 0, .001])
  test(`coordinated attack commit delay boundary ${role}/${offset}`, () => {
    const f = fixture(); f.context.coordinator.tacticalEngagements.set(f.self.id, { targetId: f.target.id, role });
    f.target.weaponState = 'recovering';
    const delay = ['pressure', 'flanker', 'punisher'].indexOf(role) * resolveBehaviorTuning(f.state.settings).attackStaggerStep;
    f.context.commitTimer = Math.max(0, delay + offset);
    assert.equal(f.gate(), offset < 0 && role !== 'pressure');
  });

test('single engagement and different targets cannot block attacks', () => {
  const f = fixture(); f.first.weaponState = 'windup'; f.context.commitTimer = 0;
  f.context.coordinator.engagements.set(f.first.id, 'other'); f.context.coordinator.engagements.delete(f.second.id);
  assert.equal(f.gate(), false);
});

test('later-phase attacks do not block an earlier role; missing actors are ignored', () => {
  const f = fixture(); f.first.weaponState = 'windup'; f.target.weaponState = 'recovering';
  f.context.coordinator.tacticalEngagements.set(f.self.id, { targetId: f.target.id, role: 'pressure' });
  f.context.coordinator.tacticalEngagements.set(f.first.id, { targetId: f.target.id, role: 'punisher' });
  assert.equal(f.gate(), false);
  f.state.combatants.splice(f.state.combatants.indexOf(f.first), 1);
  f.context.coordinator.tacticalEngagements.delete(f.self.id); assert.equal(f.gate(), false);
});

test('local target does not require AI memory', () => {
  const f = fixture(); const observation = resolveSimGrifballCombatObservation(f.state, f.self.id, f.player.id, f.owners, f.tuning)!;
  for (const c of [f.first, f.second, f.self]) f.context.coordinator.engagements.set(c.id, f.player.id);
  f.player.weaponState = 'recovering';
  assert.deepEqual(resolveSimGrifballCoordinatedAttack(f.state, f.self.id, f.owners, observation, f.context), { blocked: false });
});

for (const main of [false, true]) test(`scheduled coordination reads an earlier physical swing before animation: ${main}`, () => {
  const f = fixture('normal', main); let checked = false;
  f.target.weaponState = 'recovering'; f.target.weaponTimer = 10;
  stepSimulation(f.state, {}, { settings: f.state.settings,
    scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [f.first.id]: 'normal', [f.self.id]: 'normal' },
      resolve: ({ actorId }) => {
        if (actorId === f.first.id) return { kind: 'handled', action: { ...idleAction(), attackPrimary: true } };
        assert.equal(f.first.weaponState, 'windup'); assert.equal(f.first.weaponPhaseElapsed, 0);
        assert.equal(f.context.memories[f.first.id].aiState, 'APPROACHING', 'physical commitment alone must block');
        assert.equal(f.gate(), true); checked = true;
        return { kind: 'handoff', reason: 'wait for earlier attacking teammate' };
      },
    } });
  assert.equal(checked, true); assert.equal(f.self.weaponState, 'idle'); assert.equal(f.first.weaponPhaseElapsed, 1 / 60);
});

for (const defect of ['memory', 'target-memory', 'timer', 'negative-timer', 'engagements', 'tactics', 'duplicate', 'stale', 'actor'] as const)
  test(`coordinated attack refuses ${defect}`, () => {
    const f = fixture(), observation = f.read();
    if (defect === 'memory') delete f.context.memories[f.first.id];
    if (defect === 'target-memory') delete f.context.memories.target;
    if (defect === 'timer') f.context.commitTimer = NaN;
    if (defect === 'negative-timer') f.context.commitTimer = -1;
    if (defect === 'engagements') f.context.coordinator.engagements = {} as never;
    if (defect === 'tactics') f.context.coordinator.tacticalEngagements = {} as never;
    if (defect === 'duplicate') f.state.combatants.push(structuredClone(f.first));
    if (defect === 'stale') f.state.tick++;
    if (defect === 'actor') observation.actorId = 'other';
    const before = structuredClone({ state: f.state, context: f.context });
    assert.throws(() => resolveSimGrifballCoordinatedAttack(f.state, f.self.id, f.owners, observation, f.context));
    assert.deepEqual({ state: f.state, context: f.context }, before);
  });

for (const inactive of ['dead', 'phase', 'carrier', 'neural', 'target-dead'] as const)
  test(`coordinated attack hands off ${inactive}`, () => {
    const f = fixture(), observation = f.read();
    if (inactive === 'dead') f.self.alive = false;
    if (inactive === 'phase') f.state.match.phase = 'scored';
    if (inactive === 'carrier') f.self.hasBall = true;
    if (inactive === 'neural') f.owners[f.self.id] = 'neural-net';
    if (inactive === 'target-dead') f.target.alive = false;
    assert.equal(resolveSimGrifballCoordinatedAttack(f.state, f.self.id, f.owners, observation, f.context), null);
  });

for (const main of [false, true]) for (const dt of [1 / 30, 1 / 60])
  test(`scheduled coordinated attack reads completed ally memory and checkpoints: ${main}/${dt}`, () => {
    const f = fixture('normal', main);
    // Both stay outside melee reach; one actor's completion changes owned AI
    // state, while the later actor chooses a real attack using the shared gate.
    f.target.weaponState = 'recovering'; f.target.weaponTimer = 100;
    let restored = structuredClone({ state: f.state, context: f.context });
    const run = (state: typeof f.state, context: typeof f.context) => {
      let completions = 0;
      const before = context.memories[f.first.id].aiState;
      const events = stepSimulation(state, {}, { settings: state.settings, dt,
        scriptedActorDecisions: { version: 'scripted-actor-decision-v1', scriptedBots: { [f.first.id]: 'normal', [f.self.id]: 'normal' },
          resolve: ({ actorId }) => {
            if (actorId === f.first.id) return { kind: 'handled', action: idleAction() };
            assert.equal(completions, 1, 'ally completion must precede gate');
            const observation = resolveSimGrifballCombatObservation(state, actorId, f.target.id, f.owners, f.tuning, dt);
            if (!observation) throw new Error('scheduled engagement unavailable');
            const decision = resolveSimGrifballCoordinatedAttack(state, actorId, f.owners, observation, context, dt);
            assert.equal(decision?.blocked, state.tick % 2 === 0, 'new ally memory must control the gate');
            assert.notEqual(context.memories[f.first.id].aiState, before);
            return { kind: 'handled', action: { ...idleAction(), attackPrimary: !decision!.blocked } };
          },
          completeTurn: ({ actorId }) => {
            if (actorId === f.first.id) { completions++; context.memories[actorId].aiState = state.tick % 2 === 0 ? 'LUNGING' : 'APPROACHING'; }
          },
        } });
      return events;
    };
    for (let frame = 0; frame < 60; frame++) {
      assert.deepEqual(run(f.state, f.context), run(restored.state, restored.context));
      assert.deepEqual({ state: f.state, context: f.context }, restored);
      if ([1, 20, 45].includes(frame)) restored = structuredClone(restored);
    }
    assert.ok(f.self.lastAttackTick >= 0, 'unblocked turns execute attack intents');
  });
