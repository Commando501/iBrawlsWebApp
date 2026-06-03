import * as THREE from 'three';
import { enemyGoalForTeam } from '../../game/aiGrifballRoles';
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

  if (id === 'player') {
    state.activeWeapon = weapon;
    if (carrying) {
      state.playerMaxHP = baseMaxHp + 1; // Runner has extra health!
      state.playerHP = state.playerMaxHP; // Heal to full on pickup
    } else {
      state.playerMaxHP = baseMaxHp;
      state.playerHP = Math.min(state.playerHP, state.playerMaxHP);
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
        bot.maxHp = baseMaxHp + 1; // Runner has extra health!
        bot.hp = bot.maxHp; // Heal to full on pickup
      } else {
        bot.maxHp = baseMaxHp;
        bot.hp = Math.min(bot.hp, bot.maxHp);
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
  if (g.ball.holderId !== 'player') {
    ballChargingRef.current = false;
    return;
  }
  const chargeMax = state.settings.grifballChargeMax ?? 1.2;
  const t = Math.min(1, ballChargeTimerRef.current / chargeMax);
  const minSpeed = state.settings.grifballPassSpeedMin ?? 9;
  const maxSpeed = state.settings.grifballPassSpeedMax ?? 26;
  const speed = minSpeed + t * (maxSpeed - minSpeed);
  const heading = { x: Math.sin(state.yaw), y: 0, z: Math.cos(state.yaw) };
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
  if (state.settings.gameMode !== 'grifball' || isMultiplayer) return;
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
  }

  const coord = state.aiMatchContext.coordinator;
  if (g.ball.state === 'held' && g.ball.holderId) {
    coord.priorityTargetId = g.ball.holderId;
    coord.priorityAge = 0;
  } else {
    coord.priorityTargetId = undefined;
    coord.priorityAge = 0;
  }

  if (ballChargingRef.current) ballChargeTimerRef.current += dt;
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
      g.ball.pos.x = ref.pos.x;
      g.ball.pos.y = ref.pos.y + 1.1;
      g.ball.pos.z = ref.pos.z;
    }
  } else {
    tickBallPhysics(g.ball, dt, state.settings.grifballBallReturnTimeout ?? 8);
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
}
