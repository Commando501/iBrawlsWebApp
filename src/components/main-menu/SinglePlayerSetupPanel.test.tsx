import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { AiBehaviorEditorPanel } from './AiBehaviorEditorPanel';
import { SinglePlayerSetupPanel } from './SinglePlayerSetupPanel';

const noop = () => {};

const baseSinglePlayerProps = (): ComponentProps<typeof SinglePlayerSetupPanel> => ({
  singlePlayerMode: 'sandbox',
  setSinglePlayerMode: noop,
  adminSettings: { ...DEFAULT_ADMIN_SETTINGS },
  setAdminSettings: noop,
  aiPresets: [],
  newAiPresetNameInput: '',
  setNewAiPresetNameInput: noop,
  onSelectAIPreset: noop,
  onDeleteAIPreset: noop,
  onSelectAIArchetype: noop,
  onSaveAIPreset: noop,
  onOpenBotSetup: noop,
  tournamentState: null,
  selectedTournamentPresets: [],
  setSelectedTournamentPresets: noop,
  tournamentKillsToWin: 25,
  setTournamentKillsToWin: noop,
  tournamentRoundCount: 3,
  setTournamentRoundCount: noop,
  onInitializeTournament: noop,
  playerName: 'Player',
  playerHue: 180,
  isPlaying: false,
  onStartTournamentMatch: noop,
  onResetTournament: noop,
});

const baseAiEditorProps = (): ComponentProps<typeof AiBehaviorEditorPanel> => ({
  adminSettings: { ...DEFAULT_ADMIN_SETTINGS, aiDifficulty: 'custom' },
  setAdminSettings: noop,
  aiPresets: [],
  newAiPresetNameInput: '',
  setNewAiPresetNameInput: noop,
  onSelectAIPreset: noop,
  onDeleteAIPreset: noop,
  onSelectAIArchetype: noop,
  onSaveAIPreset: noop,
});

test('SinglePlayerSetupPanel exposes Sandbox Experience and AI Behavior Editor modes', () => {
  const html = renderToStaticMarkup(<SinglePlayerSetupPanel {...baseSinglePlayerProps()} />);

  assert.match(html, /Sandbox Experience[\s\S]*AI Behavior Editor[\s\S]*Training Sandbox Setup[\s\S]*Tournament Setup/);
});

test('SinglePlayerSetupPanel renders the custom AI editor from the AI behavior mode', () => {
  const html = renderToStaticMarkup(
    <SinglePlayerSetupPanel
      {...baseSinglePlayerProps()}
      singlePlayerMode={'ai-editor' as ComponentProps<typeof SinglePlayerSetupPanel>['singlePlayerMode']}
    />
  );

  assert.match(html, /Custom AI Behavior Editor/);
  assert.match(html, /build custom single-player bot behavior/i);
});

test('AiBehaviorEditorPanel is custom-only and omits built-in difficulty choices', () => {
  const html = renderToStaticMarkup(<AiBehaviorEditorPanel {...baseAiEditorProps()} />);

  assert.match(html, /Custom AI Behavior Editor/);
  assert.doesNotMatch(html, /Easy \(Sub-Normal\)/);
  assert.doesNotMatch(html, /Normal - Standard Combat/);
  assert.doesNotMatch(html, /Hard \(Calibrated\)/);
  assert.doesNotMatch(html, /Nightmare - Override/);
});
