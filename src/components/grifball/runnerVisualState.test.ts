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

test('roster visual sync applies runner orange to live ball holder', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  const meshes = createCombatantMeshRig(scene, 200, false);
  refs.otherPlayerMeshes.set('bot_1', meshes);

  const state = {
    isMultiplayer: false,
    grifball: { ball: { state: 'held', holderId: 'bot_1' } },
    settings: {
      enableSprint: false,
      enableSlide: false,
      hammerReloadTime: 0.6,
      hammerMeleeReload: 0.5,
    },
    otherPlayers: new Map([['bot_1', {
      id: 'bot_1',
      playerName: 'Bot',
      controller: 'ai',
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

  assert.equal(firstGroupVertexHex(meshes.group), RUNNER_ARMOR_ORANGE.getHexString());
});
