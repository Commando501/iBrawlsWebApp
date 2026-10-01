import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOfflineBotCombatant } from '../../game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import type { Combatant } from '../../types';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { buildPotentialTacticalTargets, getBestTacticalTargetFromState, getTacticalTargetByIdFromState, isTacticalTargetOnCooldown } from './tacticalTargets';
import { evaluateAICombatDecision } from '../../game/aiCombatDecision';

function fixture(id: string) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' },
    isMultiplayer: false, multiplayerRole: null });
  state.isObserverMode = true;
  state.otherPlayers.clear();
  const make = (botId: string, team: 'blue' | 'red', x: number) => {
    const bot = createOfflineBotCombatant({ id: botId, playerName: botId, team,
      spawnPos: new THREE.Vector3(x, 0, 0), yaw: 0, hue: 0,
      difficulty: 'normal', settings: state.settings });
    Object.assign(bot, { invulnerabilityTimer: 0, respawnTimer: 0,
      aiState: 'COOLDOWN', aiTimer: 1, weaponState: 'ready' });
    state.otherPlayers.set(botId, bot);
    return bot;
  };
  const self = make('observer', 'blue', 0);
  const target = make(id, 'red', 5);
  return { state, self, target, make };
}

for (const id of ['main_ai', 'ordinary']) {
  test(`carrier observation distinguishes a punch from an inherited lunge: ${id}`, () => {
    const { state, target } = fixture(id);
    target.activeWeapon = 'ball';
    for (const phase of ['swing_up', 'swing_down', 'recovering', 'ready'] as const) {
      Object.assign(target, { weaponState: phase, isLunging: false, aiTimer: 0 });
      const observed = getTacticalTargetByIdFromState(state, 'observer', id, [...state.otherPlayers.values()])!;
      assert.equal(observed.activeWeapon, 'ball');
      assert.equal(observed.weaponState, phase);
      assert.equal(observed.isLunging, false, 'a stationary punch is not a sword lunge');
      const decision = evaluateAICombatDecision({ difficulty: 'hard', weaponSwapIQ: 100, currentWeapon: 'hammer',
        botHP: 1, botMaxHP: 1, distanceToTarget: 3, nearbyEnemiesCount: 0, target: observed,
        attackRange: 3.7, attackRadius: 2.1, swordLungeDistance: 8, swordLungeSpeed: 16,
        swordTradeWindowMs: 350, canStartWeaponAction: true, weaponState: 'ready', weaponPrioritization: 50, random: () => 0 });
      assert.equal(decision.bulltrueCounter, null);
    }
    // Picking up the ball during an already committed lunge must not hide it.
    target.isLunging = true;
    assert.equal(getTacticalTargetByIdFromState(state, 'observer', id, [...state.otherPlayers.values()])!.isLunging, true);
  });
  test(`target observation preserves committed weapon phases during decision cooldown: ${id}`, () => {
    const { state, target } = fixture(id);
    const phases: NonNullable<Combatant['weaponState']>[] = [
      'swing_up', 'swing_down', 'recovering', 'melee_up', 'melee_down',
      'melee_swing', 'melee_recover', 'slashing',
    ];
    for (const phase of phases) {
      target.weaponState = phase;
      const roster = [...state.otherPlayers.values()];
      assert.equal(buildPotentialTacticalTargets(state, 'observer', roster)[0].weaponState, phase);
      assert.equal(getTacticalTargetByIdFromState(state, 'observer', id, roster)?.weaponState, phase);
      assert.equal(target.aiTimer, 1, 'observation must not advance the decision timer');
      assert.equal(target.weaponState, phase, 'observation must not alter the weapon');
    }
  });

  for (const difficulty of ['normal', 'hard', 'nightmare']) {
    test(`selection distinguishes a committed attack from genuine recovery: ${id}/${difficulty}`, () => {
      const { state, self, target, make } = fixture(id);
      target.weaponState = 'swing_up';
      const recovering = make('recovering', 'red', 6);
      recovering.weaponState = 'recovering';
      const selected = getBestTacticalTargetFromState({ state, botId: self.id, botPos: self.pos,
        difficulty, mainAI: state.otherPlayers.get('main_ai'), rosterAI: [...state.otherPlayers.values()],
        resolveBotKnobs: () => ({ aiPlaystyle: 50 }), resolveBotDerived: () => ({ spatialIQ: 50 }) });
      assert.equal(selected?.id, recovering.id);
    });
  }

  test(`ready targets retain the existing decision-cooldown fallback: ${id}`, () => {
    const { state, target } = fixture(id);
    for (const weaponState of ['ready', undefined] as const) {
      target.weaponState = weaponState;
      for (const [aiState, aiTimer, expected] of [
        ['COOLDOWN', 1, 'recovering'], ['COOLDOWN', 0, 'ready'], ['APPROACHING', 1, 'ready'],
      ] as const) {
        Object.assign(target, { aiState, aiTimer });
        assert.equal(getTacticalTargetByIdFromState(state, 'observer', id, [...state.otherPlayers.values()])?.weaponState, expected);
      }
    }
  });
}

test('local carrier observation and cooldown follow punch phases instead of stale sword animation', () => {
  const { state } = fixture('ordinary');
  Object.assign(state, { isObserverMode: false, localPlayerTeam: 'red', activeWeapon: 'ball',
    playerHP: 2, playerRespawnTimer: 0, isLunging: false });
  for (const phase of ['ready', 'swing_up', 'swing_down', 'recovering'] as const) {
    state.pWeaponState = phase;
    state.pSwordState = phase === 'ready' ? 'recovering' : 'ready';
    const observed = getTacticalTargetByIdFromState(state, 'observer', 'player', [...state.otherPlayers.values()])!;
    assert.equal(observed.activeWeapon, 'ball');
    assert.equal(observed.weaponState, phase);
    assert.equal(isTacticalTargetOnCooldown(state, undefined, observed), phase !== 'ready');
  }
  state.isLunging = true;
  assert.equal(getTacticalTargetByIdFromState(state, 'observer', 'player', [])!.isLunging, true);
  state.pWeaponState = 'ready';
  assert.equal(isTacticalTargetOnCooldown(state, undefined, { id: 'player' }), true);
  state.isLunging = false;
  state.pWeaponState = 'swing_up';
  state.pSwordState = 'recovering';
  for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
    state.activeWeapon = weapon;
    const observed = getTacticalTargetByIdFromState(state, 'observer', 'player', [])!;
    assert.equal(observed.activeWeapon, weapon);
    assert.equal(observed.weaponState, weapon === 'hammer' ? 'swing_up' : 'recovering');
  }
});
