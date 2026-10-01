import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { stepSimulation } from './step';
import { idleAction } from './actions';
import type { ScriptedCombatInput } from './scriptedCombatInput';

function fixture() {
  const state = createMatch({ seed: 1, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 }, settings: { aiDifficulty: 'normal' } });
  state.match.phase = 'playing'; const actor = state.combatants[0], target = state.combatants[1];
  actor.controller = target.controller = 'ai'; actor.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 8 };
  actor.weapon = 'sword'; actor.weaponReadyTimer = actor.swapLockoutTimer = actor.invulnerabilityTimer = target.invulnerabilityTimer = 0;
  const actions = { [actor.id]: idleAction() };
  const input: ScriptedCombatInput = { version: 'scripted-combat-v1', scriptedBots: { [actor.id]: 'normal' },
    commands: { [actor.id]: [{ kind: 'lunge', targetId: target.id, direction: { x: 0, y: 0, z: 1 } }] } };
  return { state, actor, target, actions, input };
}

test('scripted lunge locks its target and starts flight without advancing it on the commitment frame', () => {
  const f = fixture(); const start = { ...f.actor.pos };
  stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input });
  assert.equal(f.actor.isLunging, true); assert.equal(f.actor.lungeTargetId, f.target.id);
  assert.equal(f.actor.lungeTimer, 0); assert.deepEqual(f.actor.pos, start); assert.deepEqual(f.actor.lungeDir, { x: 0, y: 0, z: 1 });
  const restored = JSON.parse(JSON.stringify(f.state));
  for (let tick = 0; tick < 120; tick++) {
    stepSimulation(f.state, {}, { settings: f.state.settings }); stepSimulation(restored, {}, { settings: restored.settings });
    assert.deepEqual(restored, f.state);
  }
  assert.equal(f.actor.lungeOutcome, 'hit'); assert.equal(f.target.hp, 0);
});

test('inherited command entries cannot gain authority', () => {
  const f = fixture(); f.input.commands = Object.create(f.input.commands);
  stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input });
  assert.equal(f.actor.isLunging, false);
});

for (const reason of ['version', 'legacy', 'mode', 'unowned', 'remote', 'local', 'neural', 'dead', 'respawn', 'inactive', 'air',
  'dash', 'slide', 'carrier', 'held', 'ball', 'duplicate', 'conflict', 'unknown-command', 'bad-weapon', 'sword-swipe',
  'repeat-attack', 'too-many', 'null-command', 'missing-target', 'allied-target', 'dead-target', 'duplicate-target', 'nan', 'zero', 'jump'] as const)
  test(`invalid scripted combat rejects the whole frame before mutation: ${reason}`, () => {
    const f = fixture();
    if (reason === 'version') f.input.version = 'old' as never;
    if (reason === 'legacy') f.state.combatExecution = 'legacy-v1';
    if (reason === 'mode') f.state.mode = 'combat';
    if (reason === 'unowned') f.input.scriptedBots = {};
    if (reason === 'remote') f.actor.controller = 'remote';
    if (reason === 'local') f.state.localPlayerId = f.actor.id;
    if (reason === 'neural') f.input.scriptedBots = { [f.actor.id]: 'neural-net' };
    if (reason === 'dead') f.actor.alive = false;
    if (reason === 'respawn') f.actor.respawnTimer = 1;
    if (reason === 'inactive') f.state.match.phase = 'countdown';
    if (reason === 'air') f.actor.isJumping = true;
    if (reason === 'dash') f.actor.dashRemaining = 1;
    if (reason === 'slide') f.actor.slideActive = true;
    if (reason === 'carrier') f.actor.hasBall = true;
    if (reason === 'held') f.state.match.ball.holderId = f.actor.id;
    if (reason === 'ball') f.actor.weapon = 'ball';
    if (reason === 'duplicate') f.state.combatants.push(structuredClone(f.actor));
    if (reason === 'conflict') f.actions[f.actor.id].attackPrimary = true;
    if (reason === 'jump') f.actions[f.actor.id].jump = true;
    if (reason === 'unknown-command') f.input.commands = { [f.actor.id]: [{ kind: 'teleport' } as never] };
    if (reason === 'bad-weapon') f.input.commands = { [f.actor.id]: [{ kind: 'swap', weapon: 'ball' as never }] };
    if (reason === 'sword-swipe') f.input.commands = { [f.actor.id]: [{ kind: 'melee', weapon: 'sword', swipe: true }] };
    if (reason === 'repeat-attack') f.input.commands = { [f.actor.id]: [...f.input.commands[f.actor.id], ...f.input.commands[f.actor.id]] };
    if (reason === 'too-many') f.input.commands = { [f.actor.id]: Array(4).fill({ kind: 'swap', weapon: 'hammer' }) };
    if (reason === 'null-command') f.input.commands = { [f.actor.id]: [null as never] };
    if (reason === 'missing-target') f.target.id = 'changed';
    if (reason === 'allied-target') f.target.team = f.actor.team;
    if (reason === 'dead-target') f.target.alive = false;
    if (reason === 'duplicate-target') f.state.combatants.push(structuredClone(f.target));
    if (reason === 'nan' || reason === 'zero') f.input.commands = { [f.actor.id]: [{ kind: 'lunge', targetId: f.target.id,
      direction: { x: reason === 'nan' ? NaN : 0, y: 0, z: 0 } }] };
    const before = structuredClone(f.state);
    assert.throws(() => stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input }));
    assert.deepEqual(f.state, before);
  });

