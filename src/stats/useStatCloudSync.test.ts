import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyDelta } from "./statTypes";
import { shouldPushInitialStatProfile } from "./useStatCloudSync";

test("initial stat sync does not push an empty local profile", () => {
  assert.equal(shouldPushInitialStatProfile(createEmptyDelta()), false);
  assert.equal(
    shouldPushInitialStatProfile({
      sums: { "combat.kills": 1 },
      maxes: {},
      modes: {},
    }),
    true,
  );
});
