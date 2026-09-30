import { triggerPlayerHammerSwingForState } from '../../src/components/grifball/playerWeaponActions';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { lungeFixture } from './grifballLungeFixture';
import { addParityActor, parityRecorder } from './grifballMultiActorParity';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { updateGrifballObjectiveForState, setGrifballCarrierForState, throwPlayerGrifballPassForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { handlePointerPlayerActionInputForState, handlePointerPlayerActionReleaseForState } from '../../src/components/grifball/playerInputRuntime';
import { updatePlayerRespawnForState } from '../../src/components/grifball/playerRespawnRuntime';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { tickCombatantInvulnerability } from '../../src/components/grifball/aiTickState';
import { triggerCombatantAttackAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { DEFAULT_KEYBINDINGS, type Combatant } from '../../src/types';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { attachBallTo } from '../../src/game/grifballBall';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';
import { stepCombatantWeapons } from '../../src/sim/weapons';
import { idleAction } from '../../src/sim/actions';
import type { SimCombatant, SimState } from '../../src/sim/simState';

const noop = () => {};
export interface FrameObjectiveCase { player: boolean; lunge: boolean; goal: boolean; hp: number; reverse: boolean; mirror: boolean }
export const FRAME_OBJECTIVE_CASES: FrameObjectiveCase[] = [false, true].flatMap(player => [false, true].flatMap(lunge =>
  [false, true].flatMap(goal => [1, 2].flatMap(hp => [false, true].flatMap(reverse => [false, true].map(mirror => ({ player, lunge, goal, hp, reverse, mirror })))))));

/** Actual frame coordinator owns objective-before-skeletal-melee ordering and final
 * carrier reconciliation. Attack commitments are authored; no AI policy is certified. */
export interface ChargeCombatCase { releaseAt: number | null; shield: boolean; moving: boolean; recovery?: 'hold' | 'repress' }
export interface CarrierRecoveryCase { motion: 'stationary' | 'cross' | 'retreat'; escortHp: 1 | 3; attackAt: 1 | 12 }
export interface CarrierCrowdCase { secondLunge: boolean; shield: boolean; pickup: 'tie' | 'nearer-escort'; recovery?: CarrierRecoveryCase }
export interface RunnerCombatCase { secondAttack?: 'slash' | 'lunge'; motion?: 'retreat' | 'cross' | 'approach'; mainAttacker?: boolean; attack: 'none' | 'slash' | 'lunge'; counter: boolean; speed: 100 | 130; punchSpeed: .04 | .24; enemyHp: 1 | 2; shield: boolean }
export function runFrameObjectiveTrace(spec: FrameObjectiveCase, snapshotAt?: number, charge?: ChargeCombatCase, crowd?: CarrierCrowdCase, runnerCombat?: RunnerCombatCase) {
  if (runnerCombat && (spec.goal || charge || crowd)) throw new Error('Runner combat requires an off-goal runner');
  if (crowd && (charge || spec.goal)) throw new Error('Carrier crowd fixture requires an off-goal runner without pass input');
  if (crowd?.recovery?.motion && crowd.recovery.motion !== 'stationary' && !spec.player) throw new Error('Moving recovery requires a local player runner');
  const f = lungeFixture(runnerCombat?.mainAttacker ? 'main_ai' : 'attacker', false), { state, sim, bot, target, refs, map } = f;
  const [attacker, runner] = sim.combatants;
  attacker.id = bot.id; attacker.controller = 'ai'; runner.id = target.id;
  sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player';
  const player = spec.player ? runner : { ...structuredClone(runner), id: 'player', controller: 'remote' as const };
  if (spec.player) { runner.id = 'player'; state.otherPlayers.delete(target.id); refs.otherPlayerMeshes.delete(target.id); }
  else sim.combatants.push(player);
  player.controller = 'remote';
  const attackerTeam = spec.mirror ? 'red' : 'blue', runnerTeam = spec.mirror ? 'blue' : 'red';
  attacker.team = bot.team = attackerTeam;
  runner.team = target.team = player.team = state.localPlayerTeam = runnerTeam;
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
  const attackers: { live: Combatant; headless: SimCombatant; lunge: boolean }[] = [{ live: bot, headless: attacker, lunge: spec.lunge }];
  const collectors: (readonly [Combatant, SimCombatant])[] = [];
  if (crowd) {
    const [support, simSupport] = addParityActor(f, 'support', attackerTeam, attacker.pos.x, attacker.pos.z);
    support.yaw = bot.yaw; simSupport.yaw = attacker.yaw;
    support.activeWeapon = simSupport.weapon = 'sword';
    attackers.push({ live: support, headless: simSupport, lunge: crowd.secondLunge });
    // Opposing pickup candidates remain protected during attacks. Equal distances follow
    // roster order; a nearer escort must win regardless of insertion order.
    collectors.push(addParityActor(f, 'escort', runnerTeam, direction * (crowd.pickup === 'tie' ? 1.2 : .6), 0));
    collectors.push(addParityActor(f, 'interceptor', attackerTeam, direction * 1.2, 0));
    for (const [a, b] of collectors) { a.invulnerabilityTimer = b.invulnerabilityTimer = 10; a.activeWeapon = b.weapon = 'hammer'; }
    runner.invulnerabilityTimer = crowd.shield ? 10 : 0;
    if (spec.player) state.playerInvulnerabilityTimer = runner.invulnerabilityTimer;
    else target.invulnerabilityTimer = runner.invulnerabilityTimer;
  }
  if (crowd?.recovery) {
    for (const [a, b] of collectors) a.invulnerabilityTimer = b.invulnerabilityTimer = 0;
    // Pin the movement/contact calibration used by the independent recovery oracle.
    Object.assign(state.settings, { speedForward: 100, speedSide: 100, grifballRunnerSpeedForward: 130, grifballRunnerSpeedSide: 130, swordLungeSpeed: 24 });
    Object.assign(sim.settings, state.settings);
    collectors[0][0].hp = collectors[0][0].maxHp = collectors[0][1].hp = collectors[0][1].maxHp = crowd.recovery.escortHp;
  }
  if (runnerCombat?.secondAttack) {
    if (!spec.player || runnerCombat.attack === 'none') throw new Error('Moving focus fire requires a local carrier and two attacks');
    const [support, simSupport] = addParityActor(f, 'support', attackerTeam, attacker.pos.x, attacker.pos.z);
    support.yaw = bot.yaw; simSupport.yaw = attacker.yaw;
    support.activeWeapon = simSupport.weapon = 'sword';
    attackers.push({ live: support, headless: simSupport, lunge: runnerCombat.secondAttack === 'lunge' });
  }
  if (runnerCombat) {
    Object.assign(state.settings, { speedForward: 100, speedBackward: 100, grifballRunnerSpeedForward: runnerCombat.speed,
      grifballRunnerSpeedBackward: runnerCombat.speed, grifballRunnerSpeedSide: runnerCombat.speed, speedSide: 100, hammerMeleeSpeed: runnerCombat.punchSpeed });
    Object.assign(sim.settings, state.settings);
    for (const { live: a, headless: b } of attackers) {
      a.hp = a.maxHp = b.hp = b.maxHp = runnerCombat.enemyHp;
      a.invulnerabilityTimer = b.invulnerabilityTimer = runnerCombat.shield ? 10 : 0;
    }
  }
  const attackAt = runnerCombat ? 4 : crowd?.recovery?.attackAt ?? 1;
  // Lunge contact occurs in updateAI; a short slash impacts in skeletal animation on the authored attack tick.
  const random = seededRandom(181);
  const commitLiveFlights = () => {
    for (const { live: a, lunge } of attackers) {
      a.lungeTargetDir = { x: 0, y: 0, z: direction };
      if (!lunge) { a.isLunging = false; a.aiState = 'APPROACHING'; a.weaponState = 'ready'; }
      else {
        triggerCombatantLungeAction({ self: a, settings: state.settings, lungeDir: a.pos.clone().set(0, 0, direction), pos: a.pos, vel: a.vel, playDash: noop });
      }
    }
  };
  const commitSimFlights = (destination: SimState) => {
    for (const { headless: b, lunge } of attackers) if (lunge) {
      const c = destination.combatants.find(c => c.id === b.id)!;
      c.lungeTargetId = runner.id; c.lungeAimDirection = { x: 0, y: 0, z: direction };
      stepCombatantWeapons(destination, c, { ...idleAction(), attackSecondary: true }, destination.settings, 0, []);
    }
  };
  for (const { live: a } of attackers) { a.isLunging = false; a.aiState = 'APPROACHING'; a.weaponState = 'ready'; }
  if (attackAt === 1) withSimulationRandom(random, 0, () => { commitLiveFlights(); commitSimFlights(sim); });
  if (spec.reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  const kills = new Map<string, number>(), deaths = new Map<string, number>();
  const record = parityRecorder(), frames = []; let restored: SimState | undefined, notifications = 0, releases = 0, counters = 0;
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
    const localRunner = !!runnerCombat && spec.player;
    const localAim = localRunner ? (spec.mirror ? Math.PI : 0) + Math.PI : 0;
    const worldX = runnerCombat?.motion === 'cross' ? direction : 0;
    const worldZ = runnerCombat?.motion === 'cross' ? 0 : runnerCombat?.motion === 'approach' ? -direction : direction;
    const moveX = localRunner ? worldX * Math.cos(localAim) - worldZ * Math.sin(localAim) : charge?.moving || crowd?.recovery?.motion === 'cross' ? .25 : 0;
    const moveZ = localRunner ? worldX * Math.sin(localAim) + worldZ * Math.cos(localAim) : crowd?.recovery?.motion === 'retreat' ? 1 : 0;
    const movingPlayer = localRunner || !!charge || !!crowd?.recovery && spec.player;
    const aim = localRunner ? localAim : spec.mirror ? Math.PI : 0;
    // Request recovery continuously: late melee cannot be picked up until the next objective tick.
    bot.pickupRequested = !runnerCombat && !crowd && !charge?.recovery;
    for (const [c] of collectors) c.pickupRequested = true;
    state.playerPickupRequested = !!charge?.recovery && tick === 183;
    // Compute authored headless intent from its own pre-frame state, never the live frame.
    const requestCounter = !!runnerCombat?.counter && tick === 4 && runner.alive && runner.hasBall && runner.weaponState === 'idle';
    const runnerAim = requestCounter ? Math.atan2(attacker.pos.x - runner.pos.x, attacker.pos.z - runner.pos.z)
      : runner.weaponState === 'idle' ? aim : runner.yaw;
    // Scripted carrier intent holds through the punch strike; player input remains unrestricted.
    const punchCommitted = runner.weapon === 'ball' && (runner.weaponState === 'windup' || runner.weaponState === 'active');
    const runnerMove = runnerCombat && runner.alive && runner.hasBall && !requestCounter && !punchCommitted ? direction : 0;
    withSimulationRandom(random, tick / 60, () => {
      if (attackAt > 1 && tick === attackAt) { commitLiveFlights(); commitSimFlights(sim); if (restored) commitSimFlights(restored); }
      if (movingPlayer) state.yaw = aim + Math.PI;
      if (localRunner && runnerCombat.counter && tick === 4) handlePointerPlayerActionInputForState({
        state, button: 0, keybindings: DEFAULT_KEYBINDINGS, ballChargingRef, ballChargeTimerRef,
        callbacks: { triggerPlayerHammerSwing: () => { counters++; triggerPlayerHammerSwingForState({ state,
          recordHammerAttack: noop, playSwing: noop, sendSync: noop }); },
          triggerPlayerHammerMelee: noop, triggerPlayerPistolFire: noop, triggerPlayerSwordSlash: noop, triggerPlayerSwordLunge: noop },
      });
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
        if (!updatePlayerRespawnForState({ state, dt, isMultiplayer: false, getMainAi: () => state.otherPlayers.get('main_ai'), activeCustomMap: map, spawnPoints: [], playRespawn: noop })) {
          updatePlayerHorizontalMovementForState({ state, refs, dt, keysPressed: {}, movementKeybindings: DEFAULT_KEYBINDINGS,
            actionKeybindings: DEFAULT_KEYBINDINGS, gamepad: null, mobileJoystick: movingPlayer ? { x: -moveX, y: moveZ } : null, mobileControlsActive: movingPlayer,
            sprintToggleActiveRef: { current: false }, prevSprintInputRef: { current: false } });
          updatePlayerVerticalIntegrationForState({ state, dt, gravityAcceleration: 18, constrainCombatantToArena: (pos, vel) =>
            constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }) });
        }
      }, updateHammerAnimations: f.weaponFrame, runAIOrchestrator: f.respawns,
      updateAI: dt => {
        for (const c of state.otherPlayers.values()) if (c.hp > 0) tickCombatantInvulnerability(c, dt);
        for (const c of state.otherPlayers.values()) {
          if (runnerCombat && c === target && c.hp > 0 && state.grifball.ball.holderId === c.id) {
            const frame = { pos: c.pos, vel: c.vel, yaw: c.yaw, aiState: c.aiState, timer: c.aiTimer ?? 0,
              dashRemaining: 0, slideActive: false, weaponState: c.weaponState ?? 'ready', pickupRequested: false };
            const moved = resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: c.id, self: c, frame,
              alliesList: [], enemiesList: [], dt, canStartWeaponAction: runnerCombat.counter && tick === 4,
              triggerCombatantAttack: (self, weapon) => { counters++; triggerCombatantAttackAction({ self, weapon, recordHammerAttack: noop, playSwing: noop }); },
              constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: map, arenaRadius: map.arenaRadius }),
              getEnemyGoalPos: () => ({ x: 0, z: direction * 100 }) });
            if (!moved) throw new Error('Runner trace must exercise production carrier movement');
            c.yaw = frame.yaw; c.aiState = frame.aiState; c.aiTimer = frame.timer;
          }
          const entry = attackers.find(a => a.live === c);
          if (!entry || c.hp <= 0) continue;
          if (tick === attackAt && !entry.lunge && runnerCombat?.attack !== 'none') triggerCombatantAttackAction({ self: c, weapon: 'sword', recordHammerAttack: noop, playSwing: noop });
          if (c.isLunging) f.flightFor(c, spec.player ? { ...target, id: 'player', hp: state.playerHP,
            pos: state.playerPos, vel: state.playerVel, team: state.localPlayerTeam, invulnerabilityTimer: state.playerInvulnerabilityTimer,
            activeWeapon: state.activeWeapon as 'ball' | 'hammer' } : target, dt);
        }
      },
      updateGrifball: dt => updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef,
        dt, isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: () => { throw new Error('Trace must stop before reset'); }, pushStatsUpdate: () => { notifications++; } }),
      updateCharacterSkeletalAnimations: f.visuals, updateMatchTimers: noop, enforceArenaBounds: noop,
      renderGame: () => {
        const holder = state.grifball.ball.holderId;
        const hp = holder === 'player' ? state.playerHP : state.otherPlayers.get(holder ?? '')?.hp;
        record.compare(tick, 'published.deadCarrier', !!holder && (hp === undefined || hp <= 0), false);
      },
      updateFloatingNameplate: noop, pushStatsUpdate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop, playRespawn: noop,
      });
    });
    previousHeld = held;
    const actions = Object.fromEntries(sim.combatants.map(c => [c.id, { ...idleAction(), aim: movingPlayer && c === player ? aim : c.yaw,
      pickup: collectors.some(([, b]) => b === c) || (c === attacker ? !runnerCombat && !crowd && !charge?.recovery : c === player && !!charge?.recovery && tick === 183),
      moveX: c === player ? moveX : 0, moveZ: c === player ? moveZ : 0, attackSecondary: c === player && held,
      attackPrimary: localRunner && c === player ? requestCounter : tick === attackAt && runnerCombat?.attack !== 'none' && attackers.some(a => a.headless === c && !a.lunge),
      ...(runnerCombat && !spec.player && c === runner ? { aim: runnerAim, moveX: -runnerMove * Math.sin(runnerAim), moveZ: runnerMove * Math.cos(runnerAim), attackPrimary: requestCounter } : {}) }]));
    const events = stepSimulation(sim, actions, { settings: sim.settings });
    for (const event of events.kills) {
      kills.set(event.attackerId, (kills.get(event.attackerId) ?? 0) + 1);
      deaths.set(event.victimId, (deaths.get(event.victimId) ?? 0) + 1);
    }
    if (restored) { const replay = stepSimulation(restored, actions, { settings: restored.settings });
      record.compare(tick, 'snapshot.state', JSON.stringify(restored), JSON.stringify(sim)); record.compare(tick, 'snapshot.events', JSON.stringify(replay), JSON.stringify(events)); }
    if (tick === snapshotAt) restored = JSON.parse(JSON.stringify(sim));
    const live = { ball: structuredClone(state.grifball.ball), phase: state.grifball.phase, goals: state.teamScores[runner.team].goals,
      runnerDeaths: spec.player ? state.playerDeaths : target.deaths ?? 0,
      hp: spec.player ? state.playerHP : target.hp, maxHp: spec.player ? state.playerMaxHP : target.maxHp,
      respawn: Math.max(0, spec.player ? state.playerRespawnTimer : target.respawnTimer), weapon: spec.player ? state.activeWeapon : target.activeWeapon,
      attackerHp: bot.hp, attackerWeapon: bot.activeWeapon, attackerPos: bot.pos.toArray(), runnerPos: (spec.player ? state.playerPos : target.pos).toArray() };
    const headless = { ball: structuredClone(sim.match.ball), phase: sim.match.phase, goals: sim.scores[runner.team].goals,
      runnerDeaths: deaths.get(runner.id) ?? 0,
      hp: runner.hp, maxHp: runner.maxHp, respawn: runner.respawnTimer, weapon: runner.weapon,
      attackerHp: attacker.hp, attackerWeapon: attacker.weapon, attackerPos: Object.values(attacker.pos), runnerPos: Object.values(runner.pos) };
    const compare = (key: string, a: unknown, b: unknown) => {
      if (a && typeof a === 'object') for (const field of Object.keys(a)) compare(`${key}.${field}`, (a as Record<string, unknown>)[field], (b as Record<string, unknown>)?.[field]);
      else record.compare(tick, key, a, b, typeof a === 'number' ? 1e-6 : 0);
    };
    const liveCharge = { active: ballChargingRef.current, seconds: ballChargeTimerRef.current, display: state.grifballPassCharge };
    const simCharge = { active: !!player.passCharging, seconds: player.passChargeTimer,
      display: player.passCharging ? Math.min(1, player.passChargeTimer / (sim.settings.grifballChargeMax ?? 1.2)) : 0 };
    const liveCrowd = crowd || runnerCombat?.secondAttack ? [...state.otherPlayers.values()].map(c => ({ id: c.id, hp: c.hp, maxHp: c.maxHp,
      weapon: c.activeWeapon, pos: c.pos.toArray(), shield: c.invulnerabilityTimer, lunging: !!c.isLunging,
      kills: c.kills ?? 0, deaths: c.deaths ?? 0 })) : [];
    const simCrowd = liveCrowd.map(c => {
      const b = sim.combatants.find(b => b.id === c.id)!;
      return { id: b.id, hp: b.hp, maxHp: b.maxHp, weapon: b.weapon, pos: Object.values(b.pos), shield: b.invulnerabilityTimer,
        lunging: b.isLunging, kills: kills.get(b.id) ?? 0, deaths: deaths.get(b.id) ?? 0 };
    });
    if (crowd || runnerCombat?.secondAttack) {
      compare('crowd', liveCrowd, simCrowd);
      record.compare(tick, 'crowd.runnerDeaths', spec.player ? state.playerDeaths : target.deaths ?? 0, deaths.get(runner.id) ?? 0);
    }
    const liveRunner = runnerCombat && spec.player ? { yaw: [Math.sin(state.yaw), Math.cos(state.yaw)], vel: state.playerVel.toArray(),
      phase: state.pWeaponState === 'ready' ? 'idle' : state.pWeaponState === 'swing_up' ? 'windup' : state.pWeaponState === 'swing_down' ? 'active' : 'recovering',
      elapsed: state.pWeaponTimer, kills: state.playerKills, enemyKills: bot.kills ?? 0, enemyDeaths: bot.deaths ?? 0 }
      : runnerCombat ? { yaw: [Math.sin(target.yaw), Math.cos(target.yaw)], vel: target.vel.toArray(),
      phase: target.weaponState === 'ready' ? 'idle' : target.weaponState === 'swing_up' ? 'windup' : target.weaponState === 'swing_down' ? 'active' : 'recovering',
      elapsed: target.weaponTimer ?? 0, kills: target.kills ?? 0, enemyKills: bot.kills ?? 0, enemyDeaths: bot.deaths ?? 0 } : undefined;
    const simRunner = runnerCombat ? { yaw: [Math.sin(runner.yaw + Math.PI), Math.cos(runner.yaw + Math.PI)], vel: Object.values(runner.vel),
      phase: runner.weaponState, elapsed: runner.weaponPhaseElapsed ?? 0, kills: kills.get(runner.id) ?? 0,
      enemyKills: kills.get(attacker.id) ?? 0, enemyDeaths: deaths.get(attacker.id) ?? 0 } : undefined;
    if (runnerCombat) {
      compare('runner', { ...liveRunner, vel: live.hp > 0 ? liveRunner!.vel : [] }, { ...simRunner, vel: headless.hp > 0 ? simRunner!.vel : [] });
    }
    if (charge) compare('charge', liveCharge, simCharge);
    compare('frame', live, headless); frames.push({ tick, live, headless, events, liveCharge, simCharge, ...(crowd || runnerCombat?.secondAttack ? { liveCrowd, simCrowd } : {}), ...(runnerCombat ? { liveRunner, simRunner } : {}) });
  }
  if (runnerCombat) return { name: JSON.stringify({ ...spec, runnerCombat }), ticks, counters, ...record.result(), frames };
  if (crowd?.recovery) return { name: JSON.stringify({ ...spec, crowd }), ticks, ...record.result(), frames };
  if (crowd) {
    const lethal = !crowd.shield && spec.hp <= 2;
    const winner = crowd.pickup === 'nearer-escort' || spec.reverse ? 'escort' : 'interceptor';
    const earlyHits = attackers.filter(a => a.lunge).length;
    const earlyDeath = lethal && earlyHits >= spec.hp;
    for (const side of ['live', 'headless'] as const) {
      record.compare(1, `expected.${side}.focusHealth`, frames[0][side].hp, crowd.shield ? spec.hp : Math.max(0, spec.hp - 2));
      record.compare(1, `expected.${side}.firstPossession`, frames[0][side].ball.holderId, lethal ? earlyDeath ? winner : null : runner.id);
      record.compare(2, `expected.${side}.contestedPickup`, frames[1][side].ball.holderId, lethal ? winner : runner.id);
      record.compare(ticks, `expected.${side}.retainedPossession`, frames.at(-1)![side].ball.holderId, lethal ? winner : runner.id);
      record.compare(ticks, `expected.${side}.noGoal`, frames.at(-1)![side].goals, 0);
    }
    // Flights resolve before skeletal melee regardless of insertion order. Within each
    // phase the roster order selects which hit earns the sole kill credit.
    const attackOrder = spec.reverse ? [...attackers].reverse() : [...attackers];
    const contactOrder = [...attackOrder.filter(a => a.lunge), ...attackOrder.filter(a => !a.lunge)];
    const killer = lethal ? contactOrder[spec.hp - 1].headless.id : null;
    for (const a of attackers) {
      record.compare(ticks, `expected.live.${a.live.id}.kills`, a.live.kills ?? 0, a.live.id === killer ? 1 : 0);
      record.compare(ticks, `expected.headless.${a.headless.id}.kills`, kills.get(a.headless.id) ?? 0, a.headless.id === killer ? 1 : 0);
    }
    record.compare(ticks, 'expected.runnerDeaths', deaths.get(runner.id) ?? 0, lethal ? 1 : 0);
    for (const [a, b] of collectors) for (const [side, hp] of [['live', a.hp], ['headless', b.hp]] as const)
      record.compare(ticks, `expected.${side}.${a.id}.health`, hp, lethal && a.id === winner ? spec.hp : 1);
    record.compare(ticks, 'expected.notifications', notifications, 0);
    return { name: JSON.stringify({ ...spec, crowd }), ticks, ...record.result(), frames };
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
