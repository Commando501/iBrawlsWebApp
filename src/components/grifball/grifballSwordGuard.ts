import { chooseGrifballSwordGuard, runnerPunchClock } from '../../game/aiGrifballSwordGuard';
import { getModelTargetRadiusBonus } from './modelHitbox';
import type { GrifballRuntimeState } from './runtimeState';
import type { Combatant, CustomMapData } from '../../types';
import { getGoalPlates } from '../../game/grifballGoals';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';

export function observeLiveGrifballSwordGuard(state: GrifballRuntimeState, self: Combatant, targetId: string,
  canStartWeaponAction: boolean, dt: number, map: CustomMapData | null) {
  const assignment = state.aiMatchContext.grifballTeamPlan.assignments.get(self.id);
  if (assignment) delete assignment.swordGuard;
  if (!assignment?.tuning?.swordGuardEnabled || isNeuralNetDifficulty(self.difficulty) || isNeuralNetDifficulty(state.settings.aiDifficulty) ||
    state.settings.gameMode !== 'grifball' || state.isMultiplayer || state.grifball.phase !== 'playing' || state.grifball.ball.state !== 'held' ||
    state.grifball.ball.holderId !== targetId) return null;
  const runner = targetId === 'player' ? null : state.otherPlayers.get(targetId);
  if (targetId !== 'player' && !runner) return null;
  const human = !runner || runner.controller === 'remote', yaw = runner?.yaw ?? state.yaw;
  const pitch = human ? runner?.pitch ?? state.pitch : 0;
  const pos = runner?.pos ?? state.playerPos;
  const team = runner?.team ?? state.localPlayerTeam;
  const result = chooseGrifballSwordGuard({ assignment, settings: state.settings, dt, pos: self.pos,
    bodyHeight: human ? .825 : self.isCrouching ? .52 : .825, radiusBonus: getModelTargetRadiusBonus(self.modelType),
    ownGoals: getGoalPlates(map).filter(goal => goal.team === self.team),
    eligible: self.controller === 'ai' && self.activeWeapon === 'sword' && self.weaponState === 'ready' &&
      canStartWeaponAction && self.pos.y <= .01 && self.vel.y === 0 && !self.isJumping && !self.isLunging &&
      !(self.aiDashRemaining! > 0) && !self.aiSlideActive && !(self.invulnerabilityTimer! > 0) &&
      self.hp > 0 && self.team !== team && (runner?.hp ?? state.playerHP) > 0 &&
      (runner?.respawnTimer ?? state.playerRespawnTimer) <= 0 && (runner?.activeWeapon ?? state.activeWeapon) === 'ball',
    punch: { id: targetId, pos, heading: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) },
      originHeight: human ? 1.65 - (runner ? runner.isCrouching ? .72 : 0 : state.crouchAmount) : 1.2,
      bodyHeight: runner?.isCrouching || !runner && state.isCrouching ? .52 : .825,
      radiusBonus: getModelTargetRadiusBonus(runner?.modelType ?? state.playerModelType),
      ...runnerPunchClock(runner?.weaponState ?? state.pWeaponState, runner?.weaponTimer ?? state.pWeaponTimer, state.settings) },
  });
  if (assignment && result) assignment.swordGuard = result;
  return result;
}
