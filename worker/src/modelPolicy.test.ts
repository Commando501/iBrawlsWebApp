import assert from "node:assert/strict";
import test from "node:test";
import * as workerModule from "./index";

type WorkerHelpers = {
  normalizeMatchLobbyConfig?: (input: unknown) => Record<string, unknown>;
  createMatchLobbySummary?: (
    config: Record<string, unknown>,
    options?: { hasPassword?: boolean; inProgress?: boolean },
  ) => Record<string, unknown>;
  normalizePlayerLoadout?: (input: unknown) => Record<string, unknown> | undefined;
};

const helpers = workerModule as WorkerHelpers;

function getHelper<Name extends keyof WorkerHelpers>(name: Name): NonNullable<WorkerHelpers[Name]> {
  const helper = helpers[name];
  assert.equal(typeof helper, "function", `${name} should be exported for focused worker sanitation coverage`);
  return helper as NonNullable<WorkerHelpers[Name]>;
}

test("worker lobby config preserves supported visual model policies and defaults invalid values to v3", () => {
  const normalizeMatchLobbyConfig = getHelper("normalizeMatchLobbyConfig");

  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: "v1" }).visualModelPolicy, "v1");
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: "v2" }).visualModelPolicy, "v2");
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: "v3" }).visualModelPolicy, "v3");
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: "forge" }).visualModelPolicy, "v3");
  assert.equal(normalizeMatchLobbyConfig({}).visualModelPolicy, "v3");
});

test("worker lobby summaries mirror the normalized visual model policy", () => {
  const normalizeMatchLobbyConfig = getHelper("normalizeMatchLobbyConfig");
  const createMatchLobbySummary = getHelper("createMatchLobbySummary");

  const config = normalizeMatchLobbyConfig({ visualModelPolicy: "v2" });
  const summary = createMatchLobbySummary(config);

  assert.equal(summary.visualModelPolicy, "v2");
});

test("worker loadout sanitation preserves v3 and drops arbitrary mesh data", () => {
  const normalizePlayerLoadout = getHelper("normalizePlayerLoadout");

  const loadout = normalizePlayerLoadout({
    helmet: "mark-vi",
    modelSystem: "v3",
    modelType: "large",
    rawMesh: { vertices: [0, 1, 2] },
    meshImportPath: "/private/reference-model.glb",
    vertices: [0, 1, 2],
    faces: [[0, 1, 2]],
    customArmor: {
      helmet: {
        version: 1,
        id: "helmet-v3",
        name: "Helmet V3",
        slot: "helmet",
        modelType: "large",
        rawMesh: { vertices: [0, 1, 2] },
        meshImportPath: "/private/reference-helmet.glb",
        vertices: [0, 1, 2],
        faces: [[0, 1, 2]],
        voxels: [{ x: 0, y: 0, z: 0, role: "primary" }],
      },
    },
  });

  assert.ok(loadout);
  assert.equal(loadout.modelSystem, "v3");
  assert.equal(Object.hasOwn(loadout, "modelType"), false);
  assert.equal(Object.hasOwn(loadout, "rawMesh"), false);
  assert.equal(Object.hasOwn(loadout, "meshImportPath"), false);
  assert.equal(Object.hasOwn(loadout, "vertices"), false);
  assert.equal(Object.hasOwn(loadout, "faces"), false);

  const customArmor = loadout.customArmor as Record<string, Record<string, unknown>>;
  const helmet = customArmor.helmet;
  assert.ok(helmet);
  assert.equal(Object.hasOwn(helmet, "rawMesh"), false);
  assert.equal(Object.hasOwn(helmet, "meshImportPath"), false);
  assert.equal(Object.hasOwn(helmet, "vertices"), false);
  assert.equal(Object.hasOwn(helmet, "faces"), false);
});
