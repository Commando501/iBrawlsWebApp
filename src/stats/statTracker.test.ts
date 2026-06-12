import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameStats, MedalInfo, UniversalSettings } from '../types';
import { StatTracker, classifyKillWeapon, resolveModeKey } from './statTracker';

/**
 * Tracker tests drive synthetic GameStats frames through observeFrame the same
 * way the HUD pipeline does in the app. localStorage does not exist under
 * node:test, so persistence is a no-op and each StatTracker starts empty.
 */

const baseSettings = {
  playerName: 'Tester',
  iBrawlsKillTarget: 10,
} as unknown as UniversalSettings;

function makeStats(partial: Partial<GameStats> = {}): GameStats {
  return {
    playerKills: 0,
    playerDeaths: 0,
    scorePlayer: 0,
    scoreEnemy: 0,
    gameTime: 300,
    settings: baseSettings,
    lastDeaths: [],
    activeWeapon: 'hammer',
    ...partial,
  } as GameStats;
}

function medal(id: string): MedalInfo {
  return { id, name: id, icon: id, color: '#fff', description: '' };
}

function beginSandboxMatch(tracker: StatTracker): void {
  tracker.beginMatch({ isMultiplayer: false, gameMode: 'sandbox', singlePlayerMode: 'sandbox' });
}

test('resolveModeKey maps play context to stable mode keys', () => {
  assert.equal(resolveModeKey({ isMultiplayer: false, gameMode: 'sandbox', singlePlayerMode: 'sandbox' }), 'offline:sandbox');
  assert.equal(resolveModeKey({ isMultiplayer: false, gameMode: 'sandbox', singlePlayerMode: 'tournament' }), 'offline:tournament');
  assert.equal(resolveModeKey({ isMultiplayer: false, gameMode: 'grifball' }), 'offline:grifball');
  assert.equal(resolveModeKey({ isMultiplayer: true, gameMode: 'sandbox' }), 'online:sandbox');
  assert.equal(resolveModeKey({ isMultiplayer: true, gameMode: 'grifball' }), 'online:grifball');
});

test('classifyKillWeapon prefers the death-feed weapon and falls back to the active weapon', () => {
  assert.equal(classifyKillWeapon('sword', 'hammer'), 'sword');
  assert.equal(classifyKillWeapon('hammer_vs_hammer', 'sword'), 'hammer');
  assert.equal(classifyKillWeapon(undefined, 'pistol'), 'pistol');
  assert.equal(classifyKillWeapon(undefined, 'hammer'), 'hammer');
});

test('kills, deaths, and medals accumulate from frame diffs', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);

  tracker.observeFrame(makeStats());
  tracker.observeFrame(makeStats({
    playerKills: 1,
    scorePlayer: 1,
    lastDeaths: [{
      id: 'd1',
      attacker: 'Tester',
      victim: 'Bot',
      weapon: 'sword',
      medals: [medal('swordslayer'), medal('double')],
    }],
  }));
  tracker.observeFrame(makeStats({ playerKills: 1, playerDeaths: 1, scorePlayer: 1 }));

  const totals = tracker.getProfile().totals;
  assert.equal(totals['combat.kills'], 1);
  assert.equal(totals['combat.swordKills'], 1);
  assert.equal(totals['combat.deaths'], 1);
  assert.equal(totals['medal.swordslayer'], 1);
  assert.equal(totals['medal.double'], 1);
  assert.equal(totals['combat.medals'], 2);
  assert.equal(totals['combat.multikills'], 1, 'double medal counts as a multikill');

  const mode = tracker.getProfile().modes['offline:sandbox'];
  assert.equal(mode?.['combat.kills'], 1);
  tracker.flushToStorage();
});

test('sandbox match end is detected from the win target and commits match stats', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);

  tracker.observeFrame(makeStats());
  // Reach the kill target without ever dying -> win + flawless victory.
  tracker.observeFrame(makeStats({ playerKills: 10, scorePlayer: 10, scoreEnemy: 4 }));

  const totals = tracker.getProfile().totals;
  assert.equal(tracker.hasActiveMatch(), false);
  assert.equal(totals['match.played'], 1);
  assert.equal(totals['match.wins'], 1);
  assert.equal(totals['match.flawlessWins'], 1);
  assert.equal(totals['best.killsInMatch'], 10);
  assert.equal(totals['best.winStreak'], 1);
  tracker.flushToStorage();
});

test('killing spree personal best tracks kills between deaths', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);

  tracker.observeFrame(makeStats());
  tracker.observeFrame(makeStats({ playerKills: 3, scorePlayer: 3 }));
  tracker.observeFrame(makeStats({ playerKills: 3, playerDeaths: 1, scorePlayer: 3 }));
  tracker.observeFrame(makeStats({ playerKills: 5, playerDeaths: 1, scorePlayer: 5 }));

  assert.equal(tracker.getProfile().totals['best.killingSpree'], 3);
  tracker.flushToStorage();
});

