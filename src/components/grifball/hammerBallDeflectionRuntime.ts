import { deflectBallWithHammer } from '../../game/hammerBallDeflection';
import type { Vec3 } from '../../game/grifballBall';
import { isOnlineGrifballAuthority } from './onlineGrifballRuntime';
import type { GrifballRuntimeState } from './runtimeState';

export function deflectBallWithHammerForState(
  state: GrifballRuntimeState, attackerPos: Vec3, impactPos: Vec3, radius: number,
): boolean {
  if (state.settings.gameMode !== 'grifball' || state.grifball.phase !== 'playing' ||
      state.isMultiplayer && !isOnlineGrifballAuthority(state)) return false;
  return deflectBallWithHammer(state.grifball.ball, attackerPos, impactPos, radius, state.settings);
}
