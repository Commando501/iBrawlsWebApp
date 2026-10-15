import { clearBotEngagements, setTacticalBotEngagements, tickBotCoordinator, type BotCoordinatorState, type BotCoordRole } from './aiBotCoordinator';
import { selectGrifballAssignmentThreat, type GrifballTeamPlanState, type GrifballTacticalPlayer } from './aiGrifballTeamPlan';

/** Once per advancing game frame, before roster revival and team planning.
 * Tactical orders persist through clearing until the fresh plan replaces them. */
export function beginAICoordinationFrame(coordinator: BotCoordinatorState, dt: number, priorityTargetTtl: number): void {
  tickBotCoordinator(coordinator, dt, priorityTargetTtl);
  clearBotEngagements(coordinator);
}

/** Publish the same frozen plan to all actors before any actor moves. */
export function publishGrifballTacticalEngagements(coordinator: BotCoordinatorState,
  plan: GrifballTeamPlanState, players: GrifballTacticalPlayer[]): void {
  const engagements: [string, { targetId: string; role: BotCoordRole }][] = [];
  for (const a of plan.assignments.values()) {
    const bot = players.find(p => p.id === a.botId);
    if (!bot) continue;
    const targetId = selectGrifballAssignmentThreat(a, bot.pos, players);
    if (targetId && (a.defense || a.tanking?.attack && targetId === a.tanking.targetId))
      engagements.push([a.botId, { targetId, role: a.tanking?.mode === 'punish' ? 'flanker' : 'pressure' }]);
  }
  setTacticalBotEngagements(coordinator, engagements);
}
