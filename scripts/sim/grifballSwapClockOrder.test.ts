import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { tickAIEngagementCooldowns } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';

for (const reverse of [false, true]) for (const condition of ['alive', 'paused', 'dead', 'revive', 'swap'] as const)
  for (const dt of [1 / 60, .01, .025]) test(`mixed swap clocks ${reverse}/${condition}/${dt}`, () => {
    const f = createBotParityFixture('main_ai', true, { weaponReadyTime: .2, weaponSwapLockout: .4 }, 'ordinary');
    const { bot, target, state, sim } = f, [main, ordinary] = sim.combatants;
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
    for (const [live, actor] of [[bot, main], [target, ordinary]] as const) {
      actor.id = live.id; actor.controller = 'ai'; actor.pauseDuringInactiveGrifball = true;
      actor.weaponReadyTimer = live.swapCooldownTimer = .06; actor.swapLockoutTimer = live.swapLockoutTimer = .1;
      if (condition === 'dead' || condition === 'revive') {
        actor.alive = false; actor.hp = live.hp = 0; actor.respawnTimer = live.respawnTimer = condition === 'revive' ? dt / 2 : 10;
      }
    }
    sim.combatants.push({ ...structuredClone(ordinary), id: 'player', controller: 'remote', alive: true, hp: 20, respawnTimer: 0, pos: { x: 40, y: 0, z: 0 } });
    if (reverse) { sim.combatants.splice(0, 2, ordinary, main); state.otherPlayers = new Map([[target.id, target], [bot.id, bot]]); }
    if (condition === 'paused') { sim.match.phase = state.grifball.phase = 'countdown'; sim.match.phaseTimer = state.grifball.phaseTimer = 0; }
    let restored: typeof sim | undefined;
    for (let tick = 1; tick <= 30; tick++) {
      f.weaponFrame(dt); f.respawns(dt);
      for (const actor of state.otherPlayers.values()) if (actor.hp > 0 && state.grifball.phase === 'playing') {
        tickAIEngagementCooldowns({ self: actor, botId: actor.id, mainAIId: 'main_ai', dt,
          frame: { pos: actor.pos, vel: actor.vel, aiState: actor.aiState, timer: actor.aiTimer,
            dashCooldownTimer: 0, slideCooldownTimer: 0, hammerJumpCooldownTimer: 0 } });
        if (condition === 'swap' && tick === 12) swapCombatantWeaponAction({ self: actor, settings: state.settings,
          type: 'sword', setLockout: true, recordWeaponSwap: () => {} });
      }
      const actions = Object.fromEntries(sim.combatants.map(c => [c.id, { ...idleAction(), aim: c.yaw, swapWeapon: c.id !== 'player' && condition === 'swap' && tick === 12 }]));
      const events = stepSimulation(sim, actions, { settings: sim.settings, dt });
      if (restored) { assert.deepEqual(stepSimulation(restored, actions, { settings: restored.settings, dt }), events); assert.deepEqual(restored, sim); }
      if (tick === 1) restored = JSON.parse(JSON.stringify(sim));
      for (const [live, actor] of [[bot, main], [target, ordinary]] as const) {
        assert.ok(Math.abs(actor.weaponReadyTimer - (live.swapCooldownTimer ?? 0)) < 1e-9, `${tick}/${actor.id}/readiness`);
        assert.ok(Math.abs(actor.swapLockoutTimer - (live.swapLockoutTimer ?? 0)) < 1e-9, `${tick}/${actor.id}/lockout`);
      }
      if (tick === 1 && (condition === 'dead' || condition === 'paused')) {
        assert.equal(main.weaponReadyTimer, .06 - dt, 'main clock advances globally');
        assert.equal(ordinary.weaponReadyTimer, .06, 'ordinary clock waits for an active living turn');
      }
      if (condition === 'swap' && tick === 12) for (const actor of [main, ordinary]) {
        assert.equal(actor.weaponReadyTimer, .2, 'new readiness does not lose a tick');
        assert.equal(actor.swapLockoutTimer, .4, 'new lockout does not lose a tick');
      }
    }
  });
