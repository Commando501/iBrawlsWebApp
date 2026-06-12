import { MedalInfo } from '../types';
import { buildMedal } from './medalCatalog';

export type RewardWeapon = 'hammer' | 'sword';

export interface MedalEvaluationInput {
  isVictimLunging: boolean;
  victimSpawnTime: number;
  playerHP: number;
  playerMaxHP: number;
  playerLastKillTime: number;
  playerMultikillCount: number;
  playerSpreeCount: number;
  activeWeapon: RewardWeapon;
  now: number;
}

export interface MedalEvaluationResult {
  medals: MedalInfo[];
  playerLastKillTime: number;
  playerMultikillCount: number;
  playerSpreeCount: number;
  priorityMedal: MedalInfo | null;
}

const PRIORITY_MEDAL_IDS = new Set([
  'double',
  'triple',
  'overkill',
  'bulltrue',
  'spawnslayer',
  'killingspree',
]);

export function getPriorityMedal(medals: MedalInfo[]): MedalInfo | null {
  return medals.find(medal => PRIORITY_MEDAL_IDS.has(medal.id)) ?? medals[0] ?? null;
}

export function evaluateKillMedals(input: MedalEvaluationInput): MedalEvaluationResult {
  const medals: MedalInfo[] = [];

  if (input.isVictimLunging) {
    medals.push(buildMedal('bulltrue'));
  }

  if (input.victimSpawnTime > 0 && input.now - input.victimSpawnTime <= 1000) {
    medals.push(buildMedal('spawnslayer'));
  }

  if (input.playerMaxHP > 1 && input.playerHP === 1) {
    medals.push(buildMedal('closecall'));
  }

  const playerMultikillCount =
    input.playerLastKillTime > 0 && input.now - input.playerLastKillTime <= 3000
      ? input.playerMultikillCount + 1
      : 1;

  if (playerMultikillCount === 2) {
    medals.push(buildMedal('double'));
  } else if (playerMultikillCount === 3) {
    medals.push(buildMedal('triple'));
  } else if (playerMultikillCount >= 4) {
    medals.push(buildMedal('overkill', {
      name: playerMultikillCount === 4 ? 'Overkill' : `Multikill x${playerMultikillCount}`,
      description: `${playerMultikillCount} kills within 3 seconds of each other!`,
    }));
  }

  const playerSpreeCount = input.playerSpreeCount + 1;
  if (playerSpreeCount === 5) {
    medals.push(buildMedal('killingspree'));
  }

  if (input.activeWeapon === 'hammer') {
    medals.push(buildMedal('hammertime'));
  } else if (input.activeWeapon === 'sword') {
    medals.push(buildMedal('swordslayer'));
  }

  return {
    medals,
    playerLastKillTime: input.now,
    playerMultikillCount,
    playerSpreeCount,
    priorityMedal: getPriorityMedal(medals),
  };
}
