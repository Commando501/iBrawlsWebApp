import test from 'node:test';
import assert from 'node:assert/strict';
import { lungeFixture } from './grifballLungeFixture';
import { idleAction } from '../../src/sim/actions';
import { resolveMixedPlayerLunge, stepCombatantWeapons } from '../../src/sim/weapons';
import { updatePlayerSwordLungeForState } from '../../src/components/grifball/playerSwordLungeRuntime';

// Captured immediately before Stadium tick 5164. Both poses describe 39
// identical 0.4-unit steps; accumulated roundoff straddles 16 on step 40.
const captured = [
  { pos: [40.83821642435816, -9.848871112185122], start: [38.74192313712982, 5.609639632835622],
    direction: [.13437777482232313, -.9909301759628684] },
  { pos: [40.838216424357896, -9.848871112185137], start: [38.74192313712983, 5.609639632835621],
    direction: [.13437777482232058, -.9909301759628687] },
];

for (const id of ['main_ai', 'ordinary']) for (const sign of [1, -1]) {
  test(`captured lunge poses finish on the same step: ${id}/${sign}`, () => {
    for (const c of captured) {
      const f = lungeFixture(id);
      f.map.arenaRadius = f.state.arenaRadius = 60;
      f.map.arenaHalfExtents = { x: 52, z: 23 };
      f.bot.pos.set(c.pos[0] * sign, 0, c.pos[1] * sign);
      f.bot.lungeStartPos = { x: c.start[0] * sign, y: 0, z: c.start[1] * sign };
      f.bot.lungeTargetDir = { x: c.direction[0] * sign, y: 0, z: c.direction[1] * sign };
      f.bot.lungeTimer = .6500000000000004;
      f.target.pos.set(0, 0, 0);
      f.flight();
      assert.equal(f.bot.isLunging, true, 'nominal 16-unit step retains the strict greater-than boundary');
      assert.deepEqual(f.outcomes, []);
      f.flight();
      assert.equal(f.bot.isLunging, false);
      assert.deepEqual(f.outcomes, ['miss_timeout']);
      f.flight();
      assert.deepEqual(f.outcomes, ['miss_timeout'], 'termination is reported once');
    }
  });
}

const noop = () => {};
function checkBoundary(kind: 'roster' | 'player', distance: number, contact = false, elapsed = .5) {
  const f = lungeFixture('ordinary', kind !== 'player');
  f.bot.pos.set(distance, 0, 0); f.bot.lungeStartPos = { x: 0, y: 0, z: 0 };
  f.bot.lungeTimer = elapsed;
  f.target.pos.set(contact ? distance : -10, 0, 0);
  f.sim.combatExecution = kind === 'player' ? 'live-mixed-v1' : 'live-roster-v2';
  const [actor, target] = f.sim.combatants;
  actor.id = kind === 'player' ? 'player' : f.bot.id;
  target.id = f.target.id;
  Object.assign(actor, { pos: { x: distance, y: 0, z: 0 }, isLunging: true,
    lungeStartPos: { x: 0, y: 0, z: 0 }, lungeDir: { x: 1, y: 0, z: 0 },
    lungeTimer: elapsed, lungeTargetId: target.id, weapon: 'sword', weaponReadyTimer: 0,
    invulnerabilityTimer: 0, attackCooldown: 0 });
  Object.assign(target, { pos: { x: contact ? distance : -10, y: 0, z: 0 },
    hp: 20, maxHp: 20, invulnerabilityTimer: 0, respawnTimer: 0, weapon: 'hammer' });
  if (kind === 'roster') {
    f.flight(0);
    stepCombatantWeapons(f.sim, actor, idleAction(), f.sim.settings, 0, []);
    return { live: !!f.bot.isLunging, sim: actor.isLunging, outcome: f.outcomes.at(-1), simOutcome: actor.lungeOutcome };
  }
  const s = f.state;
  s.localPlayerTeam = 'blue'; s.isLunging = true; s.activeWeapon = 'sword';
  s.playerPos.set(distance, 0, 0); s.lungeStartPos.set(0, 0, 0);
  s.lungeTargetDir.set(1, 0, 0); s.lungeTimer = elapsed;
  s.playerInvulnerabilityTimer = 0; f.bot.team = 'blue';
  const ends: boolean[] = [];
  updatePlayerSwordLungeForState({ state: s, dt: 0, isMultiplayer: false, activeCustomMap: f.map,
    multiplayerSocket: null, getMainAi: () => undefined,
    areCombatantsHostile: (_a, b) => b === f.target.id, constrainCombatantToArena: noop,
    renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: hit => ends.push(hit),
    recordPlayerCounterSuccess: noop, recordPlayerDamageDealt: noop, recordBotCalibrationDeath: noop,
    evaluatePlayerKillMedals: () => [], executeTrade: () => assert.fail('unexpected trade'),
    applyOutgoingMultiplayerHitLocally: noop, playExplosion: noop, playDeath: noop, playSwing: noop,
    spawnVoxelShockwaveParticles: noop, pushStatsUpdate: noop });
  f.sim.localPlayerId = actor.id;
  resolveMixedPlayerLunge(f.sim, actor, f.sim.settings, 0, []);
  return { live: s.isLunging, sim: actor.isLunging, outcome: ends.length ? ends[0] ? 'hit' : 'miss_timeout' : undefined,
    simOutcome: actor.lungeOutcome };
}

for (const kind of ['roster', 'player'] as const) {
  test(`strict travel boundary absorbs roundoff but rejects real overshoot: ${kind}`, () => {
    for (const delta of [-2e-9, -1e-12, 0, 1e-12, 1e-10, 1e-9, 1.01e-9, 2e-9, .4]) {
      const result = checkBoundary(kind, 16 + delta);
      const continues = delta <= 1e-9;
      assert.equal(result.live, continues, `live: ${delta}`);
      assert.equal(result.sim, continues, `sim: ${delta}`);
    }
  });
  test(`contact still takes precedence over exceeded travel: ${kind}`, () => {
    const result = checkBoundary(kind, 16.4, true);
    assert.deepEqual(result, { live: false, sim: false, outcome: 'hit', simOutcome: 'hit' });
  });
  test(`elapsed timeout remains effective below the travel limit: ${kind}`, () => {
    const result = checkBoundary(kind, 4, false, .81);
    assert.deepEqual(result, { live: false, sim: false, outcome: 'miss_timeout', simOutcome: 'miss_timeout' });
  });
}
