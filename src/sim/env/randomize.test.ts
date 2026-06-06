import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSimSettings } from '../factory';
import { createRng } from '../rng';
import { randomizeSettings, DOMAIN_RANDOMIZABLE_KEYS, type RandomizeSpec } from './randomize';

const base = resolveSimSettings();

test('disabled spec returns the base unchanged', () => {
  const out = randomizeSettings(base, { enabled: false, pct: 0.2 }, createRng(1));
  assert.equal(out, base);
});

test('each randomizable key lands within ±pct of its base', () => {
  const spec: RandomizeSpec = { enabled: true, pct: 0.15 };
  const out = randomizeSettings(base, spec, createRng(7));
  for (const k of DOMAIN_RANDOMIZABLE_KEYS) {
    const b = base[k] as number;
    if (typeof b !== 'number') continue;
    const v = out[k] as number;
    assert.ok(v >= b * (1 - 0.15) - 1e-9 && v <= b * (1 + 0.15) + 1e-9, `${k}: ${v} vs base ${b}`);
  }
});

test('it is deterministic for a given rng seed', () => {
  const spec: RandomizeSpec = { enabled: true, pct: 0.2 };
  const a = randomizeSettings(base, spec, createRng(42));
  const b = randomizeSettings(base, spec, createRng(42));
  assert.deepEqual(a, b);
  const c = randomizeSettings(base, spec, createRng(43));
  assert.notDeepEqual(a, c);
});

test('non-randomized keys are untouched (e.g. maxHP, goalTarget)', () => {
  const out = randomizeSettings(base, { enabled: true, pct: 0.3 }, createRng(5));
  assert.equal(out.maxHP, base.maxHP);
  assert.equal(out.grifballGoalTarget, base.grifballGoalTarget);
  assert.equal(out.gameMode, base.gameMode);
});

test('pass-speed min/max stay ordered after jitter', () => {
  // Run many seeds; min must never exceed max.
  for (let s = 0; s < 200; s++) {
    const out = randomizeSettings(base, { enabled: true, pct: 0.4 }, createRng(s));
    assert.ok((out.grifballPassSpeedMin ?? 0) <= (out.grifballPassSpeedMax ?? 0), `seed ${s}`);
  }
});

test('only the listed keys may be restricted via spec.keys', () => {
  const out = randomizeSettings(base, { enabled: true, pct: 0.5, keys: ['attackRange'] }, createRng(9));
  assert.notEqual(out.attackRange, base.attackRange);
  assert.equal(out.dashDistance, base.dashDistance); // not in the restricted list
});
