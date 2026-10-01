import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { createRng } from '../../src/sim/rng';
import { withSimulationRandom } from '../../src/game/simulationRandom';
import { resolveSimGrifballTacticalWeaponChoice, type TacticalAIMemory } from '../../src/sim/grifballTacticalWeaponChoice';
import { evaluateTacticalWeaponChoiceForState } from '../../src/components/grifball/aiTacticalWeaponRuntime';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import type { SimCombatant } from '../../src/sim/simState';
import type { WeaponState } from '../../src/types';

const phases: { name: string; weapon: SimCombatant['weapon']; phase: SimCombatant['weaponState'];
  kind: SimCombatant['attackKind']; roster: WeaponState; local: WeaponState | 'slashing'; cooldown?: boolean; lunge?: boolean }[] = [
  { name: 'ready', weapon: 'hammer', phase: 'idle', kind: 'none', roster: 'ready', local: 'ready' },
  { name: 'ai-reload', weapon: 'hammer', phase: 'idle', kind: 'none', roster: 'ready', local: 'ready', cooldown: true },
  { name: 'slam-windup', weapon: 'hammer', phase: 'windup', kind: 'strike', roster: 'swing_up', local: 'swing_up' },
  { name: 'slam-impact', weapon: 'hammer', phase: 'active', kind: 'strike', roster: 'swing_down', local: 'swing_down' },
  { name: 'slash-windup', weapon: 'sword', phase: 'windup', kind: 'slash', roster: 'swing_up', local: 'slashing' },
  { name: 'slash-recovery', weapon: 'sword', phase: 'recovering', kind: 'slash', roster: 'recovering', local: 'recovering' },
  { name: 'swipe-windup', weapon: 'hammer', phase: 'windup', kind: 'swipe', roster: 'melee_up', local: 'melee_swing' },
  { name: 'swipe-recovery', weapon: 'hammer', phase: 'recovering', kind: 'swipe', roster: 'melee_recover', local: 'melee_recover' },
  { name: 'punch-windup', weapon: 'ball', phase: 'windup', kind: 'punch', roster: 'swing_up', local: 'swing_up' },
  { name: 'lunge', weapon: 'sword', phase: 'idle', kind: 'none', roster: 'ready', local: 'ready', lunge: true },
];

function fixture(id: string, mixed: boolean, spec = phases[0]) {
  const targetId = mixed ? 'player' : id === 'main_ai' ? 'enemy' : 'main_ai';
  const f = createBotParityFixture(id, !mixed, { aiDifficulty: 'normal' }, targetId);
  const [self, other] = f.sim.combatants;
  f.sim.combatExecution = mixed ? 'live-mixed-v1' : 'live-roster-v2'; f.sim.match.phase = 'playing';
  if (mixed) f.sim.localPlayerId = targetId;
  self.id = id; other.id = targetId; self.controller = 'ai'; other.controller = mixed ? 'remote' : 'ai';
  self.weapon = f.bot.activeWeapon = 'sword'; self.weaponReadyTimer = f.bot.swapCooldownTimer = 0;
  self.pos = { x: 0, y: 0, z: 0 }; other.pos = { x: 0, y: 0, z: 2 };
  other.hp = other.maxHp = f.target.hp = f.target.maxHp = 20;
  other.invulnerabilityTimer = f.target.invulnerabilityTimer = 0;
  other.weapon = f.target.activeWeapon = spec.weapon; other.weaponState = spec.phase; other.attackKind = spec.kind;
  other.isLunging = f.target.isLunging = !!spec.lunge;
  f.target.weaponState = spec.roster; f.target.aiState = 'COOLDOWN'; f.target.aiTimer = spec.cooldown ? .5 : 0;
  const memories: Record<string, TacticalAIMemory> = { [id]: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 },
    ...(!mixed ? { [targetId]: { aiState: 'COOLDOWN', timer: spec.cooldown ? .5 : 0, cooldownMultiplier: 1 } as TacticalAIMemory } : {}) };
  if (mixed) {
    f.state.otherPlayers.delete(targetId); f.state.localPlayerTeam = 'red'; f.state.playerPos.set(0, 0, 2);
    f.state.playerHP = f.state.playerMaxHP = 20; f.state.playerInvulnerabilityTimer = 0;
    f.state.activeWeapon = spec.weapon; f.state.isLunging = !!spec.lunge;
    if (spec.weapon === 'sword') f.state.pSwordState = spec.local as typeof f.state.pSwordState;
    else f.state.pWeaponState = spec.local as typeof f.state.pWeaponState;
  }
  const owners = { [id]: 'hard' }, plan = createGrifballTeamPlanState();
  plan.snapshot = createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: owners });
  plan.assignments.set(id, { botId: id, team: self.team, role: 'lead', slot: 0,
    destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Tactical policy observation' });
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
    playstyleFactor: .5, pressureAggression: 50, weaponSwapIQ: 100, weaponPrioritization: 50 };
  return { ...f, self, other, owners, plan, memories, tuning };
}

