import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { V3_BLENDER_ANIMATIONS } from './v3BlenderAnimationClips.generated';
import { V3_AUTHORED_ANIMATION_CLIP_IDS, sampleV3ProductionClip } from './v3AuthoredAnimationClips';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { applyV3CleanRigPose } from './v3CleanRig';
import { getV3Mesh2MotionDriverRig, getV3Mesh2MotionDriverWeaponSocketWorldPosition } from './v3Mesh2MotionDriverRig';
import { setV3Mesh2MotionCalibrationOverride } from './v3Mesh2MotionCalibration';
import { createCombatantMeshRig } from './combatantModels';
import { animateV3CombatantModel, animateV3WeaponMeshes } from './combatantAnimationV3';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { getV3WeaponSocketWorldPosition } from './v3WeaponSocketBasis';
import { V3_BALL_CONTACTS, V3_BALL_RADIUS, applyV3BallCarryPose } from './v3BallCarry';

describe('Blender unified-rig animation bake', () => {
  it('joins attack stages and returns to ready without a body-pose jump', () => {
    const chains = [
      ['clean_hammer_carry', 'clean_hammer_windup', 'clean_hammer_strike', 'clean_hammer_recover', 'clean_hammer_carry'],
      ['clean_hammer_carry', 'clean_hammer_melee', 'clean_hammer_melee_recover', 'clean_hammer_carry'],
      ['clean_sword_carry', 'clean_sword_slash', 'clean_sword_recover', 'clean_sword_carry'],
      ['clean_sword_carry', 'clean_sword_lunge', 'clean_sword_carry'],
      ['clean_ball_carry', 'clean_ball_punch', 'clean_ball_carry', 'clean_ball_throw', 'clean_idle'],
      ['clean_idle', 'clean_hit_react', 'clean_idle'],
      ['clean_pistol_carry', 'clean_pistol_fire', 'clean_pistol_carry'],
    ];
    for (const chain of chains) for (let i = 1; i < chain.length; i++) {
      const from = V3_BLENDER_ANIMATIONS.clips[chain[i - 1]], to = V3_BLENDER_ANIMATIONS.clips[chain[i]];
      for (const [joint, track] of Object.entries(from.joints)) {
        const endPosition = track.positions.at(-1)!;
        const endRotation = new THREE.Quaternion(...track.quaternions.at(-1)!).normalize();
        assert.ok(new THREE.Vector3(...endPosition).distanceTo(new THREE.Vector3(...to.joints[joint].positions[0])) < .0001,
          `${chain[i - 1]} -> ${chain[i]} ${joint} position jump`);
        assert.ok(endRotation.angleTo(new THREE.Quaternion(...to.joints[joint].quaternions[0]).normalize()) < .0001,
          `${chain[i - 1]} -> ${chain[i]} ${joint} rotation jump`);
      }
    }
  });

  it('jabs the held ball straight forward and releases an overhead throw into forward flight', () => {
    const center = (id: 'clean_ball_punch' | 'clean_ball_throw', frame: number) =>
      new THREE.Vector3(...sampleV3ProductionClip(id, { frame }).pose.ballPose!.position);
    const xs = Array.from({ length: 73 }, (_, frame) => center('clean_ball_punch', frame).x);
    assert.ok(Math.max(...xs) - Math.min(...xs) < .12, 'jab must stay in a narrow forward lane');
    assert.ok(center('clean_ball_punch', 26).z < -.60, 'ball must lead in front at jab extension');
    assert.ok(center('clean_ball_punch', 13).z - center('clean_ball_punch', 26).z > .28, 'jab needs a clear forward extension');
    assert.ok(center('clean_ball_punch', 45).z > center('clean_ball_punch', 26).z + .28, 'jab must retract after impact');
    const carry = sampleV3ProductionClip('clean_ball_carry', { frame: 0 }).pose.ballPose!;
    for (const frame of [0, 72]) assert.ok(center('clean_ball_punch', frame).distanceTo(new THREE.Vector3(...carry.position)) < .0001);
    assert.ok(center('clean_ball_throw', 30).x > .3 && center('clean_ball_throw', 30).z > 0, 'throw must load behind the right shoulder');
    const before = sampleV3ProductionClip('clean_ball_throw', { frame: 44 }).pose;
    const release = sampleV3ProductionClip('clean_ball_throw', { frame: 45 }).pose;
    assert.equal(before.ballPose!.released, false);
    assert.equal(release.ballPose!.released, true);
    assert.ok(release.ballPose!.position[1] > 1.6 && release.ballPose!.releaseVelocity![2] < -2.5);
    assert.ok(center('clean_ball_throw', 60).z < center('clean_ball_throw', 45).z - .6, 'released ball must travel independently forward');
    assert.ok(center('clean_ball_throw', 90).y >= .149, 'preview flight must not pass through the floor');
    const scene = new THREE.Scene(), model = new THREE.Group(), ball = new THREE.Group();
    scene.add(model, ball);
    assert.equal(applyV3BallCarryPose(model, ball, before), true);
    const lastHeld = ball.position.clone();
    assert.equal(applyV3BallCarryPose(model, ball, release), false);
    assert.deepEqual(ball.position.toArray(), lastHeld.toArray(), 'release must stop writing a gameplay projectile transform');
    assert.equal(applyV3BallCarryPose(model, ball, release, true), true);
  });

  it('recovers through a planted support foot, an airborne return step, and a delayed upper-body settle', () => {
    const model = buildV3SpartanModel({ v3SourceFidelity: 'exact', v3QualityTier: 'desktop' });
    const rig = getV3Mesh2MotionDriverRig(model);
    const parts = model.userData.v3PartGroups as Record<string, THREE.Group>;
    for (const id of ['clean_slide', 'clean_slide_hammer', 'clean_slide_sword', 'clean_slide_pistol', 'clean_slide_ball'] as const) {
      assert.equal(V3_BLENDER_ANIMATIONS.clips[id].durationFrames, 84);
      const at = (frame: number) => {
        applyV3CleanRigPose(model, sampleV3ProductionClip(id, { frame }).pose);
        return {
          left: rig.joints.foot_l.object.getWorldPosition(new THREE.Vector3()),
          right: rig.joints.foot_r.object.getWorldPosition(new THREE.Vector3()),
          hip: rig.joints.pelvis.object.getWorldPosition(new THREE.Vector3()),
          chest: rig.joints.spine_03.object.getWorldQuaternion(new THREE.Quaternion()),
          leftSole: new THREE.Box3().setFromObject(parts.footLeft, true).min.y,
          rightSole: new THREE.Box3().setFromObject(parts.footRight, true).min.y,
        };
      };
      const held = at(49), shifted = at(59), airborne = at(65), planted = at(74), standing = at(84);
      assert.ok(Math.abs(shifted.hip.x - shifted.left.x) < Math.abs(held.hip.x - held.left.x) - .08, `${id}: no weight shift to supporting leg`);
      assert.ok(airborne.rightSole > .07 && Math.abs(airborne.leftSole) < .001, `${id}: leading foot must lift while tucked foot supports`);
      assert.ok(airborne.hip.y > held.hip.y + .15 && airborne.hip.y < standing.hip.y - .15, `${id}: hip rise must be progressive`);
      assert.ok(planted.right.distanceTo(standing.right) < .0001, `${id}: leading foot must reach standing contact before support foot releases`);
      for (let frame = 49; frame <= 74; frame++) {
        assert.ok(at(frame).left.distanceTo(held.left) < .0001, `${id}:${frame} support boot slides while bearing weight`);
      }
      for (let frame = 74; frame <= 84; frame++) {
        assert.ok(at(frame).right.distanceTo(planted.right) < .0001, `${id}:${frame} planted boot slides during settling`);
      }
      assert.ok(at(79).leftSole > .025, `${id}: trailing foot needs a small lifted adjustment`);
      assert.ok(at(80).chest.angleTo(standing.chest) > .01, `${id}: chest should finish after hip rise`);
      assert.ok(at(83).hip.distanceTo(standing.hip) < .004, `${id}: hip must ease into neutral`);
      if (id === 'clean_slide_ball') {
        const triangle = new THREE.Triangle(), nearest = new THREE.Vector3();
        for (let frame = 49; frame <= 84; frame++) {
          const pose = sampleV3ProductionClip(id, { frame }).pose;
          applyV3CleanRigPose(model, pose);
          const center = new THREE.Vector3(...pose.ballPose!.position);
          for (const slot of ['helmet', 'chest', 'pelvis', 'thighLeft', 'thighRight']) {
            parts[slot].traverse(object => {
              if (!(object instanceof THREE.Mesh)) return;
              const positions = object.geometry.getAttribute('position'), index = object.geometry.index;
              for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
                for (const [offset, point] of [triangle.a, triangle.b, triangle.c].entries()) {
                  point.fromBufferAttribute(positions, index ? index.getX(i + offset) : i + offset).applyMatrix4(object.matrixWorld);
                }
                triangle.closestPointToPoint(center, nearest);
                assert.ok(nearest.distanceTo(center) >= V3_BALL_RADIUS, `${id}:${frame} ball intersects ${slot}`);
              }
            });
          }
        }
      }
    }
  });

  it('selects each slide hold from runtime state and synchronizes its item with the applied body pose', () => {
    const meshes = createCombatantMeshRig(new THREE.Scene(), 192, false, { modelSystem: 'v3' });
    for (const activeWeapon of ['ball', 'hammer', 'sword', 'pistol'] as const) {
      for (const isSliding of [true, false]) {
        animateV3CombatantModel({
          refs: createInitialGrifballThreeRefs(), mesh: meshes.group, vel: new THREE.Vector3(0, 0, -4),
          yaw: 0, hp: 100, activeWeapon, weaponState: 'ready', weaponTimer: 0, dt: 1, settings: {},
          isSliding, animationClockMs: 400, isLocalV3Animation: true, v3PoseAlphaOverride: 1,
          v3AnimationAuthority: 'cleanRig', v3AuthoredNormalizedTime: .4,
        });
        const id = isSliding ? `clean_slide_${activeWeapon}` : activeWeapon === 'ball' ? 'clean_ball_walk' : `clean_${activeWeapon}_carry`;
        assert.equal(meshes.group.userData.v3CleanAuthoredClip, id);
        // Intentionally omit the item timer/slide override: use the body's evaluated pose.
        animateV3WeaponMeshes({ hammerModel: meshes.hammer, swordModel: meshes.sword, pistolModel: meshes.pistol,
          ballModel: meshes.ball, combatantModel: meshes.group, activeWeapon, weaponState: 'ready', weaponTimer: 0,
          isLunging: false, dt: 1, settings: {}, v3AnimationAuthority: 'cleanRig' });
        assert.equal(meshes[activeWeapon]!.visible, true);
        for (const item of ['ball', 'hammer', 'sword', 'pistol'] as const) assert.equal(meshes[item]!.visible, item === activeWeapon);
        const grip = getV3Mesh2MotionDriverWeaponSocketWorldPosition(meshes.group, 'rightHandGrip')!;
        const contact = activeWeapon === 'ball' ? meshes.ball!.localToWorld(new THREE.Vector3(...V3_BALL_CONTACTS.right))
          : getV3WeaponSocketWorldPosition(meshes[activeWeapon], 'thirdPersonPrimaryGrip')!;
        assert.ok(contact.distanceTo(grip) < .002, `${id} body/item phase mismatch`);
      }
    }
  });

  it('preserves the slide body motion for every item and returns to its neutral carry', () => {
    const base = V3_BLENDER_ANIMATIONS.clips.clean_slide;
    for (const item of ['hammer', 'sword', 'pistol', 'ball']) {
      const slide = V3_BLENDER_ANIMATIONS.clips[`clean_slide_${item}`];
      const carry = V3_BLENDER_ANIMATIONS.clips[`clean_${item}_carry`];
      for (const [name, track] of Object.entries(slide.joints)) {
        if (/^(root|pelvis|spine_|neck|head|thigh_|calf_|foot_|toe)/.test(name)) {
          const original = base.joints[name];
          for (let frame = 0; frame <= slide.durationFrames; frame++) {
            const a = track.positions[Math.min(frame, track.positions.length - 1)], b = original.positions[Math.min(frame, original.positions.length - 1)];
            const aq = track.quaternions[Math.min(frame, track.quaternions.length - 1)], bq = original.quaternions[Math.min(frame, original.quaternions.length - 1)];
            assert.ok(new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)) < .00001, `${item}: ${name} changed slide position`);
            assert.ok(new THREE.Quaternion(...aq).normalize().angleTo(new THREE.Quaternion(...bq).normalize()) < .00001, `${item}: ${name} changed slide rotation`);
          }
        }
      }
      for (const name of [...Object.keys(slide.joints), 'weapon']) {
        const a = name === 'weapon' ? slide.weaponTrack! : slide.joints[name];
        const b = name === 'weapon' ? carry.weaponTrack! : carry.joints[name];
        for (const p of [a.positions[0], a.positions.at(-1)!]) {
          assert.ok(new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...b.positions[0])) < .0001, `${item}: ${name} carry position jump`);
        }
        for (const q of [a.quaternions[0], a.quaternions.at(-1)!]) {
          assert.ok(new THREE.Quaternion(...q).normalize().angleTo(new THREE.Quaternion(...b.quaternions[0]).normalize()) < .0001, `${item}: ${name} carry rotation jump`);
        }
      }
    }
  });

  it('keeps the runner ball attached to the right hand under character and scene transforms', () => {
    const scene = new THREE.Scene();
    const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' }, { v3SourceFidelity: 'exact', v3QualityTier: 'desktop' });
    const ball = meshes.ball!;
    const model = meshes.group;
    model.position.set(3, 2, -4);
    model.rotation.y = .7;
    model.scale.setScalar(1.3);
    const driver = getV3Mesh2MotionDriverRig(model);
    let gripRotation: THREE.Quaternion | undefined;
    for (const id of ['clean_slide_ball', 'clean_ball_carry', 'clean_ball_walk', 'clean_ball_sprint', 'clean_ball_punch', 'clean_ball_throw'] as const) {
      for (let frame = 0; frame <= V3_BLENDER_ANIMATIONS.clips[id].durationFrames; frame++) {
        const { pose } = sampleV3ProductionClip(id, { frame });
        applyV3CleanRigPose(model, pose);
        const held = !pose.ballPose?.released;
        assert.equal(applyV3BallCarryPose(model, ball, pose), held);
        if (!held) continue;
        const relative = driver.joints.hand_r.object.getWorldQuaternion(new THREE.Quaternion()).invert()
          .multiply(ball.getWorldQuaternion(new THREE.Quaternion())).normalize();
        if (!gripRotation) gripRotation = relative.clone();
        assert.ok(relative.angleTo(gripRotation) < .001, `${id}:${frame} skull bomb rotates inside the hand`);
        if (id === 'clean_ball_throw') {
          const center = ball.getWorldPosition(new THREE.Vector3()), point = new THREE.Vector3();
          const parts = model.userData.v3PartGroups as Record<string, THREE.Group>;
          for (const slot of ['helmet', 'chest']) parts[slot].traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            const positions = object.geometry.getAttribute('position');
            for (let i = 0; i < positions.count; i++) {
              point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
              assert.ok(point.distanceTo(center) > V3_BALL_RADIUS * 1.3, `${id}:${frame} casing intersects ${slot}`);
            }
          });
        }
        for (const side of ['right'] as const) {
          const contact = ball.localToWorld(new THREE.Vector3(...V3_BALL_CONTACTS[side]));
          const hand = getV3Mesh2MotionDriverWeaponSocketWorldPosition(model, `${side}HandGrip`)!;
          assert.ok(contact.distanceTo(hand) < .002, `${id}:${frame} ${side} ball contact drift`);
        }
      }
    }
    // The gameplay objective can live directly in the scene, outside the rig.
    scene.attach(ball);
    const pose = sampleV3ProductionClip('clean_slide_ball', { normalizedTime: .4 }).pose;
    assert.equal(applyV3BallCarryPose(model, ball, pose), true);
    assert.ok(ball.getWorldPosition(new THREE.Vector3()).distanceTo(model.localToWorld(new THREE.Vector3(...pose.ballPose!.position))) < .0001);
  });

  it('connects slide entry and recovery to idle and holds a stable skid pose', () => {
    const slide = V3_BLENDER_ANIMATIONS.clips.clean_slide;
    const idle = V3_BLENDER_ANIMATIONS.clips.clean_idle;
    for (const [name, a] of Object.entries(slide.joints)) {
      const b = idle.joints[name];
      for (const index of [0, a.positions.length - 1]) {
        assert.ok(new THREE.Vector3(...a.positions[index]).distanceTo(new THREE.Vector3(...b.positions[0])) < .0001, `${name} slide/idle position jump`);
      }
      for (const index of [0, a.quaternions.length - 1]) {
        assert.ok(new THREE.Quaternion(...a.quaternions[index]).normalize().angleTo(new THREE.Quaternion(...b.quaternions[0]).normalize()) < .0001, `${name} slide/idle rotation jump`);
      }
      for (let frame = 18; frame <= 48; frame++) {
        const p = a.positions[Math.min(frame, a.positions.length - 1)], q = a.quaternions[Math.min(frame, a.quaternions.length - 1)];
        assert.ok(new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...a.positions[Math.min(18, a.positions.length - 1)])) < .0001, `${name} moves during held slide`);
        assert.ok(new THREE.Quaternion(...q).normalize().angleTo(new THREE.Quaternion(...a.quaternions[Math.min(18, a.quaternions.length - 1)]).normalize()) < .0001, `${name} cycles during held slide`);
      }
    }
  });

  it('strikes upward with the hammer pommel and connects recovery back to the original carry', () => {
    const ids = ['clean_hammer_carry', 'clean_hammer_melee', 'clean_hammer_melee_recover', 'clean_hammer_carry'];
    for (let i = 1; i < ids.length; i++) {
      const from = V3_BLENDER_ANIMATIONS.clips[ids[i - 1]], to = V3_BLENDER_ANIMATIONS.clips[ids[i]];
      for (const name of [...Object.keys(from.joints), 'weapon']) {
        const a = name === 'weapon' ? from.weaponTrack! : from.joints[name];
        const b = name === 'weapon' ? to.weaponTrack! : to.joints[name];
        assert.ok(new THREE.Vector3(...a.positions.at(-1)!).distanceTo(new THREE.Vector3(...b.positions[0])) < .0001, `${ids[i]} ${name} position jump`);
        assert.ok(new THREE.Quaternion(...a.quaternions.at(-1)!).normalize().angleTo(new THREE.Quaternion(...b.quaternions[0]).normalize()) < .0001, `${ids[i]} ${name} rotation jump`);
      }
    }
    const point = (frame: number, z: number) => {
      const p = sampleV3ProductionClip('clean_hammer_melee', { frame }).weaponPose!;
      return new THREE.Vector3(0, 0, z * .915932).applyQuaternion(new THREE.Quaternion(...p.modelSpaceQuaternion!))
        .add(new THREE.Vector3(...p.position));
    };
    const neutral = point(0, .31), impact = point(36, .31), head = point(36, -.93);
    assert.ok(impact.y > neutral.y + .45 && impact.y > 1.4, 'pommel must strike upward to upper-body height');
    assert.ok(impact.z < neutral.z - .15 && impact.z < -.45, 'pommel must lead forward, clear of the face');
    assert.ok(impact.y > head.y + .4, 'bottom of the handle must lead the strike above the hammer head');
    for (let frame = 9; frame <= 30; frame++) {
      assert.ok(point(frame + 1, .31).y > point(frame, .31).y, `frame ${frame}: pommel reverses during rising strike`);
    }
    for (let frame = 0; frame <= 36; frame++) {
      assert.ok(point(frame, -.93).x < -.35, `frame ${frame}: hammer head must stay outside the left side`);
    }
  });

  it('holds a low extended lunge until contact, then cuts sideways and returns to ready', () => {
    const clip = V3_BLENDER_ANIMATIONS.clips.clean_sword_lunge;
    const carry = V3_BLENDER_ANIMATIONS.clips.clean_sword_carry;
    const pelvisHeight = (c: typeof clip, frame: number) => new THREE.Vector3(...c.joints.pelvis.positions[Math.min(frame, c.joints.pelvis.positions.length - 1)])
      .applyQuaternion(new THREE.Quaternion(...c.joints.root.quaternions[Math.min(frame, c.joints.root.quaternions.length - 1)]).normalize())
      .add(new THREE.Vector3(...c.joints.root.positions[Math.min(frame, c.joints.root.positions.length - 1)])).y;
    const pose = (frame: number) => sampleV3ProductionClip('clean_sword_lunge', { frame }).weaponPose!;
    const tip = (frame: number) => {
      const p = pose(frame);
      return new THREE.Vector3(0, 0, -.75 * .950718).applyQuaternion(new THREE.Quaternion(...p.modelSpaceQuaternion!))
        .add(new THREE.Vector3(...p.position));
    };
    for (let frame = 12; frame <= 33; frame++) {
      const p = pose(frame), q = new THREE.Quaternion(...p.modelSpaceQuaternion!).normalize();
      assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(q).z < -.995, 'blade must point forward during glide');
      assert.ok(tip(frame).z < -.95, 'extended blade must lead the body');
      assert.ok(pelvisHeight(clip, frame) < pelvisHeight(carry, 0) - .18, 'lunge must crouch');
      assert.ok(tip(frame).distanceTo(tip(12)) < .0001, 'glide must hold a steady thrust without early slashing');
      for (const name of ['thigh_l', 'thigh_r', 'calf_l', 'calf_r']) {
        const track = clip.joints[name].quaternions;
        assert.ok(new THREE.Quaternion(...track[frame]).normalize().angleTo(new THREE.Quaternion(...track[12]).normalize()) < .0001,
          'feet must hold a slide stance without running steps');
      }
    }
    for (let frame = 35; frame <= 46; frame++) {
      const velocity = tip(frame + 1).sub(tip(frame - 1)).normalize();
      const q = new THREE.Quaternion(...pose(frame).modelSpaceQuaternion!).normalize();
      assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(q).dot(velocity) > .94, `lunge frame ${frame}: edge must lead cut`);
      assert.ok(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(q).dot(velocity)) < .1, `lunge frame ${frame}: blade-face slap`);
    }
    assert.ok(tip(33).x - tip(48).x > .85, 'contact must end in a broad sideways cut');
    for (const name of [...Object.keys(clip.joints), 'weapon']) {
      const a = name === 'weapon' ? clip.weaponTrack! : clip.joints[name];
      const b = name === 'weapon' ? carry.weaponTrack! : carry.joints[name];
      for (const index of [0, a.positions.length - 1]) {
        assert.ok(new THREE.Vector3(...a.positions[index]).distanceTo(new THREE.Vector3(...b.positions[0])) < .0001, `${name} lunge/carry position jump`);
      }
      for (const index of [0, a.quaternions.length - 1]) {
        assert.ok(new THREE.Quaternion(...a.quaternions[index]).normalize().angleTo(new THREE.Quaternion(...b.quaternions[0]).normalize()) < .0001, `${name} lunge/carry rotation jump`);
      }
    }
  });

  it('cuts edge-first along the katar tip trajectory and returns continuously to carry', () => {
    const pose = (frame: number) => sampleV3ProductionClip('clean_sword_slash', { frame }).weaponPose!;
    const tip = (frame: number) => {
      const p = pose(frame);
      return new THREE.Vector3(0, 0, -.75 * .950718).applyQuaternion(new THREE.Quaternion(...p.modelSpaceQuaternion!)).add(new THREE.Vector3(...p.position));
    };
    for (let frame = 17; frame <= 45; frame++) {
      const velocity = tip(frame + 1).sub(tip(frame - 1)).normalize();
      const q = new THREE.Quaternion(...pose(frame).modelSpaceQuaternion!).normalize();
      const edge = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const faceNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      assert.ok(edge.dot(velocity) > .95, `frame ${frame}: blade edge does not lead the cut`);
      assert.ok(Math.abs(faceNormal.dot(velocity)) < .1, `frame ${frame}: blade slaps sideways through the cut`);
    }
    assert.ok(tip(17).x - tip(45).x > 1, 'blade must sweep across the front of the character');
    const ids = ['clean_sword_carry', 'clean_sword_slash', 'clean_sword_recover', 'clean_sword_carry'];
    for (let i = 1; i < ids.length; i++) {
      const from = V3_BLENDER_ANIMATIONS.clips[ids[i - 1]], to = V3_BLENDER_ANIMATIONS.clips[ids[i]];
      for (const name of [...Object.keys(from.joints), 'weapon']) {
        const a = name === 'weapon' ? from.weaponTrack! : from.joints[name];
        const b = name === 'weapon' ? to.weaponTrack! : to.joints[name];
        assert.ok(new THREE.Vector3(...a.positions.at(-1)!).distanceTo(new THREE.Vector3(...b.positions[0])) < .0001, `${ids[i]} ${name} position jump`);
        assert.ok(new THREE.Quaternion(...a.quaternions.at(-1)!).normalize().angleTo(new THREE.Quaternion(...b.quaternions[0]).normalize()) < .0001, `${ids[i]} ${name} rotation jump`);
      }
    }
  });

  it('connects the two-hand hammer windup, overhand strike, and return to neutral without pose jumps', () => {
    const ids = ['clean_hammer_carry', 'clean_hammer_windup', 'clean_hammer_strike', 'clean_hammer_recover', 'clean_hammer_carry'];
    for (let i = 1; i < ids.length; i++) {
      const from = V3_BLENDER_ANIMATIONS.clips[ids[i - 1]], to = V3_BLENDER_ANIMATIONS.clips[ids[i]];
      for (const name of [...Object.keys(from.joints), 'weapon']) {
        const a = name === 'weapon' ? from.weaponTrack! : from.joints[name];
        const b = name === 'weapon' ? to.weaponTrack! : to.joints[name];
        assert.ok(new THREE.Vector3(...a.positions.at(-1)!).distanceTo(new THREE.Vector3(...b.positions[0])) < .0001, `${ids[i]} ${name} position jump`);
        assert.ok(new THREE.Quaternion(...a.quaternions.at(-1)!).normalize().angleTo(new THREE.Quaternion(...b.quaternions[0]).normalize()) < .0001, `${ids[i]} ${name} rotation jump`);
      }
    }
    const head = (id: 'clean_hammer_windup' | 'clean_hammer_strike', t: number) => {
      const p = sampleV3ProductionClip(id, { normalizedTime: t }).weaponPose!;
      // Striking-head center is .93 source units along the haft, scaled to the suit.
      return new THREE.Vector3(0, 0, -.93 * .915932).applyQuaternion(new THREE.Quaternion(...p.modelSpaceQuaternion!)).add(new THREE.Vector3(...p.position));
    };
    const loaded = head('clean_hammer_windup', 1), overhead = head('clean_hammer_strike', .30), impact = head('clean_hammer_strike', 1);
    assert.ok(loaded.x > .3 && loaded.z > .3 && loaded.y > 1.65, 'load behind the character’s right shoulder');
    assert.ok(overhead.y > 2.05, 'head must pass overhead before descending');
    assert.ok(impact.z < -.8 && impact.y < .6 && impact.y > .15, 'finish down in front, clear of the floor');
  });

  it('covers all production clips with valid tracks and seamless loop endpoints', () => {
    assert.deepEqual(Object.keys(V3_BLENDER_ANIMATIONS.clips).sort(), [...V3_AUTHORED_ANIMATION_CLIP_IDS].sort());
    for (const [id, clip] of Object.entries(V3_BLENDER_ANIMATIONS.clips)) {
      for (const track of [...Object.values(clip.joints), ...(clip.weaponTrack ? [clip.weaponTrack] : [])]) {
        for (const [kind, rows] of Object.entries(track)) {
          assert.ok(rows.length === 1 || rows.length === clip.durationFrames + 1, `${id} ${kind} frame count`);
          assert.ok(rows.every(row => row.every(Number.isFinite)));
          if (kind === 'quaternions') for (const row of rows) assert.ok(Math.abs(Math.hypot(...row) - 1) < .00001);
          if (clip.loop) {
            const a = rows[0], b = rows.at(-1)!;
            const error = kind === 'positions' ? new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b))
              : new THREE.Quaternion(...a).normalize().angleTo(new THREE.Quaternion(...b).normalize());
            assert.ok(error < .0001, `${id} ${kind} loop jump ${error}`);
          }
        }
      }
    }
  });

  it('keeps armor soles grounded, bones connected, and primary grips attached throughout every clip', () => {
    const meshes = createCombatantMeshRig(new THREE.Scene(), 192, false, { modelSystem: 'v3' }, { v3SourceFidelity: 'exact', v3QualityTier: 'desktop' });
    const model = meshes.group;
    const rig = getV3Mesh2MotionDriverRig(model);
    const parts = model.userData.v3PartGroups as Record<string, THREE.Group>;
    let katarGripRotation: THREE.Quaternion | undefined;
    const hammerGripRotations: Partial<Record<'l' | 'r', THREE.Quaternion>> = {};
    const lengths = Object.fromEntries(Object.values(rig.joints).filter(j => rig.joints[j.parentName ?? '']).map(j => [j.name,
      j.object.getWorldPosition(new THREE.Vector3()).distanceTo(rig.joints[j.parentName!].object.getWorldPosition(new THREE.Vector3()))]));
    for (const id of V3_AUTHORED_ANIMATION_CLIP_IDS) {
      const clip = V3_BLENDER_ANIMATIONS.clips[id];
      let previousLeftElbow: THREE.Vector3 | undefined;
      let previousLeftForearm: THREE.Quaternion | undefined;
      let previousRightElbow: THREE.Vector3 | undefined;
      let previousRightForearm: THREE.Quaternion | undefined;
      for (let frame = 0; frame <= clip.durationFrames; frame++) {
        const sample = sampleV3ProductionClip(id, { frame });
        assert.equal(sample.motionSource, 'blenderAuthored');
        applyV3CleanRigPose(model, sample.pose);
        const leftElbow = rig.joints.lowerarm_l.object.getWorldPosition(new THREE.Vector3());
        const leftWrist = rig.joints.hand_l.object.getWorldPosition(new THREE.Vector3());
        const leftForearm = rig.joints.lowerarm_l.object.getWorldQuaternion(new THREE.Quaternion());
        const leftHandAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.joints.hand_l.object.getWorldQuaternion(new THREE.Quaternion()));
        const wristBend = leftWrist.clone().sub(leftElbow).angleTo(leftHandAxis) * 180 / Math.PI;
        assert.ok(wristBend < (clip.weapon === 'hammer' || clip.weapon === 'pistol' ? 56 : 3), `${id}:${frame} left wrist bent ${wristBend} degrees`);
        if (previousLeftElbow) assert.ok(previousLeftElbow.distanceTo(leftElbow) < .065, `${id}:${frame} left elbow jumped`);
        if (previousLeftForearm) assert.ok(previousLeftForearm.angleTo(leftForearm) < .28, `${id}:${frame} left forearm flipped`);
        previousLeftElbow = leftElbow; previousLeftForearm = leftForearm;
        const rightElbow = rig.joints.lowerarm_r.object.getWorldPosition(new THREE.Vector3());
        const rightWrist = rig.joints.hand_r.object.getWorldPosition(new THREE.Vector3());
        const rightForearm = rig.joints.lowerarm_r.object.getWorldQuaternion(new THREE.Quaternion());
        const rightHandAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.joints.hand_r.object.getWorldQuaternion(new THREE.Quaternion()));
        const rightBend = rightWrist.clone().sub(rightElbow).angleTo(rightHandAxis) * 180 / Math.PI;
        assert.ok(rightBend < (clip.weapon ? 56 : 3), `${id}:${frame} right wrist bent ${rightBend} degrees`);
        if (previousRightElbow) assert.ok(previousRightElbow.distanceTo(rightElbow) < .07, `${id}:${frame} right elbow jumped`);
        if (previousRightForearm) assert.ok(previousRightForearm.angleTo(rightForearm) < .28, `${id}:${frame} right forearm flipped`);
        previousRightElbow = rightElbow; previousRightForearm = rightForearm;
        if (id === 'clean_slide' && frame >= 18 && frame <= 48) {
          const hip = rig.joints.pelvis.object.getWorldPosition(new THREE.Vector3());
          const leading = rig.joints.foot_r.object.getWorldPosition(new THREE.Vector3());
          const tucked = rig.joints.foot_l.object.getWorldPosition(new THREE.Vector3());
          assert.ok(hip.y < .35, 'slide hips must remain low');
          assert.ok(leading.z < tucked.z - .5, 'one leg must extend forward of the tucked leg');
          for (const slot of ['footLeft', 'footRight']) {
            assert.ok(Math.abs(new THREE.Box3().setFromObject(parts[slot], true).min.y) < .005, `${slot} slide contact floats`);
          }
          for (const side of ['l', 'r']) {
            const shoulder = rig.joints[`upperarm_${side}`].object.getWorldPosition(new THREE.Vector3());
            const elbow = rig.joints[`lowerarm_${side}`].object.getWorldPosition(new THREE.Vector3());
            assert.ok(elbow.y < shoulder.y - .12 && Math.abs(elbow.x - shoulder.x) < .2, 'slide elbow must stay down and close to body');
          }
        }
        if (id === 'clean_idle' || id === 'clean_walk') {
          for (const side of ['l', 'r']) {
            const shoulder = rig.joints[`upperarm_${side}`].object.getWorldPosition(new THREE.Vector3());
            const elbow = rig.joints[`lowerarm_${side}`].object.getWorldPosition(new THREE.Vector3());
            const wrist = rig.joints[`hand_${side}`].object.getWorldPosition(new THREE.Vector3());
            assert.ok(elbow.y < shoulder.y - .15, `${id}:${frame} raised resting elbow`);
            assert.ok(Math.abs(elbow.x - shoulder.x) < .14, `${id}:${frame} flared resting elbow`);
            assert.ok(wrist.y < elbow.y, `${id}:${frame} resting wrist above elbow`);
          }
        }
        // A tilted slide boot needs actual vertices: the transformed local
        // bounding box includes empty space below the bevelled heel.
        const minY = Math.min(new THREE.Box3().setFromObject(parts.footLeft, id.startsWith('clean_slide')).min.y,
          new THREE.Box3().setFromObject(parts.footRight, id.startsWith('clean_slide')).min.y);
        assert.ok(Math.abs(minY) < .005, `${id}:${frame} sole height ${minY}`);
        for (const [name, length] of Object.entries(lengths)) {
          if (name === 'pelvis') continue; // Authored root/body height is intentional.
          const joint = rig.joints[name];
          const actual = joint.object.getWorldPosition(new THREE.Vector3()).distanceTo(rig.joints[joint.parentName!].object.getWorldPosition(new THREE.Vector3()));
          assert.ok(Math.abs(actual - length) < .00002, `${id}:${frame} stretched ${name}`);
        }
        if (sample.weaponPose) {
          if (id === 'clean_hammer_carry' && frame === 0) {
            for (const side of ['l', 'r'] as const) {
              hammerGripRotations[side] = rig.joints[`hand_${side}`].object.getWorldQuaternion(new THREE.Quaternion()).invert()
                .multiply(new THREE.Quaternion(...sample.weaponPose.modelSpaceQuaternion!)).normalize();
            }
          }
          if (id === 'clean_hammer_melee' || id === 'clean_hammer_melee_recover' || id === 'clean_slide_hammer') {
            for (const side of ['l', 'r'] as const) {
              const relative = rig.joints[`hand_${side}`].object.getWorldQuaternion(new THREE.Quaternion()).invert()
                .multiply(new THREE.Quaternion(...sample.weaponPose.modelSpaceQuaternion!)).normalize();
              assert.ok((side === 'l' && id !== 'clean_slide_hammer') || (hammerGripRotations[side] && relative.angleTo(hammerGripRotations[side]!) < .001),
                `${id}:${frame} hammer rotates inside ${side} hand`);
            }
          }
          if (id === 'clean_sword_carry' && frame === 0) {
            katarGripRotation = rig.joints.hand_r.object.getWorldQuaternion(new THREE.Quaternion()).invert()
              .multiply(new THREE.Quaternion(...sample.weaponPose.modelSpaceQuaternion!)).normalize();
          }
          if (id === 'clean_sword_slash' || id === 'clean_sword_recover' || id === 'clean_sword_lunge' || id === 'clean_slide_sword') {
            const relative = rig.joints.hand_r.object.getWorldQuaternion(new THREE.Quaternion()).invert()
              .multiply(new THREE.Quaternion(...sample.weaponPose.modelSpaceQuaternion!)).normalize();
            assert.ok(katarGripRotation && relative.angleTo(katarGripRotation) < .001, `${id}:${frame} katar spins inside the hand`);
          }
          const grip = getV3Mesh2MotionDriverWeaponSocketWorldPosition(model, 'rightHandGrip')!;
          assert.ok(grip.distanceTo(new THREE.Vector3(...sample.weaponPose.position)) < .002, `${id}:${frame} floating weapon`);
          const weapon = sample.weaponPose.weapon;
          animateV3WeaponMeshes({ hammerModel: meshes.hammer, swordModel: meshes.sword, pistolModel: meshes.pistol,
            combatantModel: model, activeWeapon: weapon, weaponState: 'ready', weaponTimer: 0, isLunging: false,
            dt: 1 / 60, settings: {}, v3AnimationAuthority: 'cleanRig', v3AuthoredClipId: id,
            v3AuthoredNormalizedTime: frame / clip.durationFrames });
          assert.ok(getV3WeaponSocketWorldPosition(meshes[weapon], 'thirdPersonPrimaryGrip')!.distanceTo(grip) < .002,
            `${id}:${frame} runtime primary grip drift`);
          if (sample.weaponPose.modelSpaceOffhandSocket) {
            if (weapon === 'hammer') {
              assert.ok(new THREE.Vector3(...sample.weaponPose.modelSpaceOffhandSocket).distanceTo(new THREE.Vector3(0, 0, -.24)) < .0001,
                `${id}:${frame} secondary contact moved away from the physical handle`);
            }
            const offhand = getV3Mesh2MotionDriverWeaponSocketWorldPosition(model, 'leftHandGrip')!;
            assert.ok(getV3WeaponSocketWorldPosition(meshes[weapon], 'thirdPersonOffhandGrip')!.distanceTo(offhand) < .002,
              `${id}:${frame} runtime secondary grip drift`);
          }
        }
      }
    }
  });

  it('does not reapply legacy calibration offsets to a baked pose', () => {
    const model = buildV3SpartanModel({ v3SourceFidelity: 'exact', v3QualityTier: 'desktop' });
    const pose = sampleV3ProductionClip('clean_hammer_carry', { normalizedTime: .3 }).pose;
    try {
      setV3Mesh2MotionCalibrationOverride({ version: 'v3-mesh2motion-calibration/v2', armSpread: {left: .3, right: .3}, driverJoints: {}, partBindings: {}, weaponSockets: {} });
      applyV3CleanRigPose(model, pose, { alpha: .2 });
      const report = model.userData.v3Mesh2MotionDriverCalibrationReport;
      assert.deepEqual(report.armSpread, {left: 0, right: 0});
      assert.equal(report.driverJointAdjustmentCount, 0);
      const grip = getV3Mesh2MotionDriverWeaponSocketWorldPosition(model, 'rightHandGrip')!;
      assert.ok(grip.distanceTo(new THREE.Vector3(...pose.weaponPose!.position)) < .002);
    } finally { setV3Mesh2MotionCalibrationOverride(null); }
  });
});
