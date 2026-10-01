import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { triggerCombatantAttackAction, triggerCombatantLungeAction, swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import type { ScriptedCombatCommand } from '../../src/sim/scriptedCombatInput';

const dt = 1 / 60, noop = () => {};
const phase = (value: string | undefined) => value === 'ready' ? 'idle'
  : value === 'swing_up' || value === 'melee_up' ? 'windup'
  : value === 'swing_down' || value === 'melee_down' ? 'active' : 'recovering';

// A newly committed counter must be visible to a later actor's existing flight.
// Reversing roster order is a negative control: contact precedes that commitment.
for (const main of ['lunger', 'defender']) for (const defenderFirst of [false, true])
  for (const mirror of [false, true]) for (const kind of ['slash', 'slam', 'swap-slash'] as const)
    for (const packet of [false, true]) {
      if (kind === 'swap-slash' && !packet) continue;
      test(`actor intent order ${main}/${defenderFirst}/${mirror}/${kind}/${packet}`, () => {
        const f = attachLungeRuntime(createBotParityFixture(main === 'lunger' ? 'main_ai' : 'lunger', true,
          { weaponReadyTime: 0, weaponSwapLockout: .5, enableSwordTrade: true, enableHammerSwordTrade: true },
          main === 'defender' ? 'main_ai' : 'defender'));
        const { bot, target, sim, state } = f, [self, rival] = sim.combatants;
        sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
        const sign = mirror ? -1 : 1;
        for (const [live, actor] of [[bot, self], [target, rival]] as const) {
          actor.id = live.id; actor.controller = 'ai'; actor.hp = actor.maxHp = live.hp = live.maxHp = 5;
          actor.invulnerabilityTimer = actor.weaponReadyTimer = 0;
          actor.pos = { x: 0, y: 0, z: live === bot ? 0 : sign * 1.7 };
          live.pos.set(actor.pos.x, actor.pos.y, actor.pos.z);
          actor.yaw = live === bot ? (mirror ? Math.PI : 0) : (mirror ? 0 : Math.PI);
          live.yaw = actor.yaw + Math.PI;
          if (mirror) actor.team = live.team = live.team === 'blue' ? 'red' : 'blue';
        }
        target.activeWeapon = rival.weapon = kind === 'slash' ? 'sword' : 'hammer';
        bot.activeWeapon = self.weapon = 'sword';
        sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', pos: { x: 40, y: 0, z: 0 } });
        if (defenderFirst) { sim.combatants.splice(0, 2, rival, self); state.otherPlayers = new Map([[target.id, target], [bot.id, bot]]); }
        withSimulationRandom(seededRandom(31), 0, () => {
          triggerCombatantLungeAction({ self: bot, settings: state.settings, lungeDir: new THREE.Vector3(0, 0, sign), pos: bot.pos, vel: bot.vel, playDash: noop });
          self.lungeTargetId = rival.id; self.lungeAimDirection = { x: 0, y: 0, z: sign };
          stepCombatantWeapons(sim, self, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
        });
        const commands: ScriptedCombatCommand[] = [
          ...(kind === 'swap-slash' ? [{ kind: 'swap', weapon: 'sword' } as const] : []),
          { kind: 'melee', weapon: kind === 'slam' ? 'hammer' : 'sword', swipe: false },
        ];
        let restored: typeof sim | undefined;
        for (let tick = 1; tick <= 30; tick++) {
          withSimulationRandom(seededRandom(31), tick * dt, () => {
            f.weaponFrame(dt); f.respawns(dt);
            for (const actor of state.otherPlayers.values()) {
              tickCombatantInvulnerability(actor, dt);
              if (actor === target && tick === 1) {
                if (kind === 'swap-slash') swapCombatantWeaponAction({ self: target, settings: state.settings, type: 'sword', setLockout: true, recordWeaponSwap: noop });
                triggerCombatantAttackAction({ self: target, weapon: kind === 'slam' ? 'hammer' : 'sword', recordHammerAttack: noop, playSwing: noop });
              }
              if (actor.isLunging) f.flightFor(actor, actor === bot ? target : bot);
            }
            f.visuals(dt);
          });
          const actions = Object.fromEntries(sim.combatants.map(c => [c.id, { ...idleAction(), aim: c.yaw,
            attackPrimary: tick === 1 && c === rival && !packet }]));
          const options = { settings: sim.settings, ...(tick === 1 && packet ? { scriptedCombat: {
            version: 'scripted-combat-v1' as const, scriptedBots: { [rival.id]: 'normal' }, commands: { [rival.id]: commands },
          } } : {}) };
          const events = stepSimulation(sim, actions, options);
          if (restored) {
            assert.deepEqual(stepSimulation(restored, actions, options), events);
            assert.deepEqual(restored, sim);
          }
          if (tick === 1) {
            assert.equal(bot.hp, defenderFirst ? 4 : 5, 'live order oracle');
            assert.equal(self.hp, defenderFirst ? 4 : 5, 'headless order oracle');
            assert.equal(target.hp, 4); assert.equal(rival.hp, 4);
            restored = JSON.parse(JSON.stringify(sim));
          }
          for (const [live, actor] of [[bot, self], [target, rival]] as const) {
            assert.equal(actor.hp, live.hp, `${tick}/${actor.id}/health`);
            assert.equal(actor.weaponState, phase(live.weaponState), `${tick}/${actor.id}/phase`);
            assert.equal(actor.isLunging, !!live.isLunging, `${tick}/${actor.id}/flight`);
            assert.ok(Math.abs((actor.weaponPhaseElapsed ?? 0) - (live.weaponTimer ?? 0)) < 1e-6, `${tick}/${actor.id}/animation clock`);
            for (const axis of ['x', 'y', 'z'] as const) assert.ok(Math.abs(actor.pos[axis] - live.pos[axis]) < 1e-6, `${tick}/${actor.id}/${axis}`);
          }
        }
      });
    }
