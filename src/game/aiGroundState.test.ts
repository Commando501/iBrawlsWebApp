import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveAIGroundState, type AIGroundStateInput } from './aiGroundState';
import { resolveBehaviorTuning } from './aiBehaviorTuning';
import { NEUTRAL_MATCH_MULTIPLIERS } from './aiTuning';
import { withSimulationRandom } from './simulationRandom';
import { shouldStartAISlide } from './aiMovementMechanics';
import { createMatch } from '../sim/factory';

// Optional extraction audit against the unmodified committed live block. The
// production test command uses only the enduring independent behavior oracles.
const referencePath = '../../output/ground-fsm-reference';
const reference = process.env.M7_GROUND_REFERENCE
  ? (await import(referencePath)).resolveAIGroundState : undefined;
type Fixture = ReturnType<typeof fixture>;
type Case = { name: string; setup: (f: Fixture) => void; state: string; events?: string[];
  forward?: number; timer?: number; draws?: number; check?: (f: Fixture) => void };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function fixture(id: string, sign: number, dt: number) {
  const settings = createMatch({ seed: 5, teamSizes: { blue: 1, red: 1 } }).settings;
  Object.assign(settings, { enableSlide: false, speedForward: 100, speedBackward: 100, speedSide: 100,
    speedSlide: 100, dashDuration: .25, dashCooldown: 2 });
  const events: { kind: string; pos: number[] }[] = [];
  const rolls: number[] = [];
  let draws = 0, feint = false, jump = false, coordBlocked = false, targetCooldown = false;
  const record = (kind: string) => events.push({ kind, pos: input.frame.pos.toArray() });
  const input: AIGroundStateInput = {
    settings, frame: { pos: new THREE.Vector3(), vel: new THREE.Vector3(0, .7, 0), dashDir: new THREE.Vector3(),
      aiState: 'APPROACHING', timer: 1, weaponState: 'ready', dashRemaining: 0, dashCooldownTimer: 2,
      slideActive: false, slideDistanceTraveled: 0, slideCooldownTimer: 0, isSprinting: false },
    target: { id: 'target', hp: 20, invulnerabilityTimer: 0, weaponState: 'ready' },
    botId: id, botHP: 20, pressureTargetId: 'target', distanceToTarget: 12, attackDistanceToTarget: 12,
    resolvedDangerZone: 3, resolvedAiReach: 3, guaranteedKillRange: 3, maxLungeRange: 10,
    minLungeRange: 4, stationarySwingReach: 3, activeWeapon: 'hammer', canStartWeaponAction: true,
    targetIsProtected: false, difficulty: 'normal', movementComplexity: 80, playstyleFactor: 1,
    tunedAnticipationFactor: .5, effectiveReactionLatency: .1, effectivePressureAggression: 50,
    cooldownMult: 1, dt, swayTimer: 1, savedVelY: .7, lookHeading: new THREE.Vector3(0, 0, sign),
    spatialLookHeading: new THREE.Vector3(0, 0, sign), sidewayHeading: new THREE.Vector3(-sign, 0, 0),
    spatialBias: { aggressionMult: 1 }, totalApproachLateral: 0, sprintMult: 1, isCrouching: false,
    feintChance: 0, feintLungeFakeout: false, psychEnabled: false, psychState: { standoffTimer: 1 },
    matchMultipliers: { ...NEUTRAL_MATCH_MULTIPLIERS }, tuning: resolveBehaviorTuning(settings),
    startOffensiveHammerJump: () => { record('jump'); if (jump) input.frame.vel.y = 15; return jump; },
    playDash: () => record('dash'), tryFeintRoll: () => { record('feint-roll'); return feint; },
    commitFeint: () => record('feint'), isTargetOnCooldown: () => { record('target-cooldown'); return targetCooldown; },
    isCoordAttackBlocked: () => { record('coordinator'); return coordBlocked; },
    clearPressureTarget: bot => { assert.equal(bot, id); record('clear-pressure'); },
    triggerCombatantAttack: weapon => record(`attack-${weapon}`), random: () => rolls[draws++] ?? .99,
  };
  return { input, events, rolls, sign, dt, record, draws: () => draws,
    setDraws: (value: number) => { draws = value; },
    setFeint: () => { feint = true; }, setJump: () => { jump = true; },
    block: () => { coordBlocked = true; }, cooldown: () => { targetCooldown = true; } };
}
const state = (f: Fixture, value: AIGroundStateInput['frame']['aiState']) => { f.input.frame.aiState = value; };
const distance = (f: Fixture, value: number) => { f.input.distanceToTarget = f.input.attackDistanceToTarget = value; };
const cases: Case[] = [
  { name: 'approach walks', setup: () => {}, state: 'APPROACHING', forward: 4, draws: 0 },
  { name: 'approach sprint and lateral', setup: f => { f.input.sprintMult = 1.5; f.input.totalApproachLateral = 2; },
    state: 'APPROACHING', forward: 6, check: f => close(f.input.frame.pos.x, -f.sign * 1.8 * f.dt) },
  { name: 'approach enters sidestep', setup: f => distance(f, 4), state: 'SIDE_STEPPING', forward: 4, timer: .993, draws: 1 },
  { name: 'slide starts lazily', setup: f => { f.input.settings.enableSlide = true; f.rolls.push(0); },
    state: 'APPROACHING', forward: 5.8, events: ['dash'], draws: 1,
    check: f => { assert.equal(f.input.frame.slideActive, true); close(f.input.frame.slideDistanceTraveled, 5.8 * f.dt); } },
  { name: 'slide finishes distance', setup: f => { f.input.frame.slideActive = true; f.input.settings.enableSlide = true;
    f.input.settings.slideDistance = .01; }, state: 'APPROACHING', forward: 5.8,
    check: f => { assert.equal(f.input.frame.slideActive, false); close(f.input.frame.slideCooldownTimer, f.input.settings.slideCooldown ?? 1.5); } },
  { name: 'disabled active slide spends final travel', setup: f => { f.input.frame.slideActive = true; },
    state: 'APPROACHING', forward: 5.8, check: f => assert.equal(f.input.frame.slideActive, false) },
  { name: 'slide closes into sidestep', setup: f => { f.input.frame.slideActive = true; f.input.settings.enableSlide = true; distance(f, 4); },
    state: 'SIDE_STEPPING', forward: 5.8, timer: .993 },
  { name: 'sidestep closes to own hammer reach', setup: f => { state(f, 'SIDE_STEPPING'); distance(f, 4); },
    state: 'SIDE_STEPPING', forward: .525, check: f => close(f.input.frame.pos.x, -f.sign * 3.2 * f.dt) },
  { name: 'sidestep retreats inside sword band', setup: f => { state(f, 'SIDE_STEPPING'); distance(f, 6); f.input.activeWeapon = 'sword'; },
    state: 'SIDE_STEPPING', forward: -.675 },
  { name: 'crouched sidestep', setup: f => { state(f, 'SIDE_STEPPING'); distance(f, 2); f.input.isCrouching = true; },
    state: 'SIDE_STEPPING', forward: -.30375 },
  { name: 'random side dash defers travel', setup: f => { state(f, 'SIDE_STEPPING'); distance(f, 2); f.input.frame.dashCooldownTimer = 0; f.rolls.push(0, .9); },
    state: 'SIDE_STEPPING', forward: -.675, draws: 2, events: ['dash'],
    check: f => { close(f.input.frame.dashRemaining!, .25); close(f.input.frame.dashDir.x, -f.sign); } },
  { name: 'sidestep reacts to attack', setup: f => { state(f, 'SIDE_STEPPING'); f.input.target.weaponState = 'swing_up'; f.rolls.push(0); },
    state: 'DANCING_BACKWARD', forward: .525, timer: .45, draws: 1 },
  { name: 'sidestep trade avoidance skips reaction draw', setup: f => { state(f, 'SIDE_STEPPING'); f.input.target.weaponState = 'swing_up';
    f.input.difficulty = 'hard'; f.input.matchMultipliers.avoidCoinFlipTrades = true; }, state: 'DANCING_BACKWARD', timer: .45, draws: 0 },
  { name: 'shield overrides sidestep timeout', setup: f => { state(f, 'SIDE_STEPPING'); f.input.targetIsProtected = true; f.input.frame.timer = -1; },
    state: 'DANCING_BACKWARD', timer: .5, draws: 0 },
  { name: 'standoff forces charge and clears memory', setup: f => { state(f, 'SIDE_STEPPING'); f.input.frame.timer = -1; f.input.psychEnabled = true; f.rolls.push(0); },
    state: 'CHARGE_ATTACK', draws: 1, check: f => assert.equal(f.input.psychState.standoffTimer, 0) },
  { name: 'expired sidestep close target charges', setup: f => { state(f, 'SIDE_STEPPING'); distance(f, 2); f.input.frame.timer = 0; }, state: 'CHARGE_ATTACK', draws: 0 },
  { name: 'expired sidestep distant target advances', setup: f => { state(f, 'SIDE_STEPPING'); f.input.frame.timer = 0; }, state: 'DANCING_FORWARD', timer: .745, draws: 1 },
  { name: 'forward feint retreats', setup: f => { state(f, 'DANCING_FORWARD'); f.input.feintChance = 100; f.setFeint(); },
    state: 'DANCING_BACKWARD', forward: -6.2, timer: .55, events: ['feint-roll', 'feint'] },
  { name: 'declined forward feint advances', setup: f => { state(f, 'DANCING_FORWARD'); f.input.feintChance = 100; },
    state: 'DANCING_FORWARD', forward: 5, events: ['feint-roll'] },
  { name: 'lunge fakeout movement', setup: f => { state(f, 'DANCING_FORWARD'); f.input.feintLungeFakeout = true; }, state: 'DANCING_FORWARD', forward: 6.2 },
  { name: 'forward reacts and selects backward dash', setup: f => { state(f, 'DANCING_FORWARD'); f.input.target.weaponState = 'swing_up'; f.input.frame.dashCooldownTimer = 0; f.rolls.push(0); },
    state: 'DANCING_BACKWARD', forward: 5, timer: .65, events: ['dash'], draws: 1, check: f => close(f.input.frame.dashDir.z, -f.sign) },
  { name: 'forward enters charge', setup: f => { state(f, 'DANCING_FORWARD'); distance(f, 2); }, state: 'CHARGE_ATTACK', forward: 5 },
  { name: 'forward timeout overrides charge', setup: f => { state(f, 'DANCING_FORWARD'); distance(f, 2); f.input.frame.timer = 0; }, state: 'SIDE_STEPPING', timer: .993 },
  { name: 'forward shield retreats', setup: f => { state(f, 'DANCING_FORWARD'); f.input.targetIsProtected = true; }, state: 'DANCING_BACKWARD', timer: .5 },
  { name: 'retreat exploits recovery', setup: f => { state(f, 'DANCING_BACKWARD'); distance(f, 4); f.input.target.weaponState = 'recovering'; }, state: 'CHARGE_ATTACK', forward: -6.2 },
  { name: 'retreat expiry overrides recovery charge', setup: f => { state(f, 'DANCING_BACKWARD'); distance(f, 4); f.input.target.weaponState = 'recovering'; f.input.frame.timer = 0; }, state: 'SIDE_STEPPING', timer: .4 },
  { name: 'charge feint selects dash without travel', setup: f => { state(f, 'CHARGE_ATTACK'); f.input.target.weaponState = 'swing_up';
    f.input.feintChance = 100; f.input.frame.dashCooldownTimer = 0; f.setFeint(); }, state: 'SIDE_STEPPING', forward: 0, timer: .35,
    events: ['feint-roll', 'dash', 'feint'] },
  { name: 'charge commits after movement', setup: f => { state(f, 'CHARGE_ATTACK'); distance(f, 2); }, state: 'COOLDOWN', forward: 6.5,
    events: ['coordinator', 'target-cooldown', 'attack-hammer'], check: f => { close(f.events.at(-1)!.pos[2], 6.5 * f.sign * f.dt); assert.equal(f.input.frame.weaponState, 'ready'); } },
  { name: 'charge sword commits', setup: f => { state(f, 'CHARGE_ATTACK'); distance(f, 2); f.input.activeWeapon = 'sword'; }, state: 'COOLDOWN', events: ['coordinator', 'target-cooldown', 'attack-sword'] },
  { name: 'coordinator refuses charge', setup: f => { state(f, 'CHARGE_ATTACK'); distance(f, 2); f.block(); }, state: 'SIDE_STEPPING', timer: .25, events: ['coordinator'] },
  { name: 'charge avoids swing trade', setup: f => { state(f, 'CHARGE_ATTACK'); distance(f, 2); f.input.difficulty = 'hard';
    f.input.matchMultipliers.avoidCoinFlipTrades = true; f.input.target.weaponState = 'swing_down'; }, state: 'DANCING_BACKWARD', timer: .6, events: ['coordinator', 'target-cooldown'] },
  { name: 'charge dash starts but walks this frame', setup: f => { state(f, 'CHARGE_ATTACK'); f.input.frame.dashCooldownTimer = 0; },
    state: 'SIDE_STEPPING', forward: 6.5, timer: .4, events: ['dash'], check: f => close(f.input.frame.dashRemaining!, .25) },
  { name: 'pressure re-swings and updates cached readiness', setup: f => { state(f, 'PRESSURING'); distance(f, 2); }, state: 'PRESSURING', forward: 8,
    events: ['coordinator', 'attack-hammer'], check: f => assert.equal(f.input.frame.weaponState, 'swing_up') },
  { name: 'pressure blocked attack still approaches', setup: f => { state(f, 'PRESSURING'); distance(f, 2); f.block(); }, state: 'PRESSURING', forward: 8, events: ['coordinator'] },
  { name: 'pressure recovering slows', setup: f => { state(f, 'PRESSURING'); f.input.frame.weaponState = 'recovering'; }, state: 'PRESSURING', forward: 4.4 },
  { name: 'pressure dash selection', setup: f => { state(f, 'PRESSURING'); f.input.frame.dashCooldownTimer = 0; f.rolls.push(0); }, state: 'PRESSURING', forward: 8, draws: 1, events: ['dash'] },
  ...['dead', 'shield', 'lock', 'timer', 'distance'].map(reason => ({ name: `pressure exits ${reason}`, setup: (f: Fixture) => {
    state(f, 'PRESSURING'); if (reason === 'dead') f.input.target.hp = 0;
    if (reason === 'shield') f.input.target.invulnerabilityTimer = 1;
    if (reason === 'lock') f.input.pressureTargetId = 'other';
    if (reason === 'timer') f.input.frame.timer = 0;
    if (reason === 'distance') distance(f, 20);
  }, state: 'SIDE_STEPPING', forward: 0, timer: .35, events: ['clear-pressure'] })),
  { name: 'cooldown crouch retreat', setup: f => { state(f, 'COOLDOWN'); f.input.isCrouching = true; }, state: 'COOLDOWN', forward: -.675, timer: 1, draws: 0 },
  { name: 'cooldown expiry after movement', setup: f => { state(f, 'COOLDOWN'); f.input.frame.timer = 0; }, state: 'SIDE_STEPPING', forward: -1.5, timer: .7 },
  { name: 'opportunistic jump precedes ground state', setup: f => { distance(f, 7); f.rolls.push(0); f.setJump(); },
    state: 'APPROACHING', forward: 4, events: ['jump'], draws: 1, check: f => assert.equal(f.input.frame.weaponState, 'swing_up') },
  { name: 'low complexity still consumes preceding jump draw', setup: f => { distance(f, 7); f.rolls.push(0); f.input.movementComplexity = 10; }, state: 'APPROACHING', draws: 1 },
  { name: 'protected target still consumes preceding jump draw', setup: f => { distance(f, 7); f.rolls.push(0); f.input.targetIsProtected = true; }, state: 'APPROACHING', draws: 1 },
];
const snapshot = (f: Fixture) => ({ frame: { ...f.input.frame, pos: f.input.frame.pos.toArray(), vel: f.input.frame.vel.toArray(), dashDir: f.input.frame.dashDir.toArray() },
  psych: { ...f.input.psychState }, events: structuredClone(f.events), draws: f.draws() });
