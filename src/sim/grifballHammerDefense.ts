import { resolveGrifballHammerDefense } from '../game/aiGrifballHammerDefense';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { SimState, SimCombatant } from './simState';

export function observeSimGrifballHammerDefense(state: SimState, plan: GrifballTeamPlanState, actor: SimCombatant,
  scriptedBots: Readonly<Record<string, string>>, ready: boolean, dt: number) {
  if (!plan.assignments.get(actor.id)?.tuning?.hammerDefenseEnabled && !plan.hammerDefenseCommitments?.[actor.id]) {
    const assignment = plan.assignments.get(actor.id); if (assignment) delete assignment.hammerDefense;
    return null;
  }
  const allowed = state.mode === 'grifball' && state.combatExecution === 'live-mixed-v1' && state.match.phase === 'playing' &&
    actor.controller === 'ai' && actor.id !== state.localPlayerId && Object.hasOwn(scriptedBots, actor.id) &&
    !isNeuralNetDifficulty(scriptedBots[actor.id]) && !isNeuralNetDifficulty(state.settings.aiDifficulty) &&
    actor.alive && actor.hp > 0 && actor.respawnTimer <= 0 && actor.weapon === 'hammer' &&
    !actor.isLunging && !actor.isJumping && actor.pos.y <= .01 && actor.vel.y === 0 && actor.dashRemaining <= 0 && !actor.slideActive && !actor.hammerJumpPlanned;
  return resolveGrifballHammerDefense(plan, actor.id, allowed, ['windup', 'active'].includes(actor.weaponState), {
    settings: state.settings, dt, pos: actor.pos, team: actor.team, ball: state.match.ball,
    bounds: plan.snapshot?.passing?.bounds, ownGoal: plan.snapshot?.goals[actor.team], observedThrow: plan.observedThrow,
    eligible: ready && actor.weaponState === 'idle' && actor.invulnerabilityTimer <= 0,
    nearbyEnemy: state.combatants.some(p => p.id !== actor.id && p.team !== actor.team && p.alive && p.hp > 0 && p.respawnTimer <= 0 &&
      !(p.id === state.localPlayerId && state.localPlayerIsObserver) && Math.hypot(p.pos.x - actor.pos.x, p.pos.y - actor.pos.y, p.pos.z - actor.pos.z) <= 3),
  });
}
