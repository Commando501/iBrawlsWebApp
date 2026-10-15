import { createBotParityFixture } from './grifballBotExecutionParity';
import { parityRecorder } from './grifballMultiActorParity';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { handlePointerPlayerActionInputForState, handlePointerPlayerActionReleaseForState } from '../../src/components/grifball/playerInputRuntime';
import { triggerPlayerHammerMeleeForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { setGrifballCarrierForState, updateGrifballObjectiveForState, throwPlayerGrifballPassForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import { attachBallTo } from '../../src/game/grifballBall';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';
import { idleAction } from '../../src/sim/actions';
import type { SimState } from '../../src/sim/simState';

const noop = () => {};
const KINDS = ['moving-release', 'overcharge', 'turn-release', 'disabled', 'disable-reenable', 'pickup-held', 'pickup-repress', 'score-charging'] as const;
export interface PassInputCase { kind: typeof KINDS[number]; mirror: boolean; sideways: boolean; chargeMax: number }
export const PASS_INPUT_CASES: PassInputCase[] = KINDS.flatMap(kind => [false, true].flatMap(mirror => [false, true].flatMap(sideways =>
  [.2, .5].map(chargeMax => ({ kind, mirror, sideways, chargeMax })))));

/** Pointer edges sampled before the actual live frame. Roster decisions, attacks
 * against the runner and other input devices are outside this trace family. */
export function runPassInputTrace(spec: PassInputCase, snapshotAt?: number) {
  const f = createBotParityFixture('unused', false), { state, sim, refs, map } = f;
  const player = sim.combatants[0]; player.id = 'player'; player.controller = 'remote';
  sim.combatants = [player]; state.otherPlayers.clear(); refs.otherPlayerMeshes.clear();
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = player.id;
  player.team = state.localPlayerTeam = spec.mirror ? 'red' : 'blue';
  Object.assign(state.settings, { grifballChargeMax: spec.chargeMax, grifballAllowThrowing: spec.kind !== 'disabled',
    grifballRoundResetDelay: 10, grifballRunnerHealth: 3 }); Object.assign(sim.settings, state.settings);
  state.grifballTactics = defaultGrifballTactics(); sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
  const pickup = spec.kind.startsWith('pickup');
  player.pos = { x: 0, y: 0, z: 0 }; player.vel = { x: 0, y: 0, z: 0 }; player.yaw = spec.mirror ? Math.PI : 0;
  state.playerPos.set(0, 0, 0); state.playerVel.set(0, 0, 0); state.yaw = player.yaw + Math.PI;
  player.weapon = state.activeWeapon = 'hammer'; player.weaponReadyTimer = player.invulnerabilityTimer = 0;
  player.hp = player.maxHp = state.playerHP = state.playerMaxHP = 1;
  state.playerRespawnTimer = state.playerInvulnerabilityTimer = state.swapCooldownTimer = state.swapLockoutTimer = 0;
  state.pWeaponState = state.pSwordState = 'ready'; state.pWeaponTimer = state.pSwordTimer = 0; state.pWeaponReady = true;
  if (!pickup) { attachBallTo(state.grifball.ball, 'player'); attachBallTo(sim.match.ball, 'player');
    setGrifballCarrierForState({ state, id: 'player', carrying: true }); setSimCarrier(player, true, sim.settings, sim); }
  if (spec.kind === 'score-charging') {
    const plate = sim.goalPlates.find(p => p.team !== player.team)!;
    player.pos = { ...plate.position, y: 0 }; state.playerPos.set(player.pos.x, 0, player.pos.z);
  }
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const random = seededRandom(211), record = parityRecorder(), frames = [];
  let previousHeld = false, restored: SimState | undefined, releases = 0;
  const keybindings = { ...DEFAULT_KEYBINDINGS, altAttack: 'rmb' };
  const callbacks = { triggerPlayerHammerSwing: noop, triggerPlayerPistolFire: noop, triggerPlayerSwordSlash: noop, triggerPlayerSwordLunge: noop,
    triggerPlayerHammerMelee: () => triggerPlayerHammerMeleeForState({ state, playSwing: noop, sendSync: noop }) };
  for (let tick = 1; tick <= 120; tick++) {
    if (spec.kind === 'disable-reenable') {
      state.settings.grifballAllowThrowing = sim.settings.grifballAllowThrowing = !(tick >= 5 && tick < 10);
      if (restored) restored.settings.grifballAllowThrowing = sim.settings.grifballAllowThrowing;
    }
    const held = spec.kind === 'pickup-repress' ? tick <= 5 || tick >= 8 && tick <= 20 : tick <= (spec.kind === 'overcharge' ? 80 : 20);
    const moving = !['pickup-held', 'pickup-repress', 'score-charging'].includes(spec.kind);
    const action = { ...idleAction(), aim: (spec.mirror ? Math.PI : 0) + (spec.kind === 'turn-release' && tick >= 21 ? Math.PI / 2 : 0),
      moveX: moving && spec.sideways ? .5 : 0, moveZ: moving && !spec.sideways ? .5 : 0, attackSecondary: held, pickup: pickup && tick === 2 };
    withSimulationRandom(random, tick / 60, () => {
      state.yaw = action.aim + Math.PI;
      if (held && !previousHeld) handlePointerPlayerActionInputForState({ state, button: 2, keybindings, ballChargingRef, ballChargeTimerRef, callbacks });
      if (!held && previousHeld) handlePointerPlayerActionReleaseForState({ button: 2, keybindings, ballChargingRef,
        throwPlayerPass: () => throwPlayerGrifballPassForState({ state, refs, ballChargingRef, ballChargeTimerRef, playSwing: () => { releases++; } }) });
      state.playerPickupRequested = action.pickup;
      advanceGrifballFrameForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: 1 / 60,
        isPlaying: true, isPausedRef: { current: false }, replayData: null, keysPressed: { current: {} }, grifbHoldTimerRef: { current: 0 },
        secretAudioRef: { current: null }, isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
        replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
        spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
        updatePhysics: dt => {
          updatePlayerHorizontalMovementForState({ state, refs, dt, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
            actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: { x: -action.moveX, y: action.moveZ }, mobileControlsActive: true,
            sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
          updatePlayerVerticalIntegrationForState({ state, dt, gravityAcceleration: 18, constrainCombatantToArena: (pos, vel) =>
            constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }) });
        }, updateHammerAnimations: f.weaponFrame, runAIOrchestrator: noop, updateAI: noop,
        updateGrifball: dt => updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
          isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => { throw new Error('Trace must stop before reset'); }, pushStatsUpdate: noop }),
        updateCharacterSkeletalAnimations: noop, updateMatchTimers: noop, enforceArenaBounds: noop, renderGame: noop,
        updateFloatingNameplate: noop, pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop, playRespawn: noop });
    });
    previousHeld = held;
    const events = stepSimulation(sim, { player: action }, { settings: sim.settings });
    if (restored) { const replay = stepSimulation(restored, { player: action }, { settings: restored.settings });
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim)); record.compare(tick, 'snapshot.events', JSON.stringify(replay), JSON.stringify(events)); }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    const live = { ball: structuredClone(state.grifball.ball), phase: state.grifball.phase, pos: state.playerPos.toArray(), vel: state.playerVel.toArray(),
      hp: state.playerHP, weapon: state.activeWeapon, charging: ballChargingRef.current, charge: ballChargeTimerRef.current, displayedCharge: state.grifballPassCharge };
    const headless = { ball: structuredClone(sim.match.ball), phase: sim.match.phase, pos: Object.values(player.pos), vel: Object.values(player.vel),
      hp: player.hp, weapon: player.weapon, charging: !!player.passCharging, charge: player.passChargeTimer,
      displayedCharge: player.passCharging ? Math.min(1, player.passChargeTimer / spec.chargeMax) : 0 };
    const compare = (path: string, a: unknown, b: unknown) => {
      if (a && typeof a === 'object') for (const key of Object.keys(a)) compare(`${path}.${key}`, (a as Record<string, unknown>)[key], (b as Record<string, unknown>)?.[key]);
      else record.compare(tick, path, a, b, typeof a === 'number' ? 1e-6 : 0);
    };
    compare('frame', live, headless); frames.push({ tick, live, headless });
  }
  const shouldRelease = !['disabled', 'disable-reenable', 'pickup-held', 'score-charging'].includes(spec.kind);
  record.compare(120, 'expected.releaseCount', releases, shouldRelease ? 1 : 0);
  for (const side of ['live', 'headless'] as const) {
    if (shouldRelease) record.compare(spec.kind === 'overcharge' ? 81 : 21, `expected.${side}.released`, frames[spec.kind === 'overcharge' ? 80 : 20][side].ball.state, 'thrown');
    if (shouldRelease) {
      const releaseIndex = spec.kind === 'overcharge' ? 80 : 20;
      const released = frames[releaseIndex][side], before = frames[releaseIndex - 1][side];
      for (const [axis, index] of [['x', 0], ['z', 2]] as const) record.compare(releaseIndex + 1,
        `expected.${side}.preMovementOrigin.${axis}`, released.ball.pos[axis] - released.ball.vel[axis] / 60, before.pos[index], 1e-6);
    }
    if (['disabled', 'disable-reenable', 'pickup-held'].includes(spec.kind)) record.compare(120, `expected.${side}.retained`, frames[119][side].ball.holderId, 'player');
    if (spec.kind === 'score-charging') { record.compare(1, `expected.${side}.goal`, frames[0][side].phase, 'scored'); record.compare(1, `expected.${side}.chargeCancelled`, frames[0][side].charging, false);
      record.compare(1, `expected.${side}.displayCleared`, frames[0][side].displayedCharge, 0); }
  }
  return { name: JSON.stringify(spec), ticks: 120, ...record.result(), frames };
}
export const runPassInputParity = () => PASS_INPUT_CASES.map(c => runPassInputTrace(c));
