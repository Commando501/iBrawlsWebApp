import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  RUNNER_ARMOR_ORANGE,
  RUNNER_DAMAGE_RED,
  RUNNER_HEAL_BLUE,
  updateRunnerVisualStateForGroup,
} from './runnerVisualState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createCombatantMeshRig } from './combatantModels';
import { updateRosterCombatantVisualsForState } from './rosterVisualSync';
import type { GrifballRuntimeState } from './runtimeState';

function createVertexColoredGroup(color: THREE.ColorRepresentation = '#2563eb'): {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  colors: THREE.BufferAttribute;
} {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const vertexCount = geometry.getAttribute('position').count;
  const sourceColor = new THREE.Color(color);
  const colorData = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) {
    colorData[i * 3] = sourceColor.r;
    colorData[i * 3 + 1] = sourceColor.g;
    colorData[i * 3 + 2] = sourceColor.b;
  }
  const colors = new THREE.BufferAttribute(colorData, 3);
  geometry.setAttribute('color', colors);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.65,
  });
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  return { group, mesh, material, colors };
}

function firstVertexHex(attribute: THREE.BufferAttribute): string {
  return new THREE.Color(attribute.getX(0), attribute.getY(0), attribute.getZ(0)).getHexString();
}

function firstGroupVertexHex(group: THREE.Group): string | null {
  let hex: string | null = null;
  group.traverse((child) => {
    if (hex || !(child instanceof THREE.Mesh) || child.userData.teamOutlineMesh === true) return;
    const colors = child.geometry.getAttribute('color');
    if (colors instanceof THREE.BufferAttribute) {
      hex = firstVertexHex(colors);
    }
  });
  return hex;
}

test('runner orange armor applies while carrying and restores after drop', () => {
  const { group, colors } = createVertexColoredGroup('#2563eb');
  const originalHex = firstVertexHex(colors);

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 100 });

  assert.equal(firstVertexHex(colors), RUNNER_ARMOR_ORANGE.getHexString());

  updateRunnerVisualStateForGroup({ group, carrying: false, hp: 2, alive: true, nowMs: 200 });

  assert.equal(firstVertexHex(colors), originalHex);
  assert.equal(group.children.some((child) => child.name === 'runner-heal-wave'), false);
});

test('runner damage starts a blinking red glow over orange armor', () => {
  const { group, material, colors } = createVertexColoredGroup();

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 100 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 180 });

  assert.equal(firstVertexHex(colors), RUNNER_ARMOR_ORANGE.getHexString());
  assert.equal(material.emissive.getHexString(), RUNNER_DAMAGE_RED.getHexString());
  assert.ok(material.emissiveIntensity > 0);

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 1200 });

  assert.equal(material.emissive.getHexString(), '000000');
});

test('runner healing starts a blue wave from legs toward head', () => {
  const { group } = createVertexColoredGroup();

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 100 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1.25, alive: true, nowMs: 300 });

  const wave = group.children.find((child) => child.name === 'runner-heal-wave') as THREE.Mesh | undefined;
  assert.ok(wave);
  assert.equal((wave.material as THREE.MeshBasicMaterial).color.getHexString(), RUNNER_HEAL_BLUE.getHexString());
  assert.ok(wave.position.y < 0);

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1.25, alive: true, nowMs: 900 });

  assert.ok(wave.position.y > 0);
});

test('runner visuals clear when combatant dies', () => {
  const { group, material, colors } = createVertexColoredGroup('#2563eb');
  const originalHex = firstVertexHex(colors);

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 100 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 180 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 0, alive: false, nowMs: 200 });

  assert.equal(firstVertexHex(colors), originalHex);
  assert.equal(material.emissive.getHexString(), '000000');
  assert.equal(group.children.some((child) => child.name === 'runner-heal-wave'), false);
});

test('non-carriers never upload unchanged armor buffers or invalidate materials', () => {
  const { group, colors, material } = createVertexColoredGroup();
  const original = Array.from(colors.array), bufferVersion = colors.version, materialVersion = material.version;
  for (let frame = 0; frame < 120; frame++)
    updateRunnerVisualStateForGroup({ group, carrying: false, hp: 2, alive: true, nowMs: frame * 16 });
  assert.deepEqual(Array.from(colors.array), original);
  assert.equal(colors.version, bufferVersion);
  assert.equal(material.version, materialVersion);
});

test('carrier armor uploads only on tint transitions while damage uniforms still animate', () => {
  const { group, colors, material } = createVertexColoredGroup();
  const original = Array.from(colors.array), materialVersion = material.version;
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 0 });
  const tintedVersion = colors.version;
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 100 });
  const firstGlow = material.emissiveIntensity;
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 130 });
  assert.notEqual(material.emissiveIntensity, firstGlow);
  assert.equal(material.emissive.getHexString(), RUNNER_DAMAGE_RED.getHexString());
  for (let frame = 0; frame < 120; frame++)
    updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 150 + frame * 16 });
  assert.equal(colors.version, tintedVersion);
  assert.equal(material.version, materialVersion, 'uniform updates do not require shader revalidation');
  assert.equal(material.emissive.getHexString(), '000000');
  updateRunnerVisualStateForGroup({ group, carrying: false, hp: 1, alive: true, nowMs: 2200 });
  assert.equal(colors.version, tintedVersion + 1);
  assert.deepEqual(Array.from(colors.array), original);
  for (let frame = 0; frame < 120; frame++)
    updateRunnerVisualStateForGroup({ group, carrying: false, hp: 1, alive: true, nowMs: 2216 + frame * 16 });
  assert.equal(colors.version, tintedVersion + 1);
});

