import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitialTournamentRounds,
  buildNextTournamentRoundMatches,
  generateTournamentOpponents,
  getTournamentBotCount,
  getTournamentRoundLabels,
  simulateBotMatch,
} from './tournament';
import { DEFAULT_NEURAL_BRAIN_ID, NEURAL_NET_DIFFICULTY } from '../../game/neuralBrains';

test('builds the expected tournament bracket shape', () => {
  assert.equal(getTournamentBotCount(3), 7);
  assert.deepEqual(getTournamentRoundLabels(3), ['Quarterfinals', 'Semifinals', 'Final']);

  const rounds = buildInitialTournamentRounds(3);
  assert.equal(rounds.length, 3);
  assert.equal(rounds[0].length, 4);
  assert.deepEqual(rounds[0][0], { opponent1: 'player', opponent2: 'bot_1', isCompleted: false });
  assert.equal(rounds[1].length, 2);
  assert.equal(rounds[2].length, 1);
});

test('builds next-round matches from winners', () => {
  assert.deepEqual(buildNextTournamentRoundMatches(['player', 'bot_2']), [
    { opponent1: 'player', opponent2: 'bot_2', isCompleted: false },
  ]);
});

test('simulates bot matches without changing match identity', () => {
  const match = { opponent1: 'bot_1', opponent2: 'bot_2', isCompleted: false };
  const result = simulateBotMatch(match, {
    bot_1: {
      id: 'bot_1',
      name: 'One',
      hue: 10,
      difficulty: 'normal',
      reactionLatency: 0.2,
      anticipationFactor: 0.4,
      movementComplexity: 50,
      weaponSwapIQ: 50,
      playstyle: 50,
      behavior: 'defensive',
    },
    bot_2: {
      id: 'bot_2',
      name: 'Two',
      hue: 20,
      difficulty: 'normal',
      reactionLatency: 0.2,
      anticipationFactor: 0.4,
      movementComplexity: 50,
      weaponSwapIQ: 50,
      playstyle: 50,
      behavior: 'aggressive',
    },
  }, 25);

  assert.equal(result.isCompleted, true);
  assert.ok(result.winner === 'bot_1' || result.winner === 'bot_2');
  assert.ok(result.score1 !== undefined);
  assert.ok(result.score2 !== undefined);
});

test('generateTournamentOpponents assigns a combat archetype to each bot', () => {
  const opponents = generateTournamentOpponents('hard', 7);
  assert.equal(Object.keys(opponents).length, 7);
  for (const opp of Object.values(opponents)) {
    assert.ok(opp.archetype);
    assert.ok(['passive', 'defensive', 'aggressive'].includes(opp.behavior));
  }
});

test('generateTournamentOpponents with single custom preset uses that preset for all bots', () => {
  const mockPreset = {
    id: 'ai_preset_1',
    name: 'Custom Brawler',
    tuning: {
      aiReactionLatency: 0.12,
      aiAnticipationFactor: 0.85,
      aiMovementComplexity: 75,
      aiWeaponSwapIQ: 80,
      aiPlaystyle: 90,
      aiWeaponPrioritization: 40,
    }
  };

  const opponents = generateTournamentOpponents('custom', 3, [mockPreset]);
  assert.equal(Object.keys(opponents).length, 3);
  for (const opp of Object.values(opponents)) {
    assert.equal(opp.difficulty, 'custom');
    assert.equal(opp.reactionLatency, 0.12);
    assert.equal(opp.anticipationFactor, 0.85);
    assert.equal(opp.movementComplexity, 75);
    assert.equal(opp.weaponSwapIQ, 80);
    assert.equal(opp.playstyle, 90);
    assert.equal(opp.behavior, 'aggressive');
    assert.equal(opp.archetype, 'none');
  }
});

test('generateTournamentOpponents with multiple custom presets randomly assigns them', () => {
  const mockPreset1 = {
    id: 'ai_preset_1',
    name: 'Preset One',
    tuning: {
      aiReactionLatency: 0.1,
      aiAnticipationFactor: 0.9,
      aiMovementComplexity: 80,
      aiWeaponSwapIQ: 80,
      aiPlaystyle: 10,
      aiWeaponPrioritization: 50,
    }
  };

  const mockPreset2 = {
    id: 'ai_preset_2',
    name: 'Preset Two',
    tuning: {
      aiReactionLatency: 0.4,
      aiAnticipationFactor: 0.2,
      aiMovementComplexity: 30,
      aiWeaponSwapIQ: 30,
      aiPlaystyle: 90,
      aiWeaponPrioritization: 50,
    }
  };

  const opponents = generateTournamentOpponents('custom', 10, [mockPreset1, mockPreset2]);
  assert.equal(Object.keys(opponents).length, 10);
  
  let usedPreset1 = false;
  let usedPreset2 = false;

  for (const opp of Object.values(opponents)) {
    assert.equal(opp.difficulty, 'custom');
    assert.equal(opp.archetype, 'none');
    if (opp.reactionLatency === 0.1) {
      assert.equal(opp.anticipationFactor, 0.9);
      assert.equal(opp.movementComplexity, 80);
      assert.equal(opp.weaponSwapIQ, 80);
      assert.equal(opp.playstyle, 10);
      assert.equal(opp.behavior, 'passive');
      usedPreset1 = true;
    } else if (opp.reactionLatency === 0.4) {
      assert.equal(opp.anticipationFactor, 0.2);
      assert.equal(opp.movementComplexity, 30);
      assert.equal(opp.weaponSwapIQ, 30);
      assert.equal(opp.playstyle, 90);
      assert.equal(opp.behavior, 'aggressive');
      usedPreset2 = true;
    } else {
      assert.fail('Generated bot tuning does not match any selected preset');
    }
  }

  assert.ok(usedPreset1);
  assert.ok(usedPreset2);
});

test('generateTournamentOpponents can seed a NeuralNet CombatDRV2 bracket', () => {
  const opponents = generateTournamentOpponents(NEURAL_NET_DIFFICULTY, 4, undefined, DEFAULT_NEURAL_BRAIN_ID);

  assert.equal(Object.keys(opponents).length, 4);
  for (const opp of Object.values(opponents)) {
    assert.equal(opp.difficulty, NEURAL_NET_DIFFICULTY);
    assert.equal(opp.neuralBrainId, DEFAULT_NEURAL_BRAIN_ID);
    assert.equal(opp.behavior, 'aggressive');
    assert.equal(opp.archetype, 'neural_net');
    assert.ok(opp.reactionLatency <= 0.02);
    assert.ok(opp.movementComplexity >= 95);
  }
});
