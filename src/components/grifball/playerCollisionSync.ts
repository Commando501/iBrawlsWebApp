import { MAIN_AI_ID } from '../../game/roster';
import { type CharacterModelType, type Combatant } from '../../types';
import { resolveCombatantBodyCollisions, type CombatantColliderEntity } from './bodyCollisions';
import { type GrifballRuntimeState } from './runtimeState';

export function resolvePlayerCombatantCollisionsForState({
  state,
  mainAI,
  playerModelType,
}: {
  state: GrifballRuntimeState;
  mainAI: Combatant | undefined;
  playerModelType?: CharacterModelType;
}): void {
  if (state.isObserverMode) return;

  const colliders: CombatantColliderEntity[] = [];

  if (state.playerHP > 0) {
    colliders.push({
      id: 'player',
      pos: state.playerPos,
      vel: state.playerVel,
      isCrouching: !!state.isCrouching,
      modelType: playerModelType,
    });
  }

  const mainAIDead = !mainAI || mainAI.hp <= 0 || mainAI.aiState === 'RESPAWNING';
  if (mainAI && !mainAIDead && !state.isMultiplayer) {
    colliders.push({
      id: MAIN_AI_ID,
      pos: mainAI.pos,
      vel: mainAI.vel,
      isCrouching: !!mainAI.isCrouching,
      modelType: mainAI.modelType,
    });
  }

  state.otherPlayers.forEach((bot, id) => {
    if (id === MAIN_AI_ID) return;
    if (bot.hp > 0 && bot.respawnTimer <= 0 && !bot.isObserver && bot.pos && bot.vel) {
      colliders.push({
        id,
        pos: bot.pos,
        vel: bot.vel,
        isCrouching: !!bot.isCrouching,
        modelType: bot.modelType,
      });
    }
  });

  resolveCombatantBodyCollisions(colliders);
}
