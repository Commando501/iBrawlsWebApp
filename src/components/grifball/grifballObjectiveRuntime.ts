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

export function updateGrifballObjectiveForState({
  state,
  refs,
  ballMeshRef,
  ballChargingRef,
  ballChargeTimerRef,
  dt,
  isMultiplayer,
  activeCustomMap,
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
  placeCombatantsAtGrifballSpawns: () => void;
  pushStatsUpdate: () => void;
}): void {
  if (state.settings.gameMode !== 'grifball' || isMultiplayer) {
    hideGrifballThrowTrajectoryVisualForRefs(refs);
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
      if (state.playerHP > 0) {
        candidates.push({ id: 'player', pos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z }, alive: true });
      }
      for (const bot of state.otherPlayers.values()) {
        if (bot.controller === 'ai' && bot.hp > 0 && (bot.respawnTimer ?? 0) <= 0) {
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

  const mesh = ballMeshRef.current;
  if (mesh) {
    mesh.visible = true;
    mesh.position.set(g.ball.pos.x, g.ball.pos.y, g.ball.pos.z);
    mesh.rotation.y += dt * 2.5;
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