test('next possession restores the latest armor customization instead of an obsolete snapshot', () => {
  const { group, colors, material } = createVertexColoredGroup();
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 0 });
  updateRunnerVisualStateForGroup({ group, carrying: false, hp: 2, alive: true, nowMs: 100 });
  const edited = new THREE.Color('#22c55e');
  for (let i = 0; i < colors.count; i++) colors.setXYZ(i, edited.r, edited.g, edited.b);
  material.emissive.set('#123456'); material.emissiveIntensity = 0.3;
  const expected = Array.from(colors.array);
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 200 });
  updateRunnerVisualStateForGroup({ group, carrying: false, hp: 2, alive: true, nowMs: 300 });
  assert.deepEqual(Array.from(colors.array), expected);
  assert.equal(material.emissive.getHexString(), '123456');
  assert.equal(material.emissiveIntensity, 0.3);
});

test('armor added during a possession gets tinted once and restores independently', () => {
  const first = createVertexColoredGroup(), added = createVertexColoredGroup('#22c55e');
  const originalAdded = Array.from(added.colors.array);
  updateRunnerVisualStateForGroup({ group: first.group, carrying: true, hp: 2, alive: true, nowMs: 0 });
  const firstVersion = first.colors.version;
  first.group.add(added.mesh);
  updateRunnerVisualStateForGroup({ group: first.group, carrying: true, hp: 2, alive: true, nowMs: 100 });
  assert.equal(first.colors.version, firstVersion);
  assert.equal(firstVertexHex(added.colors), RUNNER_ARMOR_ORANGE.getHexString());
  updateRunnerVisualStateForGroup({ group: first.group, carrying: false, hp: 2, alive: true, nowMs: 200 });
  assert.deepEqual(Array.from(added.colors.array), originalAdded);
});

test('material-colored carriers keep their healing wave blue across updates', () => {
  const group = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color: '#2563eb' });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 0 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 100 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 200 });
  const wave = group.getObjectByName('runner-heal-wave') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  assert.equal(wave.material.color.getHexString(), RUNNER_HEAL_BLUE.getHexString());
  assert.ok(wave.material.opacity < 0.78);
  assert.equal(material.color.getHexString(), RUNNER_ARMOR_ORANGE.getHexString());
  updateRunnerVisualStateForGroup({ group, carrying: false, hp: 2, alive: true, nowMs: 300 });
  assert.equal(material.color.getHexString(), '2563eb');
  assert.equal(group.getObjectByName('runner-heal-wave'), undefined);
});

for (const controller of ['ai', 'remote'] as const) {
  for (const team of ['blue', 'red'] as const) {
    test(`live ${controller} ${team} ball holder becomes gold and restores team color`, () => {
      const scene = new THREE.Scene();
      const refs = createInitialGrifballThreeRefs();
      refs.scene = scene;
      const meshes = createCombatantMeshRig(scene, 200, false);
      refs.otherPlayerMeshes.set('bot_1', meshes);

      const state = {
        isMultiplayer: false,
        localPlayerTeam: 'blue',
        grifball: { ball: { state: 'held', holderId: 'bot_1' } },
        settings: {
          gameMode: 'grifball',
          enableSprint: false,
          enableSlide: false,
          hammerReloadTime: 0.6,
          hammerMeleeReload: 0.5,
        },
        otherPlayers: new Map([['bot_1', {
          id: 'bot_1',
          playerName: 'Bot',
          controller,
          team,
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          yaw: 0,
          isCrouching: false,
          hp: 2,
          maxHp: 2,
          respawnTimer: 0,
          score: 0,
          kills: 0,
          deaths: 0,
          activeWeapon: 'ball',
          weaponState: 'ready',
          weaponTimer: 0,
        }]]),
      } as unknown as GrifballRuntimeState;

      updateRosterCombatantVisualsForState({
        refs,
        state,
        dt: 0.016,
        renderSwordLungeTrailVfx: () => {},
        applyBotMeleeImpact: () => {},
      });

      const armor = meshes.group.userData.teamArmorState;
      assert.equal(armor.material.color.getHexString(), RUNNER_ARMOR_ORANGE.getHexString());
      state.grifball.ball.state = 'loose';
      state.grifball.ball.holderId = null;
      updateRosterCombatantVisualsForState({
        refs, state, dt: 0.016,
        renderSwordLungeTrailVfx: () => {}, applyBotMeleeImpact: () => {},
      });
      assert.equal(armor.material.color.getHexString(), team === 'blue' ? '2563eb' : 'dc2626');
    });

  }
}
