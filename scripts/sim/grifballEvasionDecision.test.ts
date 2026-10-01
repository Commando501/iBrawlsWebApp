import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { resolveAILungeEvasionForCombatant } from '../../src/components/grifball/aiLungeEvasionRuntime';
import { triggerEnemyHammerSwingForCombatant } from '../../src/components/grifball/enemyWeaponActions';
import { startAIHammerJumpForCombatant } from '../../src/components/grifball/combatantActions';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { withSimulationRandom } from '../../src/game/simulationRandom';

const cases = ['counter-hammer', 'counter-sword', 'dash', 'bait', 'bait-decline', 'hop', 'hammer-jump',
  'jump-rejected', 'hop-and-counter', 'dash-and-counter', 'easy', 'far', 'unready-hop', 'airborne-hop'] as const;
for (const id of ['main_ai', 'ordinary']) for (const mirror of [false, true]) for (const kind of cases)
  test(`evasion policy owned RNG ${id}/${mirror}/${kind}`, () => {
    const run = (explicit: boolean) => {
      const f = createBotParityFixture(id, true, { swordLungeSpeed: 24, attackRadius: 2, aiTuneHammerWindupSeconds: .32 }), { bot, target, state } = f;
      const hammer = ['counter-hammer', 'hammer-jump', 'jump-rejected', 'hop-and-counter', 'dash-and-counter'].includes(kind);
      bot.activeWeapon = hammer ? 'hammer' : 'sword'; target.activeWeapon = 'sword';
      const sign = mirror ? -1 : 1;
      const distance = kind.startsWith('bait') ? 12 : kind === 'far' ? 40 : kind.endsWith('and-counter') ? 8 : 3;
      target.pos.set(0, 0, sign * distance); target.isLunging = !kind.startsWith('bait'); target.lungeTargetDir = { x: 0, y: 0, z: -sign };
      if (kind === 'jump-rejected') bot.aiHammerJumpsInAir = state.settings.hammerJumpAirLimit;
      if (kind === 'airborne-hop') { bot.isJumping = true; bot.pos.y = 2; bot.vel.y = -1; }
      const frame = { pos: bot.pos, vel: bot.vel, dashDir: new THREE.Vector3(), aiState: 'APPROACHING' as const,
        timer: .2, dashRemaining: 0, dashCooldownTimer: ['hop', 'hammer-jump', 'jump-rejected', 'hop-and-counter', 'unready-hop', 'airborne-hop'].includes(kind) ? 1 : 0,
        pendingPostEvasionCharge: true, weaponState: 'ready' as const };
      const events: string[] = []; let draws = 0;
      const random = () => { draws++; return ['bait-decline', 'hop-and-counter'].includes(kind) ? .99 : .01; };
      const result = withSimulationRandom(explicit ? () => assert.fail('explicit policy leaked into global RNG') : random, 0, () =>
        resolveAILungeEvasionForCombatant({ state, self: bot, frame, botId: id,
          target: { ...target, weaponState: 'ready', isLunging: !!target.isLunging, isCrouching: false },
          toTarget: target.pos.clone().sub(bot.pos), distanceToTarget: distance, combatDistanceToTarget: distance,
          resolvedAiReach: 3, targetIsProtected: false, targetIsLunging: !!target.isLunging,
          dt: 1 / 60, difficulty: kind === 'easy' ? 'easy' : 'normal', defensiveEvasionMult: 1, spatialIQ: 80,
          swayTimer: 0, activeWeapon: bot.activeWeapon, canStartWeaponAction: kind !== 'unready-hop', cooldownMultiplier: .75,
          calibrationEnabled: false, bulltrueCounter: kind === 'counter-hammer' ? 'hammer' : kind === 'counter-sword' ? 'sword' : null,
          getTargetPlayerModel: () => null, mainAI: state.otherPlayers.get('main_ai'),
          triggerCombatantAttack: () => { events.push('attack'); f.attack(); },
          startAIHammerJump: (self, _pos, vel, horizontalHeading, jumpType) => {
            events.push('jump-attempt');
            return startAIHammerJumpForCombatant({ self, settings: state.settings, vel, horizontalHeading, jumpType,
              onMainAIHammerSwing: () => triggerEnemyHammerSwingForCombatant(bot), playSwing: () => events.push('swing'), playJump: () => events.push('jump') });
          }, spawnVoxelShockwaveParticles: () => events.push('particles'),
          recordCombatantObservation: () => events.push('observation'), playDash: () => events.push('dash'), playJump: () => events.push('hop'),
          tuning: resolveBehaviorTuning(state.settings), ...(explicit ? { random } : {}) }));
      return { result, draws, events, pose: { pos: bot.pos.toArray(), vel: bot.vel.toArray(), dir: frame.dashDir.toArray(),
        jumping: !!bot.isJumping, planned: !!bot.hammerJumpPlanned, weapon: bot.weaponState } };
    };
    const result = run(true);
    assert.deepEqual(run(true), result, 'restoring the same observations and caller stream reproduces policy and effects');
    assert.deepEqual(run(false), result, 'existing live global-stream calls retain the same order and draw count');
    const dash = ['dash', 'bait', 'dash-and-counter'].includes(kind);
    const hop = ['hop', 'hop-and-counter', 'unready-hop', 'airborne-hop'].includes(kind);
    const counter = kind.startsWith('counter-') || kind.endsWith('and-counter');
    assert.equal(result.events.includes('dash'), dash);
    assert.equal(result.events.includes('attack'), counter);
    assert.equal(result.events.includes('hop'), hop && kind !== 'airborne-hop');
    assert.equal(result.pose.jumping, hop || kind === 'hammer-jump' && id !== 'main_ai');
    assert.equal(result.pose.planned, kind === 'hammer-jump' && id === 'main_ai');
    assert.equal(result.result.isEvadingLunge, dash || hop || kind === 'hammer-jump');
    if (dash) { assert.equal(Math.abs(result.pose.dir[0]), 1); assert.equal(Math.abs(result.pose.dir[2]), 0); }
    if (kind === 'airborne-hop') assert.equal(result.pose.pos[1], 2, 'already advanced gravity is not integrated twice');
    if (kind === 'hop') assert.equal(result.pose.pos[1], 5.5 / 60, 'new emergency hop contributes one launch displacement');
    if (kind === 'bait') assert.equal(result.result.pendingPostEvasionCharge, true, 'bait retains existing follow-up intent');
    if (kind === 'dash') assert.equal(result.result.pendingPostEvasionCharge, false);
    if (kind === 'jump-rejected') assert.deepEqual(result.events, ['jump-attempt'], 'rejected hammer jump does not become an emergency hop');
    const expectedDraws = kind.startsWith('counter-') || ['easy', 'far'].includes(kind) ? 0
      : dash || kind === 'hop-and-counter' ? 2 : 1;
    assert.equal(result.draws, expectedDraws);
  });
