import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORED_SWING_TIMING,
  crossedSwingImpacts,
  gameSwingTiming,
  sampleSwing,
  swingDuration,
  timeAtSwingFrame,
} from "./ironVanguardSwingTiming";

test("authored and game timings hit the same source pose at different real times", () => {
  for (const timing of [
    AUTHORED_SWING_TIMING,
    gameSwingTiming(),
    [0.1, 0.04, 0.2, 0.9] as const,
  ]) {
    assert.ok(
      Math.abs(sampleSwing(timing[0] + timing[1], timing).frame - 34) < 1e-8,
    );
    assert.ok(
      Math.abs(sampleSwing(swingDuration(timing), timing).frame - 70) < 1e-8,
    );
    for (let f = 0; f <= 70; f += 0.25) {
      assert.ok(
        Math.abs(sampleSwing(timeAtSwingFrame(f, timing), timing).frame - f) <
          1e-8,
      );
    }
  }
  assert.equal(gameSwingTiming()[0], 0.28);
  assert.equal(gameSwingTiming()[1], 0.12);
  assert.ok(Math.abs(swingDuration(gameSwingTiming()) - 1) < 1e-8);
});

test("impact fires once even when a render frame skips the exact marker", () => {
  const timing = gameSwingTiming();
  assert.equal(crossedSwingImpacts(0.39, 0.45, timing), 1);
  assert.equal(crossedSwingImpacts(0.45, 0.49, timing), 0);
  assert.equal(crossedSwingImpacts(0.39, 0.4, timing), 1);
  assert.equal(crossedSwingImpacts(0.4, 0.5, timing), 0);
  assert.equal(crossedSwingImpacts(0, 3, timing, true), 3);
  assert.equal(crossedSwingImpacts(0.45, 1.45, timing, true), 1);
  assert.equal(crossedSwingImpacts(0.5, 0.1, timing), 0);
});

test("invalid timing is rejected and invalid or out-of-range scrub values are bounded", () => {
  assert.throws(() => swingDuration([0, 1, 1, 1]), RangeError);
  assert.throws(() => swingDuration([NaN, 1, 1, 1]), RangeError);
  assert.equal(sampleSwing(-1, AUTHORED_SWING_TIMING).frame, 0);
  assert.equal(sampleSwing(NaN, AUTHORED_SWING_TIMING).frame, 0);
  assert.equal(sampleSwing(100, AUTHORED_SWING_TIMING).frame, 70);
  assert.equal(timeAtSwingFrame(-2, AUTHORED_SWING_TIMING), 0);
});

test('game preview recovery uses the same source poses as the gameplay adapter', async () => {
  const { ironVanguardSourceFrame } = await import('../game/ironVanguardTiming');
  const settings = { hammerSlamWindupTime: .3, hammerSlamAttackTime: .2, hammerReloadTime: 1.1 };
  const timing = gameSwingTiming(settings);
  for (const time of [0, .05, .1, .4, 1.1]) {
    assert.ok(Math.abs(sampleSwing(.5 + time, timing).frame - ironVanguardSourceFrame('recovering', time, settings)) < 1e-7);
  }
});
