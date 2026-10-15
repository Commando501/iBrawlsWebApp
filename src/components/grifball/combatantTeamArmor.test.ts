import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildVoxelSpartanModel } from '../VoxelModels';
import { createCombatantMeshRig } from './combatantModels';
import { clearRunnerVisualStateForGroup, updateRunnerVisualStateForGroup } from './runnerVisualState';
import { FRIENDLY_ARMOR_COLOR, ENEMY_ARMOR_COLOR, RUNNER_ARMOR_COLOR, registerCombatantTeamArmorSources, resolveFriendlyArmorTeam, syncCombatantTeamArmor } from './combatantTeamArmor';

for (const modelSystem of ['v1', 'v2', 'v3'] as const) {
  test(`${modelSystem} armor is opaque solid team color without extra overlay geometry`, () => {
    const model = buildVoxelSpartanModel(false, 100, { modelSystem }, { v3QualityTier: 'mobileLow' });
    const sources = registerCombatantTeamArmorSources(model);
    const before: THREE.Object3D[] = [];
    model.traverse(object => before.push(object));
    const armor = syncCombatantTeamArmor(model, 'red', 'red')!;
    assert.ok(sources.length > 0);
    assert.equal(armor.material.color.getHexString(), FRIENDLY_ARMOR_COLOR.slice(1));
    assert.equal(armor.material.transparent, false);
    assert.equal(armor.material.opacity, 1);
    assert.equal(armor.material.vertexColors, false);
    assert.equal(armor.material.emissive.getHex(), 0);
    assert.equal(armor.material.blending, THREE.NormalBlending);
    assert.ok(sources.every(source => source.material === armor.material));
    const after: THREE.Object3D[] = [];
    model.traverse(object => after.push(object));
    assert.deepEqual(after, before);
    syncCombatantTeamArmor(model, 'blue', 'red');
    assert.equal(armor.material.color.getHexString(), ENEMY_ARMOR_COLOR.slice(1));
  });
}

test('team colors isolate shared materials and preserve saved paint when leaving team mode', () => {
  const material = new THREE.MeshStandardMaterial({ color: '#12ab34', vertexColors: true });
  const geometry = new THREE.BoxGeometry();
  const root = new THREE.Group();
  const body = new THREE.Mesh(geometry, [material]);
  const other = new THREE.Mesh(geometry, material);
  const original = body.material;
  root.add(body);
  const armor = syncCombatantTeamArmor(root, 'red', 'blue')!;
  assert.equal(other.material, material);
  assert.equal(material.color.getHexString(), '12ab34');
  let disposed = false;
  armor.material.addEventListener('dispose', () => { disposed = true; });
  syncCombatantTeamArmor(root, null);
  assert.equal(body.material, original);
  assert.equal(disposed, true);
  assert.equal(body.userData.teamArmorMesh, undefined);
});

test('weapons keep separate materials and runner pickup/damage/healing stays gold until release', () => {
  const rig = createCombatantMeshRig(new THREE.Scene(), 110, false, { modelSystem: 'v1' }, {}, 'blue', 'blue');
  const armor = rig.group.userData.teamArmorState;
  rig.hammer.traverse(object => {
    if (object instanceof THREE.Mesh) assert.notEqual(object.material, armor.material);
  });
  for (const [carrying, hp, nowMs] of [[true, 2, 0], [true, 1, 100], [true, 2, 200], [false, 2, 300]] as const) {
    updateRunnerVisualStateForGroup({ group: rig.group, carrying, hp, alive: true, nowMs });
    assert.equal(armor.material.color.getHexString(), (carrying ? RUNNER_ARMOR_COLOR : FRIENDLY_ARMOR_COLOR).slice(1));
    assert.equal(armor.material.emissive.getHex(), 0);
  }
});

test('red-side players and followed observers use their own team as friendly', () => {
  assert.equal(resolveFriendlyArmorTeam({ multiplayerRole: 'client', observerTarget: 'host', localPlayerTeam: 'red' }), 'red');
  assert.equal(resolveFriendlyArmorTeam({ multiplayerRole: 'host', observerTarget: 'client', localPlayerTeam: 'blue' }), 'blue');
  assert.equal(resolveFriendlyArmorTeam({ multiplayerRole: 'observer', observerTarget: 'client', localPlayerTeam: 'blue' }), 'red');
});

for (const modelSystem of ['v1', 'v2', 'v3'] as const) {
  for (const team of ['blue', 'red'] as const) {
    test(`${modelSystem} ${team} runner restores current allegiance on drop, death, and cleanup`, () => {
      const group = buildVoxelSpartanModel(false, 100, { modelSystem }, { v3QualityTier: 'mobileLow' });
      const armor = syncCombatantTeamArmor(group, team, 'blue')!;
      const color = () => armor.material.color.getHexString();
      for (const friendlyTeam of ['blue', 'red'] as const) {
        for (const end of ['drop', 'dead', 'zeroHp', 'cleanup'] as const) {
          updateRunnerVisualStateForGroup({ group, carrying: true, alive: true, hp: 2, nowMs: 0 });
          assert.equal(color(), RUNNER_ARMOR_COLOR.slice(1));
          // Team synchronization must not overwrite gold before the next runner update.
          syncCombatantTeamArmor(group, team, friendlyTeam);
          assert.equal(color(), RUNNER_ARMOR_COLOR.slice(1));
          if (end === 'cleanup') clearRunnerVisualStateForGroup(group);
          else updateRunnerVisualStateForGroup({
            group, carrying: end !== 'drop', alive: end !== 'dead', hp: end === 'zeroHp' ? 0 : 2, nowMs: 100,
          });
          assert.equal(color(), (team === friendlyTeam ? FRIENDLY_ARMOR_COLOR : ENEMY_ARMOR_COLOR).slice(1));
        }
      }
    });
  }
}
