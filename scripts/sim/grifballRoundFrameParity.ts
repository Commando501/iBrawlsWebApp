import { createBotParityFixture } from './grifballBotExecutionParity';
import { addParityActor, parityRecorder } from './grifballMultiActorParity';
import { stepLiveGroundMotion, groundMotionAction } from './grifballGroundMotion';
import { PREMADE_MAPS } from '../../src/game/premadeMaps';
import { toGrifballArena } from '../../src/game/grifballMaps';
import { getGoalPlates } from '../../src/game/grifballGoals';
import { attachBallTo } from '../../src/game/grifballBall';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import { updateGrifballObjectiveForState, setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { setSimCarrier } from '../../src/sim/grifball';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import type { SimState } from '../../src/sim/simState';
import { DEFAULT_KEYBINDINGS, type CustomMapData } from '../../src/types';

const noop = () => {};
export interface RoundFrameCase { map: CustomMapData; player: boolean; mirror: boolean; reverse: boolean; winner: boolean }
export const ROUND_FRAME_CASES: RoundFrameCase[] = PREMADE_MAPS.map(toGrifballArena).filter(map => getGoalPlates(map).length === 2).flatMap(map => [false, true].flatMap(player =>
  [false, true].flatMap(mirror => [false, true].flatMap(reverse => [false, true].map(winner =>
    ({ map, player, mirror, reverse, winner }))))));

/** Full frame phase ordering with supplied movement commands. No autonomous route or combat selection. */
export function runRoundFrameTrace(spec: RoundFrameCase, snapshotAt?: number) {
  const f = createBotParityFixture('runner', false, { maxHP: 2, grifballRunnerHealth: 3, grifballRunnerHealRate: 0,
    grifballRoundResetDelay: .19, grifballCountdownDuration: .09, grifballGoalTarget: spec.winner ? 1 : 2,
    respawnInvulnerabilityDuration: .5 }, 'injured', spec.map);
  const { state, refs, sim, bot, target, map } = f;
  const [runner, injured] = sim.combatants;
  runner.id = bot.id; injured.id = target.id;
  const team = spec.mirror ? 'red' : 'blue';
  runner.team = bot.team = state.localPlayerTeam = team;
  injured.team = target.team = team === 'blue' ? 'red' : 'blue';
  const player = spec.player ? runner : { ...structuredClone(runner), id: 'player', controller: 'remote' as const };
  if (spec.player) { runner.id = 'player'; state.otherPlayers.delete(bot.id); refs.otherPlayerMeshes.delete(bot.id); }
  else sim.combatants.push(player);
  player.controller = 'remote'; sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
  const [downed, dead] = addParityActor(f, 'downed', team, 8, 5);
  for (const c of sim.combatants) {
    c.controller = c === player ? 'remote' : 'ai';
    c.pos = { x: 0, y: 0, z: 10 }; c.vel = { x: 0, y: 0, z: 0 }; c.yaw = 0;
    c.hp = c.maxHp = 2; c.invulnerabilityTimer = c.weaponReadyTimer = c.respawnTimer = 0;
  }
  injured.hp = target.hp = 1; target.maxHp = 2;
  dead.hp = downed.hp = 0; dead.alive = false; dead.respawnTimer = downed.respawnTimer = .49; downed.maxHp = 2;
  sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match); state.grifballTactics = defaultGrifballTactics();
  state.arenaRadius = map.arenaRadius;
  const plate = sim.goalPlates.find(p => p.team !== team)!;
  const direction = Math.sign(plate.position.x), aim = direction * Math.PI / 2;
  runner.pos = { x: plate.position.x - direction * (plate.halfExtents.x + .5), y: 0, z: plate.position.z };
  for (const c of sim.combatants) {
    const a = state.otherPlayers.get(c.id);
    if (a) { a.pos.set(c.pos.x, c.pos.y, c.pos.z); a.vel.set(0, 0, 0); a.yaw = c.yaw + Math.PI; a.invulnerabilityTimer = 0; }
  }
  state.playerPos.set(player.pos.x, 0, player.pos.z); state.playerVel.set(0, 0, 0); state.yaw = player.yaw + Math.PI;
  state.playerHP = state.playerMaxHP = 2; state.playerRespawnTimer = state.playerInvulnerabilityTimer = 0;
  state.pWeaponState = state.pSwordState = 'ready'; state.pWeaponTimer = state.pSwordTimer = 0;
  state.swapCooldownTimer = state.swapLockoutTimer = 0; state.activeWeapon = 'hammer';
  attachBallTo(state.grifball.ball, runner.id); attachBallTo(sim.match.ball, runner.id);
  setGrifballCarrierForState({ state, id: runner.id, carrying: true }); setSimCarrier(runner, true, sim.settings, sim);
  if (spec.reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
  const placement = createArenaOrchestratorCallbacksForState({ getState: () => state, getRefs: () => refs, spawnPoints: [],
    getActiveCustomMap: () => map, getLegacyRosterProps: () => ({}), getOfflineBotCount: () => state.otherPlayers.size,
    isPlaying: true, opponentClientId: '', constrainCombatantToArena: noop, getVisualModelPolicy: () => 'v2', pushStatsUpdate: noop, playRespawn: noop });
  const record = parityRecorder(), random = seededRandom(811), frames = [];
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  let restored: SimState | undefined, resets = 0, notifications = 0;
  const motion = { walk: [{ tick: 1, direction: { x: direction, z: 0 } }] };
  for (let tick = 1; tick <= 120; tick++) {
    const moving = sim.match.phase === 'playing';
    const actions = moving ? { [runner.id]: runner.hasBall || spec.player
      ? { ...idleAction(), aim, moveZ: 1 } : groundMotionAction(runner, motion, tick, aim, sim.settings) } : {};
    withSimulationRandom(random, tick / 60, () => {
      const liveMoving = state.grifball.phase === 'playing';
      if (spec.player && liveMoving) state.yaw = aim + Math.PI;
      advanceGrifballFrameForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: 1 / 60,
        isPlaying: true, isPausedRef: { current: false }, replayData: null, keysPressed: { current: {} }, grifbHoldTimerRef: { current: 0 },
        secretAudioRef: { current: null }, isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null,
        replayRecordingRef: { current: null }, replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
        spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop,
        updatePhysics: dt => {
          if (!updatePlayerRespawnForState({ state, dt, isMultiplayer: false, getMainAi: () => undefined, activeCustomMap: map, spawnPoints: [], playRespawn: noop })) {
            updatePlayerHorizontalMovementForState({ state, refs, dt, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
              actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: { x: 0, y: spec.player && liveMoving ? 1 : 0 },
              mobileControlsActive: true, sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
            updatePlayerVerticalIntegrationForState({ state, dt, gravityAcceleration: 18,
              constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }) });
          }
        }, updateHammerAnimations: f.weaponFrame, runAIOrchestrator: f.respawns,
        updateAI: dt => {
          for (const a of state.otherPlayers.values()) if (a.hp > 0) tickCombatantInvulnerability(a, dt);
          if (!spec.player && liveMoving) {
            if (state.grifball.ball.holderId === bot.id) {
              const frame = { pos: bot.pos, vel: bot.vel, yaw: bot.yaw, aiState: bot.aiState, timer: bot.aiTimer ?? 0,
                dashRemaining: 0, slideActive: false, weaponState: bot.weaponState ?? 'ready', pickupRequested: false };
              const moved = resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: bot.id, self: bot, frame, alliesList: [], enemiesList: [], dt,
                canStartWeaponAction: false, triggerCombatantAttack: noop, getEnemyGoalPos: () => plate.position,
                constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }) });
              if (!moved) throw new Error('Expected production carrier movement');
              bot.yaw = frame.yaw; bot.aiState = frame.aiState; bot.aiTimer = frame.timer;
            } else stepLiveGroundMotion(f, bot, motion, tick);
          } else if (!spec.player) { bot.vel.x = 0; bot.vel.z = 0; }
        },
        updateGrifball: dt => updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt,
          isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => { resets++; placement.placeCombatantsAtGrifballSpawns(); },
          pushStatsUpdate: () => { notifications++; } }),
        updateCharacterSkeletalAnimations: f.visuals, updateMatchTimers: noop, enforceArenaBounds: noop, renderGame: noop,
        updateFloatingNameplate: noop, pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop, playRespawn: noop });
    });
    const events = stepSimulation(sim, actions, { settings: sim.settings });
    if (restored) {
      const replay = stepSimulation(restored, actions, { settings: restored.settings });
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim));
      record.compare(tick, 'snapshot.events', JSON.stringify(replay), JSON.stringify(events));
    }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    const liveActors = sim.combatants.map(c => {
      const a = state.otherPlayers.get(c.id), yaw = a ? a.yaw : state.yaw;
      return { id: c.id, hp: a ? a.hp : state.playerHP, maxHp: a ? a.maxHp : state.playerMaxHP,
        respawn: Math.max(0, a ? a.respawnTimer : state.playerRespawnTimer), shield: a ? a.invulnerabilityTimer : state.playerInvulnerabilityTimer,
        weapon: a ? a.activeWeapon : state.activeWeapon, pos: (a ? a.pos : state.playerPos).toArray(),
        vel: (a ? a.vel : state.playerVel).toArray(), heading: [Math.sin(yaw), Math.cos(yaw)] };
    });
    const simActors = sim.combatants.map(c => ({ id: c.id, hp: c.hp, maxHp: c.maxHp, respawn: c.respawnTimer, shield: c.invulnerabilityTimer,
      weapon: c.weapon, pos: Object.values(c.pos), vel: Object.values(c.vel), heading: [Math.sin(c.yaw + Math.PI), Math.cos(c.yaw + Math.PI)] }));
    const live = { match: structuredClone(state.grifball), scores: structuredClone(state.teamScores), actors: liveActors };
    const headless = { match: structuredClone(sim.match), scores: structuredClone(sim.scores), actors: simActors };
    const compare = (path: string, a: any, b: any) => {
      if (a && typeof a === 'object') for (const key of Object.keys(a)) compare(`${path}.${key}`, a[key], b?.[key]);
      else record.compare(tick, path, a, b, typeof a === 'number' ? 1e-6 : 0);
    };
    compare('frame', live, headless); frames.push({ tick, live, headless, events, resets, notifications });
  }
  for (const side of ['live', 'headless'] as const) {
    const actorAt = (tick: number, id: string) => frames[tick - 1][side].actors.find(c => c.id === id)!;
    record.compare(3, `expected.${side}.approach`, frames[2][side].match.phase, 'playing');
    record.compare(4, `expected.${side}.goal`, frames[3][side].match.phase, 'scored');
    record.compare(4, `expected.${side}.baseHealth`, actorAt(4, runner.id).hp, 2);
    record.compare(4, `expected.${side}.releasedWeapon`, actorAt(4, runner.id).weapon, 'hammer');
    record.compare(16, `expected.${side}.transition`, frames[15][side].match.phase, spec.winner ? 'matchEnd' : 'countdown');
    record.compare(120, `expected.${side}.round`, frames[119][side].match.roundNumber, spec.winner ? 1 : 2);
    record.compare(120, `expected.${side}.winner`, frames[119][side].match.winningTeam, spec.winner ? team : null);
    record.compare(120, `expected.${side}.oneGoal`, frames[119][side].scores[team].goals, 1);
    record.compare(16, `expected.${side}.resetDoesNotRevive`, actorAt(16, dead.id).hp, 0);
    record.compare(29, `expected.${side}.beforeRevival`, actorAt(29, dead.id).hp, 0);
    record.compare(30, `expected.${side}.revival`, actorAt(30, dead.id).hp, 2);
    record.compare(30, `expected.${side}.revivalShield`, actorAt(30, dead.id).shield, .5 - 1 / 60, 1e-6);
    record.compare(61, `expected.${side}.shieldExpired`, actorAt(61, dead.id).shield, 0);
    record.compare(120, `expected.${side}.injuryPreserved`, actorAt(120, injured.id).hp, 1);
    const startX = plate.position.x - direction * (plate.halfExtents.x + .5);
    for (let tick = 1; tick <= 4; tick++) record.compare(tick, `expected.${side}.approachPosition`, actorAt(tick, runner.id).pos[0], startX + direction * tick * 7.54 / 60, 1e-6);
    if (!spec.winner) {
      record.compare(22, `expected.${side}.countdownEnds`, frames[21][side].match.phase, 'playing');
      const spawn = actorAt(16, runner.id).pos;
      record.compare(22, `expected.${side}.countdownStationary`, JSON.stringify(actorAt(22, runner.id).pos), JSON.stringify(spawn));
      record.compare(23, `expected.${side}.movementResumes`, actorAt(23, runner.id).pos[0], spawn[0] + direction * (spec.player ? 5.8 : 5.2) / 60, 1e-6);
      for (const a of frames[15][side].actors) {
        const participant = sim.combatants.find(c => c.id === a.id)!;
        const cluster = map.teamSpawns![participant.team];
        record.compare(16, `expected.${side}.${a.id}.authoredSpawn`, cluster.some(p => p.x === a.pos[0] && p.y === a.pos[1] && p.z === a.pos[2]), true);
        const length = Math.hypot(a.pos[0], a.pos[2]);
        record.compare(16, `expected.${side}.${a.id}.spawnHeadingX`, a.heading[0], a.pos[0] / length, 1e-6);
        record.compare(16, `expected.${side}.${a.id}.spawnHeadingZ`, a.heading[1], a.pos[2] / length, 1e-6);
      }
    } else record.compare(120, `expected.${side}.endedRunnerStationary`, JSON.stringify(actorAt(120, runner.id).pos), JSON.stringify(actorAt(4, runner.id).pos));
    const revived = actorAt(30, dead.id), length = Math.hypot(revived.pos[0], revived.pos[2]);
    record.compare(30, `expected.${side}.revivedHeadingX`, revived.heading[0], revived.pos[0] / length, 1e-6);
    record.compare(30, `expected.${side}.revivedHeadingZ`, revived.heading[1], revived.pos[2] / length, 1e-6);
  }
  record.compare(120, 'expected.resets', resets, spec.winner ? 0 : 1);
  record.compare(120, 'expected.notifications', notifications, 1);
  record.compare(120, 'expected.resetEvents', frames.filter(f => f.events.roundReset).length, spec.winner ? 0 : 1);
  record.compare(120, 'expected.matchEndEvents', frames.filter(f => f.events.matchEnded).length, spec.winner ? 1 : 0);
  return { name: `${spec.map.id}/${spec.player}/${spec.mirror}/${spec.reverse}/${spec.winner}`, ticks: 120, ...record.result(), frames };
}
export const runRoundFrameParity = () => ROUND_FRAME_CASES.map(c => runRoundFrameTrace(c));
