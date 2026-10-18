import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTournamentFlow } from './useTournamentFlow';
import { buildInitialTournamentRounds, generateTournamentOpponents } from '../../features/tournament/tournament';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { sfx } from '../AudioEngine';
import type { TournamentState, UniversalSettings } from '../../types';

test('starting or resuming a tournament overrides the previous training mode and roster', () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originals = { init: sfx.init, resume: sfx.resume, playRespawn: sfx.playRespawn };
  const noop = () => {};
  Object.assign(sfx, { init: noop, resume: noop, playRespawn: noop });
  try {
    for (const status of ['bracket', 'playing'] as const) {
      const state: TournamentState = { difficulty: 'normal', killsToWin: 25, roundCount: 1,
        currentRound: 0, currentMatchIndex: 0, status,
        opponents: generateTournamentOpponents('normal', 1), rounds: buildInitialTournamentRounds(1) };
      const storage = new Map([['ibrawls_tournament_state', JSON.stringify(state)]]);
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      } });
      let settings: UniversalSettings = { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' };
      let bots = 7;
      let playing = false;
      let flow: ReturnType<typeof useTournamentFlow>;
      function Probe() {
        flow = useTournamentFlow({ playerName: 'Pilot', multiplayerSocket: null,
          setIsMultiplayer: noop, setMultiplayerRole: noop, setMultiplayerSocket: noop,
          setMultiplayerPlayerCount: noop, setMultiplayerSpawnSlot: noop,
          setOfflineBotCount: value => { bots = typeof value === 'function' ? value(bots) : value; },
          setBotColors: noop, setBotDifficulties: noop, setBotBehaviors: noop, setBotArchetypes: noop,
          setAdminSettings: value => { settings = typeof value === 'function' ? value(settings) : value; },
          setIsPlaying: value => { playing = typeof value === 'function' ? value(playing) : value; },
          setIsPaused: noop, setIsTerminated: noop, setShowAdminPanel: noop,
          setShowUiAdjustment: noop, setShowLightingMenu: noop, onCloseTournamentGame: noop });
        return null;
      }
      renderToStaticMarkup(<Probe />);
      flow!.handleStartTournamentMatch();
      assert.equal(settings.gameMode, 'sandbox', status);
      assert.equal(bots, 1, status);
      assert.equal(playing, true, status);
      assert.equal(JSON.parse(storage.get('ibrawls_tournament_state')!).status, 'playing');
    }
  } finally {
    Object.assign(sfx, originals);
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
