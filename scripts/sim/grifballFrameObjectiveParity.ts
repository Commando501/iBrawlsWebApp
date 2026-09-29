import { lungeFixture } from './grifballLungeFixture';
import { parityRecorder } from './grifballMultiActorParity';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { updateGrifballObjectiveForState, setGrifballCarrierForState, throwPlayerGrifballPassForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { handlePointerPlayerActionInputForState, handlePointerPlayerActionReleaseForState } from '../../src/components/grifball/playerInputRuntime';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { attachBallTo } from '../../src/game/grifballBall';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { idleAction } from '../../src/sim/actions';
import type { SimState } from '../../src/sim/simState';

const noop = () => {};
export interface FrameObjectiveCase { player: boolean; lunge: boolean; goal: boolean; hp: number; reverse: boolean; mirror: boolean }
export const FRAME_OBJECTIVE_CASES: FrameObjectiveCase[] = [false, true].flatMap(player => [false, true].flatMap(lunge =>
  [false, true].flatMap(goal => [1, 2].flatMap(hp => [false, true].flatMap(reverse => [false, true].map(mirror => ({ player, lunge, goal, hp, reverse, mirror })))))));

/** Actual frame coordinator owns objective-before-skeletal-melee ordering and final
 * carrier reconciliation. Attack commitments are authored; no AI policy is certified. */
export interface ChargeCombatCase { releaseAt: number | null; shield: boolean; moving: boolean; recovery?: 'hold' | 'repress' }
export function runFrameObjectiveTrace(spec: FrameObjectiveCase, snapshotAt?: number, charge?: ChargeCombatCase) {
  const f = lungeFixture('attacker', false), { state, sim, bot, target, refs, map } = f;
  const [attacker, runner] = sim.combatants;
  attacker.id = bot.id; attacker.controller = 'ai'; runner.id = target.id;
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
  const player = spec.player ? runner : { ...structuredClone(runner), id: 'player', controller: 'remote' as const };
  if (spec.player) { runner.id = 'player'; state.otherPlayers.delete(target.id); refs.otherPlayerMeshes.delete(target.id); }
  else sim.combatants.push(player);
  player.controller = 'remote';
  attacker.team = bot.team = spec.mirror ? 'red' : 'blue';
  runner.team = target.team = player.team = state.localPlayerTeam = spec.mirror ? 'blue' : 'red';
  state.grifballTactics = defaultGrifballTactics();
  Object.assign(state.settings, { grifballRunnerHealth: spec.hp, grifballRunnerHealRate: 0, grifballRoundResetDelay: 10,
    enableSwordTrade: false, enableHammerSwordTrade: false, respawnInvulnerabilityDuration: 0, swordSlashSpeed: .02 });
  Object.assign(sim.settings, state.settings);
  sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
  const direction = spec.mirror ? -1 : 1;
  const plate = sim.goalPlates.find(p => p.team === attacker.team)!;
  const position = spec.goal ? { ...plate.position, y: 0 } : { x: 0, y: 0, z: 0 };
  runner.pos = { ...position }; target.pos.set(position.x, 0, position.z);
  attacker.pos = { x: position.x, y: 0, z: position.z - direction * 1.5 }; bot.pos.set(attacker.pos.x, 0, attacker.pos.z);
  attacker.yaw = spec.mirror ? Math.PI : 0; bot.yaw = attacker.yaw + Math.PI;
  if (!spec.player) player.pos = { x: 20, y: 0, z: 0 };
  state.playerPos.set(player.pos.x, 0, player.pos.z); state.playerVel.set(0, 0, 0); state.yaw = player.yaw + Math.PI;
  for (const c of sim.combatants) { c.vel = { x: 0, y: 0, z: 0 }; c.hp = c.maxHp = 1; c.weaponReadyTimer = c.invulnerabilityTimer = 0; c.weapon = 'hammer'; }
  state.playerHP = state.playerMaxHP = 1; state.playerInvulnerabilityTimer = state.playerRespawnTimer = 0;
  state.pWeaponState = state.pSwordState = 'ready'; state.pWeaponTimer = state.pSwordTimer = 0;
  state.activeWeapon = 'hammer'; state.swapCooldownTimer = state.swapLockoutTimer = 0;
  attacker.weapon = bot.activeWeapon = 'sword';
  bot.hp = bot.maxHp = 1; target.hp = target.maxHp = 1;
  attachBallTo(state.grifball.ball, runner.id); attachBallTo(sim.match.ball, runner.id);
  setGrifballCarrierForState({ state, id: runner.id, carrying: true }); setSimCarrier(runner, true, sim.settings, sim);
  // Lunge contact occurs in updateAI; a short slash impacts in skeletal animation on tick 1.
  attacker.lungeTargetId = runner.id; attacker.lungeAimDirection = { x: 0, y: 0, z: direction };
  bot.lungeTargetDir = { x: 0, y: 0, z: direction };
  const random = seededRandom(181);
  withSimulationRandom(random, 0, () => {
    if (!spec.lunge) { bot.isLunging = false; bot.aiState = 'APPROACHING'; bot.weaponState = 'ready'; }
    else {
      triggerCombatantLungeAction({ self: bot, settings: state.settings, lungeDir: bot.pos.clone().set(0, 0, direction), pos: bot.pos, vel: bot.vel, playDash: noop });
      stepCombatantWeapons(sim, attacker, { ...idleAction(), attackSecondary: true }, sim.settings, 0, []);
    }
  });
  if (spec.reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const record = parityRecorder(), frames = []; let restored: SimState | undefined, notifications = 0, releases = 0;
  let previousHeld = !!charge;
  const passBindings = { ...DEFAULT_KEYBINDINGS, altAttack: 'rmb' };
  if (charge) {
    if (!spec.player || spec.goal) throw new Error('Charge combat requires an off-goal player runner');
    handlePointerPlayerActionInputForState({ state, button: 2, keybindings: passBindings, ballChargingRef, ballChargeTimerRef,
      callbacks: { triggerPlayerHammerSwing: noop, triggerPlayerHammerMelee: noop, triggerPlayerPistolFire: noop, triggerPlayerSwordSlash: noop, triggerPlayerSwordLunge: noop } });
    // A pre-existing held charge at the starting checkpoint; both engines then advance independently.
    ballChargeTimerRef.current = player.passChargeTimer = .2; player.passCharging = player.passInputHeld = true;
    state.grifballPassCharge = .2 / (state.settings.grifballChargeMax ?? 1.2);
    state.playerInvulnerabilityTimer = player.invulnerabilityTimer = charge.shield ? 10 : 0;
    if (charge.recovery) {
      map.teamSpawns = { ...map.teamSpawns, [player.team]: [{ x: 0, y: 0, z: 0 }] };
      sim.spawns[player.team] = [{ x: 0, y: 0, z: 0 }];
      state.settings.grifballBallReturnTimeout = sim.settings.grifballBallReturnTimeout = .25;
    }
  }
  const ticks = charge ? 240 : 120;
  for (let tick = 1; tick <= ticks; tick++) {
    const held = charge?.recovery === 'repress' ? tick !== 187 && tick < 201 : !!charge && (charge.releaseAt === null || tick < charge.releaseAt);
    const moveX = charge?.moving ? .25 : 0;
    const aim = spec.mirror ? Math.PI : 0;
    // Request recovery continuously: late melee cannot be picked up until the next objective tick.
    bot.pickupRequested = !charge?.recovery;
    state.playerPickupRequested = !!charge?.recovery && tick === 183;
    withSimulationRandom(random, tick / 60, () => {
      if (charge) state.yaw = aim + Math.PI;
      if (charge && !previousHeld && held) handlePointerPlayerActionInputForState({ state, button: 2, keybindings: passBindings, ballChargingRef, ballChargeTimerRef,
        callbacks: { triggerPlayerHammerSwing: noop, triggerPlayerHammerMelee: noop, triggerPlayerPistolFire: noop, triggerPlayerSwordSlash: noop, triggerPlayerSwordLunge: noop } });
      if (charge && previousHeld && !held) handlePointerPlayerActionReleaseForState({ button: 2, keybindings: passBindings, ballChargingRef,
        throwPlayerPass: () => throwPlayerGrifballPassForState({ state, refs, ballChargingRef, ballChargeTimerRef, playSwing: () => { releases++; } }) });
      advanceGrifballFrameForState({
      state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: 1 / 60, isPlaying: true,
      isPausedRef: { current: false }, replayData: null, keysPressed: { current: {} }, grifbHoldTimerRef: { current: 0 },
      secretAudioRef: { current: null }, isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
      replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
      spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
      updatePhysics: dt => {
        if (!updatePlayerRespawnForState({ state, dt, isMultiplayer: false, getMainAi: () => undefined, activeCustomMap: map, spawnPoints: [], playRespawn: noop })) {
          updatePlayerHorizontalMovementForState({ state, refs, dt, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
            actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: charge ? { x: -moveX, y: 0 } : null, mobileControlsActive: !!charge,
            sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
          updatePlayerVerticalIntegrationForState({ state, dt, gravityAcceleration: 18, constrainCombatantToArena: (pos, vel) =>
            constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }) });
        }
      }, updateHammerAnimations: f.weaponFrame, runAIOrchestrator: f.respawns,
      updateAI: dt => {
        for (const c of state.otherPlayers.values()) if (c.hp > 0) tickCombatantInvulnerability(c, dt);
        if (tick === 1 && !spec.lunge) f.attack();
        if (bot.hp > 0 && bot.isLunging) f.flightFor(bot, spec.player ? { ...target, id: 'player', hp: state.playerHP,
          pos: state.playerPos, vel: state.playerVel, team: state.localPlayerTeam, invulnerabilityTimer: state.playerInvulnerabilityTimer,
          activeWeapon: state.activeWeapon as 'ball' | 'hammer' } : target, dt);
      },
      updateGrifball: dt => updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef,
        dt, isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => { throw new Error('Trace must stop before reset'); }, pushStatsUpdate: () => { notifications++; } }),
      updateCharacterSkeletalAnimations: f.visuals, updateMatchTimers: noop, enforceArenaBounds: noop,
      renderGame: () => record.compare(tick, 'published.deadCarrier', state.grifball.ball.holderId === runner.id && (spec.player ? state.playerHP : target.hp) <= 0, false),
      updateFloatingNameplate: noop, pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop, playRespawn: noop,
      });
    });
    previousHeld = held;
    const actions = Object.fromEntries(sim.combatants.map(c => [c.id, { ...idleAction(), aim: charge && c === player ? aim : c.yaw,
      pickup: c === attacker ? !charge?.recovery : c === player && !!charge?.recovery && tick === 183,
      moveX: c === player ? moveX : 0, attackSecondary: c === player && held,
      attackPrimary: tick === 1 && !spec.lunge && c === attacker }]));
    const events = stepSimulation(sim, actions, { settings: sim.settings });
    if (restored) { const replay = stepSimulation(restored, actions, { settings: restored.settings });
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim)); record.compare(tick, 'snapshot.events', JSON.stringify(replay), JSON.stringify(events)); }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    const live = { ball: structuredClone(state.grifball.ball), phase: state.grifball.phase, goals: state.teamScores[runner.team].goals,
      hp: spec.player ? state.playerHP : target.hp, maxHp: spec.player ? state.playerMaxHP : target.maxHp,
      respawn: Math.max(0, spec.player ? state.playerRespawnTimer : target.respawnTimer), weapon: spec.player ? state.activeWeapon : target.activeWeapon,
      attackerHp: bot.hp, attackerWeapon: bot.activeWeapon, attackerPos: bot.pos.toArray(), runnerPos: (spec.player ? state.playerPos : target.pos).toArray() };
    const headless = { ball: structuredClone(sim.match.ball), phase: sim.match.phase, goals: sim.scores[runner.team].goals,
      hp: runner.hp, maxHp: runner.maxHp, respawn: runner.respawnTimer, weapon: runner.weapon,
      attackerHp: attacker.hp, attackerWeapon: attacker.weapon, attackerPos: Object.values(attacker.pos), runnerPos: Object.values(runner.pos) };
    const compare = (key: string, a: unknown, b: unknown) => {
      if (a && typeof a === 'object') for (const field of Object.keys(a)) compare(`${key}.${field}`, (a as Record<string, unknown>)[field], (b as Record<string, unknown>)?.[field]);
      else record.compare(tick, key, a, b, typeof a === 'number' ? 1e-6 : 0);
    };
    const liveCharge = { active: ballChargingRef.current, seconds: ballChargeTimerRef.current, display: state.grifballPassCharge };
    const simCharge = { active: !!player.passCharging, seconds: player.passChargeTimer,
      display: player.passCharging ? Math.min(1, player.passChargeTimer / (sim.settings.grifballChargeMax ?? 1.2)) : 0 };
    if (charge) compare('charge', liveCharge, simCharge);
    compare('frame', live, headless); frames.push({ tick, live, headless, events, liveCharge, simCharge });
  }
  if (charge) {
    const releasedBeforeHit = charge.releaseAt === 1;
    const firstHp = charge.shield ? (releasedBeforeHit ? 1 : spec.hp) : releasedBeforeHit ? 0 : spec.hp - 1;
    record.compare(ticks, 'expected.releases', releases, charge.recovery === 'repress' || charge.releaseAt !== null && (releasedBeforeHit || firstHp > 0) ? 1 : 0);
    for (const side of ['live', 'headless'] as const) {
      record.compare(1, `expected.${side}.contactHealth`, frames[0][side].hp, firstHp);
      if (releasedBeforeHit) record.compare(1, `expected.${side}.releasedBallSurvives`, frames[0][side].ball.state, 'thrown');
      if (!firstHp) record.compare(ticks, `expected.${side}.revivedHealth`, frames.at(-1)![side].hp, 1);
      if (charge.recovery) record.compare(183, `expected.${side}.recovered`, frames[182][side].ball.holderId, 'player');
      if (charge.recovery === 'repress') record.compare(201, `expected.${side}.freshRelease`, frames[200][side].ball.state, 'thrown');
    }
    if (!firstHp) for (const side of ['liveCharge', 'simCharge'] as const) {
      record.compare(1, `expected.${side}.deathCancels`, frames[0][side].active, false);
      record.compare(ticks, `expected.${side}.noRevivalCharge`, frames.at(-1)![side].seconds, 0);
      if (charge.recovery) record.compare(183, `expected.${side}.pickupDoesNotRecharge`, frames[182][side].active, false);
      if (charge.recovery === 'repress') record.compare(188, `expected.${side}.freshPressCharges`, frames[187][side].active, true);
    }
    return { name: JSON.stringify({ ...spec, charge }), ticks, ...record.result(), frames };
  }
  for (const side of ['live', 'headless'] as const) {
    record.compare(1, `expected.${side}.goal`, frames[0][side].goals, spec.goal && (!spec.lunge || spec.hp > 1) ? 1 : 0);
    record.compare(1, `expected.${side}.health`, frames[0][side].hp, spec.goal && !spec.lunge ? 0 : spec.hp - 1);
    if (!spec.goal && spec.hp === 1) {
      record.compare(1, `expected.${side}.firstPickup`, frames[0][side].ball.holderId, spec.lunge ? attacker.id : null);
      record.compare(2, `expected.${side}.nextPickup`, frames[1][side].ball.holderId, attacker.id);
    }
  }
  record.compare(120, 'expected.notifications', notifications, spec.goal && (!spec.lunge || spec.hp > 1) ? 1 : 0);
  return { name: JSON.stringify(spec), ticks, ...record.result(), frames };
}
export const runFrameObjectiveParity = () => FRAME_OBJECTIVE_CASES.map(c => runFrameObjectiveTrace(c));
