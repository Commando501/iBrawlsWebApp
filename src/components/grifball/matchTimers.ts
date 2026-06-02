import { type Combatant } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

export function updateGrifballMatchTimers(
  state: GrifballRuntimeState,
  mainAI: Combatant | undefined,
  dt: number
): void {
  state.gameTime -= dt;
  if (state.gameTime < 0) {
    state.gameTime = 0;
  }

  if (state.lastStrikeTick > 0) {
    state.lastStrikeTick -= dt * 1.5;
  }
  if (state.lastAIStrikeTick > 0) {
    state.lastAIStrikeTick -= dt * 1.5;
  }

  if (state.pHammerJumpWindowTimer > 0) {
    state.pHammerJumpWindowTimer = Math.max(0, state.pHammerJumpWindowTimer - dt);
  }
  if (mainAI && mainAI.hammerJumpWindowTimer > 0) {
    mainAI.hammerJumpWindowTimer = Math.max(0, mainAI.hammerJumpWindowTimer - dt);
  }

  state.otherPlayers.forEach((other) => {
    if (other.respawnTimer > 0) {
      other.respawnTimer = Math.max(0, other.respawnTimer - dt);
    }
    if (other.invulnerabilityTimer > 0) {
      other.invulnerabilityTimer = Math.max(0, other.invulnerabilityTimer - dt);
    }
  });
}
