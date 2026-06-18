import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLUE_TEAM_OUTLINE_COLOR,
  RED_TEAM_OUTLINE_COLOR,
  getCombatantTeamOutlineState,
  registerCombatantTeamOutlineSources,
  syncCombatantTeamOutline,
} from './combatantTeamOutlines';

const createBodyMesh = (name: string): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  mesh.name = name;
  return mesh;
};

test('team outline follows registered body sources and skips later weapon meshes', () => {
  const root = new THREE.Group();
  const torso = createBodyMesh('torso');
  const arm = createBodyMesh('arm');
  root.add(torso, arm);

  registerCombatantTeamOutlineSources(root);

  const weapon = createBodyMesh('hammer');
  root.add(weapon);

  const outline = syncCombatantTeamOutline(root, 'blue');

  assert.ok(outline);
  assert.equal(outline.team, 'blue');
  assert.equal(outline.meshes.length, 2);
  assert.equal(outline.material.color.getHexString(), BLUE_TEAM_OUTLINE_COLOR.slice(1));
  assert.equal(outline.material.side, THREE.BackSide);
  assert.equal(outline.material.transparent, true);
  assert.equal(outline.material.depthWrite, false);
  assert.deepEqual(outline.meshes.map(({ source }) => source.name), ['torso', 'arm']);
  assert.equal(outline.meshes.some(({ source }) => source === weapon), false);
  assert.equal(outline.meshes[0].mesh.geometry, torso.geometry);
  assert.equal(outline.meshes[0].mesh.parent, torso.parent);
  assert.equal(outline.meshes[0].mesh.userData.teamOutlineMesh, true);
});

test('team outline updates color in place and removes cleanly when disabled', () => {
  const root = new THREE.Group();
  root.add(createBodyMesh('torso'));
  registerCombatantTeamOutlineSources(root);

  const blue = syncCombatantTeamOutline(root, 'blue');
  assert.ok(blue);
  const firstOutlineMesh = blue.meshes[0].mesh;

  const red = syncCombatantTeamOutline(root, 'red');
  assert.equal(red, blue);
  assert.equal(red?.team, 'red');
  assert.equal(red?.material.color.getHexString(), RED_TEAM_OUTLINE_COLOR.slice(1));
  assert.equal(red?.meshes[0].mesh, firstOutlineMesh);

  const removed = syncCombatantTeamOutline(root, null);
  assert.equal(removed, null);
  assert.equal(getCombatantTeamOutlineState(root), null);
  assert.equal(firstOutlineMesh.parent, null);
});
