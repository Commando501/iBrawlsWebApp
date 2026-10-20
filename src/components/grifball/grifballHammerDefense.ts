import { resolveGrifballHammerDefense } from '../../game/aiGrifballHammerDefense';
import { isNeuralNetDifficulty } from '../../game/neuralBrains';
import type { Combatant } from '../../types';
import type { GrifballAIObjectiveState, GrifballAIObjectiveFrame } from './grifballAIObjectiveMovement';

export function observeLiveGrifballHammerDefense(state: GrifballAIObjectiveState, self: Combatant,
  frame: GrifballAIObjectiveFrame, ready: boolean, dt: number) {
  const plan = state.aiMatchContext.grifballTeamPlan;
  if (!plan.assignments.get(self.id)?.tuning?.hammerDefenseEnabled && !plan.hammerDefenseCommitments?.[self.id]) {
    const assignment = plan.assignments.get(self.id); if (assignment) delete assignment.hammerDefense;
    return null;
  }
  const allowed = !state.isMultiplayer && state.settings.gameMode === 'grifball' && state.grifball.phase === 'playing' &&
    self.controller === 'ai' && !isNeuralNetDifficulty(self.difficulty) && !isNeuralNetDifficulty(state.settings.aiDifficulty) &&
    self.hp > 0 && self.respawnTimer <= 0 && self.activeWeapon === 'hammer' &&
    !self.isLunging && !self.isJumping && frame.pos.y <= .01 && frame.vel.y === 0 && frame.dashRemaining <= 0 && !frame.slideActive && !self.hammerJumpPlanned;
  const nearbyEnemy = [...state.otherPlayers.values()].some(p => p.id !== self.id && p.team !== self.team && p.hp > 0 && p.respawnTimer <= 0 && p.pos.distanceTo(frame.pos) <= 3) ||
    !state.isObserverMode && state.playerHP > 0 && state.playerRespawnTimer <= 0 && state.localPlayerTeam !== self.team && state.playerPos.distanceTo(frame.pos) <= 3;
  return resolveGrifballHammerDefense(plan, self.id, allowed, ['swing_up', 'swing_down'].includes(frame.weaponState), {
    settings: state.settings, dt, pos: frame.pos, team: self.team ?? '', ball: state.grifball.ball,
    bounds: plan.snapshot?.passing?.bounds, ownGoal: self.team ? plan.snapshot?.goals[self.team] : undefined,
    observedThrow: plan.observedThrow, eligible: ready && frame.weaponState === 'ready' && !(self.invulnerabilityTimer! > 0), nearbyEnemy,
  });
}