test('grifball goals, comeback wins, and shutouts resolve from the grifball payload', () => {
  const tracker = new StatTracker();
  tracker.beginMatch({ isMultiplayer: false, gameMode: 'grifball' });

  const grifballFrame = (blue: number, red: number, phase: 'playing' | 'matchEnd', winningTeam: string | null = null) =>
    makeStats({
      grifball: {
        phase,
        blueGoals: blue,
        redGoals: red,
        goalTarget: 5,
        roundNumber: 1,
        countdown: 0,
        ballCarrierName: null,
        ballCarrierTeam: null,
        winningTeam,
        localTeam: 'blue',
        localCarrying: false,
        passCharge: 0,
      },
    });

  tracker.observeFrame(grifballFrame(0, 0, 'playing'));
  tracker.observeFrame(grifballFrame(0, 3, 'playing')); // trailing by 3
  tracker.observeFrame(grifballFrame(5, 3, 'playing'));
  tracker.observeFrame(grifballFrame(5, 3, 'matchEnd', 'blue'));

  const totals = tracker.getProfile().totals;
  assert.equal(totals['objective.teamGoals'], 5);
  assert.equal(totals['objective.goalsConceded'], 3);
  assert.equal(totals['match.wins'], 1);
  assert.equal(totals['match.comebackWins'], 1, 'trailed 0-3 before winning');
  assert.equal(totals['objective.shutoutWins'], undefined, 'conceded goals, not a shutout');

  const mode = tracker.getProfile().modes['offline:grifball'];
  assert.equal(mode?.['objective.teamGoals'], 5);
  tracker.flushToStorage();
});

test('abandoned matches keep event stats but only count as abandoned', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);

  tracker.observeFrame(makeStats());
  tracker.observeFrame(makeStats({ playerKills: 2, scorePlayer: 2 }));
  tracker.endMatch('abandoned');

  const totals = tracker.getProfile().totals;
  assert.equal(totals['combat.kills'], 2);
  assert.equal(totals['match.abandoned'], 1);
  assert.equal(totals['match.played'], undefined);
  assert.equal(totals['best.killsInMatch'], undefined, 'no personal bests for abandoned matches');
  tracker.flushToStorage();
});

test('replay and observer frames are ignored', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);

  tracker.observeFrame(makeStats({ isReplayMode: true, playerKills: 9 }));
  tracker.observeFrame(makeStats({ isObserverMode: true, playerKills: 9 }));

  assert.equal(tracker.getProfile().totals['combat.kills'], undefined);
  tracker.flushToStorage();
});

test('a fresh frame after a finished match re-arms tracking (tournament rounds)', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);

  tracker.observeFrame(makeStats());
  tracker.observeFrame(makeStats({ playerKills: 10, scorePlayer: 10, scoreEnemy: 2 }));
  assert.equal(tracker.hasActiveMatch(), false);

  // Next round starts: counters reset, timer refilled.
  tracker.observeFrame(makeStats());
  assert.equal(tracker.hasActiveMatch(), true);
  tracker.observeFrame(makeStats({ playerKills: 1, scorePlayer: 1 }));
  assert.equal(tracker.getProfile().totals['combat.kills'], 11);
  tracker.flushToStorage();
});

test('explicit endMatch wins over later frame detection and double ends are ignored', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);
  tracker.observeFrame(makeStats());
  tracker.endMatch('loss');
  tracker.endMatch('win');
  tracker.endMatch('abandoned');

  const totals = tracker.getProfile().totals;
  assert.equal(totals['match.losses'], 1);
  assert.equal(totals['match.wins'], undefined);
  assert.equal(totals['match.abandoned'], undefined);
  tracker.flushToStorage();
});

test('flush lifecycle: begin/abort/complete keep pending deltas consistent', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);
  tracker.observeFrame(makeStats());
  tracker.observeFrame(makeStats({ playerKills: 2, scorePlayer: 2 }));

  assert.equal(tracker.hasUnsyncedChanges(), true);
  const flight = tracker.beginFlush();
  assert.ok(flight);
  assert.equal(flight!.sums['combat.kills'], 2);

  // Failure path: the in-flight delta folds back into pending.
  tracker.abortFlush();
  assert.equal(tracker.hasUnsyncedChanges(), true);

  // Success path: server totals become the local baseline.
  const flight2 = tracker.beginFlush();
  assert.ok(flight2);
  tracker.completeFlush({ totals: { 'combat.kills': 50 }, modes: { 'offline:sandbox': { 'combat.kills': 50 } } });
  assert.equal(tracker.hasUnsyncedChanges(), false);
  assert.equal(tracker.getProfile().totals['combat.kills'], 50);
  tracker.flushToStorage();
});

test('stats earned while a flush is in flight survive completeFlush', () => {
  const tracker = new StatTracker();
  beginSandboxMatch(tracker);
  tracker.observeFrame(makeStats());
  tracker.observeFrame(makeStats({ playerKills: 2, scorePlayer: 2 }));

  const flight = tracker.beginFlush();
  assert.ok(flight);
  // A kill lands while the request is on the wire.
  tracker.observeFrame(makeStats({ playerKills: 3, scorePlayer: 3 }));

  // Server merged the 2 pushed kills into existing 10.
  tracker.completeFlush({ totals: { 'combat.kills': 12 }, modes: {} });
  assert.equal(tracker.getProfile().totals['combat.kills'], 13, 'server total + the unsynced kill');
  assert.equal(tracker.hasUnsyncedChanges(), true);
  tracker.flushToStorage();
});
