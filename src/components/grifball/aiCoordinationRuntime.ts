import {
  getAttackPhaseIndex,
  getEngagingBotIds,
  shouldDeferCoordinatedAttack,
  shouldPunisherHold,
  type BotCoordinatorState,
} from '../../game/aiBotCoordinator';
import { type Combatant } from '../../types';

type AttackState = Pick<Combatant, 'aiState' | 'weaponState' | 'isLunging'>;

const isCombatantAttacking = (combatant: AttackState | undefined): boolean =>
  !!combatant &&
  (combatant.aiState === 'LUNGING' ||
    combatant.isLunging ||
    combatant.weaponState === 'swing_up' ||
    combatant.weaponState === 'swing_down');

export function isEarlierPhaseAllyAttackingTarget({
  coordinator,
  botId,
  targetId,
  difficulty,
  mainAI,
  otherPlayers,
}: {
  coordinator: BotCoordinatorState;
  botId: string;
  targetId: string;
  difficulty: string;
  mainAI: AttackState | undefined;
  otherPlayers: Map<string, Combatant>;
}): boolean {
  const coordRoleInput = { coordinator, botId, targetId, difficulty };
  const engaging = getEngagingBotIds(coordinator, targetId);
  const myPhase = getAttackPhaseIndex(coordRoleInput);

  for (const allyId of engaging) {
    if (allyId === botId) continue;
    const allyPhase = getAttackPhaseIndex({
      coordinator,
      botId: allyId,
      targetId,
      difficulty,
    });
    if (allyPhase >= myPhase) continue;

    const ally = allyId === 'main_ai' ? mainAI : otherPlayers.get(allyId);
    if (isCombatantAttacking(ally)) {
      return true;
    }
  }

  return false;
}

export function shouldBlockCoordinatedAttackForFrame({
  coordinator,
  botId,
  targetId,
  difficulty,
  commitTimer,
  attackStaggerStep,
  targetWeaponState,
  targetRecovering,
  mainAI,
  otherPlayers,
}: {
  coordinator: BotCoordinatorState;
  botId: string;
  targetId: string;
  difficulty: string;
  commitTimer: number;
  attackStaggerStep: number;
  targetWeaponState: string | undefined;
  targetRecovering: boolean;
  mainAI: AttackState | undefined;
  otherPlayers: Map<string, Combatant>;
}): boolean {
  const coordRoleInput = { coordinator, botId, targetId, difficulty };
  const allyAttacking = isEarlierPhaseAllyAttackingTarget({
    coordinator,
    botId,
    targetId,
    difficulty,
    mainAI,
    otherPlayers,
  });

  return (
    shouldDeferCoordinatedAttack({
      ...coordRoleInput,
      commitTimer,
      allyAttacking,
    }, attackStaggerStep) ||
    shouldPunisherHold({
      ...coordRoleInput,
      targetWeaponState: targetWeaponState ?? '',
      targetRecovering,
    })
  );
}
