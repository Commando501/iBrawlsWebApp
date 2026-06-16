import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_KEYBINDINGS } from "../types";
import { getDefaultUiLayouts } from "../ui/hudLayouts";
import { createDefaultAdminSettings } from "./gameplaySettings";
import { buildSaveData } from "./saveCodec";
import { getCloudSaveSyncDecision } from "./useSaveAccountSync";
import type { V3SuitProfileCatalog } from "../components/main-menu/v3ArmorSuitProfiles";

test("cloud save sync decision skips a payload that already reached the server", () => {
  const save = buildSaveData(
    createDefaultAdminSettings("ASpence501", 200),
    "ASpence501",
    getDefaultUiLayouts(),
    DEFAULT_KEYBINDINGS,
  );

  const first = getCloudSaveSyncDecision(null, save);
  assert.equal(first.shouldPush, true);

  const duplicate = getCloudSaveSyncDecision(first.payload, save);
  assert.equal(duplicate.shouldPush, false);
});

test("cloud save sync decision notices V3 suit profile catalog changes", () => {
  const profileCatalog: V3SuitProfileCatalog = {
    version: 1,
    profiles: [{
      version: 1,
      id: "profile_alpha",
      name: "Alpha Suit",
      modelSystem: "v3",
      slotPieceIds: { helmet: "piece_helmet" },
      createdAt: 1,
      updatedAt: 1,
    }],
  };
  const base = buildSaveData(
    createDefaultAdminSettings("ASpence501", 200),
    "ASpence501",
    getDefaultUiLayouts(),
    DEFAULT_KEYBINDINGS,
  );
  const withProfiles = buildSaveData(
    createDefaultAdminSettings("ASpence501", 200),
    "ASpence501",
    getDefaultUiLayouts(),
    DEFAULT_KEYBINDINGS,
    undefined,
    undefined,
    profileCatalog,
  );

  const pushed = getCloudSaveSyncDecision(null, base);
  const changed = getCloudSaveSyncDecision(pushed.payload, withProfiles);

  assert.equal(changed.shouldPush, true);
});