test('a later invalid actor cannot allow an earlier valid swap to mutate the frame', () => {
  const f = fixture(); f.input.commands = { [f.actor.id]: [{ kind: 'swap', weapon: 'hammer' }], missing: [] };
  const before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input }));
  assert.deepEqual(f.state, before);
});

test('invalid combat timesteps and overflowing directions reject before any mutation', () => {
  for (const dt of [0, -1, NaN, Infinity]) {
    const f = fixture(), before = structuredClone(f.state);
    assert.throws(() => stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input, dt }));
    assert.deepEqual(f.state, before);
  }
  const f = fixture(), before = structuredClone(f.state);
  f.input.commands = { [f.actor.id]: [{ kind: 'lunge', targetId: f.target.id,
    direction: { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE } }] };
  assert.throws(() => stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input }));
  assert.deepEqual(f.state, before);
});

for (const phase of ['idle', 'recovering', 'windup', 'active'] as const)
  test(`v2 feint reversion retains readiness and respects committed ${phase}`, () => {
    const f = fixture(); f.input.version = 'scripted-combat-v2';
    f.input.commands = { [f.actor.id]: [{ kind: 'revert-weapon-feint' }] };
    f.actor.weaponState = phase; f.actor.attackKind = 'slash'; f.actor.weaponPhaseElapsed = 0;
    f.actor.swapLockoutTimer = .5; f.actor.weaponReadyTimer = .4;
    stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input });
    const committed = phase === 'windup' || phase === 'active';
    assert.equal(f.actor.weapon, committed ? 'sword' : 'hammer');
    assert.equal(f.actor.swapLockoutTimer, committed ? .5 - 1 / 60 : 0);
    assert.equal(f.actor.weaponReadyTimer, .4 - 1 / 60);
  });

for (const defect of ['v1', 'misplaced', 'duplicate']) test(`malformed feint ${defect} packet rejects atomically`, () => {
  const f = fixture(); f.input.version = defect === 'v1' ? 'scripted-combat-v1' : 'scripted-combat-v2';
  f.input.commands = { [f.actor.id]: defect === 'misplaced' ? [{ kind: 'swap', weapon: 'sword' }, { kind: 'revert-weapon-feint' }]
    : defect === 'duplicate' ? [{ kind: 'revert-weapon-feint' }, { kind: 'revert-weapon-feint' }] : [{ kind: 'revert-weapon-feint' }] };
  const before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input }));
  assert.deepEqual(f.state, before);
});

test('v3 engagement commands cannot be submitted as precomputed frame packets', () => {
  const f = fixture(); f.input.version = 'scripted-combat-v3'; const before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, f.actions, { settings: f.state.settings, scriptedCombat: f.input }), /scheduled prepared engagement/);
  assert.deepEqual(f.state, before);
});
