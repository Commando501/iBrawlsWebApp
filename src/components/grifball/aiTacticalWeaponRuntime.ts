import { evaluateTacticalWeaponChoice, type TacticalWeaponActor, type TacticalWeaponChoiceContext } from '../../game/aiTacticalWeaponChoice';
import type { AIMatchScoreContext } from '../../game/aiTuning';
import { MAIN_AI_ID } from '../../game/roster';
import type { Combatant } from '../../types';
import type { TacticalTargetCandidate } from './combatGeometry';
import type { GrifballRuntimeState } from './runtimeState';
import { chooseGrifballRunnerPursuit } from '../../game/aiGrifballRunnerPursuit';

export type { TacticalWeaponChoiceContext } from '../../game/aiTacticalWeaponChoice';

export function evaluateTacticalWeaponChoiceForState({ state, botId, target, difficulty, context = {},
  mainAI, pressureAggression, scoreContext }: {
  state: GrifballRuntimeState;
  botId: string;
  target: TacticalTargetCandidate;
  difficulty: string;
  context?: TacticalWeaponChoiceContext;
  mainAI: Combatant | undefined;
  pressureAggression: number;
  scoreContext: AIMatchScoreContext;
}) {
  const self = (botId === MAIN_AI_ID ? mainAI : state.otherPlayers.get(botId)) ?? {
    id: botId, hp: 1, maxHp: 1, pos: { x: 0, y: 0, z: 0 }, activeWeapon: 'hammer' as const,
  };
  const actors: TacticalWeaponActor[] = [...state.otherPlayers.values()];
  // Older callers can supply the main actor separately. Shared counting removes
  // that alias when the authoritative roster already contains it.
  if (mainAI) actors.push(mainAI);
  actors.push({ id: 'player', team: state.localPlayerTeam, pos: state.playerPos,
    hp: state.playerHP, maxHp: state.playerMaxHP, respawnTimer: state.playerRespawnTimer,
    activeWeapon: state.activeWeapon, isObserver: state.isObserverMode });
  return evaluateTacticalWeaponChoice({ settings: state.settings, self, actors, target,
    difficulty, context: { ...context, runnerPursuit: (() => {
      const plan = state.aiMatchContext.grifballTeamPlan, assignment = plan.assignments.get(botId);
      if (state.isMultiplayer || state.grifball.phase !== 'playing' || state.grifball.ball.state !== 'held' || state.grifball.ball.holderId !== target.id || !assignment) return null;
      const current = state.otherPlayers.get(botId), observedSelf = plan.snapshot?.players.find(p => p.id === botId);
      if (!current || observedSelf?.space?.weapon !== current.activeWeapon || current.isLunging || current.hp <= 0 ||
        current.controller !== 'ai' || current.activeWeapon !== 'sword' && (current.swapLockoutTimer ?? 0) > 0) return null;
      const players = (plan.snapshot?.players ?? []).map(p => p.id === target.id ? { ...p, pos: target.pos, vel: target.vel ?? p.vel,
        height: target.pos.y, invulnerabilityTimer: target.invulnerabilityTimer, space: p.space ? { ...p.space, weapon: target.activeWeapon, phase: target.weaponState } : undefined } : p);
      return chooseGrifballRunnerPursuit(assignment, players, self.pos);
    })() }, pressureAggression, scoreContext });
}
