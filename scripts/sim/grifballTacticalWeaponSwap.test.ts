import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { canApplyAITacticalWeaponSwap } from '../../src/game/aiTacticalWeaponSwap';
import { swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { resolveSimGrifballTacticalWeaponSwapInput } from '../../src/sim/grifballTacticalWeaponSwapInput';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import { stepCombatantWeapons } from '../../src/sim/weapons';

const dt = 1 / 60;
const context = { swordForbidden: false, hammerForbidden: false };

for (const profile of ['live-roster-v2', 'live-mixed-v1'] as const)
  for (const id of ['main_ai', 'bot_2']) for (const desired of ['hammer', 'sword'] as const)
    for (const delay of [0, .05]) test(`${profile}/${id}/${desired}/delay-${delay}: swap, readiness, impact and restored continuation`, () => {
      const f = createBotParityFixture(id, true, { weaponReadyTime: delay, weaponSwapLockout: .1 });
      const { sim, bot, target } = f, [self, rival] = sim.combatants;
      sim.combatExecution = profile; sim.match.phase = 'playing';
      self.id = id; self.controller = 'ai'; rival.id = target.id;
      self.weapon = bot.activeWeapon = desired === 'hammer' ? 'sword' : 'hammer';
      self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 2 };
      self.yaw = 0; self.invulnerabilityTimer = rival.invulnerabilityTimer = rival.weaponReadyTimer = 0;
      self.swapLockoutTimer = bot.swapLockoutTimer = 2 * dt;
      // Zero configuration must preserve a delay already in flight.
      self.weaponReadyTimer = bot.swapCooldownTimer = .12;
      rival.hp = rival.maxHp = target.hp;
      if (profile === 'live-mixed-v1') {
        sim.localPlayerId = 'player'; f.state.isObserverMode = false; f.state.localPlayerTeam = 'blue';
        sim.combatants.push({ ...structuredClone(rival), id: 'player', controller: 'remote', team: 'blue',
          pos: { x: 40, y: 0, z: 0 }, weapon: 'hammer' });
      }
      const owners = { [id]: 'normal' };
      let liveSwaps = 0, simSwaps = 0, liveAttack = 0, simAttack = 0, hit = 0;
      let restored: typeof sim | undefined;
      let restoredAttack = 0;
      for (let tick = 1; tick <= 100; tick++) {
        const before = structuredClone(sim);
        const command = resolveSimGrifballTacticalWeaponSwapInput(sim, id, owners, desired, context);
        assert.deepEqual(sim, before, 'decision must not mutate its observations');
        // The engine must also enforce readiness when an attack is requested in
        // the same frame as the swap. The live owner checks that gate directly.
        const input = { ...(command ?? idleAction()), attackPrimary: !simAttack, aim: 0 };
        f.frame(false, false, () => {
          if (id !== 'main_ai') {
            bot.swapCooldownTimer = Math.max(0, (bot.swapCooldownTimer ?? 0) - dt);
            bot.swapLockoutTimer = Math.max(0, (bot.swapLockoutTimer ?? 0) - dt);
          }
          if (canApplyAITacticalWeaponSwap({ ...context, activeWeapon: bot.activeWeapon, requestedWeapon: desired,
            weaponState: bot.weaponState!, swapLockoutTimer: bot.swapLockoutTimer ?? 0 })) {
            swapCombatantWeaponAction({ self: bot, settings: f.state.settings, type: desired, setLockout: true,
              recordWeaponSwap: () => { liveSwaps++; } });
          }
          if (!liveAttack && bot.weaponState === 'ready' && (bot.swapCooldownTimer ?? 0) <= 0) {
            liveAttack = tick; f.attack();
          }
        });
        if (command) { simSwaps++; assert.equal(tick, 2, 'swap opens exactly when its initial lockout expires'); }
        stepSimulation(sim, { [id]: input }, { settings: sim.settings });
        if (!simAttack && self.weaponState !== 'idle') simAttack = tick;
        if (restored) {
          const ownCommand = resolveSimGrifballTacticalWeaponSwapInput(restored, id, owners, desired, context);
          assert.deepEqual(ownCommand, command);
          stepSimulation(restored, { [id]: { ...(ownCommand ?? idleAction()), attackPrimary: !restoredAttack,
            aim: 0 } }, { settings: restored.settings });
          if (!restoredAttack && restored.combatants[0].weaponState !== 'idle') restoredAttack = tick;
          assert.deepEqual(restored, sim, `restored execution ${tick}`);
        }
        if (tick === 2) restored = JSON.parse(JSON.stringify(sim));
        assert.equal(self.weapon, bot.activeWeapon);
        assert.ok(Math.abs(self.swapLockoutTimer - (bot.swapLockoutTimer ?? 0)) < 1e-9, `lockout ${tick}`);
        assert.ok(Math.abs(self.weaponReadyTimer - (bot.swapCooldownTimer ?? 0)) < 1e-9, `readiness ${tick}`);
        const phase = bot.weaponState === 'ready' ? 'idle' : bot.weaponState === 'swing_up' ? 'windup'
          : bot.weaponState === 'swing_down' ? 'active' : 'recovering';
        assert.equal(self.weaponState, phase, `phase ${tick}`);
        assert.ok(Math.abs((self.weaponPhaseElapsed ?? 0) - (bot.weaponTimer ?? 0)) < 1e-6, `phase time ${tick}`);
        assert.equal(rival.hp, target.hp, `impact ${tick}`);
        if (!hit && target.hp < 20) hit = tick;
      }
      assert.equal(liveSwaps, 1); assert.equal(simSwaps, 1);
      assert.equal(simAttack, liveAttack); assert.equal(liveAttack, delay === 0 ? 8 : 6); assert.ok(hit > liveAttack);
      assert.equal(target.hp, 19); assert.equal(self.weaponState, 'idle');
    });

