import type * as THREE from 'three';
import { getCoordinatedTargetBonus, type BotCoordinatorState } from './aiBotCoordinator';
import { getTargetEdgeSelectionBonus } from './aiSpatialStrategy';
import type { TacticalTargetCandidate } from '../components/grifball/combatGeometry';

/** Live tactical ranking over an explicitly ordered, already-filtered roster.
 * Equal scores retain the first candidate; the caller owns roster ordering. */
export function selectBestTacticalTarget({ botId, botPos, difficulty, myActiveWeapon,
  aiPlaystyle, targetSelectionSpatialIQ, arenaRadius, edgeInset, coordinator, potentialTargets }: {
  botId: string; botPos: THREE.Vector3; difficulty: string;
  myActiveWeapon: 'hammer' | 'sword' | 'ball' | undefined;
  aiPlaystyle: number; targetSelectionSpatialIQ: number; arenaRadius: number; edgeInset: number;
  coordinator: BotCoordinatorState; potentialTargets: TacticalTargetCandidate[];
}): TacticalTargetCandidate | null {
  const playstyleFactor = aiPlaystyle / 100;
  const recoveringTargetBonus = (1.0 - Math.abs(playstyleFactor - 0.5) * 2.0) * 200.0;
  let bestTarget: TacticalTargetCandidate | null = null;
  let bestScore = -Infinity;

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
        arenaRadius: arenaRadius,
        spatialIQ: targetSelectionSpatialIQ,
        edgeInset: edgeInset,
      });

      score += getCoordinatedTargetBonus({
        coordinator: coordinator,
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
}
