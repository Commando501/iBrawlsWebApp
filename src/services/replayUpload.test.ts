import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  buildReplayUploadQuery,
  countReplayPlayers,
  stripReplayPII,
  toUploadId,
  type ReplayUploadMeta,
} from './replayUpload';
import type { ReplayFile } from '../types';

function frame(overrides: Partial<ReplayFile['frames'][number]> = {}): ReplayFile['frames'][number] {
  return { time: 0, ...overrides };
}

function replay(frames: ReplayFile['frames']): ReplayFile {
  return {
    id: 'rp_test',
    name: 'Match',
    description: '',
    date: new Date(0).toISOString(),
    duration: 120,
    playerHue: 200,
    playerName: 'You',
    opponentName: 'AI',
    mapType: 'rectangular',
    mode: 'sandbox',
    maxScore: 10,
    frames,
  };
}

test('toUploadId keeps valid ids and sanitizes invalid characters', () => {
  assert.equal(toUploadId('rp_abc12345'), 'rp_abc12345');
  // Illegal chars stripped.
  assert.match(toUploadId('rp/ab c.12345!'), /^[A-Za-z0-9_-]+$/);
});

test('toUploadId pads short ids to the minimum length and caps at 64', () => {
  assert.ok(toUploadId('xy').length >= 8);
  assert.ok(toUploadId('a'.repeat(200)).length <= 64);
  assert.match(toUploadId(''), /^[A-Za-z0-9_-]{8,64}$/);
});

test('countReplayPlayers counts solo (player + ai) and multiplayer rosters', () => {
  const solo = replay([frame({ player: {} as any, ai: {} as any })]);
  assert.equal(countReplayPlayers(solo), 2);

  const mp = replay([frame({ player: {} as any, otherPlayers: [{}, {}, {}] as any })]);
  assert.equal(countReplayPlayers(mp), 4);

  assert.equal(countReplayPlayers(replay([])), 0);
});

test('buildReplayUploadQuery serializes all metadata fields', () => {
  const meta: ReplayUploadMeta = {
    id: 'rp_abc12345',
    sha256: 'a'.repeat(64),
    anonId: 'anon-1',
    duration: 1200,
    players: 8,
    map: 'rectangular',
    mode: 'sandbox',
    gameMode: 'grifball',
    schemaVersion: 1,
  };
  const q = new URLSearchParams(buildReplayUploadQuery(meta));
  assert.equal(q.get('id'), 'rp_abc12345');
  assert.equal(q.get('sha256'), 'a'.repeat(64));
  assert.equal(q.get('players'), '8');
  assert.equal(q.get('duration'), '1200');
  assert.equal(q.get('schemaVersion'), '1');
  // gameMode must survive to the manifest so the corpus is segmentable by mode.
  assert.equal(q.get('gameMode'), 'grifball');
});

test('stripReplayPII removes names everywhere but preserves behavior and the source', () => {
  const original = replay([
    frame({
      player: { pos: { x: 1.5, y: 0, z: 2.5 }, hp: 0.9 } as any,
      otherPlayers: [
        { playerName: 'Alice', hp: 1, pos: { x: 3, y: 0, z: 4 } } as any,
        { playerName: 'Bob', hp: 0.5 } as any,
      ],
    }),
  ]);
  original.playerName = 'Me';
  original.opponentName = 'Them';
  original.heatmap = {
    version: 1,
    events: [
      {
        id: 'hm_1',
        kind: 'kill',
        time: 4.5,
        actorId: 'player',
        victimId: 'bot_1',
        team: 'blue',
        position: { x: 1, z: 2 },
        weapon: 'sword',
      },
    ],
  };

  const stripped = stripReplayPII(original);

  // Names blanked at every level.
  assert.equal(stripped.playerName, '');
  assert.equal(stripped.opponentName, '');
  assert.equal(stripped.frames[0].otherPlayers![0].playerName, '');
  assert.equal(stripped.frames[0].otherPlayers![1].playerName, '');

  // Behavioral data preserved.
  assert.equal(stripped.frames[0].player!.hp, 0.9);
  assert.equal(stripped.frames[0].otherPlayers![0].pos!.x, 3);
  assert.deepEqual(stripped.heatmap?.events, original.heatmap.events);
  assert.equal('playerName' in stripped.heatmap!.events[0], false);

  // Source replay is untouched (read-only contract).
  assert.equal(original.playerName, 'Me');
  assert.equal(original.frames[0].otherPlayers![0].playerName, 'Alice');
});

test('gzip is lossless for replay JSON (the integrity guarantee)', () => {
  // Build a replay with full-precision floats like the real recorder produces.
  const frames = Array.from({ length: 200 }, (_, i) =>
    frame({
      time: i / 20,
      player: {
        pos: { x: Math.sin(i) * 7.123456789, y: 0.6 * Math.cos(i), z: Math.tan(i % 7) },
        vel: { x: i * 0.0173, y: -0.5, z: 1 / (i + 1) },
        yaw: Math.PI * Math.sin(i / 3),
        pitch: 0.123456,
        hp: 0.62345,
        isCrouching: i % 7 === 0,
        isJumping: false,
        isLunging: i % 11 === 0,
        activeWeapon: i % 2 ? 'sword' : 'hammer',
        weaponState: 'ready',
        score: (i / 50) | 0,
        kills: 0,
        deaths: 0,
        respawnTimer: 0,
        invulnerabilityTimer: 0,
      } as any,
    }),
  );
  const original = JSON.stringify(replay(frames));

  const roundTripped = gunzipSync(gzipSync(Buffer.from(original, 'utf8'))).toString('utf8');
  assert.equal(roundTripped, original);

  // And the hash the client sends matches what the download step recomputes.
  const clientHash = createHash('sha256').update(original, 'utf8').digest('hex');
  const downloadHash = createHash('sha256').update(roundTripped, 'utf8').digest('hex');
  assert.equal(clientHash, downloadHash);
});
