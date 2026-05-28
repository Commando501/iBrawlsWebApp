import { MedalInfo } from '../types';

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
  'showstopper',
  'spawnslayer',
  'killingspree',
]);

export function getPriorityMedal(medals: MedalInfo[]): MedalInfo | null {
  return medals.find(medal => PRIORITY_MEDAL_IDS.has(medal.id)) ?? medals[0] ?? null;
}

export function evaluateKillMedals(input: MedalEvaluationInput): MedalEvaluationResult {
  const medals: MedalInfo[] = [];

  if (input.isVictimLunging) {
    medals.push({
      id: 'showstopper',
      name: 'Showstopper',
      icon: 'showstopper',
      color: 'rgb(239, 68, 68)',
      description: 'Killed an opponent during their sword lunge!'
    });
  }

  if (input.victimSpawnTime > 0 && input.now - input.victimSpawnTime <= 1000) {
    medals.push({
      id: 'spawnslayer',
      name: 'Spawn Slayer',
      icon: 'spawnslayer',
      color: 'rgb(34, 197, 94)',
      description: 'Killed an opponent within 1 second of spawning!'
    });
  }

  if (input.playerMaxHP > 1 && input.playerHP === 1) {
    medals.push({
      id: 'closecall',
      name: 'Close Call',
      icon: 'closecall',
      color: 'rgb(249, 115, 22)',
      description: 'Killed an opponent while near death!'
    });
  }

  const playerMultikillCount =
    input.playerLastKillTime > 0 && input.now - input.playerLastKillTime <= 3000
      ? input.playerMultikillCount + 1
      : 1;

  if (playerMultikillCount === 2) {
    medals.push({
      id: 'double',
      name: 'Double Kill',
      icon: 'double',
      color: 'rgb(34, 211, 238)',
      description: '2 kills within 3 seconds!'
    });
  } else if (playerMultikillCount === 3) {
    medals.push({
      id: 'triple',
      name: 'Triple Kill',
      icon: 'triple',
      color: 'rgb(234, 179, 8)',
      description: '3 kills within 3 seconds!'
    });
  } else if (playerMultikillCount >= 4) {
    medals.push({
      id: 'overkill',
      name: playerMultikillCount === 4 ? 'Overkill' : `Multikill x${playerMultikillCount}`,
      icon: 'quadra',
      color: 'rgb(168, 85, 247)',
      description: `${playerMultikillCount} kills within 3 seconds of each other!`
    });
  }

  const playerSpreeCount = input.playerSpreeCount + 1;
  if (playerSpreeCount === 5) {
    medals.push({
      id: 'killingspree',
      name: 'Killing Spree',
      icon: 'killingspree',
      color: 'rgb(249, 115, 22)',
      description: '5 kills without dying!'
    });
  }

  if (input.activeWeapon === 'hammer') {
    medals.push({
      id: 'hammertime',
      name: 'Hammer Time',
      icon: 'hammertime',
      color: 'rgb(244, 63, 94)',
      description: 'Eliminated an opponent with the Gravity Hammer!'
    });
  } else if (input.activeWeapon === 'sword') {
    medals.push({
      id: 'swordslayer',
      name: 'Sword Slayer',
      icon: 'swordslayer',
      color: 'rgb(6, 182, 212)',
      description: 'Eliminated an opponent with the Katar Sword!'
    });
  }

  return {
    medals,
    playerLastKillTime: input.now,
    playerMultikillCount,
    playerSpreeCount,
    priorityMedal: getPriorityMedal(medals),
  };
}
