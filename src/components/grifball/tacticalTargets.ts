import * as THREE from 'three';
import { getCoordinatedTargetBonus } from '../../game/aiBotCoordinator';
import { getTargetEdgeSelectionBonus } from '../../game/aiSpatialStrategy';
import { resolveBehaviorTuning } from '../../game/aiBehaviorTuning';
import { MAIN_AI_ID } from '../../game/roster';
import { type AIResolvedKnobs, type DerivedAIParams } from '../../game/aiTuning';
import { type Combatant } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';
import { type GrifballRuntimeState } from './runtimeState';

type TacticalTargetBotKnobs = Pick<AIResolvedKnobs, 'aiPlaystyle'>;
type TacticalTargetBotDerived = Pick<DerivedAIParams, 'spatialIQ'>;

export const isTacticalTargetOnCooldown = (
  state: GrifballRuntimeState,
  mainAI: Combatant,
  target: Pick<TacticalTargetCandidate, 'id'>
): boolean => {
  const s = state;
  if (target.id === 'player') {
    if (s.activeWeapon === 'hammer') {
      return s.pWeaponState === 'recovering' || s.pWeaponState === 'swing_up' || s.pWeaponState === 'swing_down';
    }
    return s.pSwordState === 'recovering' || s.pSwordState === 'slashing' || s.isLunging;
  }

  if (target.id === MAIN_AI_ID) {
    return mainAI.weaponState === 'recovering' ||
      mainAI.weaponState === 'swing_up' ||
      mainAI.weaponState === 'swing_down' ||
      mainAI.aiState === 'LUNGING' ||
      (mainAI.aiState === 'COOLDOWN' && (mainAI.aiTimer ?? 0) > 0);
  }

  const other = s.otherPlayers.get(target.id);
  if (other) {
    return other.weaponState === 'recovering' ||
      other.weaponState === 'swing_up' ||
      other.weaponState === 'swing_down' ||
      other.isLunging ||
      (other.aiState === 'COOLDOWN' && (other.aiTimer || 0) > 0);
  }
  return false;
};

export const buildPotentialTacticalTargets = (
  state: GrifballRuntimeState,
  botId: string,
  rosterAI: Combatant[]
): TacticalTargetCandidate[] => {
  const s = state;
  const potentialTargets: TacticalTargetCandidate[] = [];

  if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode) {
    potentialTargets.push({
      id: 'player',
      pos: s.playerPos,
      hp: s.playerHP,
      maxHp: s.playerMaxHP,
      invulnerabilityTimer: s.playerInvulnerabilityTimer,
      activeWeapon: s.activeWeapon as TacticalTargetCandidate['activeWeapon'],
      weaponState: s.activeWeapon === 'hammer' ? s.pWeaponState : s.pSwordState,
      isLunging: s.isLunging,
      dashCooldownRemaining: s.playerDashCooldownTimer,
      swapLockoutRemaining: s.swapLockoutTimer,
      vel: s.playerVel,
      isCrouching: s.isCrouching,
      playerName: s.settings.playerName || 'Blue (You)',
    });
  }

  rosterAI.forEach((other) => {
    if (other.id !== botId && other.hp > 0 && (other.respawnTimer ?? 0) <= 0) {
      potentialTargets.push({
        id: other.id,
        pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z),
        hp: other.hp,
        maxHp: other.maxHp,
        invulnerabilityTimer: other.invulnerabilityTimer || 0,
        activeWeapon: other.activeWeapon,
        weaponState: other.aiState === 'COOLDOWN' && (other.aiTimer || 0) > 0 ? 'recovering' : (other.weaponState || 'ready'),
        isLunging: other.isLunging || other.weaponState === 'swing_up' || other.weaponState === 'swing_down',
        dashCooldownRemaining: other.aiDashCooldownTimer || 0,
        swapLockoutRemaining: other.swapLockoutTimer || 0,
        vel: new THREE.Vector3(other.vel.x, other.vel.y, other.vel.z),
        isCrouching: other.isCrouching || false,
        playerName: other.playerName,
      });
    }
  });

  return potentialTargets;
};

