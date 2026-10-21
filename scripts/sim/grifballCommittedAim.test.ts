import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveAITargetPredictionFrame } from '../../src/components/grifball/aiTargetPredictionRuntime';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';

for (const mirrored of [false, true])
  test(`committed sword tracks the approaching carrier through impact: ${mirrored}`, async t => {
    const manifest = createSuiteManifest('quick');
    manifest.cases = [{ id: 'committed-sword-aim', mode: 'match', scenario: null, mapId: 'championship_stadium',
      roster: 'scripted-4v4', difficulty: 'normal', seeds: [102], opponents: ['balanced'], mirrored: true,
      fixedHz: 60, simulationSeconds: 10, watchdogSeconds: 60 }];
    const plan = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false,
      workingTreeHash: 'b'.repeat(64), scope: ['src'] });
    const job = plan.jobs.find(j => j.variant === 'candidate' && j.mirrored === mirrored)!;
    const fixture = structuredClone(plan.cases[0]);
    const authoredDefender = fixture.roster.find(actor => actor.slot.team === 'red')!;
    authoredDefender.slot.weaponPrioritization = authoredDefender.effectiveKnobs.weaponPrioritization = 100;
    const host = createAutonomousValidationRuntime(fixture, job), state = host.state;
    const sign = mirrored ? -1 : 1;
    const carrier = [...state.otherPlayers.values()].find(p => p.team === job.focalTeam)!;
    const defender = [...state.otherPlayers.values()].find(p => p.team !== job.focalTeam)!;
    for (const actor of state.otherPlayers.values()) {
      actor.invulnerabilityTimer = actor.aiTimer = actor.swapCooldownTimer = actor.swapLockoutTimer = 0;
      actor.weaponState = 'ready';
      if (actor !== carrier && actor !== defender) { actor.hp = 0; actor.respawnTimer = 100; }
    }
    state.grifball.phase = 'playing'; state.grifball.ball.state = 'held'; state.grifball.ball.holderId = carrier.id;
    carrier.pos.set(30 * sign, 0, 0); defender.pos.set(32 * sign, 0, 0);
    carrier.vel.set(0, 0, 0); defender.vel.set(0, 0, 0); defender.activeWeapon = 'sword';
    // Exercise slash aim directly. A preceding lunge now kills the runner and
    // cannot be used to set up a later slash in this regression fixture.
    defender.weaponState = 'swing_up'; defender.weaponTimer = 0;
    defender.aiState = 'COOLDOWN'; defender.aiTimer = state.settings.swordSlashReload;
    setGrifballCarrierForState({ state, id: carrier.id, carrying: true });
    carrier.weaponState = 'recovering'; carrier.weaponTimer = 0;
    Object.assign(state.grifball.ball.pos, carrier.pos);
    let firstHit = 0, committedFrames = 0, swordImpacts = 0;
    const awayFrames: number[] = [];
    try {
      for (let tick = 1; tick <= 180; tick++) {
        const hpBefore = carrier.hp;
        const committedSwordBefore = defender.activeWeapon === 'sword' && !defender.isLunging &&
          ['swing_up', 'swing_down'].includes(defender.weaponState ?? '');
        host.runtime.step();
        if (committedSwordBefore && carrier.hp < hpBefore) swordImpacts++;
        if (!firstHit && carrier.hp < 2) firstHit = tick;
        if (defender.activeWeapon === 'sword' && ['swing_up', 'swing_down'].includes(defender.weaponState ?? '')) {
          committedFrames++;
          const dx = carrier.pos.x - defender.pos.x, dz = carrier.pos.z - defender.pos.z;
          const facing = (-Math.sin(defender.yaw) * dx - Math.cos(defender.yaw) * dz) / Math.hypot(dx, dz);
          if (facing < .99) awayFrames.push(tick);
        }
        if (defender.hp <= 0 || carrier.hp <= 0 || state.grifball.phase !== 'playing') break;
      }
      t.diagnostic(JSON.stringify({ mirrored, firstHit, committedFrames, awayFrames }));
      assert.ok(committedFrames > 0, 'exercise a committed sword slash through production AI updates');
      assert.ok(firstHit > 0, 'the in-range approaching carrier must take the sword impact');
      assert.ok(swordImpacts > 0, 'require committed sword damage independently of an earlier lunge');
      assert.deepEqual(awayFrames, [], 'movement prediction must not turn a committed strike away from its target');
    } finally { host.runtime.dispose(); }
  });

for (const sign of [-1, 1]) for (const motion of ['closing', 'receding', 'crossing', 'falling'] as const)
  test(`committed aim preserves movement prediction: ${sign}/${motion}`, () => {
    const options = { botPos: new THREE.Vector3(), target: {
      pos: new THREE.Vector3(2 * sign, motion === 'falling' ? 2 : 0, 0),
      vel: new THREE.Vector3(motion === 'crossing' ? 0 : (motion === 'receding' ? 8 : -8) * sign,
        motion === 'falling' ? -2 : 0, motion === 'crossing' ? 8 * sign : 0) },
      effectiveReactionLatency: .25, tunedAnticipationFactor: 1, predictionAnticipationBonus: .25,
      predictionLandingWeight: .5, movementComplexity: 100, activeCustomMap: null, arenaRadius: 50 };
    const original = { pos: options.target.pos.toArray(), vel: options.target.vel.toArray() };
    const predicted = resolveAITargetPredictionFrame(options);
    const current = resolveAITargetPredictionFrame({ ...options, aimAtCurrentTarget: true });
    assert.deepEqual({ ...current, yaw: 0 }, { ...predicted, yaw: 0 }, 'only aim changes; steering and distance retain their contract');
    assert.deepEqual(resolveAITargetPredictionFrame({ ...options, aimAtCurrentTarget: false }), predicted);
    const heading = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), current.yaw);
    assert.ok(heading.dot(new THREE.Vector3(sign, 0, 0)) > .999, 'face the actual target on either side');
    if (motion !== 'receding') assert.notEqual(current.yaw, predicted.yaw, 'exercise a different movement forecast');
    assert.deepEqual({ pos: options.target.pos.toArray(), vel: options.target.vel.toArray() }, original);
  });
