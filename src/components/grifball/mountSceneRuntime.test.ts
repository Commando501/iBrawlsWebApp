import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { initializeGrifballMountSceneForState } from './mountSceneRuntime';
import { createInitialGrifballThreeRefs } from './threeRefs';
import type { GrifballRuntimeState } from './runtimeState';
import type { CustomMapData, ReplayFile, UniversalSettings } from '../../types';

function harness() {
  const refs = createInitialGrifballThreeRefs();
  const scenes: { scene: THREE.Scene; disposals: number }[] = [];
  let floors = 0;
  let players = 0;
  const options: Parameters<typeof initializeGrifballMountSceneForState>[0] = {
    refs, state: { settings: {} } as GrifballRuntimeState,
    container: {} as HTMLElement, canvas: {} as HTMLCanvasElement,
    activeCustomMap: { theme: 'grifball_stadium', name: 'Stadium' } as CustomMapData,
    selectedMap: 'championship_stadium', replayData: {} as ReplayFile,
    adminSettings: {} as UniversalSettings, isMultiplayer: false,
    resetTransientVfx: () => {}, getLegacyRosterProps: () => ({} as never),
    getOfflineBotCount: () => 0, buildOrchestratorSpawnCallbacks: () => ({} as never),
    buildSilentOrchestratorEvents: () => ({}), placeCombatantsAtGrifballSpawns: () => {},
  };
  const dependencies: NonNullable<Parameters<typeof initializeGrifballMountSceneForState>[1]> = {
    initializeScene: () => {
      const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera();
      const record = { scene, disposals: 0 }; scenes.push(record);
      const renderer = { dispose: () => { record.disposals++; } } as THREE.WebGLRenderer;
      refs.scene = scene; refs.camera = camera; refs.renderer = renderer;
      return { scene, camera, renderer, isHangar: false };
    },
    buildCustomArena: () => {
      floors++;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      floor.name = 'stadium_floor'; refs.scene!.add(floor);
    },
    buildStadium: () => ({ ready: Promise.resolve(), cancel: () => {} }),
    buildLocalPlayer: () => { players++; },
    waitForTextures: async () => {},
  };
  return { refs, scenes, options, dependencies, floors: () => floors, players: () => players };
}

test('StrictMode restart cannot let a canceled mount build a second arena through reused refs', async () => {
  const h = harness();
  const oldController = new AbortController();
  const oldStages: number[] = [];
  let replacement!: ReturnType<typeof initializeGrifballMountSceneForState>;
  const old = initializeGrifballMountSceneForState({
    ...h.options, signal: oldController.signal,
    onLoadingStage: ({ progress }) => {
      oldStages.push(progress);
      if (progress !== 18) return;
      oldController.abort();
      replacement = initializeGrifballMountSceneForState(h.options, h.dependencies);
    },
  }, h.dependencies);
  await assert.rejects(old, { name: 'AbortError' });
  const current = await replacement;
  assert.equal(h.scenes.length, 2);
  assert.equal(h.scenes[0].disposals, 1, 'partially initialized renderer is released');
  assert.equal(h.scenes[1].disposals, 0, 'replacement renderer remains alive');
  assert.equal(h.refs.scene, current.scene, 'old cleanup cannot clear replacement refs');
  assert.equal(h.floors(), 1, 'only the replacement builds the arena');
  assert.equal(h.players(), 1, 'only the replacement builds a player');
  assert.equal(current.scene.children.filter(o => o.name === 'stadium_floor').length, 1);
  assert.ok(oldStages.every(progress => progress <= 18), 'no stale loading stages after cancellation');
});

