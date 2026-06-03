import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_TEAM,
  DEFAULT_AI_TEAM,
  awardTeamKill,
  createEmptyTeamScores,
  installLegacyTeamScoreBridges,
  localPlayerTeamFromRole,
  opponentTeamId,
  recordTeamDeath,
  resetTeamScores,
  resolveCombatantTeam,
  setTeamRespawnTimer,
  teamScoresToMatchContext,
  teamTallyFieldAccessor,
} from './teamScoring';

test('creates empty tallies for blue and red', () => {
  const scores = createEmptyTeamScores();
  assert.deepEqual(scores.blue, { score: 0, kills: 0, deaths: 0, respawnTimer: 0, goals: 0 });
  assert.deepEqual(scores.red, { score: 0, kills: 0, deaths: 0, respawnTimer: 0, goals: 0 });
});

test('awards kills and deaths on absolute teams', () => {
  const scores = createEmptyTeamScores();
  awardTeamKill(scores, PLAYER_TEAM);
  recordTeamDeath(scores, DEFAULT_AI_TEAM);
  setTeamRespawnTimer(scores, DEFAULT_AI_TEAM, 3);
  assert.equal(scores.blue.score, 1);
  assert.equal(scores.blue.kills, 1);
  assert.equal(scores.red.deaths, 1);
  assert.equal(scores.red.respawnTimer, 3);
});

test('maps local player team from multiplayer role', () => {
  assert.equal(localPlayerTeamFromRole('host'), PLAYER_TEAM);
  assert.equal(localPlayerTeamFromRole('observer'), PLAYER_TEAM);
  assert.equal(localPlayerTeamFromRole('client'), DEFAULT_AI_TEAM);
  assert.equal(localPlayerTeamFromRole(null), PLAYER_TEAM);
});

test('bridges legacy fields to local perspective (host / sandbox)', () => {
  const host: any = {
    teamScores: createEmptyTeamScores(),
    localPlayerTeam: PLAYER_TEAM,
  };
  installLegacyTeamScoreBridges(host);

  host.scorePlayer = 5;
  host.playerKills = 4;
  host.scoreEnemy = 7;
  host.enemyDeaths = 2;

  assert.equal(host.teamScores.blue.score, 5);
  assert.equal(host.teamScores.blue.kills, 4);
  assert.equal(host.teamScores.red.score, 7);
  assert.equal(host.teamScores.red.deaths, 2);
  assert.equal(host.scorePlayer, 5);
  assert.equal(host.scoreEnemy, 7);
});

test('bridges legacy fields for multiplayer client perspective', () => {
  const host: any = {
    teamScores: createEmptyTeamScores(),
    localPlayerTeam: DEFAULT_AI_TEAM,
  };
  installLegacyTeamScoreBridges(host);

  host.scorePlayer = 3;
  host.scoreEnemy = 9;

  assert.equal(host.teamScores.red.score, 3);
  assert.equal(host.teamScores.blue.score, 9);
  assert.equal(host.scorePlayer, 3);
  assert.equal(host.scoreEnemy, 9);
});

test('builds match context from absolute team scores', () => {
  const scores = createEmptyTeamScores();
  scores.blue.score = 10;
  scores.red.score = 12;
  assert.deepEqual(teamScoresToMatchContext(scores, PLAYER_TEAM, 25), {
    scorePlayer: 10,
    scoreEnemy: 12,
    killsToWin: 25,
  });
  assert.deepEqual(teamScoresToMatchContext(scores, DEFAULT_AI_TEAM, 25), {
    scorePlayer: 12,
    scoreEnemy: 10,
    killsToWin: 25,
  });
});

test('resolves combatant team from roster defaults', () => {
  const settings = { aiDifficulty: 'normal' } as any;
  assert.equal(resolveCombatantTeam('player', settings, {}), PLAYER_TEAM);
  assert.equal(resolveCombatantTeam('main_ai', settings, {}), DEFAULT_AI_TEAM);
  assert.equal(resolveCombatantTeam('bot_2', settings, {}), DEFAULT_AI_TEAM);
});

test('absolute team accessor targets fixed team tally', () => {
  const state = {
    teamScores: createEmptyTeamScores(),
    localPlayerTeam: PLAYER_TEAM,
  };
  const scoreAcc = teamTallyFieldAccessor(() => state as any, DEFAULT_AI_TEAM, 'score');
  scoreAcc.set(11);
  assert.equal(state.teamScores.red.score, 11);
  assert.equal(scoreAcc.get(), 11);
});

test('resets all team tallies', () => {
  const scores = createEmptyTeamScores();
  awardTeamKill(scores, PLAYER_TEAM);
  resetTeamScores(scores);
  assert.equal(scores.blue.score, 0);
  assert.equal(scores.red.kills, 0);
});

test('opponentTeamId toggles between blue and red', () => {
  assert.equal(opponentTeamId(PLAYER_TEAM), DEFAULT_AI_TEAM);
  assert.equal(opponentTeamId(DEFAULT_AI_TEAM), PLAYER_TEAM);
});