export const getTacticalTargetByIdFromState = (
  state: GrifballRuntimeState,
  botId: string,
  targetId: string,
  rosterAI: Combatant[]
): TacticalTargetCandidate | null => {
  return buildPotentialTacticalTargets(state, botId, rosterAI).find((candidate) => candidate.id === targetId) ?? null;
};

export const getBestTacticalTargetFromState = ({
  state,
  botId,
  botPos,
  difficulty,
  mainAI,
  rosterAI,
  resolveBotKnobs,
  resolveBotDerived,
}: {
  state: GrifballRuntimeState;
  botId: string;
  botPos: THREE.Vector3;
  difficulty: string;
  mainAI: Combatant;
  rosterAI: Combatant[];
  resolveBotKnobs: (botId: string) => TacticalTargetBotKnobs;
  resolveBotDerived: (botId: string) => TacticalTargetBotDerived;
}): TacticalTargetCandidate | null => {
  const s = state;
  const tuning = resolveBehaviorTuning(s.settings);
  const playstyleVal = resolveBotKnobs(botId).aiPlaystyle;
  const playstyleFactor = playstyleVal / 100;
  const recoveringTargetBonus = (1.0 - Math.abs(playstyleFactor - 0.5) * 2.0) * 200.0;
  const targetSelectionSpatialIQ = resolveBotDerived(botId).spatialIQ;

  let bestTarget: TacticalTargetCandidate | null = null;
  let bestScore = -Infinity;

  const potentialTargets = buildPotentialTacticalTargets(s, botId, rosterAI);

  potentialTargets.forEach((target) => {
    const dist = botPos.distanceTo(target.pos);
    let score = 1000;

    if (difficulty === 'easy') {
      score -= dist * 20;
      if ((target.invulnerabilityTimer ?? 0) > 0) {
        score -= 300;
      }
    } else if (difficulty === 'normal') {
      score -= dist * 15;
      score += (target.maxHp - target.hp) * 50;
      if ((target.invulnerabilityTimer ?? 0) > 0) {
        score -= 2000;
      }
      if (target.weaponState === 'recovering') {
        score += 150 + Math.max(0, recoveringTargetBonus);
      }
    } else {
      score -= dist * 10;
      score += (target.maxHp - target.hp) * 150;

      if ((target.invulnerabilityTimer ?? 0) > 0) {
        score -= 99999;
      }

      if (target.weaponState === 'recovering') {
        score += 350 + Math.max(0, recoveringTargetBonus);
      } else if (target.weaponState === 'swing_up' || target.weaponState === 'swing_down') {
        score += 100;
      }

      const myActiveWeapon = botId === MAIN_AI_ID ? mainAI.activeWeapon : s.otherPlayers.get(botId)?.activeWeapon;
      if (myActiveWeapon === 'sword') {
        if (target.activeWeapon === 'hammer') {
          score += 100;
        }
      }

      let nearbyEnemiesCount = 0;
      potentialTargets.forEach((otherT) => {
        if (otherT.id !== target.id) {
          if (target.pos.distanceTo(otherT.pos) < 6.0) {
            nearbyEnemiesCount++;
          }
        }
      });

      if (myActiveWeapon === 'hammer') {
        score += nearbyEnemiesCount * 80;
      } else {
        score -= nearbyEnemiesCount * 120;
      }

      score += getTargetEdgeSelectionBonus({
        botX: botPos.x,
        botZ: botPos.z,
        targetX: target.pos.x,
        targetZ: target.pos.z,
        arenaRadius: s.arenaRadius,
        spatialIQ: targetSelectionSpatialIQ,
        edgeInset: tuning.arenaEdgeInset,
      });

      score += getCoordinatedTargetBonus({
        coordinator: s.aiMatchContext.coordinator,
        botId,
        targetId: target.id,
        difficulty,
      });
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  });

  return bestTarget;
};