test('canceling a pending architecture download is immediate and late completion cannot spawn players', async () => {
  const h = harness(); const controller = new AbortController();
  let resolve!: () => void; let entered!: () => void; let cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildStadium = () => ({
    ready: new Promise<void>(r => { resolve = r; }), cancel: () => { cancellations++; },
  });
  const pending = initializeGrifballMountSceneForState({
    ...h.options, signal: controller.signal,
    onLoadingStage: ({ progress }) => { if (progress === 70) setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1);
  assert.equal(h.scenes[0].disposals, 1);
  assert.equal(h.refs.scene, null);
  assert.equal(h.players(), 0);
  resolve(); await Promise.resolve();
  assert.equal(h.players(), 0);
});

test('canceling texture readiness does not wait for its timeout or mutate newer scene refs', async () => {
  const h = harness(); const controller = new AbortController();
  let entered!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForTextures = () => { entered(); return new Promise<void>(() => {}); };
  const pending = initializeGrifballMountSceneForState({ ...h.options, signal: controller.signal }, h.dependencies);
  await waiting;
  const replacement = new THREE.Scene();
  const replacementCamera = new THREE.PerspectiveCamera();
  h.refs.scene = replacement; h.refs.camera = replacementCamera;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.refs.scene, replacement);
  assert.equal(h.refs.camera, replacementCamera);
  assert.equal(h.scenes[0].disposals, 1);
  assert.equal(h.players(), 0);
});

test('a builder failure releases the unfinished stadium and reports the original failure', async () => {
  const h = harness(); const failure = new Error('builder failed');
  h.dependencies.buildStadium = () => { throw failure; };
  await assert.rejects(initializeGrifballMountSceneForState(h.options, h.dependencies), error => error === failure);
  assert.equal(h.scenes[0].disposals, 1);
  assert.equal(h.refs.scene, null);
  assert.equal(h.refs.renderer, null);
  assert.equal(h.refs.camera, null);
  assert.equal(h.players(), 0);
});

test('an already aborted mount never reports progress or allocates a renderer', async () => {
  const h = harness(); const controller = new AbortController(); controller.abort();
  await assert.rejects(initializeGrifballMountSceneForState({
    ...h.options, signal: controller.signal, onLoadingStage: () => assert.fail('stale progress'),
  }, h.dependencies), { name: 'AbortError' });
  assert.equal(h.scenes.length, 0);
});

function hangarHarness() {
  const h = harness();
  h.options.activeCustomMap = null;
  h.options.selectedMap = 'hangar';
  const initialize = h.dependencies.initializeScene!;
  h.dependencies.initializeScene = options => ({ ...initialize(options), isHangar: true });
  h.dependencies.buildHangarBase = () => {
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, .2, 64), new THREE.MeshStandardMaterial());
    floor.name = 'hangar_floor'; h.refs.scene!.add(floor);
  };
  h.dependencies.buildDefaultArena = () => assert.fail('legacy Hangar floor must not be duplicated');
  h.dependencies.buildHangar = () => ({ ready: Promise.resolve(), cancel: () => {} });
  h.dependencies.waitForHangarTextures = async () => {};
  return h;
}

