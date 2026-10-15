import assert from "node:assert/strict";
import { test } from "node:test";
import { ironVanguardSourceFrame } from "./ironVanguardTiming";
const settings = {
  hammerSlamWindupTime: 0.3,
  hammerSlamAttackTime: 0.2,
  hammerReloadTime: 1.1,
};
test("saved timing maps to the approved windup, impact, follow-through and recovery poses", () => {
  for (const [state, time, frame] of [
    ["ready", 0, 0],
    ["swing_up", 0.3, 24],
    ["swing_down", 0.2, 34],
    ["recovering", 0, 34],
    ["recovering", 0.1, 42],
    ["recovering", 1.1, 70],
  ] as const)
    assert.ok(
      Math.abs(ironVanguardSourceFrame(state, time, settings) - frame) < 1e-10,
    );
});
test("custom match settings remain authoritative for the visual impact time", () => {
  assert.equal(
    ironVanguardSourceFrame("swing_up", 0.6, { hammerSlamWindupTime: 1.2 }),
    12,
  );
  assert.equal(
    ironVanguardSourceFrame("swing_down", 0.4, { hammerSlamAttackTime: 0.4 }),
    34,
  );
  assert.equal(
    ironVanguardSourceFrame("recovering", 1.1, { hammerReloadTime: 2.2 }),
    54.6,
  );
});
test("invalid or overshooting timers never produce invalid animation poses", () => {
  for (const timer of [-1, NaN, Infinity, 100])
    for (const duration of [-1, 0, NaN, Infinity]) {
      const value = ironVanguardSourceFrame("recovering", timer, {
        hammerReloadTime: duration,
      });
      assert.ok(Number.isFinite(value) && value >= 34 && value <= 70);
    }
});