for (const mixed of [false, true]) for (const id of ['main_ai', 'bot_2']) for (const spec of phases)
  test(`${mixed ? 'mixed' : 'roster'}/${id}/${spec.name}: tactical choice and random consumption match`, () => {
    const f = fixture(id, mixed, spec), liveRng = createRng(903), simRng = createRng(903);
    const before = structuredClone({ state: f.sim, plan: f.plan, memory: f.memories });
    for (const difficulty of ['easy', 'normal', 'hard', 'nightmare', 'custom']) {
      f.owners[id] = difficulty;
      for (const scoreContext of [{ scorePlayer: 0, scoreEnemy: 0 }, { scorePlayer: 9, scoreEnemy: 4, killsToWin: 10 }]) {
        const target = getTacticalTargetByIdFromState(f.state, id, f.other.id, [...f.state.otherPlayers.values()])!;
        const live = withSimulationRandom(liveRng.next, 0, () => evaluateTacticalWeaponChoiceForState({
          state: f.state, botId: id, target, difficulty, mainAI: f.state.otherPlayers.get('main_ai'),
          pressureAggression: f.tuning.pressureAggression, scoreContext,
          context: { weaponSwapIQ: 100, weaponPrioritization: 50, distanceToTarget: 2, combatDistanceToTarget: 2,
            canStartWeaponAction: true, weaponState: 'ready' },
        }));
        const rngBefore = simRng.getState();
        const headless = resolveSimGrifballTacticalWeaponChoice(f.sim, f.plan, id, f.owners, f.tuning, f.memories,
          { scoreContext, random: simRng.next })!;
        assert.ok(headless);
        assert.equal(headless.target.weaponState, target.weaponState);
        assert.equal(headless.target.isLunging, target.isLunging);
        assert.deepEqual(headless.decision, live);
        assert.equal(simRng.getState(), liveRng.getState(), 'branches consume the same number of draws');
        const restoredRng = createRng(0); restoredRng.setState(JSON.parse(JSON.stringify(rngBefore)));
        const restoredState = JSON.parse(JSON.stringify(f.sim));
        const restored = resolveSimGrifballTacticalWeaponChoice(restoredState, structuredClone(f.plan), id, f.owners,
          f.tuning, JSON.parse(JSON.stringify(f.memories)), { scoreContext, random: restoredRng.next });
        assert.deepEqual(restored, headless); assert.equal(restoredRng.getState(), simRng.getState());
      }
    }
    assert.deepEqual({ state: f.sim, plan: f.plan, memory: f.memories }, before);
  });

test('unknown target AI reload memory and absent deterministic RNG cannot produce a policy decision', () => {
  const f = fixture('bot_2', false), random = () => assert.fail('invalid observations cannot consume randomness');
  delete f.memories[f.other.id];
  assert.equal(resolveSimGrifballTacticalWeaponChoice(f.sim, f.plan, f.self.id, f.owners, f.tuning, f.memories,
    { random, scoreContext: { scorePlayer: 0, scoreEnemy: 0 } }), null);
  assert.throws(() => resolveSimGrifballTacticalWeaponChoice(f.sim, f.plan, f.self.id, f.owners, f.tuning, f.memories,
    { random: undefined as any, scoreContext: { scorePlayer: 0, scoreEnemy: 0 } }), /random stream/);
});

test('headless teammate proximity does not invent a crowd, while a second enemy does', () => {
  const f = fixture('bot_2', false), context = { scoreContext: { scorePlayer: 0, scoreEnemy: 0 }, random: () => 0 };
  f.sim.combatants.push({ ...structuredClone(f.self), id: 'friend', pos: { x: 1, y: 0, z: 0 } });
  assert.equal(resolveSimGrifballTacticalWeaponChoice(f.sim, f.plan, f.self.id, f.owners, f.tuning, f.memories, context)!.decision.weapon, 'sword');
  f.sim.combatants.push({ ...structuredClone(f.other), id: 'second-enemy', pos: { x: -1, y: 0, z: 0 } });
  assert.equal(resolveSimGrifballTacticalWeaponChoice(f.sim, f.plan, f.self.id, f.owners, f.tuning, f.memories, context)!.decision.weapon, 'hammer');
});
