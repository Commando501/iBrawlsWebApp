import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from '../../../scripts/sim/grifballBotExecutionParity';
import { resolveIncomingLungeDirectionForTarget } from './aiIncomingLungeRuntime';
import { resolveAILungeEvasionForCombatant } from './aiLungeEvasionRuntime';
import { triggerCombatantLungeAction } from './combatantActions';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { withSimulationRandom } from '../../game/simulationRandom';

const noop = () => {};
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1])
  for (const phase of ['launched', 'ended', 'zero-direction'] as const)
    test(`incoming trajectory follows physical flight ${id}/${sign}/${phase}`, () => {
      const { bot: defender, target, state } = createBotParityFixture('defender', true, {}, id);
      target.aiState = 'APPROACHING'; target.vel.set(0, 0, sign * 2);
      triggerCombatantLungeAction({ self: target, settings: state.settings, lungeDir: new THREE.Vector3(sign, 0, 0), pos: target.pos, vel: target.vel, playDash: noop });
      assert.equal(target.aiState, 'APPROACHING', 'a real launch need not change the decision state');
      if (phase === 'ended') { target.isLunging = false; target.aiState = 'LUNGING'; }
      if (phase === 'zero-direction') target.lungeTargetDir = { x: 0, y: 0, z: 0 };
      const result = resolveIncomingLungeDirectionForTarget({ target: { ...target, weaponState: target.weaponState!, isCrouching: false, isLunging: !!target.isLunging },
        toTarget: target.pos.clone().sub(defender.pos), playerIsLunging: true, playerLungeDir: { x: -sign, z: 0 },
        mainAi: id === 'main_ai' ? target : undefined, targetOtherBot: id === 'main_ai' ? undefined : target });
      assert.deepEqual(result, phase === 'launched' ? { x: sign, z: 0 } : { x: 0, z: sign });
    });

for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1])
  test(`live defender dodges perpendicular to the actual newly committed ${id} lunge/${sign}`, () => {
    const { bot, target, state } = createBotParityFixture('defender', true, {}, id);
    target.pos.set(0, 0, sign * 3); target.vel.set(0, 0, sign * 2); target.aiState = 'APPROACHING'; target.activeWeapon = 'sword';
    triggerCombatantLungeAction({ self: target, settings: state.settings, lungeDir: new THREE.Vector3(sign, 0, 0), pos: target.pos, vel: target.vel, playDash: noop });
    const dashDir = new THREE.Vector3(); let dashes = 0;
    const result = withSimulationRandom(() => 0, 0, () => resolveAILungeEvasionForCombatant({ state, self: bot, botId: bot.id,
      frame: { pos: bot.pos, vel: bot.vel, dashDir, aiState: 'APPROACHING', timer: 0, dashRemaining: 0, dashCooldownTimer: 0,
        pendingPostEvasionCharge: false, weaponState: 'ready' },
      target: { ...target, isLunging: true, isCrouching: false, weaponState: 'ready' },
      toTarget: target.pos.clone().sub(bot.pos), distanceToTarget: 3, combatDistanceToTarget: 3, resolvedAiReach: 3,
      targetIsProtected: false, targetIsLunging: true, dt: 1 / 60, difficulty: 'normal', defensiveEvasionMult: 1,
      spatialIQ: 80, swayTimer: 0, activeWeapon: 'sword', canStartWeaponAction: true, cooldownMultiplier: 1,
      calibrationEnabled: false, bulltrueCounter: null, getTargetPlayerModel: () => null,
      mainAI: state.otherPlayers.get('main_ai'), triggerCombatantAttack: () => assert.fail('sword dodge must not counter'),
      startAIHammerJump: () => assert.fail('sword dodge must not hammer jump'), spawnVoxelShockwaveParticles: noop,
      recordCombatantObservation: noop, playDash: () => { dashes++; }, playJump: () => assert.fail('dash available'),
      tuning: resolveBehaviorTuning(state.settings) }));
    assert.equal(result.isEvadingLunge, true); assert.equal(dashes, 1);
    assert.equal(Math.abs(dashDir.x), 0, 'dodge must be perpendicular to committed X travel, not old Z velocity');
    assert.equal(Math.abs(dashDir.z), 1); assert.equal(result.dashRemaining, state.settings.dashDuration);
  });
