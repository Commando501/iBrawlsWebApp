import { canStartAIWeaponAction } from './aiWeaponTimingRuntime';
import { planGrifballPass } from '../../game/aiGrifballPassing';
import { createSnapshotRouters } from '../../game/aiGrifballRunner';
import { resolveTeamTactics } from '../../game/grifballTacticsConfig';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import { observeGrifballSpace } from '../../game/aiGrifballSpace';
import { GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH } from './combatGeometry';
import { getYawForHeading } from '../../game/yaw';
import * as THREE from 'three';
import { enemyGoalForTeam } from '../../game/aiGrifballRoles';
import {
  resolveRunnerHealDelay,
  resolveRunnerHealRate,
  resolveRunnerMaxHp,
  resolveRunnerThrowAllowed,
} from '../../game/runnerBallSettings';
import { getForwardHeadingForYaw } from '../../game/yaw';
import {
  attachBallTo,
  dropBall,
  findBallPickup,
  isBallGrabbable,
  returnBallHome,
  throwBall,
  tickBallPhysics,
} from '../../game/grifballBall';
import { findScoringPlate, getGoalPlates } from '../../game/grifballGoals';
import {
  isGrifballLive,
  registerGoal,
  resolveMatchConfig,
  tickGrifballMatch,
} from '../../game/grifballMatch';
import { awardTeamGoal } from '../../game/teamScoring';
import { type CustomMapData } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';
import {
  hideGrifballThrowTrajectoryVisualForRefs,
  updateGrifballThrowTrajectoryVisualForState,
} from './grifballThrowTrajectoryRuntime';
import { resolveHeldGrifballBallVisualPosition } from './grifballBallCarryVisuals';
import { updateV3GameplayBall } from './v3GameplayBall';

type MutableRef<T> = { current: T };

export type GrifballCombatantRef = {
  pos: THREE.Vector3;
  alive: boolean;
};

export function getGrifballCombatantRefForState(
  state: GrifballRuntimeState,
  id: string
): GrifballCombatantRef | null {
  if (id === 'player') return { pos: state.playerPos, alive: state.playerHP > 0 };
  const bot = state.otherPlayers.get(id);
  if (!bot) return null;
  return { pos: bot.pos, alive: bot.hp > 0 && (bot.respawnTimer ?? 0) <= 0 };
}

export function getGrifballTeamOfForState(state: GrifballRuntimeState, id: string): string | undefined {
  if (id === 'player') return state.localPlayerTeam;
  return state.otherPlayers.get(id)?.team;
}

export function getGrifballEnemyGoalPosForMap(
  team: string | undefined,
  activeCustomMap: CustomMapData | null
): { x: number; z: number } | null {
  const plate = enemyGoalForTeam(team, getGoalPlates(activeCustomMap));
  return plate ? { x: plate.position.x, z: plate.position.z } : null;
}

export function areGrifballCombatantsHostileForState(
  state: GrifballRuntimeState,
  attackerId: string,
  victimId: string
): boolean {
  if (state.settings.gameMode !== 'grifball') return true;
  if (attackerId === victimId) return false;
  const a = getGrifballTeamOfForState(state, attackerId);
  const b = getGrifballTeamOfForState(state, victimId);
  if (!a || !b) return true;
  return a !== b;
}

function clearGrifballPickupRequestsForState(state: GrifballRuntimeState): void {
  state.playerPickupRequested = false;
  for (const bot of state.otherPlayers.values()) {
    bot.pickupRequested = false;
  }
}

function tickRunnerHealingValue({
  hp,
  maxHp,
  lastHp,
  delayTimer,
  dt,
  settings,
}: {
  hp: number;
  maxHp: number;
  lastHp: number;
  delayTimer: number;
  dt: number;
  settings: GrifballRuntimeState['settings'];
}): { hp: number; delayTimer: number; lastHp: number } {
  let nextHp = Math.min(hp, maxHp);
  let nextDelayTimer = delayTimer;
  if (nextHp < lastHp) {
    nextDelayTimer = resolveRunnerHealDelay(settings);
  } else if (nextDelayTimer > 0) {
    nextDelayTimer = Math.max(0, nextDelayTimer - dt);
  } else if (nextHp > 0 && nextHp < maxHp) {
    nextHp = Math.min(maxHp, nextHp + resolveRunnerHealRate(settings) * dt);
  }
  return { hp: nextHp, delayTimer: nextDelayTimer, lastHp: nextHp };
}

