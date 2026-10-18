import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { syncIronVanguardProxies } from './ironVanguardModel';

const names: Record<string, string> = {
  lowerTorso: 'Hips', upperTorso: 'Spine', head: 'neck',
  leftArm: 'LeftArm', rightArm: 'RightArm', leftLeg: 'LeftUpLeg', rightLeg: 'RightUpLeg',
  swordGrip: 'RightHand', rightGrip: 'RightHand', leftGrip: 'LeftHand',
};

function fixture() {
  const outer = new THREE.Group(), parent = new THREE.Group(), root = new THREE.Group();
  outer.add(parent); parent.add(root);
  const facing = new THREE.Group(), imported = new THREE.Group();
  root.add(facing); facing.add(imported);
  facing.rotation.y = .37;
  imported.rotation.x = -Math.PI / 2;
  imported.scale.setScalar(.01);
  const bones: Record<string, THREE.Bone> = {};
  const addBone = (name: string, parentName?: string) => {
    const bone = new THREE.Bone(); bone.name = name;
    const index = Object.keys(bones).length;
    bone.position.set(4 + index * .6, 8 + index * .4, -2 + index * .3);
    bone.rotation.set(.03 * index, -.04 * index, .02 * index);
    (parentName ? bones[parentName] : imported).add(bone);
    bones[name] = bone;
  };
  addBone('Hips'); addBone('Spine', 'Hips'); addBone('neck', 'Spine');
  for (const side of ['Left', 'Right']) {
    addBone(`${side}Arm`, 'Spine'); addBone(`${side}ForeArm`, `${side}Arm`);
    addBone(`${side}Hand`, `${side}ForeArm`); addBone(`${side}UpLeg`, 'Hips');
  }
  const proxies: Record<string, THREE.Group> = {};
  for (const name of Object.keys(names)) {
    const proxy = new THREE.Group(); proxy.name = name; root.add(proxy); proxies[name] = proxy;
    // Socket attachments must retain their own local pose when the socket moves.
    const attachment = new THREE.Group(); attachment.position.set(.1, .2, .3); proxy.add(attachment);
  }
  const restHand = new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, -.3, .4));
  const restLeftHand = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.3, .4, -.2));
  root.userData.ironVanguard = { bones, proxies, restHand, restLeftHand };
  return { outer, parent, root, bones, proxies, restHand, restLeftHand };
}

/** Independent copy of the previous helper's public Three.js transform math. */
function legacySync(value: ReturnType<typeof fixture>) {
  const { root, bones, proxies, restHand, restLeftHand } = value;
  root.updateWorldMatrix(true, true);
  for (const [proxyName, boneName] of Object.entries(names)) {
    const bone = bones[boneName];
    if (!bone) continue;
    const proxy = proxies[proxyName];
    proxy.position.copy(root.worldToLocal(bone.getWorldPosition(new THREE.Vector3())));
    proxy.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion())));
    if (proxyName === 'rightGrip') proxy.quaternion.multiply(restHand);
    if (proxyName === 'leftGrip') proxy.quaternion.multiply(restLeftHand);
  }
}

const snapshot = (proxies: Record<string, THREE.Group>) => Object.fromEntries(
  Object.entries(proxies).map(([name, proxy]) => [name, [...proxy.position.toArray(), ...proxy.quaternion.toArray()]]),
);

for (const scales of [
  { label: 'uniform', ancestor: [1, 1, 1], root: [1, 1, 1] },
  { label: 'nonuniform', ancestor: [1.7, .8, 1.2], root: [.75, 1.35, 1.1] },
  { label: 'reflected', ancestor: [-1.3, .9, 1.8], root: [1.1, -.8, .7] },
]) {
  test(`native proxy sockets retain legacy transforms through moving ${scales.label} parents`, () => {
    const value = fixture();
    value.outer.scale.fromArray(scales.ancestor);
    value.root.scale.fromArray(scales.root);
    for (let frame = 0; frame < 6; frame++) {
      value.outer.position.set(11 + frame, 4 - frame * .2, -8 + frame * .7);
      value.outer.rotation.set(.1 + frame * .03, -.4 + frame * .07, .08);
      value.parent.position.set(-3, 1, 5);
      value.parent.rotation.set(.08, .2 + frame * .11, -.14);
      value.root.position.set(frame * .3, .4, -2);
      value.root.rotation.set(.09, -.5 + frame * .17, -.06);
      value.bones.Spine.rotation.y = frame * .13;
      value.bones.LeftArm.rotation.x = -.2 + frame * .08;
      value.bones.RightHand.rotation.z = .3 - frame * .05;
      legacySync(value);
      const expected = snapshot(value.proxies);
      const authored = Object.values(value.bones).map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]);
      syncIronVanguardProxies(value.root);
      const actual = snapshot(value.proxies);
      for (const name of Object.keys(names)) actual[name].forEach((component, index) => {
        assert.ok(Math.abs(component - expected[name][index]) < 1e-12, `${name} component ${index}, frame ${frame}`);
      });
      assert.deepEqual(Object.values(value.bones).map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()]), authored);
      for (const proxy of Object.values(value.proxies)) assert.deepEqual(proxy.children[0].position.toArray(), [.1, .2, .3]);
    }
  });
}

test('native proxy synchronization updates the hierarchy once instead of repeating ancestor walks', t => {
  const value = fixture();
  const original = THREE.Object3D.prototype.updateWorldMatrix;
  let calls = 0;
  t.mock.method(THREE.Object3D.prototype, 'updateWorldMatrix', function (this: THREE.Object3D, parents: boolean, children: boolean) {
    calls++;
    original.call(this, parents, children);
  });
  legacySync(value);
  const legacyCalls = calls;
  calls = 0;
  syncIronVanguardProxies(value.root);
  let hierarchySize = 0; value.outer.traverse(() => { hierarchySize++; });
  assert.equal(calls, hierarchySize, 'one parent chain plus one descendant walk');
  assert.ok(legacyCalls > calls * 4, `${legacyCalls} legacy updates versus ${calls} current updates`);
});

test('missing source bones still leave their proxy sockets unchanged', () => {
  const value = fixture();
  delete value.bones.LeftHand;
  value.proxies.leftGrip.position.set(7, 8, 9);
  value.proxies.leftGrip.quaternion.setFromEuler(new THREE.Euler(.7, .2, -.6));
  const before = snapshot({ leftGrip: value.proxies.leftGrip });
  syncIronVanguardProxies(value.root);
  assert.deepEqual(snapshot({ leftGrip: value.proxies.leftGrip }), before);
});
