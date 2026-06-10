import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRegisteredDisplayName,
  getPreferredRegisteredDisplayNameFromSave,
  resolvePublicDisplayName,
  chooseSessionDiscriminator,
} from "./displayNames";

test("registered display names normalize to the editable base name", () => {
  assert.equal(normalizeRegisteredDisplayName("  ASpence501  "), "ASpence501");
  assert.equal(normalizeRegisteredDisplayName("ASpence501#1001"), "ASpence501");
  assert.equal(normalizeRegisteredDisplayName(""), null);
});

test("registered owner keeps the plain display name", () => {
  const resolved = resolvePublicDisplayName({
    requestedName: "ASpence501",
    accountId: "acct-owner",
    registeredOwnerAccountId: "acct-owner",
    activeDisplayNames: new Set(),
  });

  assert.equal(resolved, "ASpence501");
});

test("guest or different account using a registered name receives a session suffix", () => {
  const active = new Set<string>();
  const guest = resolvePublicDisplayName({
    requestedName: "ASpence501",
    registeredOwnerAccountId: "acct-owner",
    activeDisplayNames: active,
    nextDiscriminator: () => "1001",
  });
  active.add(guest);
  const otherAccount = resolvePublicDisplayName({
    requestedName: "ASpence501",
    accountId: "acct-other",
    registeredOwnerAccountId: "acct-owner",
    activeDisplayNames: active,
    nextDiscriminator: () => "1002",
  });

  assert.equal(guest, "ASpence501#1001");
  assert.equal(otherAccount, "ASpence501#1002");
});

test("session discriminator avoids active collisions for the same base name", () => {
  const active = new Set(["ASpence501#1001", "ASpence501#1002"]);
  const suffix = chooseSessionDiscriminator("ASpence501", active, () => "1001");

  assert.match(suffix, /^\d{4}$/);
  assert.notEqual(suffix, "1001");
  assert.notEqual(suffix, "1002");
  assert.equal(active.has(`ASpence501#${suffix}`), false);
});

test("registered display name backfill prefers cloud save playerName then username", () => {
  assert.equal(
    getPreferredRegisteredDisplayNameFromSave({ playerName: "CloudName" }, "AcctName"),
    "CloudName",
  );
  assert.equal(
    getPreferredRegisteredDisplayNameFromSave({ playerHue: 200 }, "AcctName"),
    "AcctName",
  );
});