export function tickGrifballRunnerHealingForState(
  state: GrifballRuntimeState,
  holderId: string,
  dt: number
): void {
  const runnerMaxHp = resolveRunnerMaxHp(state.settings);
  if (holderId === 'player') {
    state.playerMaxHP = runnerMaxHp;
    const healed = tickRunnerHealingValue({
      hp: state.playerHP,
      maxHp: state.playerMaxHP,
      lastHp: state.playerRunnerLastHp,
      delayTimer: state.playerRunnerHealDelayTimer,
      dt,
      settings: state.settings,
    });
    state.playerHP = healed.hp;
    state.playerRunnerHealDelayTimer = healed.delayTimer;
    state.playerRunnerLastHp = healed.lastHp;
    return;
  }

  const bot = state.otherPlayers.get(holderId);
  if (!bot) return;
  bot.maxHp = runnerMaxHp;
  const healed = tickRunnerHealingValue({
    hp: bot.hp,
    maxHp: bot.maxHp,
    lastHp: bot.runnerLastHp ?? bot.hp,
    delayTimer: bot.runnerHealDelayTimer ?? 0,
    dt,
    settings: state.settings,
  });
  bot.hp = healed.hp;
  bot.runnerHealDelayTimer = healed.delayTimer;
  bot.runnerLastHp = healed.lastHp;
}

export function setGrifballCarrierForState({
  state,
  refs,
  id,
  carrying,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  id: string;
  carrying: boolean;
}): void {
  const weapon = carrying ? 'ball' : 'hammer';
  const baseMaxHp = state.settings.maxHP ?? 1;
  const runnerMaxHp = resolveRunnerMaxHp(state.settings);

  if (id === 'player') {
    state.activeWeapon = weapon;
    if (carrying) {
      state.playerMaxHP = runnerMaxHp;
      state.playerHP = state.playerMaxHP;
      state.playerRunnerHealDelayTimer = 0;
      state.playerRunnerLastHp = state.playerHP;
    } else {
      state.playerMaxHP = baseMaxHp;
      state.playerHP = Math.min(state.playerHP, state.playerMaxHP);
      state.playerRunnerHealDelayTimer = 0;
      state.playerRunnerLastHp = state.playerHP;
      state.pWeaponState = 'ready';
      state.pWeaponReady = true;
    }
    if (refs.playerHammer) refs.playerHammer.visible = !carrying;
    if (refs.playerSword) refs.playerSword.visible = false;
  } else {
    const bot = state.otherPlayers.get(id);
    if (bot) {
      bot.activeWeapon = weapon;
      if (carrying) {
        bot.maxHp = runnerMaxHp;
        bot.hp = bot.maxHp;
        bot.runnerHealDelayTimer = 0;
        bot.runnerLastHp = bot.hp;
      } else {
        bot.maxHp = baseMaxHp;
        bot.hp = Math.min(bot.hp, bot.maxHp);
        bot.runnerHealDelayTimer = 0;
        bot.runnerLastHp = bot.hp;
      }
    }
  }
}

