import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { ReplayFrame } from '../../types';
import { updateReplayCombatantVisualsForFrame } from './replayPlaybackVisuals';
import {
  collectReplayPlaybackEventsForFrame,
  getReplayPlaybackEventFrameIndexes,
} from './replayPlaybackRuntime';

function player(overrides: Partial<NonNullable<ReplayFrame['player']>> = {}): NonNullable<ReplayFrame['player']> {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    hp: 5,
    isCrouching: false,
    isJumping: false,
    isLunging: false,
    isDashing: false,
    isSprinting: false,
    isSliding: false,
    weaponTimer: 0,
    activeWeapon: 'hammer',
    weaponState: 'ready',
    score: 0,
    kills: 0,
    deaths: 0,
    respawnTimer: 0,
    invulnerabilityTimer: 0,
    ...overrides,
  };
}

function frame(time: number, replayPlayer?: NonNullable<ReplayFrame['player']>): ReplayFrame {
  return replayPlayer ? { time, player: replayPlayer } : { time };
}

function sounds(events: ReturnType<typeof collectReplayPlaybackEventsForFrame>): string[] {
  return events.flatMap(event => event.type === 'sound' ? [event.sound] : []);
}

test('replay event cursor processes a replay frame only once across render ticks', () => {
  let cursor: number | null = null;

  let result = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 0,
    lastReplayEventFrameIndex: cursor,
    isPaused: false,
    dt: 0.016,
  });
  assert.deepEqual(result.frameIndexes, []);
  cursor = result.nextLastReplayEventFrameIndex;

  result = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 1,
    lastReplayEventFrameIndex: cursor,
    isPaused: false,
    dt: 0.016,
  });
  assert.deepEqual(result.frameIndexes, [1]);
  cursor = result.nextLastReplayEventFrameIndex;

  result = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 1,
    lastReplayEventFrameIndex: cursor,
    isPaused: false,
    dt: 0.016,
  });
  assert.deepEqual(result.frameIndexes, []);
  assert.equal(result.nextLastReplayEventFrameIndex, 1);
});

test('replay event cursor advances crossed frame indexes and clamps catch-up', () => {
  const result = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 6,
    lastReplayEventFrameIndex: 1,
    isPaused: false,
    dt: 0.016,
    maxCatchUpFrames: 3,
  });

  assert.deepEqual(result.frameIndexes, [4, 5, 6]);
  assert.equal(result.nextLastReplayEventFrameIndex, 6);
});

test('replay transition events are collected once per processed recorded frame', () => {
  const frames: ReplayFrame[] = [
    frame(0, player()),
    frame(0.05, player({ hp: 4 })),
    frame(0.1, player({ hp: 4, weaponState: 'swing_down' })),
    frame(0.15, player({ hp: 4, weaponState: 'ready' })),
  ];
  const indexes = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 3,
    lastReplayEventFrameIndex: 0,
    isPaused: false,
    dt: 0.016,
  }).frameIndexes;

  const events = indexes.flatMap(frameIndex =>
    collectReplayPlaybackEventsForFrame({
      frames,
      frameIndex,
      replayPlayerName: 'Player',
      attackRange: 4,
      attackRadius: 4.5,
    })
  );

  assert.deepEqual(sounds(events), ['swing', 'swing', 'explosion']);
  assert.equal(events.filter(event => event.type === 'hammerSplash').length, 1);
});

test('replay seek reset establishes a quiet baseline before forward events resume', () => {
  let result = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 10,
    lastReplayEventFrameIndex: null,
    isPaused: false,
    dt: 0.016,
  });
  assert.deepEqual(result.frameIndexes, []);

  result = getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 11,
    lastReplayEventFrameIndex: result.nextLastReplayEventFrameIndex,
    isPaused: false,
    dt: 0.016,
  });
  assert.deepEqual(result.frameIndexes, [11]);
});

test('replay event cursor suppresses paused and invalid-dt playback effects', () => {
  assert.deepEqual(getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 1,
    lastReplayEventFrameIndex: 0,
    isPaused: true,
    dt: 0.016,
  }).frameIndexes, []);

  assert.deepEqual(getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 1,
    lastReplayEventFrameIndex: 0,
    isPaused: false,
    dt: 0,
  }).frameIndexes, []);

  assert.deepEqual(getReplayPlaybackEventFrameIndexes({
    currentFrameIndex: 4,
    lastReplayEventFrameIndex: 0,
    isPaused: false,
    dt: 0.2,
  }).frameIndexes, []);
});

test('replay transition lookup uses the nearest previous frame containing the combatant', () => {
  const frames: ReplayFrame[] = [
    frame(0, player({ hp: 5 })),
    frame(0.05),
    frame(0.1, player({ hp: 0 })),
  ];

  const events = collectReplayPlaybackEventsForFrame({
    frames,
    frameIndex: 2,
    replayPlayerName: 'Player',
    attackRange: 4,
    attackRadius: 4.5,
  });

  assert.deepEqual(sounds(events), ['death']);
  assert.equal(events.filter(event => event.type === 'shockwave').length, 3);
});

test('replay bot visuals apply recorded yaw and shared forward-facing sword rig', () => {
  const scene = new THREE.Scene();
  const refs = {
    scene,
    otherPlayerMeshes: new Map(),
    damageExplosionParticles: [],
    enemyGroup: null,
    hostGroup: null,
  } as any;

  let animatedYaw: number | null = null;
  updateReplayCombatantVisualsForFrame({
    refs,
    updatedPlayers: new Map([
      ['bot_1', {
        pos: new THREE.Vector3(1, 0, 2),
        vel: new THREE.Vector3(),
        yaw: Math.PI / 2,
        pitch: 0,
        crouchScaleY: 1,
        hp: 5,
        activeWeapon: 'sword',
        weaponState: 'ready',
        isCrouching: false,
        isLunging: false,
        isDashing: false,
        isSprinting: false,
        isSliding: false,
        weaponTimer: 0,
        score: 0,
        kills: 0,
        deaths: 0,
        respawnTimer: 0,
        invulnerabilityTimer: 0,
        name: 'Bot',
        hue: 0,
      }],
    ]),
    targetId: 'free',
    observerCamMode: 'third',
    replayPlayerName: 'Player',
    dt: 0.016,
    animateSpartanModel: (_mesh, _vel, yaw) => {
      animatedYaw = yaw;
    },
    renderSwordLungeTrailVfx: () => {},
    updateBlinking: () => {},
  });

  const meshes = refs.otherPlayerMeshes.get('bot_1');
  assert.ok(meshes);
  assert.equal(meshes.group.rotation.y, Math.PI / 2);
  assert.equal(animatedYaw, Math.PI / 2);
  assert.equal(meshes.sword.rotation.x, -Math.PI / 2);
});
