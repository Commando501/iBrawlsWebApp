import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDeltaToPayload, sanitizeDelta } from "./stats";

test("sanitizeDelta strips invalid keys, values, and oversized payloads", () => {
  const delta = sanitizeDelta({
    sums: {
      "combat.kills": 3,
      bad: -5,
      nan: Number.NaN,
      str: "12",
      huge: Number.MAX_VALUE,
    },
    maxes: { "best.killsInMatch": 7 },
    modes: {
      "offline:sandbox": { sums: { "combat.kills": 3 }, maxes: {} },
      "": { sums: { x: 1 }, maxes: {} },
      junk: "nope",
    },
  });

  assert.equal(delta.sums["combat.kills"], 3);
  assert.equal(delta.sums.bad, undefined);
  assert.equal(delta.sums.nan, undefined);
  assert.equal(delta.sums.str, undefined);
  assert.ok(delta.sums.huge <= 1_000_000_000_000, "values are capped");
  assert.equal(delta.maxes["best.killsInMatch"], 7);
  assert.deepEqual(Object.keys(delta.modes), ["offline:sandbox"]);
});

test("sanitizeDelta tolerates non-object bodies", () => {
  for (const body of [null, undefined, 42, "x", []]) {
    const delta = sanitizeDelta(body);
    assert.deepEqual(delta.sums, {});
    assert.deepEqual(delta.maxes, {});
    assert.deepEqual(delta.modes, {});
  }
});

test("applyDeltaToPayload sums counters and folds maxes", () => {
  const payload = {
    totals: { "combat.kills": 10, "best.killsInMatch": 8 },
    modes: { "offline:sandbox": { "combat.kills": 10 } },
  };
  applyDeltaToPayload(payload, sanitizeDelta({
    sums: { "combat.kills": 5 },
    maxes: { "best.killsInMatch": 6 },
    modes: { "offline:sandbox": { sums: { "combat.kills": 5 }, maxes: {} } },
  }));

  assert.equal(payload.totals["combat.kills"], 15);
  assert.equal(payload.totals["best.killsInMatch"], 8, "max keeps the larger existing record");
  assert.equal(payload.modes["offline:sandbox"]["combat.kills"], 15);
});

test("applyDeltaToPayload creates mode buckets on demand", () => {
  const payload = { totals: {}, modes: {} as Record<string, Record<string, number>> };
  applyDeltaToPayload(payload, sanitizeDelta({
    sums: {},
    maxes: {},
    modes: { "online:grifball": { sums: { "objective.teamGoals": 2 }, maxes: {} } },
  }));
  assert.equal(payload.modes["online:grifball"]["objective.teamGoals"], 2);
});