for (const id of ['main_ai', 'ordinary']) for (const sign of [-1, 1]) for (const dt of [1 / 60, 1 / 30]) for (const c of cases)
  test(`ground FSM ${id}/${sign}/${dt}/${c.name}`, () => {
    const f = fixture(id, sign, dt); c.setup(f);
    // No hidden consumption from global RNG is permitted when a caller stream exists.
    withSimulationRandom(() => { throw new Error('Unexpected global draw'); }, 0, () => resolveAIGroundState(f.input));
    assert.equal(f.input.frame.aiState, c.state);
    assert.deepEqual(f.events.map(e => e.kind), c.events ?? []);
    if (c.timer !== undefined) close(f.input.frame.timer!, c.timer);
    if (c.forward !== undefined) close(f.input.frame.pos.z, sign * dt * c.forward);
    if (c.draws !== undefined) assert.equal(f.draws(), c.draws);
    close(f.input.frame.vel.y, .7); // saved before ground movement, including a newly selected jump
    c.check?.(f);
    if (reference) {
      const old = fixture(id, sign, dt); c.setup(old);
      withSimulationRandom(old.input.random!, 0, () => reference(old.input));
      assert.deepEqual(snapshot(f), snapshot(old));
    }
    const fallback = fixture(id, sign, dt); c.setup(fallback);
    const random = fallback.input.random!; delete fallback.input.random;
    withSimulationRandom(random, 0, () => resolveAIGroundState(fallback.input));
    assert.deepEqual(snapshot(f), snapshot(fallback));
  });

test('slide eligibility draws lazily, and explicit numeric rng takes precedence', () => {
  const input = { enableSlide: false, slideCooldownRemaining: 0, state: 'APPROACHING', distanceToTarget: 12,
    engageRange: 3, movementComplexity: 80, isDashing: false, isSliding: false, targetProtected: false,
    random: () => { throw new Error('ineligible or explicit roll must not draw'); } };
  assert.equal(shouldStartAISlide(input), false);
  assert.equal(shouldStartAISlide({ ...input, enableSlide: true, rng: 0 }), true);
  assert.equal(shouldStartAISlide({ ...input, enableSlide: true, slideCooldownRemaining: 1 }), false);
});
