import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampLoadingProgress,
  deriveMultiplayerLoadingSnapshot,
  removeLoadingParticipant,
  upsertLoadingSlot,
  upsertLoadingStatus,
} from './matchLoadingState';
import { resolveTopDownMapBounds } from './topDownMapModel';

test('clampLoadingProgress keeps progress inside percentage bounds', () => {
  assert.equal(clampLoadingProgress(-12), 0);
  assert.equal(clampLoadingProgress(48.6), 49);
  assert.equal(clampLoadingProgress(144), 100);
  assert.equal(clampLoadingProgress('bad'), 0);
});

test('multiplayer loading snapshot waits for every participant or timeout', () => {
  let roster = {};
  roster = upsertLoadingSlot(roster, { clientId: 'host', role: 'host', playerName: 'Host', hue: 200 }, 1_000);
  roster = upsertLoadingSlot(roster, { clientId: 'guest', role: 'client', playerName: 'Guest', hue: 120 }, 1_000);
  roster = upsertLoadingStatus(roster, { progress: 100, ready: true }, 'host', 2_000);

  const waiting = deriveMultiplayerLoadingSnapshot(roster, 3_000, 45_000);
  assert.equal(waiting.gateReleased, false);
  assert.equal(waiting.waitingCount, 1);

  const timedOut = deriveMultiplayerLoadingSnapshot(roster, 60_000, 45_000);
  assert.equal(timedOut.gateReleased, true);
  assert.equal(timedOut.participants.find((p) => p.clientId === 'guest')?.timedOut, true);
});

test('removing a participant releases the gate when remaining players are ready', () => {
  let roster = {};
  roster = upsertLoadingStatus(roster, { role: 'host', progress: 100, ready: true }, 'host', 1_000);
  roster = upsertLoadingStatus(roster, { role: 'client', progress: 40, ready: false }, 'guest', 1_000);
  roster = removeLoadingParticipant(roster, 'guest');

  const snapshot = deriveMultiplayerLoadingSnapshot(roster, 2_000);
  assert.equal(snapshot.gateReleased, true);
  assert.equal(snapshot.participants.length, 1);
});

test('loading participants preserve visual model policy for previews', () => {
  const roster = upsertLoadingSlot({}, {
    clientId: 'guest',
    role: 'client',
    playerName: 'Guest',
    hue: 140,
    visualModelPolicy: 'v1',
    loadout: { modelSystem: 'v3' },
  }, 1_000);

  const participant = deriveMultiplayerLoadingSnapshot(roster, 1_000).participants[0];
  assert.equal(participant.visualModelPolicy, 'v1');
  assert.equal(participant.loadout?.modelSystem, 'v3');
});

test('loading participant previews preserve V3 role paint while V1 and V2 policies remain selectable', () => {
  let roster = {};
  roster = upsertLoadingSlot(roster, {
    clientId: 'legacy',
    role: 'host',
    playerName: 'Legacy',
    visualModelPolicy: 'v1',
    loadout: { modelSystem: 'v3' },
  }, 1_000);
  roster = upsertLoadingSlot(roster, {
    clientId: 'rigged',
    role: 'client',
    playerName: 'Rigged',
    visualModelPolicy: 'v2',
    loadout: { modelSystem: 'v2', modelType: 'large' },
  }, 1_000);
  roster = upsertLoadingSlot(roster, {
    clientId: 'advanced',
    role: 'observer',
    playerName: 'Advanced',
    visualModelPolicy: 'v3',
    loadout: {
      modelSystem: 'v3',
      paintJob: {
        v3RoleColors: {
          primary: '#123456',
          accent: '#abcdef',
          invalid: '#ffffff',
        },
        v3RoleEmissive: {
          visor: true,
        },
      },
    } as any,
  }, 1_000);

  const participants = deriveMultiplayerLoadingSnapshot(roster, 1_000).participants;
  assert.deepEqual(participants.map((entry) => entry.visualModelPolicy), ['v1', 'v2', 'v3']);
  const advanced = participants.find((entry) => entry.clientId === 'advanced');
  assert.equal((advanced?.loadout as any)?.paintJob.v3RoleColors.primary, '#123456');
  assert.equal((advanced?.loadout as any)?.paintJob.v3RoleColors.invalid, undefined);
  assert.equal((advanced?.loadout as any)?.paintJob.v3RoleEmissive.visor, true);
});

test('top-down bounds resolve default and custom maps', () => {
  const hangar = resolveTopDownMapBounds({ selectedMap: 'hangar' });
  assert.equal(hangar.shape, 'circle');
  assert.equal(hangar.radius, 20);

  const custom = resolveTopDownMapBounds({
    selectedMap: 'custom_file',
    customMap: {
      id: 'local',
      name: 'Local',
      description: '',
      author: '',
      theme: 'hangar',
      arenaRadius: 30,
      arenaHalfExtents: { x: 24, z: 12 },
      mapShape: 'rectangular',
      objects: [],
      spawnPoints: [],
    } as any,
  });
  assert.equal(custom.shape, 'rectangular');
  assert.equal(custom.halfX, 24);
  assert.equal(custom.halfZ, 12);
});
