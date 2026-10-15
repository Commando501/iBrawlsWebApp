import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  recordReplayFrameForState,
  initializeReplayRecordingForState,
} from "./replayRecordingRuntime";
import { buildReplayPlaybackFrameSlice } from "./replayHelpers";
import { createInitialGrifballRuntimeState } from "./runtimeState";
import { DEFAULT_ADMIN_SETTINGS } from "../../settings/gameplaySettings";
import type { Combatant, ReplayFile } from "../../types";
import type { LastRecordedReplayEntityState } from "./runtimeRefs";

test("bot jump flags are recorded even with unchanged position and velocity and reach playback", () => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: null,
    isMultiplayer: false,
  });
  const bot = {
    id: "main_ai",
    controller: "ai",
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    hp: 100,
    hue: 200,
    playerName: "Vanguard",
    activeWeapon: "hammer",
    weaponState: "ready",
    isCrouching: false,
    isJumping: true,
  } as Combatant;
  state.otherPlayers.set("main_ai", bot);
  const replayRecordingRef: { current: ReplayFile | null } = { current: null };
  const lastRecordedStateRef = {
    current: new Map<string, LastRecordedReplayEntityState>(),
  };
  initializeReplayRecordingForState({
    state,
    replayData: null,
    replayRecordingRef,
    lastRecordTimeRef: { current: 0 },
    replayRecordingElapsedTimeRef: { current: 0 },
    lastRecordedStateRef,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    visualModelPolicy: "v3",
  });
  const record = (time: number) =>
    recordReplayFrameForState({
      state,
      time,
      replayRecordingRef,
      lastRecordedStateRef,
      isMultiplayer: false,
    });
  record(0);
  bot.isJumping = false;
  record(0.1);
  const replay = replayRecordingRef.current!;
  assert.equal(replay.frames[0].otherPlayers?.[0].isJumping, true);
  assert.equal(replay.frames[1].otherPlayers?.[0].isJumping, false);
  assert.equal(
    buildReplayPlaybackFrameSlice({
      replayData: replay,
      time: 0,
      botColors: {},
    })?.updatedPlayers.get("main_ai")?.isJumping,
    true,
  );
  assert.equal(
    buildReplayPlaybackFrameSlice({
      replayData: replay,
      time: 0.1,
      botColors: {},
    })?.updatedPlayers.get("main_ai")?.isJumping,
    false,
  );
  for (const frame of replay.frames)
    for (const actor of frame.otherPlayers ?? []) delete actor.isJumping;
  assert.equal(
    buildReplayPlaybackFrameSlice({
      replayData: replay,
      time: 0.1,
      botColors: {},
    })?.updatedPlayers.get("main_ai")?.isJumping,
    undefined,
  );
});

test("lunge contact and flight changes are recorded without position changes and reach playback", () => {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: null,
    isMultiplayer: false,
  });
  const bot = {
    id: "main_ai",
    controller: "ai",
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    hp: 100,
    hue: 200,
    playerName: "Vanguard",
    activeWeapon: "hammer",
    weaponState: "ready",
    isCrouching: false,
    isLunging: true,
  } as Combatant;
  state.otherPlayers.set("main_ai", bot);
  const replayRecordingRef: { current: ReplayFile | null } = { current: null };
  const lastRecordedStateRef = {
    current: new Map<string, LastRecordedReplayEntityState>(),
  };
  initializeReplayRecordingForState({
    state,
    replayData: null,
    replayRecordingRef,
    lastRecordTimeRef: { current: 0 },
    replayRecordingElapsedTimeRef: { current: 0 },
    lastRecordedStateRef,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    visualModelPolicy: "v3",
  });
  const record = (time: number) =>
    recordReplayFrameForState({
      state,
      time,
      replayRecordingRef,
      lastRecordedStateRef,
      isMultiplayer: false,
    });
  record(0);
  bot.isLunging = false;
  bot.swordLungeHit = true;
  record(0.1);
  const replay = replayRecordingRef.current!;
  assert.equal(replay.frames[1].otherPlayers?.[0].swordLungeHit, true);
  assert.equal(buildReplayPlaybackFrameSlice({ replayData: replay, time: 0.1, botColors: {} })?.updatedPlayers.get("main_ai")?.swordLungeHit, true);
  assert.equal(replay.frames[0].otherPlayers?.[0].isLunging, true);
  assert.equal(replay.frames[1].otherPlayers?.[0].isLunging, false);
  assert.equal(
    buildReplayPlaybackFrameSlice({
      replayData: replay,
      time: 0,
      botColors: {},
    })?.updatedPlayers.get("main_ai")?.isLunging,
    true,
  );
  assert.equal(
    buildReplayPlaybackFrameSlice({
      replayData: replay,
      time: 0.1,
      botColors: {},
    })?.updatedPlayers.get("main_ai")?.isLunging,
    false,
  );
  for (const frame of replay.frames)
    for (const actor of frame.otherPlayers ?? []) delete actor.isLunging;
  assert.equal(
    buildReplayPlaybackFrameSlice({
      replayData: replay,
      time: 0.1,
      botColors: {},
    })?.updatedPlayers.get("main_ai")?.isLunging,
    false,
  );
});
