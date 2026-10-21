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
import { syncCombatantTeamArmor } from './combatantTeamArmor';
import { buildVoxelSpartanModel } from '../VoxelModels';

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

test('runner damage keeps a red ripple glow until shields recover', () => {
  const { group, material, colors } = createVertexColoredGroup();

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 2, alive: true, nowMs: 100 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 180 });

  assert.equal(firstVertexHex(colors), RUNNER_ARMOR_ORANGE.getHexString());
  assert.equal(material.emissive.getHexString(), RUNNER_DAMAGE_RED.getHexString());
  assert.ok(material.emissiveIntensity > 0);

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 1200 });

  assert.equal(material.emissive.getHexString(), RUNNER_DAMAGE_RED.getHexString());
});

test('runner healing applies blue to the body without adding ring geometry', () => {
  const { group, material } = createVertexColoredGroup();
  const originalChildren = [...group.children];

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 100 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1.25, alive: true, nowMs: 300 });

  assert.equal(material.emissive.getHexString(), RUNNER_HEAL_BLUE.getHexString());
  assert.deepEqual(group.children, originalChildren);

  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1.5, alive: true, nowMs: 900 });

  assert.equal(material.emissive.getHexString(), RUNNER_HEAL_BLUE.getHexString());
  assert.deepEqual(group.children, originalChildren);
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
  assert.equal(material.version, materialVersion + 1, 'install the ripple shader once; animate only uniforms');
  assert.equal(material.emissive.getHexString(), RUNNER_DAMAGE_RED.getHexString());
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

test('material-colored carriers keep their healing ripple blue across updates', () => {
  const group = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color: '#2563eb' });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1, alive: true, nowMs: 0 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1.1, alive: true, nowMs: 100 });
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 1.2, alive: true, nowMs: 200 });
  assert.equal(material.emissive.getHexString(), RUNNER_HEAL_BLUE.getHexString());
  assert.equal(group.getObjectByName('runner-heal-wave'), undefined);
  assert.equal(material.color.getHexString(), RUNNER_ARMOR_ORANGE.getHexString());
  updateRunnerVisualStateForGroup({ group, carrying: false, hp: 2, alive: true, nowMs: 300 });
  assert.equal(material.color.getHexString(), '2563eb');
  assert.equal(group.getObjectByName('runner-heal-wave'), undefined);
});

for (const modelSystem of ['v1', 'v2', 'v3'] as const) {
  test(`${modelSystem} armor ripples reflect custom shield capacity, recharge, interruption, and release`, () => {
    const group = buildVoxelSpartanModel(false, 100, { modelSystem }, { v3QualityTier: 'mobileLow' });
    const armor = syncCombatantTeamArmor(group, 'red', 'blue')!;
    const update = (hp: number, nowMs: number, carrying = true) =>
      updateRunnerVisualStateForGroup({ group, hp, maxHp: 5, nowMs, carrying, alive: true });
    update(5, 0);
    const fullVersion = armor.material.version;
    assert.equal(armor.material.color.getHexString(), RUNNER_ARMOR_ORANGE.getHexString());
    // Start observing an already damaged runner; no prior hit event is required.
    update(3, 100);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as Parameters<THREE.Material['onBeforeCompile']>[0];
    armor.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const uniforms = shader.uniforms;
    assert.equal(uniforms.runnerRippleStrength.value, 1);
    assert.equal(uniforms.runnerRippleColor.value.getHexString(), RUNNER_DAMAGE_RED.getHexString());
    update(3, 2500);
    assert.equal(uniforms.runnerRippleStrength.value, 1, 'damage persists beyond the old hit flash');
    update(3.1, 2600);
    assert.equal(uniforms.runnerRippleColor.value.getHexString(), RUNNER_HEAL_BLUE.getHexString());
    assert.equal(group.getObjectByName('runner-heal-wave'), undefined);
    for (let frame = 1; frame <= 40; frame++) update(3.1 + frame * 0.01, 2600 + frame * 16);
    assert.ok(uniforms.runnerRippleTime.value > 0.6, 'surface ripple does not restart each frame');
    update(3.5, 3350);
    assert.equal(uniforms.runnerRippleColor.value.getHexString(), RUNNER_HEAL_BLUE.getHexString(), 'bridge snapshot gaps');
    update(2, 3400);
    assert.equal(uniforms.runnerRippleColor.value.getHexString(), RUNNER_DAMAGE_RED.getHexString());
    update(2.1, 3500);
    update(2.1, 4100);
    assert.equal(uniforms.runnerRippleColor.value.getHexString(), RUNNER_DAMAGE_RED.getHexString(), 'stalled healing returns to damaged');
    update(5, 4200);
    assert.equal(uniforms.runnerRippleStrength.value, 0, 'full shields are plain gold');
    update(2, 4300);
    update(2, 4400, false);
    assert.equal(uniforms.runnerRippleStrength.value, 0);
    assert.equal(armor.material.color.getHexString(), 'dc2626');
    assert.equal(group.getObjectByName('runner-heal-wave'), undefined);
    assert.equal(armor.material.version, fullVersion + 1, 'shader installs once for all transitions');
  });
}

test('joining a damaged runner immediately shows red and full custom shields stay gold', () => {
  const { group, material } = createVertexColoredGroup();
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 4, maxHp: 8, alive: true, nowMs: 0 });
  assert.equal(material.emissive.getHexString(), RUNNER_DAMAGE_RED.getHexString());
  updateRunnerVisualStateForGroup({ group, carrying: true, hp: 8, maxHp: 8, alive: true, nowMs: 100 });
  assert.equal(material.emissive.getHexString(), '000000');
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
