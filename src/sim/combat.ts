/**
 * Combat (deathmatch) objective tick — the combat-mode counterpart to
 * `grifball.tickGrifballObjective`. No ball, no plates: a phase machine runs
 * countdown → playing, and the first team to reach the kill target
 * (`state.match.goalTarget`, reused as the kill target) wins and ends the match.
 *
 * Kills themselves are awarded in the weapons step (`awardTeamKill`), so this tick just
 * advances the clock and checks the win condition. Respawns are handled by the shared
 * `tickRespawns` in `step.ts`, so downed combatants keep coming back until someone wins.
 */

import { type UniversalSettings } from '../types';
import { resolveMatchConfig } from '../game/grifballMatch';
import { getTeamTally, type TeamId } from '../game/teamScoring';
import { type SimState } from './simState';
import { type ObjectiveEvents } from './grifball';

/** Team with the most kills that has reached the target, or null if none yet. */
function leadingTeamAtTarget(state: SimState, target: number): TeamId | null {
  let best: TeamId | null = null;
  let bestKills = target - 1;
  for (const team of Object.keys(state.scores)) {
    const kills = getTeamTally(state.scores, team).kills;
    if (kills >= target && kills > bestKills) {
      bestKills = kills;
      best = team;
    }
  }
  return best;
}

/** Advance the combat match one tick. Returns objective events (goal/pickup unused). */
export function tickCombat(
  state: SimState,
  settings: UniversalSettings,
  dt: number
): ObjectiveEvents {
  const events: ObjectiveEvents = {
    startedPlaying: false,
    goal: null,
    pickup: null,
    roundReset: false,
    matchEnded: false,
  };
  const m = state.match;
  const config = resolveMatchConfig(settings);

  if (m.phase === 'countdown') {
    m.phaseTimer += dt;
    if (m.phaseTimer >= config.countdownDuration) {
      m.phase = 'playing';
      m.phaseTimer = 0;
      events.startedPlaying = true;
    }
    return events;
  }

  if (m.phase === 'playing') {
    m.phaseTimer += dt;
    const winner = leadingTeamAtTarget(state, m.goalTarget);
    if (winner) {
      m.winningTeam = winner;
      m.lastScoringTeam = winner;
      m.phase = 'matchEnd';
      events.matchEnded = true;
    }
  }

  return events;
}
