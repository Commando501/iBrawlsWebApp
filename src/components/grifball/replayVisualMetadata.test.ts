import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReplayFile } from '../../types';
import {
  DEFAULT_REPLAY_VISUAL_MODEL_POLICY,
  resolveReplayCombatantVisualLoadout,
  resolveReplayVisualModelPolicy,
} from './replayVisualMetadata';

const baseReplay = (overrides: Partial<ReplayFile> = {}): ReplayFile => ({
  id: 'r1',
  name: 'Replay',
  description: '',
  date: new Date(0).toISOString(),
  duration: 1,
  playerHue: 200,
  playerName: 'Player',
  opponentName: 'Bot',
  mapType: 'hangar' as ReplayFile['mapType'],
  mode: 'sandbox',
  maxScore: 25,
  frames: [],
  ...overrides,
});

test('older replays without visual policy use legacy V1 visuals', () => {
  const replay = baseReplay();

  assert.equal(resolveReplayVisualModelPolicy(replay), DEFAULT_REPLAY_VISUAL_MODEL_POLICY);
  assert.deepEqual(resolveReplayCombatantVisualLoadout(replay, 'player'), { modelSystem: 'v1' });
});

test('V3 replay visual policy falls back to V2 sanitized stored loadouts', () => {
  const replay = baseReplay({
    visualModelPolicy: 'v3',
    visualLoadouts: {
      player: {
        modelSystem: 'v3',
        helmet: 'odst',
        rawMesh: { vertices: [1, 2, 3] },
      } as any,
    },
  });

  const loadout = resolveReplayCombatantVisualLoadout(replay, 'player') as any;
  assert.equal(resolveReplayVisualModelPolicy(replay), 'v2');
  assert.equal(loadout.modelSystem, 'v2');
  assert.equal(loadout.helmet, 'odst');
  assert.equal(loadout.modelType, 'medium');
  assert.equal(loadout.rawMesh, undefined);
});
