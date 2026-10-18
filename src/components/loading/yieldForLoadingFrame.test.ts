import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { yieldForLoadingFrame } from './yieldForLoadingFrame';

function frames(t: TestContext) {
  const originalRequest = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const originalCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; },
    cancelAnimationFrame: (key: number) => { pending.delete(key); },
  });
  t.after(() => {
    if (originalRequest) Object.defineProperty(globalThis, 'requestAnimationFrame', originalRequest);
    else delete (globalThis as any).requestAnimationFrame;
    if (originalCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancel);
    else delete (globalThis as any).cancelAnimationFrame;
  });
  return {
    pending,
    paint: () => {
      const [key, callback] = [...pending][0];
      pending.delete(key);
      callback(0);
    },
  };
}

test('visible loading yields across two frames so progress can paint', async t => {
  const f = frames(t);
  let done = false;
  const task = yieldForLoadingFrame().then(() => { done = true; });
  f.paint();
  await Promise.resolve();
  assert.equal(done, false);
  f.paint();
  await task;
  assert.equal(done, true);
  assert.equal(f.pending.size, 0);
});

test('loading continues when a background tab never receives an animation frame', { timeout: 2000 }, async t => {
  const f = frames(t);
  await yieldForLoadingFrame();
  assert.equal(f.pending.size, 0, 'the suspended frame is canceled after the fallback');
});

test('loading continues if the tab is hidden between its two paint frames', { timeout: 2000 }, async t => {
  const f = frames(t);
  const task = yieldForLoadingFrame();
  f.paint();
  await task;
  assert.equal(f.pending.size, 0);
});

test('loading yields without animation frame support', async () => {
  await yieldForLoadingFrame();
});
