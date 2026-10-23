import { chooseGrifballSwordGuard, runnerPunchClock } from '../game/aiGrifballSwordGuard';
import { getModelTargetRadiusBonus } from '../components/grifball/modelHitbox';
import { canStartAIWeaponAction } from '../game/aiWeaponTiming';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import type { SimCombatPriorityMemory } from './grifballCombatPriorities';
import { isMixedPlayer, type SimState } from './simState';
import { resolveGrifballPlayerStyle } from '../game/grifballPlayerStyles';

export function observeSimGrifballSwordGuard(state: SimState, plan: GrifballTeamPlanState, botId: string, targetId: string,
  scriptedBots: Readonly<Record<string, string>>, memory: SimCombatPriorityMemory, dt: number) {
  const assignment = plan.assignments.get(botId);
  if (assignment) delete assignment.swordGuard;
  const self = state.combatants.find(c => c.id === botId), runner = state.combatants.find(c => c.id === targetId);
  if (!assignment?.tuning?.swordGuardEnabled || !self || !runner || state.mode !== 'grifball' || state.combatExecution !== 'live-mixed-v1' ||
    state.match.phase !== 'playing' || state.match.ball.state !== 'held' || state.match.ball.holderId !== targetId ||
    !Object.hasOwn(scriptedBots, botId) || isNeuralNetDifficulty(scriptedBots[botId]) || isNeuralNetDifficulty(state.settings.aiDifficulty)) return null;
  const human = isMixedPlayer(state, runner), pitch = human ? runner.pitch ?? 0 : 0;
  const up = state.settings.hammerMeleeSpeed ?? .24, down = Math.max(.03, up * .5);
  const phase = runner.weaponState === 'windup' ? 'swing_up' : runner.weaponState === 'active' ? 'swing_down' : 'recovering';
  const elapsed = phase === 'swing_up' ? up - runner.weaponTimer : down - runner.weaponTimer;
  const result = chooseGrifballSwordGuard({ assignment, settings: state.settings, dt, pos: self.pos,
    isCrouching: self.isCrouching,
    playerStyle: resolveGrifballPlayerStyle(plan.snapshot?.tactics?.botStyles, botId),
    bodyHeight: human ? .825 : self.isCrouching ? .52 : .825, radiusBonus: getModelTargetRadiusBonus(self.modelType),
    ownGoals: state.goalPlates.filter(goal => goal.team === self.team),
    eligible: self.controller === 'ai' && !isMixedPlayer(state, self) && self.weapon === 'sword' && self.weaponState === 'idle' &&
      canStartAIWeaponAction({ ...memory, swapCooldownTimer: self.weaponReadyTimer }) &&
      self.pos.y <= .01 && self.vel.y === 0 && !self.isJumping && !self.isLunging && self.dashRemaining <= 0 && !self.slideActive &&
      self.invulnerabilityTimer <= 0 && self.alive && self.hp > 0 && self.team !== runner.team &&
      runner.alive && runner.hp > 0 && runner.respawnTimer <= 0 && runner.weapon === 'ball',
    punch: { id: targetId, pos: runner.pos,
      heading: { x: Math.sin(runner.yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(runner.yaw) * Math.cos(pitch) },
      originHeight: human ? 1.65 - (runner.crouchAmount ?? (runner.isCrouching ? .72 : 0)) : 1.2,
      bodyHeight: runner.isCrouching ? .52 : .825, radiusBonus: getModelTargetRadiusBonus(runner.modelType),
      ...runnerPunchClock(phase, Math.max(0, elapsed), state.settings) },
  });
  if (assignment && result) assignment.swordGuard = result;
  return result;
}
