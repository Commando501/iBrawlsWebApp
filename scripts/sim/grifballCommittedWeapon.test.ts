import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { deriveAIParams, type AIResolvedKnobs } from '../../src/game/aiTuning';
import { NEUTRAL_PERSONALITY_FLAGS } from '../../src/game/aiPersonalities';
import { startWeaponSwapFeint } from '../../src/game/aiMatchContext';

const dt = 1 / 60, noop = () => {};

for (const id of ['main_ai', 'bot_2'])
  for (const kind of ['hammer-up', 'hammer-down', 'sword-up', 'sword-down', 'swipe-up', 'swipe-down', 'feint-up', 'feint-down'] as const)
    test(`${id}/${kind}: live arbitration preserves the committed weapon until impact`, () => {
      const f = createBotParityFixture(id), { bot, target, state } = f;
      const feint = kind.startsWith('feint'), swipe = kind.startsWith('swipe');
      const weapon = kind.startsWith('sword') || feint ? 'sword' : 'hammer';
      const desired = weapon === 'hammer' ? 'sword' : 'hammer';
      const phase = kind.endsWith('up') ? swipe ? 'melee_up' : 'swing_up' : swipe ? 'melee_down' : 'swing_down';
      bot.pos.set(10, 0, 0); target.pos.set(10, 0, 2);
      bot.activeWeapon = weapon; bot.weaponState = phase; bot.weaponTimer = 0;
      bot.aiState = 'COOLDOWN'; bot.aiTimer = 1; bot.swapLockoutTimer = bot.swapCooldownTimer = 0;
      // These are ordinary encounters: no holder or interception assignment can
      // accidentally supply the narrower pre-existing protection.
      assert.equal(state.grifball.ball.holderId, null);
      if (feint) startWeaponSwapFeint(state.aiMatchContext, id, dt / 2);
      let choices = 0, swaps = 0;
      const knobs: AIResolvedKnobs = { difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
        weaponPrioritization: 50, reactionLatency: .2, anticipationFactor: 0, aiPlaystyle: 50 };
      const candidate = () => ({ ...target, isLunging: false, weaponState: 'ready' });
      const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: f.refs },
        mai: () => state.otherPlayers.get('main_ai'), resolveBotKnobs: () => knobs,
        resolveBotDerived: () => deriveAIParams(state.settings, knobs), resolveBotFlags: () => NEUTRAL_PERSONALITY_FLAGS,
        getMatchScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0, killsToWin: 25 }),
        getBestTacticalTarget: candidate, getTacticalTargetById: candidate, getTargetPlayerModel: () => null,
        getActiveCustomMap: () => f.map, getOptimalSpawnPoint: () => new THREE.Vector3(),
        grifballEnemyGoalPos: () => ({ x: 30, z: 0 }), grifballTeamOf: (actorId: string) => state.otherPlayers.get(actorId)?.team,
        constrainCombatantToArena: noop, recoverCombatantAltitude: () => false,
        evaluateTacticalWeaponChoice: () => { choices++; return { weapon: feint ? null : desired }; },
        swapCombatantWeapon: (self, type, setLockout = false) => {
          swaps++; swapCombatantWeaponAction({ self, type, setLockout, settings: state.settings, recordWeaponSwap: noop });
        },
        recordCombatantObservation: noop, isTargetOnCooldown: () => false, clearPressureTarget: noop,
        triggerCombatantAttack: () => assert.fail('the existing AI cooldown must prevent another attack'),
        triggerCombatantLunge: () => assert.fail('the existing AI cooldown must prevent a lunge'),
        startAIHammerJump: () => false, playDash: noop, playJump: noop, playExplosion: noop, playDeath: noop });
      let committed = 0;
      for (let tick = 1; tick <= 60; tick++) {
        const before = bot.weaponState;
        f.frame(false, false, () => update(id, dt));
        if (['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(before!)) {
          committed++;
          assert.equal(bot.activeWeapon, weapon, `committed ${before} at tick ${tick}`);
          assert.equal(swaps, 0);
        } else break;
      }
      assert.ok(choices > 0, 'exercise tactical arbitration in the full live updater');
      assert.ok(committed > 0);
      // Sword damage occurs at the up/down boundary; a down-phase fixture starts
      // after that event, while hammer/swipe damage is still pending.
      if (!(weapon === 'sword' && kind.endsWith('down'))) assert.equal(target.hp, 19, 'the original attack must land');
      assert.equal(bot.activeWeapon, desired, 'the deferred choice/revert remains available after impact');
      assert.equal(swaps, 1);
    });
