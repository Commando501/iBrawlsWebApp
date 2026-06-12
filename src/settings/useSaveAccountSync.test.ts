import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_KEYBINDINGS } from "../types";
import { getDefaultUiLayouts } from "../ui/hudLayouts";
import { createDefaultAdminSettings } from "./gameplaySettings";
import { buildSaveData } from "./saveCodec";
import { getCloudSaveSyncDecision } from "./useSaveAccountSync";

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
