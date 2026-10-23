import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { idleAction } from './actions';
import { stepSimulation } from './step';
import { setSimCarrier } from './grifball';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, type ScriptedObjectiveInput } from './scriptedObjectiveInput';

function fixture() {
  const state = createMatch({ seed: 41, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 },
    settings: { speedForward: 100, speedBackward: 25, speedSide: 50, aiDifficulty: 'normal' } });
  state.match.phase = 'playing';
  const actor = state.combatants[0]; actor.id = 'walker'; actor.controller = 'ai';
  actor.pos = { x: -10, y: 0, z: 0 }; actor.vel = { x: 0, y: 0, z: 0 };
  actor.weaponReadyTimer = actor.invulnerabilityTimer = 0;
  const actions = { walker: idleAction() };
  const input: ScriptedObjectiveInput = { version: SCRIPTED_OBJECTIVE_INPUT_VERSION,
    scriptedBots: { walker: 'normal' }, movement: { walker: { x: 0, z: -1 } } };
  return { state, actor, actions, input };
}
for (const runner of [false, true]) for (const crouch of [false, true]) for (const scale of [0, .35, 1])
  test(`scripted objective world steering keeps attack facing ${runner}/crouch=${crouch}/${scale}`, () => {
    const { state, actor, actions, input } = fixture();
    if (runner) { setSimCarrier(actor, true, state.settings); state.match.ball.state = 'held'; state.match.ball.holderId = actor.id; }
    input.movement = { walker: { x: .6 * scale, z: -.8 * scale } };
    actions.walker.aim = .73; actions.walker.crouch = crouch;
    const before = { ...actor.pos }, speed = (runner ? 7.54 : 5.2) * (crouch ? .45 : 1);
    stepSimulation(state, actions, { settings: state.settings, scriptedObjective: input });
    assert.ok(Math.abs(actor.vel.x - .6 * scale * speed) < 1e-10);
    assert.ok(Math.abs(actor.vel.z + .8 * scale * speed) < 1e-10);
    assert.ok(Math.abs(actor.pos.x - before.x - actor.vel.x / 60) < 1e-10);
    assert.ok(Math.abs(actor.pos.z - before.z - actor.vel.z / 60) < 1e-10);
    assert.equal(actor.yaw, .73);
  });
test('omitting the explicit contract retains the ordinary backward input speed', () => {
  const { state, actor, actions } = fixture(); actions.walker.moveZ = -1;
  stepSimulation(state, actions, { settings: state.settings });
  assert.equal(actor.vel.z, -1.45);
});
test('mixed execution keeps the local player outside the scripted movement contract', () => {
  const { state, actor, actions, input } = fixture();
  state.combatExecution = 'live-mixed-v1'; state.localPlayerId = 'player';
  const local = { ...structuredClone(actor), id: 'player', controller: 'remote' as const, pos: { x: 40, y: 0, z: 0 } };
  state.combatants.push(local);
  for (let tick = 0; tick < 60; tick++) stepSimulation(state, actions, { settings: state.settings, scriptedObjective: input });
  assert.ok(Math.abs(actor.pos.z + 5.2) < 1e-9);
  assert.deepEqual(local.pos, { x: 40, y: 0, z: 0 });
});
test('scripted steering is constrained by the arena and retains independent JSON continuation', () => {
  const { state, actor, actions, input } = fixture();
  const boundaryZ = state.map.arenaHalfExtents!.z - 0.6;
  actor.pos.z = boundaryZ - 0.06; input.movement = { walker: { x: 0, z: 1 } };
  const restored = structuredClone(state), restoredInput = structuredClone(input);
  for (let tick = 0; tick < 60; tick++) {
    assert.deepEqual(stepSimulation(state, actions, { settings: state.settings, scriptedObjective: input }),
      stepSimulation(restored, actions, { settings: restored.settings, scriptedObjective: restoredInput }));
    assert.deepEqual(state, restored);
  }
  assert.ok(Math.abs(actor.pos.z - boundaryZ) < 1e-9);
  assert.equal(actor.vel.z, 0);
});
test('inherited movement cannot bypass input validation or issue a command', () => {
  const { state, actor, actions, input } = fixture();
  input.movement = Object.create({ walker: { x: 0, z: 1 } });
  stepSimulation(state, actions, { settings: state.settings, scriptedObjective: input });
  assert.equal(actor.vel.z, 0);
});
for (const kind of ['version', 'legacy', 'combat', 'remote', 'local', 'global-neural', 'effective-neural', 'slot-neural',
  'unlisted', 'inherited-authority', 'unknown', 'duplicate', 'nan', 'infinite', 'overspeed', 'dead', 'respawning',
  'flight', 'jumping', 'height', 'vertical', 'dash', 'slide', 'inactive', 'jump-request', 'dash-request'] as const)
  test(`invalid scripted steering rejects atomically: ${kind}`, () => {
    const { state, actor, actions, input } = fixture();
    const settings = { ...state.settings };
    if (kind === 'version') (input as { version: string }).version = 'scripted-objective-v0';
    if (kind === 'legacy') state.combatExecution = 'legacy-v1';
    if (kind === 'combat') state.mode = 'combat';
    if (kind === 'remote') actor.controller = 'remote';
    if (kind === 'local') { state.combatExecution = 'live-mixed-v1'; state.localPlayerId = actor.id; }
    if (kind === 'global-neural') state.settings.aiDifficulty = 'neural-net';
    if (kind === 'effective-neural') settings.aiDifficulty = 'neural-net';
    if (kind === 'slot-neural') input.scriptedBots = { walker: 'neural-net' };
    if (kind === 'unlisted') input.scriptedBots = {};
    if (kind === 'inherited-authority') input.scriptedBots = Object.create({ walker: 'normal' });
    if (kind === 'unknown') input.movement = { missing: { x: 0, z: 1 } };
    if (kind === 'duplicate') state.combatants.push(structuredClone(actor));
    if (kind === 'nan') input.movement = { walker: { x: NaN, z: 0 } };
    if (kind === 'infinite') input.movement = { walker: { x: 0, z: Infinity } };
    if (kind === 'overspeed') input.movement = { walker: { x: 1, z: 1 } };
    if (kind === 'dead') { actor.alive = false; actor.hp = 0; }
    if (kind === 'respawning') actor.respawnTimer = 1;
    if (kind === 'flight') actor.isLunging = true;
    if (kind === 'jumping') actor.isJumping = true;
    if (kind === 'height') actor.pos.y = 1;
    if (kind === 'vertical') actor.vel.y = -1;
    if (kind === 'dash') actor.dashRemaining = .2;
    if (kind === 'slide') actor.slideActive = true;
    if (kind === 'inactive') state.match.phase = 'countdown';
    if (kind === 'jump-request') actions.walker.jump = true;
    if (kind === 'dash-request') actions.walker.dash = true;
    const before = structuredClone(state);
    assert.throws(() => stepSimulation(state, actions, { settings, scriptedObjective: input }), /[Ss]cripted|Unsupported/);
    assert.deepEqual(state, before);
  });
