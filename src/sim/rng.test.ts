import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, normalizeSeed } from './rng';

test('same seed reproduces the same stream', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  for (let i = 0; i < 1000; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('different seeds diverge', () => {
  const a = createRng(1);
  const b = createRng(2);
  let same = 0;
  for (let i = 0; i < 100; i++) {
    if (a.next() === b.next()) same++;
  }
  assert.ok(same < 5, `streams should differ, got ${same} collisions`);
});

test('next() stays in [0, 1)', () => {
  const r = createRng(99);
  for (let i = 0; i < 10000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('int() is inclusive on both ends and in range', () => {
  const r = createRng(7);
  let sawMin = false;
  let sawMax = false;
  for (let i = 0; i < 10000; i++) {
    const v = r.int(3, 6);
    assert.ok(v >= 3 && v <= 6 && Number.isInteger(v), `bad int: ${v}`);
    if (v === 3) sawMin = true;
    if (v === 6) sawMax = true;
  }
  assert.ok(sawMin && sawMax, 'should reach both endpoints');
});

test('getState/setState round-trips the stream', () => {
  const r = createRng(42);
  for (let i = 0; i < 50; i++) r.next();
  const snapshot = r.getState();
  const expected = [r.next(), r.next(), r.next()];
  r.setState(snapshot);
  assert.deepEqual([r.next(), r.next(), r.next()], expected);
});

test('restoring state into a fresh RNG resumes the same stream', () => {
  const a = createRng(2024);
  for (let i = 0; i < 123; i++) a.next();
  const b = createRng(0);
  b.setState(a.getState());
  for (let i = 0; i < 100; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('normalizeSeed yields a uint32', () => {
  assert.equal(normalizeSeed(-1), 0xffffffff);
  assert.equal(normalizeSeed(3.9), 3);
  assert.equal(normalizeSeed(0), 0);
});
