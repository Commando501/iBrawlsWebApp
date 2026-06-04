import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateArchetypes, centroidToArchetype } from './archetypeMapping';
import type { FingerprintFeature, Row } from './stats';

function fp(overrides: Partial<Record<FingerprintFeature, number>>): Record<FingerprintFeature, number> {
  return {
    avgLungeDistance: 8,
    lungeFrequency: 0.4,
    dodgeBiasX: 0,
    dodgeBiasZ: 0,
    counterRate: 0.2,
    approachSpeed: 0.5,
    edgeProximity: 0.35,
    reactionTime: 0.3,
    ...overrides,
  };
}

test('centroidToArchetype maps sword-lunge-heavy play to high weapon prioritization', () => {
  const { knobOverrides } = centroidToArchetype(fp({ lungeFrequency: 0.9 }));
  assert.ok(knobOverrides.aiWeaponPrioritization >= 85);
});

test('centroidToArchetype maps hammer-heavy play to low weapon prioritization', () => {
  const { knobOverrides } = centroidToArchetype(fp({ lungeFrequency: 0.1 }));
  assert.ok(knobOverrides.aiWeaponPrioritization <= 15);
});

test('centroidToArchetype flags passive players to skip pressure', () => {
  const passive = centroidToArchetype(fp({ approachSpeed: 0.1, edgeProximity: 0.9 }));
  const aggressive = centroidToArchetype(fp({ approachSpeed: 0.95, edgeProximity: 0.1 }));
  assert.equal(passive.flags.skipPressure, true);
  assert.equal(aggressive.flags.skipPressure, false);
});

test('centroidToArchetype mirrors reaction time and clamps to a sane range', () => {
  assert.equal(centroidToArchetype(fp({ reactionTime: 0.22 })).knobOverrides.aiReactionLatency, 0.22);
  // Extreme values clamp rather than producing nonsense.
  assert.ok(centroidToArchetype(fp({ reactionTime: 99 })).knobOverrides.aiReactionLatency <= 1.2);
  assert.ok(centroidToArchetype(fp({ reactionTime: -5 })).knobOverrides.aiReactionLatency >= 0.05);
});

test('centroidToArchetype keeps every knob and flag within its valid domain', () => {
  const { knobOverrides, flags } = centroidToArchetype(
    fp({ counterRate: 5, dodgeBiasX: 9, dodgeBiasZ: 9, avgLungeDistance: 50 }),
  );
  assert.ok(knobOverrides.aiWeaponSwapIQ >= 0 && knobOverrides.aiWeaponSwapIQ <= 100);
  assert.ok(knobOverrides.aiMovementComplexity >= 0 && knobOverrides.aiMovementComplexity <= 100);
  assert.ok(knobOverrides.aiAnticipationFactor >= 0 && knobOverrides.aiAnticipationFactor <= 1);
  assert.ok(flags.spacingBand >= 0.8 && flags.spacingBand <= 1.4);
  assert.ok(flags.feintBias >= 0.5 && flags.feintBias <= 1.6);
});

test('buildCandidateArchetypes returns clusters sorted by population share', () => {
  // 30 sword-aggressive players + 10 hammer-defensive players.
  const swords: Row[] = Array.from({ length: 30 }, () => ({
    lungeFrequency: 0.85, approachSpeed: 0.9, counterRate: 0.1, reactionTime: 0.15,
    avgLungeDistance: 12, dodgeBiasX: 0.1, dodgeBiasZ: 0, edgeProximity: 0.2,
    scorePlayer: 5, scoreEnemy: 3,
  }));
  const hammers: Row[] = Array.from({ length: 10 }, () => ({
    lungeFrequency: 0.15, approachSpeed: 0.2, counterRate: 0.5, reactionTime: 0.45,
    avgLungeDistance: 5, dodgeBiasX: -0.1, dodgeBiasZ: 0, edgeProximity: 0.7,
    scorePlayer: 2, scoreEnemy: 5,
  }));

  const candidates = buildCandidateArchetypes([...swords, ...hammers], 2);
  assert.equal(candidates.length, 2);
  // Largest cluster (sword players) first and is the majority.
  assert.equal(candidates[0].matches, 30);
  assert.ok(candidates[0].share > candidates[1].share);
  // The dominant cluster is sword-leaning.
  assert.ok(candidates[0].knobOverrides.aiWeaponPrioritization > 60);
  assert.equal(candidates[0].matches + candidates[1].matches, 40);
});

test('buildCandidateArchetypes returns nothing for empty input', () => {
  assert.deepEqual(buildCandidateArchetypes([], 4), []);
});