test('Hangar cancellation releases its floor and cannot complete a stale player mount', async () => {
  const h = hangarHarness(), controller = new AbortController();
  let entered!: () => void, resolve!: () => void, cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildHangar = () => ({ ready: new Promise<void>(r => { resolve = r; }), cancel: () => { cancellations++; } });
  const pending = initializeGrifballMountSceneForState({ ...h.options, signal: controller.signal,
    onLoadingStage: ({ progress }) => { if (progress === 60) setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting; const floor = h.refs.scene!.getObjectByName('hangar_floor')!;
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1); assert.equal(floor.parent, null); assert.equal(h.scenes[0].disposals, 1);
  resolve(); await Promise.resolve(); assert.equal(h.players(), 0);
});

test('Hangar waits for its material gate before creating the player', async () => {
  const h = hangarHarness(); let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForHangarTextures = () => { entered(); return new Promise<void>(r => { release = r; }); };
  h.dependencies.waitForTextures = () => { assert.fail('Stadium gate must not replace Hangar readiness'); };
  const mounting = initializeGrifballMountSceneForState(h.options, h.dependencies);
  await waiting; assert.equal(h.players(), 0); release(); await mounting;
  assert.equal(h.players(), 1);
  assert.equal(h.refs.scene!.children.filter(o => o.name === 'hangar_floor').length, 1);
});

test('Circle retains its default builder and does not load Hangar assets', async () => {
  const h = harness(); h.options.activeCustomMap = null; h.options.selectedMap = 'circle';
  let circles = 0;
  h.dependencies.buildDefaultArena = ({ isHangar }) => { assert.equal(isHangar, false); circles++; };
  h.dependencies.buildHangar = () => { assert.fail('Circle must not load Hangar'); };
  h.dependencies.buildHangarBase = () => { assert.fail('Circle must not use Hangar floor'); };
  await initializeGrifballMountSceneForState(h.options, h.dependencies);
  assert.equal(circles, 1); assert.equal(h.players(), 1);
});

test('canceling a Canyon load releases its floor and prevents late combatant creation', async () => {
  const h = harness(); const controller = new AbortController();
  h.options.activeCustomMap = { id: 'forerunner_canyon', theme: 'forerunner' } as CustomMapData;
  h.dependencies.buildStadium = () => undefined;
  let floor!: THREE.Mesh, resolve!: () => void, entered!: () => void, cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildCustomArena = () => {
    floor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    floor.name = 'canyon_floor'; h.refs.scene!.add(floor);
  };
  h.dependencies.buildCanyon = () => ({
    ready: new Promise<void>(r => { resolve = r; }), cancel: () => { cancellations++; },
  });
  const pending = initializeGrifballMountSceneForState({
    ...h.options, signal: controller.signal,
    onLoadingStage: ({ stage }) => { if (stage === 'Loading canyon architecture') setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1);
  assert.equal(floor.parent, null);
  assert.equal(h.scenes[0].disposals, 1);
  resolve(); await Promise.resolve();
  assert.equal(h.players(), 0);
});

test('Canyon waits for its own material readiness before creating the player', async () => {
  const h = harness();
  h.options.activeCustomMap = { id: 'forerunner_canyon', theme: 'forerunner' } as CustomMapData;
  h.dependencies.buildStadium = () => undefined;
  h.dependencies.buildCanyon = () => ({ ready: Promise.resolve(), cancel: () => {} });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForCanyonTextures = () => { entered(); return new Promise<void>(r => { release = r; }); };
  h.dependencies.waitForTextures = () => assert.fail('Stadium-specific gate must not replace Canyon readiness');
  const pending = initializeGrifballMountSceneForState(h.options, h.dependencies);
  await waiting;
  assert.equal(h.players(), 0);
  release(); await pending;
  assert.equal(h.players(), 1);
});

function cyberHarness() {
  const h = harness();
  h.options.activeCustomMap = { id: 'cyber_hex_arena', theme: 'cyberpunk' } as CustomMapData;
  h.dependencies.buildStadium = () => undefined;
  h.dependencies.buildCustomArena = () => {
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, .2, 64), new THREE.MeshStandardMaterial());
    floor.name = 'cyber_floor'; h.refs.scene!.add(floor);
  };
  h.dependencies.buildCyber = () => ({ ready: Promise.resolve(), cancel: () => {} });
  h.dependencies.waitForCyberTextures = async () => {};
  return h;
}

test('Cyber cancellation disposes its floor and blocks a late player mount', async () => {
  const h = cyberHarness(), controller = new AbortController();
  let entered!: () => void, release!: () => void, cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildCyber = () => ({ ready: new Promise<void>(r => { release = r; }), cancel: () => { cancellations++; } });
  const pending = initializeGrifballMountSceneForState({ ...h.options, signal: controller.signal,
    onLoadingStage: ({ progress }) => { if (progress === 70) setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting; const floor = h.refs.scene!.getObjectByName('cyber_floor')!;
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1); assert.equal(floor.parent, null); assert.equal(h.scenes[0].disposals, 1);
  release(); await Promise.resolve(); assert.equal(h.players(), 0);
});

test('Cyber waits for its material readiness independently of the other maps', async () => {
  const h = cyberHarness(); let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForCyberTextures = () => { entered(); return new Promise<void>(r => { release = r; }); };
  h.dependencies.waitForTextures = h.dependencies.waitForCanyonTextures = h.dependencies.waitForHangarTextures = () => assert.fail('wrong material gate');
  const pending = initializeGrifballMountSceneForState(h.options, h.dependencies);
  await waiting; assert.equal(h.players(), 0); release(); await pending;
  assert.equal(h.players(), 1);
});

function jungleHarness() {
  const h = harness();
  h.options.activeCustomMap = { id: 'botanical_outpost', theme: 'nature' } as CustomMapData;
  h.dependencies.buildStadium = () => undefined;
  h.dependencies.buildCustomArena = () => {
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(21, 21, .2, 64), new THREE.MeshStandardMaterial());
    floor.name = 'jungle_floor'; h.refs.scene!.add(floor);
  };
  h.dependencies.buildJungle = () => ({ ready: Promise.resolve(), cancel: () => {} });
  h.dependencies.waitForJungleTextures = async () => {};
  return h;
}

test('Jungle cancellation disposes its floor and blocks a late player mount', async () => {
  const h = jungleHarness(), controller = new AbortController();
  let entered!: () => void, release!: () => void, cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildJungle = () => ({ ready: new Promise<void>(r => { release = r; }), cancel: () => { cancellations++; } });
  const pending = initializeGrifballMountSceneForState({ ...h.options, signal: controller.signal,
    onLoadingStage: ({ progress }) => { if (progress === 70) setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting; const floor = h.refs.scene!.getObjectByName('jungle_floor')!;
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1); assert.equal(floor.parent, null); assert.equal(h.scenes[0].disposals, 1);
  release(); await Promise.resolve(); assert.equal(h.players(), 0);
});

test('Jungle waits for its material readiness independently of the other maps', async () => {
  const h = jungleHarness(); let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForJungleTextures = () => { entered(); return new Promise<void>(r => { release = r; }); };
  h.dependencies.waitForTextures = h.dependencies.waitForCanyonTextures = h.dependencies.waitForHangarTextures = h.dependencies.waitForCyberTextures = () => assert.fail('wrong material gate');
  const pending = initializeGrifballMountSceneForState(h.options, h.dependencies);
  await waiting; assert.equal(h.players(), 0); release(); await pending;
  assert.equal(h.players(), 1);
});

function asteroidHarness() {
  const h = harness();
  h.options.activeCustomMap = { id: 'vanguard_starbase', theme: 'space' } as CustomMapData;
  h.dependencies.buildStadium = () => undefined;
  h.dependencies.buildCustomArena = () => {
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, .2, 64), new THREE.MeshStandardMaterial());
    floor.name = 'asteroid_floor'; h.refs.scene!.add(floor);
  };
  h.dependencies.buildAsteroid = () => ({ ready: Promise.resolve(), cancel: () => {} });
  h.dependencies.waitForAsteroidTextures = async () => {};
  return h;
}

test('Asteroid cancellation disposes its floor and blocks a late player mount', async () => {
  const h = asteroidHarness(), controller = new AbortController();
  let entered!: () => void, release!: () => void, cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildAsteroid = () => ({ ready: new Promise<void>(r => { release = r; }), cancel: () => { cancellations++; } });
  const pending = initializeGrifballMountSceneForState({ ...h.options, signal: controller.signal,
    onLoadingStage: ({ progress }) => { if (progress === 70) setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting; const floor = h.refs.scene!.getObjectByName('asteroid_floor')!;
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1); assert.equal(floor.parent, null); assert.equal(h.scenes[0].disposals, 1);
  release(); await Promise.resolve(); assert.equal(h.players(), 0);
});

test('Asteroid waits for its material readiness independently of the other maps', async () => {
  const h = asteroidHarness(); let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForAsteroidTextures = () => { entered(); return new Promise<void>(r => { release = r; }); };
  h.dependencies.waitForTextures = h.dependencies.waitForCanyonTextures = h.dependencies.waitForHangarTextures = h.dependencies.waitForCyberTextures = h.dependencies.waitForJungleTextures = () => assert.fail('wrong material gate');
  const pending = initializeGrifballMountSceneForState(h.options, h.dependencies);
  await waiting; assert.equal(h.players(), 0); release(); await pending;
  assert.equal(h.players(), 1);
});

function neonHarness() {
  const h = harness();
  h.options.activeCustomMap = { id: 'synthwave_grid_arena', theme: 'synthwave' } as CustomMapData;
  h.dependencies.buildStadium = () => undefined;
  h.dependencies.buildCustomArena = () => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(48, .2, 24), new THREE.MeshStandardMaterial());
    floor.name = 'neon_floor'; h.refs.scene!.add(floor);
  };
  h.dependencies.buildNeon = () => ({ ready: Promise.resolve(), cancel: () => {} });
  h.dependencies.waitForNeonTextures = async () => {};
  return h;
}

test('Neon cancellation disposes its floor and blocks a late player mount', async () => {
  const h = neonHarness(), controller = new AbortController();
  let entered!: () => void, release!: () => void, cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildNeon = () => ({ ready: new Promise<void>(r => { release = r; }), cancel: () => { cancellations++; } });
  const pending = initializeGrifballMountSceneForState({ ...h.options, signal: controller.signal,
    onLoadingStage: ({ progress }) => { if (progress === 70) setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting; const floor = h.refs.scene!.getObjectByName('neon_floor')!;
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1); assert.equal(floor.parent, null); assert.equal(h.scenes[0].disposals, 1);
  release(); await Promise.resolve(); assert.equal(h.players(), 0);
});

test('Neon waits for its material readiness independently of the other maps', async () => {
  const h = neonHarness(); let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForNeonTextures = () => { entered(); return new Promise<void>(r => { release = r; }); };
  h.dependencies.waitForTextures = h.dependencies.waitForCanyonTextures = h.dependencies.waitForHangarTextures = h.dependencies.waitForCyberTextures = h.dependencies.waitForJungleTextures = h.dependencies.waitForAsteroidTextures = () => assert.fail('wrong material gate');
  const pending = initializeGrifballMountSceneForState(h.options, h.dependencies);
  await waiting; assert.equal(h.players(), 0); release(); await pending;
  assert.equal(h.players(), 1);
});

function rainyHarness() {
  const h = harness();
  h.options.activeCustomMap = { id: 'rainy_industrial_streets', theme: 'rainy_streets' } as CustomMapData;
  h.dependencies.buildStadium = () => undefined;
  h.dependencies.buildCustomArena = () => {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(48, .2, 24), new THREE.MeshStandardMaterial());
    floor.name = 'rainy_floor'; h.refs.scene!.add(floor);
  };
  h.dependencies.buildRainy = () => ({ ready: Promise.resolve(), cancel: () => {} });
  h.dependencies.waitForRainyTextures = async () => {};
  return h;
}

test('Rainy cancellation disposes its floor and blocks a late player mount', async () => {
  const h = rainyHarness(), controller = new AbortController();
  let entered!: () => void, release!: () => void, cancellations = 0;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.buildRainy = () => ({ ready: new Promise<void>(r => { release = r; }), cancel: () => { cancellations++; } });
  const pending = initializeGrifballMountSceneForState({ ...h.options, signal: controller.signal,
    onLoadingStage: ({ progress }) => { if (progress === 70) setTimeout(entered, 5); },
  }, h.dependencies);
  await waiting; const floor = h.refs.scene!.getObjectByName('rainy_floor')!;
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancellations, 1); assert.equal(floor.parent, null); assert.equal(h.scenes[0].disposals, 1);
  release(); await Promise.resolve(); assert.equal(h.players(), 0);
});

test('Rainy waits for its material readiness independently of the other maps', async () => {
  const h = rainyHarness(); let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => { entered = r; });
  h.dependencies.waitForRainyTextures = () => { entered(); return new Promise<void>(r => { release = r; }); };
  h.dependencies.waitForTextures = h.dependencies.waitForCanyonTextures = h.dependencies.waitForHangarTextures = h.dependencies.waitForCyberTextures = h.dependencies.waitForJungleTextures = h.dependencies.waitForAsteroidTextures = () => assert.fail('wrong material gate');
  const pending = initializeGrifballMountSceneForState(h.options, h.dependencies);
  await waiting; assert.equal(h.players(), 0); release(); await pending;
  assert.equal(h.players(), 1);
});
