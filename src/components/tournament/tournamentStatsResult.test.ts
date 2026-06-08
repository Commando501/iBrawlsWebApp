import assert from 'node:assert/strict';
import test from 'node:test';
import type { TournamentState } from '../../types';
import { resolveTournamentStatsResult } from './tournamentStatsResult';

function createTournamentState(overrides: Partial<TournamentState> = {}): TournamentState {
  return {
    difficulty: 'normal',
    killsToWin: 25,
    roundCount: 3,
    currentRound: 0,
    currentMatchIndex: 0,
    opponents: {
      bot_1: {
        id: 'bot_1',
        name: 'Rift Captain',
        hue: 20,
        difficulty: 'normal',
        reactionLatency: 0.4,
        anticipationFactor: 0.5,
        movementComplexity: 0.5,
        weaponSwapIQ: 0.5,
        playstyle: 50,
        behavior: 'defensive',
      },
    },
    rounds: [[{
      opponent1: 'player',
      opponent2: 'bot_1',
      isCompleted: false,
    }]],
    status: 'playing',
    ...overrides,
  };
}

test('resolveTournamentStatsResult ignores sandbox and inactive tournament states', () => {
  assert.deepEqual(resolveTournamentStatsResult({
    singlePlayerMode: 'sandbox',
    tournamentState: createTournamentState(),
    hasPendingMatchResult: false,
    stats: { scorePlayer: 25, scoreEnemy: 0 },
  }), { outcome: 'none' });

  assert.deepEqual(resolveTournamentStatsResult({
    singlePlayerMode: 'tournament',
    tournamentState: createTournamentState({ status: 'bracket' }),
    hasPendingMatchResult: false,
    stats: { scorePlayer: 25, scoreEnemy: 0 },
  }), { outcome: 'none' });
});

test('resolveTournamentStatsResult creates a pending player win result', () => {
  assert.deepEqual(resolveTournamentStatsResult({
    singlePlayerMode: 'tournament',
    tournamentState: createTournamentState(),
    hasPendingMatchResult: false,
    stats: { scorePlayer: 25, scoreEnemy: 17 },
  }), {
    outcome: 'player_win',
    matchResult: {
      winner: 'player',
      opponentName: 'Rift Captain',
      playerScore: 25,
      opponentScore: 17,
    },
  });
});

test('resolveTournamentStatsResult does not duplicate a pending player win result', () => {
  assert.deepEqual(resolveTournamentStatsResult({
    singlePlayerMode: 'tournament',
    tournamentState: createTournamentState(),
    hasPendingMatchResult: true,
    stats: { scorePlayer: 25, scoreEnemy: 17 },
  }), { outcome: 'none' });
});

test('resolveTournamentStatsResult completes the match when the opponent wins', () => {
  assert.deepEqual(resolveTournamentStatsResult({
    singlePlayerMode: 'tournament',
    tournamentState: createTournamentState(),
    hasPendingMatchResult: false,
    stats: { scorePlayer: 21, scoreEnemy: 25 },
  }), {
    outcome: 'opponent_win',
    playerScore: 21,
    opponentScore: 25,
  });
});

test('resolveTournamentStatsResult falls back to a generic opponent name', () => {
  assert.deepEqual(resolveTournamentStatsResult({
    singlePlayerMode: 'tournament',
    tournamentState: createTournamentState({ opponents: {} }),
    hasPendingMatchResult: false,
    stats: { scorePlayer: 25, scoreEnemy: 3 },
  }), {
    outcome: 'player_win',
    matchResult: {
      winner: 'player',
      opponentName: 'AI Bot',
      playerScore: 25,
      opponentScore: 3,
    },
  });
});