export function ensureGrifballBallMeshForRefs({
  refs,
  ballMeshRef,
}: {
  refs: GrifballThreeRefs;
  ballMeshRef: MutableRef<THREE.Mesh | null>;
}): void {
  if (ballMeshRef.current || !refs.scene) return;
  const geo = new THREE.SphereGeometry(0.32, 18, 18);
  const mat = new THREE.MeshStandardMaterial({
    color: '#161616',
    emissive: '#7dd3fc',
    emissiveIntensity: 0.7,
    metalness: 0.5,
    roughness: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  refs.scene.add(mesh);
  ballMeshRef.current = mesh;
}

function resolveHeldBallMeshPositionForState({
  state,
  refs,
  basePosition,
  localPlayerModelSystem,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  basePosition: THREE.Vector3;
  localPlayerModelSystem?: unknown;
}): THREE.Vector3 {
  const holderId = state.grifball.ball.holderId;
  if (state.grifball.ball.state !== 'held' || !holderId) {
    return basePosition;
  }

  if (holderId === 'player') {
    return resolveHeldGrifballBallVisualPosition({
      basePosition,
      yaw: state.yaw,
      activeWeapon: state.activeWeapon,
      weaponState: state.pWeaponState,
      weaponTimer: state.pWeaponTimer,
      settings: state.settings,
      modelSystem: localPlayerModelSystem,
    });
  }

  const holder = state.otherPlayers.get(holderId);
  if (!holder) {
    return basePosition;
  }

  const meshes = refs.otherPlayerMeshes.get(holderId);
  const modelSystem = meshes?.group.userData.modelSystem
    ?? (holderId === 'main_ai' ? refs.enemyGroup?.userData.modelSystem : undefined);

  return resolveHeldGrifballBallVisualPosition({
    basePosition,
    yaw: holder.yaw,
    activeWeapon: holder.activeWeapon,
    weaponState: holder.weaponState ?? 'ready',
    weaponTimer: holder.weaponTimer ?? 0,
    settings: state.settings,
    modelSystem,
  });
}

export function throwPlayerGrifballPassForState({
  state,
  refs,
  ballChargingRef,
  ballChargeTimerRef,
  playSwing,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  ballChargingRef: MutableRef<boolean>;
  ballChargeTimerRef: MutableRef<number>;
  playSwing: () => void;
}): void {
  const g = state.grifball;
  if (g.ball.holderId !== 'player' || !resolveRunnerThrowAllowed(state.settings)) {
    ballChargingRef.current = false;
    ballChargeTimerRef.current = 0;
    return;
  }
  const chargeMax = state.settings.grifballChargeMax ?? 1.2;
  const t = Math.min(1, ballChargeTimerRef.current / chargeMax);
  const minSpeed = state.settings.grifballPassSpeedMin ?? 9;
  const maxSpeed = state.settings.grifballPassSpeedMax ?? 26;
  const speed = minSpeed + t * (maxSpeed - minSpeed);
  const forwardHeading = getForwardHeadingForYaw(state.yaw);
  const heading = { x: forwardHeading.x, y: 0, z: forwardHeading.z };
  throwBall(g.ball, { x: state.playerPos.x, y: state.playerPos.y + 1.1, z: state.playerPos.z }, heading, speed);
  setGrifballCarrierForState({ state, refs, id: 'player', carrying: false });
  ballChargingRef.current = false;
  ballChargeTimerRef.current = 0;
  playSwing();
}

/** Execute a shared pass intent once per frame, after movement, through the existing throw rules. */
export function tickScriptedGrifballPassForState(state: GrifballRuntimeState, refs: GrifballThreeRefs, dt: number): boolean {
  const plan = state.aiMatchContext.grifballTeamPlan, ball = state.grifball.ball;
  const bot = state.otherPlayers.get(ball.holderId ?? '');
  const assignment = bot && plan.assignments.get(bot.id), selected = assignment?.pass?.selected;
  const tuning = bot?.team ? resolveTeamTactics(state.grifballTactics, bot.team) : null;
  const cancel = () => { plan.passCharge = null; for (const p of state.otherPlayers.values()) if (p.controller === 'ai' && !isNeuralNetDifficulty(p.difficulty) && !isNeuralNetDifficulty(state.settings.aiDifficulty)) p.grifballPassCharge = 0; return false; };
  if (state.isMultiplayer || state.settings.gameMode !== 'grifball' || state.grifball.phase !== 'playing' || ball.state !== 'held' ||
    !bot || bot.activeWeapon !== 'ball' || bot.controller !== 'ai' || isNeuralNetDifficulty(bot.difficulty) || isNeuralNetDifficulty(state.settings.aiDifficulty) ||
    bot.hp <= 0 || (bot.respawnTimer ?? 0) > 0 || !selected || !resolveRunnerThrowAllowed(state.settings) ||
    !tuning?.enabled || !tuning.spaceEnabled || !tuning.passingEnabled || !plan.snapshot?.geometry ||
    bot.weaponState !== 'ready' || (bot.swapLockoutTimer ?? 0) > 0 || !canStartAIWeaponAction({ aiState: bot.aiState, timer: bot.aiTimer, swapCooldownTimer: bot.swapCooldownTimer }) ||
    bot.isLunging || bot.isJumping || bot.pos.y > 0.01 || bot.vel.y !== 0 || (bot.aiDashRemaining ?? 0) > 0 || bot.aiSlideActive) return cancel();
  const receiver = state.otherPlayers.get(selected.receiverId);
  if (!receiver || receiver.hp <= 0 || (receiver.respawnTimer ?? 0) > 0 || receiver.team !== bot.team || receiver.controller !== 'ai' || isNeuralNetDifficulty(receiver.difficulty)) return cancel();
  let charge = plan.passCharge;
  if (!charge || charge.carrierId !== bot.id || charge.receiverId !== receiver.id || charge.speed !== selected.speed) {
    charge = plan.passCharge = { carrierId: bot.id, receiverId: receiver.id, speed: selected.speed, elapsed: 0 };
  }
  charge.elapsed += Math.max(0, dt);
  bot.grifballPassCharge = Math.min(1, charge.elapsed / Math.max(0.001, state.settings.grifballChargeMax ?? 1.2));
  if (charge.elapsed + 1e-9 < selected.chargeSeconds) return false;
  // The roster has moved since planning. Recheck current positions, availability and weapon timing at release.
  const snapshot = { ...plan.snapshot, passing: { ...plan.snapshot.passing!, allowed: resolveRunnerThrowAllowed(state.settings),
    minSpeed: state.settings.grifballPassSpeedMin ?? 9, maxSpeed: state.settings.grifballPassSpeedMax ?? 26,
    chargeMax: state.settings.grifballChargeMax ?? 1.2, pickupRadius: state.settings.grifballPickupRadius ?? 1.6 }, players: plan.snapshot.players.flatMap(p => {
    const live = state.otherPlayers.get(p.id);
    if (p.id === 'player') return !state.isObserverMode && state.playerHP > 0 && state.playerRespawnTimer <= 0 ? [{ ...p,
      pos: { x: state.playerPos.x, z: state.playerPos.z }, vel: { x: state.playerVel.x, z: state.playerVel.z },
      space: observeGrifballSpace(state.settings, state.activeWeapon, state.activeWeapon === 'sword' ? state.pSwordState : state.pWeaponState,
        state.activeWeapon === 'sword' ? state.pSwordTimer : state.pWeaponTimer, state.swapLockoutTimer ?? 0, state.playerPos.y, state.playerVel.y, GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH) }] : [];
    return live && live.hp > 0 && (live.respawnTimer ?? 0) <= 0 && !live.isObserver ? [{ ...p,
      pos: { x: live.pos.x, z: live.pos.z }, vel: { x: live.vel.x, z: live.vel.z }, height: live.pos.y,
      scripted: live.controller === 'ai' && !isNeuralNetDifficulty(live.difficulty),
      space: observeGrifballSpace(state.settings, live.activeWeapon, live.weaponState, live.weaponTimer ?? 0,
        live.swapLockoutTimer ?? 0, live.pos.y, live.vel.y, GRAVITY_ACCELERATION, MELEE_SWORD_SLASH_REACH) }] : [];
  }) };
  const currentCarrier = snapshot.players.find(p => p.id === bot.id)!;
  const fresh = planGrifballPass(snapshot, currentCarrier, tuning, createSnapshotRouters(snapshot));
  const pass = fresh.candidates.find(c => c.receiverId === receiver.id && c.speed === selected.speed && c.viable);
  if (!pass) { assignment!.pass = fresh; return cancel(); }
  bot.yaw = getYawForHeading(pass.direction.x, pass.direction.z);
  throwBall(ball, { x: bot.pos.x, y: bot.pos.y + 1.1, z: bot.pos.z }, { ...pass.direction, y: 0 }, pass.speed);
  setGrifballCarrierForState({ state, refs, id: bot.id, carrying: false });
  plan.passFlight = { team: bot.team!, receiverId: receiver.id, carrierId: bot.id };
  cancel();
  return true;
}

export function updateGrifballObjectiveForState({
  state,
  refs,
  ballMeshRef,
  ballChargingRef,
  ballChargeTimerRef,
  dt,
  isMultiplayer,
  activeCustomMap,
  localPlayerModelSystem,
  placeCombatantsAtGrifballSpawns,
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  ballMeshRef: MutableRef<THREE.Mesh | null>;
  ballChargingRef: MutableRef<boolean>;
  ballChargeTimerRef: MutableRef<number>;
  dt: number;
  isMultiplayer: boolean;
  activeCustomMap: CustomMapData | null;
  localPlayerModelSystem?: unknown;
  placeCombatantsAtGrifballSpawns: () => void;
  pushStatsUpdate: () => void;
}): void {
  if (state.settings.gameMode !== 'grifball' || isMultiplayer) {
    hideGrifballThrowTrajectoryVisualForRefs(refs);
    clearGrifballPickupRequestsForState(state);
    return;
  }
  ensureGrifballBallMeshForRefs({ refs, ballMeshRef });
  const g = state.grifball;
  const config = resolveMatchConfig(state.settings);

  const result = tickGrifballMatch(g, dt, config);
  if (result.roundReset) {
    placeCombatantsAtGrifballSpawns();
    returnBallHome(g.ball);
    setGrifballCarrierForState({ state, refs, id: 'player', carrying: false });
    for (const bot of state.otherPlayers.values()) {
      if (bot.controller === 'ai' && bot.activeWeapon === 'ball') bot.activeWeapon = 'hammer';
    }
    hideGrifballThrowTrajectoryVisualForRefs(refs);
  }

  const coord = state.aiMatchContext.coordinator;
  if (g.ball.state === 'held' && g.ball.holderId) {
    coord.priorityTargetId = g.ball.holderId;
    coord.priorityAge = 0;
  } else {
    coord.priorityTargetId = undefined;
    coord.priorityAge = 0;
  }

  const throwingAllowed = resolveRunnerThrowAllowed(state.settings);
  if (!throwingAllowed) {
    ballChargingRef.current = false;
    ballChargeTimerRef.current = 0;
    for (const bot of state.otherPlayers.values()) {
      bot.grifballPassCharge = 0;
    }
  }
  if (throwingAllowed && ballChargingRef.current) ballChargeTimerRef.current += dt;
  state.grifballPassCharge = ballChargingRef.current
    ? Math.min(1, ballChargeTimerRef.current / (state.settings.grifballChargeMax ?? 1.2))
    : 0;

  tickScriptedGrifballPassForState(state, refs, dt);
  if (g.ball.state === 'held' && g.ball.holderId) {
    const holderId = g.ball.holderId;
    const ref = getGrifballCombatantRefForState(state, holderId);
    if (!ref || !ref.alive) {
      dropBall(g.ball, ref ? { x: ref.pos.x, y: 0, z: ref.pos.z } : g.ball.home);
      setGrifballCarrierForState({ state, refs, id: holderId, carrying: false });
      if (holderId === 'player') {
        ballChargingRef.current = false;
        ballChargeTimerRef.current = 0;
      }
    } else {
      tickGrifballRunnerHealingForState(state, holderId, dt);
      g.ball.pos.x = ref.pos.x;
      g.ball.pos.y = ref.pos.y + 1.1;
      g.ball.pos.z = ref.pos.z;
    }
  } else {
    tickBallPhysics(
      g.ball,
      dt,
      state.settings.grifballBallReturnTimeout ?? 8,
      activeCustomMap ?? { arenaRadius: state.arenaRadius }
    );
  }

  if (isGrifballLive(g)) {
    if (isBallGrabbable(g.ball)) {
      const candidates: { id: string; pos: { x: number; y: number; z: number }; alive: boolean }[] = [];
      if (state.playerPickupRequested && state.playerHP > 0) {
        candidates.push({ id: 'player', pos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z }, alive: true });
      }
      for (const bot of state.otherPlayers.values()) {
        if (bot.pickupRequested === true && bot.controller === 'ai' && bot.hp > 0 && (bot.respawnTimer ?? 0) <= 0) {
          candidates.push({ id: bot.id, pos: { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z }, alive: true });
        }
      }
      const grabId = findBallPickup(g.ball, candidates, state.settings.grifballPickupRadius ?? 1.6);
      if (grabId) {
        attachBallTo(g.ball, grabId);
        setGrifballCarrierForState({ state, refs, id: grabId, carrying: true });
      }
    }

    if (g.ball.state === 'held' && g.ball.holderId) {
      const carrierTeam = getGrifballTeamOfForState(state, g.ball.holderId);
      const ref = getGrifballCombatantRefForState(state, g.ball.holderId);
      if (carrierTeam && ref && ref.alive) {
        const plate = findScoringPlate(ref.pos.x, ref.pos.z, carrierTeam, getGoalPlates(activeCustomMap));
        if (plate) {
          const total = awardTeamGoal(state.teamScores, carrierTeam);
          registerGoal(g, carrierTeam, total, config);
          setGrifballCarrierForState({ state, refs, id: g.ball.holderId, carrying: false });
          g.ball.state = 'idle';
          g.ball.holderId = null;
          g.ball.pos = { x: g.ball.home.x, y: 0.35, z: g.ball.home.z };
          ballChargingRef.current = false;
          pushStatsUpdate();
        }
      }
    }
  }

  clearGrifballPickupRequestsForState(state);

  const mesh = ballMeshRef.current;
  if (mesh) {
    const basePosition = new THREE.Vector3(g.ball.pos.x, g.ball.pos.y, g.ball.pos.z);
    const visualPosition = resolveHeldBallMeshPositionForState({
      state,
      refs,
      basePosition,
      localPlayerModelSystem,
    });
    mesh.visible = true;
    mesh.position.copy(visualPosition);
    mesh.rotation.y += dt * 2.5;
    updateV3GameplayBall(state, refs, mesh, dt, localPlayerModelSystem);
  }

  const chargingHolderId =
    ballChargingRef.current && g.ball.holderId === 'player'
      ? 'player'
      : g.ball.holderId && (state.otherPlayers.get(g.ball.holderId)?.grifballPassCharge ?? 0) > 0
        ? g.ball.holderId
        : null;
  updateGrifballThrowTrajectoryVisualForState({
    state,
    refs,
    chargingHolderId,
    arenaBounds: activeCustomMap ?? { arenaRadius: state.arenaRadius },
  });
}
