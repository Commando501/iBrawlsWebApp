import { evaluateKillMedals } from '../../game/rewards';
import { type Combatant, type MedalInfo } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

interface EvaluatePlayerKillMedalsOptions {
  state: GrifballRuntimeState;
  getState: () => GrifballRuntimeState;
  victimId: string;
  victim: Combatant | undefined;
  playMedal: (medalId: string) => void;
  onPopupExpired: () => void;
}

export const evaluatePlayerKillMedalsForState = ({
  state: s,
  getState,
  victimId,
  victim,
  playMedal,
  onPopupExpired,
}: EvaluatePlayerKillMedalsOptions): MedalInfo[] => {
  const now = Date.now();

  let isLunging = false;
  let spawnTime = 0;

  if (victimId !== 'player' && victim) {
    isLunging =
      victim.aiState === 'LUNGING' ||
      !!victim.isLunging ||
      victim.weaponState === 'swing_up' ||
      victim.weaponState === 'swing_down';
    spawnTime = victim.spawnTime || 0;
  }

  const result = evaluateKillMedals({
    isVictimLunging: isLunging,
    victimSpawnTime: spawnTime,
    playerHP: s.playerHP,
    playerMaxHP: s.playerMaxHP,
    playerLastKillTime: s.playerLastKillTime,
    playerMultikillCount: s.playerMultikillCount,
    playerSpreeCount: s.playerSpreeCount,
    activeWeapon: s.activeWeapon as 'hammer' | 'sword',
    now,
  });
  s.playerLastKillTime = result.playerLastKillTime;
  s.playerMultikillCount = result.playerMultikillCount;
  s.playerSpreeCount = result.playerSpreeCount;

  if (result.priorityMedal) {
    const priorityMedal = result.priorityMedal;
    playMedal(priorityMedal.id);
    s.activeMedalPopup = {
      medal: priorityMedal,
      key: Math.random(),
    };

    setTimeout(() => {
      const innerS = getState();
      if (innerS && innerS.activeMedalPopup && innerS.activeMedalPopup.medal.id === priorityMedal.id) {
        innerS.activeMedalPopup = null;
        onPopupExpired();
      }
    }, 2500);
  }

  return result.medals;
};
