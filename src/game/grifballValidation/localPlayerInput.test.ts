import test from 'node:test';
import assert from 'node:assert/strict';
import { validationLocalInput } from './localPlayerInput';
import type { GrifballTacticalSnapshot } from '../aiGrifballTeamPlan';
import { isSpaceSegmentOpen } from '../grifballSpaceGeometry';

function scene(): GrifballTacticalSnapshot {
  return { round: 1, playing: true, spacing: 4, holderId: null, ball: { x: 10, z: 0 },
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: { key: 'local-input-open', shape: 'rectangular', x: 52, z: 23, blockers: [] },
    players: [{ id: 'player', team: 'blue', pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, scripted: false }] };
}

test('local input follows loose possession, the opposing goal while carrying, and observed carriers', () => {
  const s = scene();
  assert.deepEqual(validationLocalInput(s, 1), { forward: true, yaw: -Math.PI / 2, attack: null, pickup: false });
  s.holderId = 'player'; s.ball = { x: -10, z: 0 };
  assert.equal(validationLocalInput(s, 1).yaw, -Math.PI / 2);
  s.players.push({ id: 'carrier', team: 'red', pos: { x: 0, z: 10 }, vel: { x: 0, z: 0 }, scripted: true });
  s.holderId = 'carrier';
  assert.equal(Math.abs(validationLocalInput(s, 1).yaw), Math.PI);
  s.players[0].team = 'red'; s.holderId = 'player';
  assert.equal(validationLocalInput(s, 1).yaw, Math.PI / 2);
});

test('local input routes around cover and stops for a sealed route', () => {
  const s = scene(); s.geometry!.key = 'local-input-cover';
  s.geometry!.blockers = [{ kind: 'box', x: 5, z: 0, hx: 1, hz: 3 }];
  const input = validationLocalInput(s, 1);
  assert.equal(input.forward, true); assert.notEqual(input.yaw, -Math.PI / 2);
  const next = { x: -Math.sin(input.yaw), z: -Math.cos(input.yaw) };
  assert.ok(isSpaceSegmentOpen(s.geometry!, s.players[0].pos, next));
  s.geometry = { ...s.geometry!, key: 'local-input-sealed', blockers: [{ kind: 'box', x: 5, z: 0, hx: 1, hz: 30 }] };
  assert.equal(validationLocalInput(s, 1).forward, false);
});

test('local melee intent uses observed hostile reach, stable identity ties and a fixed input cadence', () => {
  const s = scene();
  s.players.push({ id: 'enemy', team: 'red', pos: { x: 1, z: 0 }, vel: { x: 0, z: 0 }, scripted: true });
  assert.equal(validationLocalInput(s, 1).attack, null);
  assert.equal(validationLocalInput(s, 12).attack, 'primary');
  s.players[0].space = { weapon: 'ball', phase: 'ready', speed: 5.2, reach: 1.8, attackIn: .3, blastRadius: 0, lungeReach: 0, lungeSpeed: 0, mobileIn: 0 };
  assert.equal(validationLocalInput(s, 12).attack, 'primary', 'the production primary input punches while carrying');
  const before = structuredClone(s);
  assert.deepEqual(validationLocalInput({ ...s, players: [...s.players].reverse() }, 12), validationLocalInput(s, 12));
  assert.deepEqual(s, before, 'driver cannot mutate positions, health, possession or assignments');
  s.players[1].team = 'blue'; assert.equal(validationLocalInput(s, 12).attack, null);
  s.players[1].team = 'red'; s.players[1].pos.x = 3;
  assert.equal(validationLocalInput(s, 12).attack, null);
});

test('local driver supplies no movement or attacks while inactive, absent, at the target or missing geometry', () => {
  const s = scene(), idle = { forward: false, yaw: 0, attack: null, pickup: false };
  assert.deepEqual(validationLocalInput({ ...s, playing: false }, 12), idle);
  assert.deepEqual(validationLocalInput({ ...s, players: [] }, 12), idle);
  assert.deepEqual(validationLocalInput({ ...s, geometry: undefined }, 12), idle);
  assert.deepEqual(validationLocalInput({ ...s, ball: { x: 0, z: 0 } }, 12), { ...idle, pickup: true });
});