for (const reason of ['same', 'forbidden', 'lockout', 'windup', 'active', 'recovery', 'carrier', 'holder', 'ball',
  'remote', 'unowned', 'local', 'dead', 'respawn', 'inactive', 'airborne', 'dash', 'slide', 'lunge', 'neural'] as const)
  test(`unsupported or refused ${reason} swap hands back control without mutation`, () => {
    const f = createBotParityFixture('bot_2'); const { sim } = f, actor = sim.combatants[0];
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing'; actor.controller = 'ai';
    actor.pos = { x: 0, y: 0, z: 0 }; actor.weapon = 'hammer'; actor.swapLockoutTimer = 0;
    const owners: Record<string, string> = { [actor.id]: 'normal' }, rules = { ...context };
    if (reason === 'same') actor.weapon = 'sword';
    if (reason === 'forbidden') rules.swordForbidden = true;
    if (reason === 'lockout') actor.swapLockoutTimer = dt * 2;
    if (reason === 'windup') actor.weaponState = 'windup';
    if (reason === 'active') actor.weaponState = 'active';
    if (reason === 'recovery') actor.weaponState = 'recovering';
    if (reason === 'carrier') actor.hasBall = true;
    if (reason === 'holder') { sim.match.ball.state = 'held'; sim.match.ball.holderId = actor.id; }
    if (reason === 'ball') actor.weapon = 'ball';
    if (reason === 'remote') actor.controller = 'remote';
    if (reason === 'unowned') delete owners[actor.id];
    if (reason === 'local') sim.localPlayerId = actor.id;
    if (reason === 'dead') actor.alive = false;
    if (reason === 'respawn') actor.respawnTimer = 1;
    if (reason === 'inactive') sim.match.phase = 'countdown';
    if (reason === 'airborne') actor.isJumping = true;
    if (reason === 'dash') actor.dashRemaining = 1;
    if (reason === 'slide') actor.slideActive = true;
    if (reason === 'lunge') actor.isLunging = true;
    if (reason === 'neural') owners[actor.id] = 'neural-net';
    const before = structuredClone(sim);
    assert.equal(resolveSimGrifballTacticalWeaponSwapInput(sim, actor.id, owners, 'sword', rules), null);
    assert.deepEqual(sim, before);
  });

test('committed strikes cannot be overridden by a forced tactical swap', () => {
  for (const weaponState of ['swing_up', 'swing_down', 'melee_up', 'melee_down']) {
    const request = { ...context, activeWeapon: 'hammer', requestedWeapon: 'sword' as const,
      weaponState, swapLockoutTimer: 0, force: true };
    assert.equal(canApplyAITacticalWeaponSwap(request), false);
  }
});

for (const profile of ['legacy-v1', 'live-player-v1', 'live-roster-v1', 'live-roster-v2', 'live-mixed-v1'] as const)
  test(`${profile}: zero swap settings retain the correct owner semantics`, () => {
    const { sim } = createBotParityFixture(); const actor = sim.combatants[0];
    sim.combatExecution = profile; actor.weapon = 'hammer'; actor.weaponState = 'idle';
    actor.weaponReadyTimer = .2; actor.swapLockoutTimer = 0;
    const settings = { ...sim.settings, weaponReadyTime: 0, weaponSwapLockout: 0 };
    stepCombatantWeapons(sim, actor, { ...idleAction(), swapWeapon: true, attackPrimary: true }, settings, dt, []);
    const roster = profile === 'live-roster-v1' || profile === 'live-roster-v2' || profile === 'live-mixed-v1';
    assert.equal(actor.weapon, 'sword'); assert.equal(actor.swapLockoutTimer, 0);
    assert.equal(actor.weaponReadyTimer, roster ? .2 - dt : 0);
    assert.equal(actor.weaponState === 'idle', roster);
  });

test('zero delays allow a ready roster actor to swap and strike in the same frame', () => {
  const { sim } = createBotParityFixture(); const actor = sim.combatants[0];
  sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
  actor.controller = 'ai'; actor.pos = { x: 0, y: 0, z: 0 }; actor.weapon = 'hammer';
  actor.swapLockoutTimer = actor.weaponReadyTimer = actor.attackCooldown = 0;
  const input = resolveSimGrifballTacticalWeaponSwapInput(sim, actor.id, { [actor.id]: 'normal' }, 'sword', context)!;
  assert.ok(input);
  stepCombatantWeapons(sim, actor, { ...input, attackPrimary: true },
    { ...sim.settings, weaponReadyTime: 0, weaponSwapLockout: 0 }, dt, []);
  assert.equal(actor.weapon, 'sword'); assert.equal(actor.weaponState, 'windup'); assert.equal(actor.attackKind, 'slash');
});
