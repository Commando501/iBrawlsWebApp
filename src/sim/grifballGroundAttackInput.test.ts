import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { resolveSimGrifballGroundAttackInput } from './grifballGroundAttackInput';

function fixture() {
  const state = createMatch({ seed: 7, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 }, settings: { aiDifficulty: 'normal' } });
  state.match.phase = 'playing';
  const actor = state.combatants[0];
  actor.controller = 'ai'; actor.pos = { x: -10, y: 0, z: 0 };
  actor.vel = { x: 3, y: 0, z: -2 }; actor.weaponReadyTimer = 0;
  const owners = { [actor.id]: 'normal' };
  const opportunity = { enemyInKillRange: true, aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1.25 };
  return { state, actor, owners, opportunity };
}

for (const weapon of ['hammer', 'sword'] as const) test(`${weapon} commitment returns a stopped command and owned reload without mutation`, () => {
  const f = fixture(); f.actor.weapon = weapon;
  f.state.settings.hammerReloadTime = .8; f.state.settings.swordSlashReload = .4;
  const before = structuredClone(f);
  const input = resolveSimGrifballGroundAttackInput(f.state, f.actor.id, f.owners, f.opportunity)!;
  assert.equal(input.action.attackPrimary, true);
  assert.equal(input.action.aim, f.actor.yaw);
  assert.deepEqual(input.scriptedObjective.movement[f.actor.id], { x: 0, z: 0 });
  assert.equal(input.aiState, 'COOLDOWN');
  assert.equal(input.timer, weapon === 'hammer' ? 1 : .5);
  assert.deepEqual(f, before);
});

for (const reason of ['range', 'reload', 'swap', 'weapon', 'airborne', 'vertical', 'dash', 'slide', 'lunge',
  'dead', 'respawning', 'inactive', 'carrier', 'holder', 'ball', 'unowned', 'remote', 'local', 'neural'] as const)
  test(`ground attack ${reason} remains a non-mutating handoff`, () => {
    const f = fixture(); let opportunity = { ...f.opportunity, aiState: 'COOLDOWN' as const };
    if (reason === 'range') opportunity.enemyInKillRange = false;
    if (reason === 'reload') opportunity.timer = 1 / 120;
    if (reason === 'swap') f.actor.weaponReadyTimer = 1 / 30;
    if (reason === 'weapon') f.actor.weaponState = 'windup';
    if (reason === 'airborne') f.actor.isJumping = true;
    if (reason === 'vertical') f.actor.vel.y = .1;
    if (reason === 'dash') f.actor.dashRemaining = .1;
    if (reason === 'slide') f.actor.slideActive = true;
    if (reason === 'lunge') f.actor.isLunging = true;
    if (reason === 'dead') f.actor.alive = false;
    if (reason === 'respawning') f.actor.respawnTimer = 1;
    if (reason === 'inactive') f.state.match.phase = 'countdown';
    if (reason === 'carrier') f.actor.hasBall = true;
    if (reason === 'holder') { f.state.match.ball.state = 'held'; f.state.match.ball.holderId = f.actor.id; }
    if (reason === 'ball') f.actor.weapon = 'ball';
    if (reason === 'unowned') delete f.owners[f.actor.id];
    if (reason === 'remote') f.actor.controller = 'remote';
    if (reason === 'local') f.state.localPlayerId = f.actor.id;
    if (reason === 'neural') f.owners[f.actor.id] = 'neural-net';
    const before = structuredClone(f);
    assert.equal(resolveSimGrifballGroundAttackInput(f.state, f.actor.id, f.owners, opportunity), null);
    assert.deepEqual(f, before);
  });

test('swap clock may expire this frame, but selecting a command never spends the AI reload', () => {
  const f = fixture(); f.actor.weaponReadyTimer = 1 / 60;
  const opportunity = { ...f.opportunity, aiState: 'COOLDOWN' as const, timer: 1 / 120 };
  assert.equal(resolveSimGrifballGroundAttackInput(f.state, f.actor.id, f.owners, opportunity), null);
  opportunity.timer = 0;
  assert.ok(resolveSimGrifballGroundAttackInput(f.state, f.actor.id, f.owners, opportunity));
  assert.equal(f.actor.weaponReadyTimer, 1 / 60); assert.equal(opportunity.timer, 0);
});
