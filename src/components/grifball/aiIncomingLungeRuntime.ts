import { resolveTargetLungeDirection } from '../../game/aiSpatialStrategy';
import { type Combatant } from '../../types';
import { type TacticalTargetCandidate } from './combatGeometry';

type LungeDirLike = { x: number; z: number };

export function resolveIncomingLungeDirectionForTarget({
  target,
  toTarget,
  playerIsLunging,
  playerLungeDir,
  mainAi,
  targetOtherBot,
}: {
  target: TacticalTargetCandidate;
  toTarget: LungeDirLike;
  playerIsLunging: boolean;
  playerLungeDir: LungeDirLike;
  mainAi: Pick<Combatant, 'aiState' | 'lungeTargetDir'> | undefined;
  targetOtherBot: Pick<Combatant, 'isLunging' | 'lungeTargetDir'> | undefined;
}): { x: number; z: number } {
  return resolveTargetLungeDirection({
    targetId: target.id,
    toTargetX: toTarget.x,
    toTargetZ: toTarget.z,
    targetVelX: target.vel?.x,
    targetVelZ: target.vel?.z,
    playerIsLunging: target.id === 'player' && playerIsLunging,
    playerLungeDirX: playerLungeDir.x,
    playerLungeDirZ: playerLungeDir.z,
    mainAiIsLunging: target.id === 'main_ai' && mainAi?.aiState === 'LUNGING',
    mainAiLungeDirX: mainAi?.lungeTargetDir?.x || 0,
    mainAiLungeDirZ: mainAi?.lungeTargetDir?.z || 0,
    botIsLunging: !!targetOtherBot?.isLunging,
    botLungeDirX: targetOtherBot?.lungeTargetDir?.x,
    botLungeDirZ: targetOtherBot?.lungeTargetDir?.z,
  });
}
