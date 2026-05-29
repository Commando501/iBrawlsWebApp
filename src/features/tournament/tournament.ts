import { TournamentMatch, TournamentOpponent, AIPreset } from '../../types';
import {
  applyPersonalityKnobs,
  pickRandomArchetype,
  playstyleToBehavior,
} from '../../game/aiPersonalities';

export const TOURNAMENT_BOT_NAMES = [
  'Talon', 'Malcom', 'Sark', 'Brock', 'Lauren', 'Xan', 'Ravage', 'Diva', 'Gorge', 'Ares', 'Kraken'
];

export const TOURNAMENT_DEFAULT_KILLS_TO_WIN = 25;
export const TOURNAMENT_MIN_KILLS_TO_WIN = 5;
export const TOURNAMENT_MAX_KILLS_TO_WIN = 50;
export const TOURNAMENT_DEFAULT_ROUND_COUNT = 3;
export const TOURNAMENT_MIN_ROUND_COUNT = 1;
export const TOURNAMENT_MAX_ROUND_COUNT = 4;

export type TournamentDifficulty = 'easy' | 'normal' | 'hard' | 'nightmare';

export function getTournamentBotCount(roundCount: number): number {
  return Math.pow(2, roundCount) - 1;
}

export function getTournamentRoundLabels(roundCount: number): string[] {
  const labels: string[] = [];
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    const roundsRemaining = roundCount - roundIndex;
    if (roundsRemaining === 1) labels.push('Final');
    else if (roundsRemaining === 2) labels.push('Semifinals');
    else if (roundsRemaining === 3) labels.push('Quarterfinals');
    else labels.push(`Round of ${Math.pow(2, roundsRemaining)}`);
  }
  return labels;
}

export function buildInitialTournamentRounds(roundCount: number): TournamentMatch[][] {
  const rounds: TournamentMatch[][] = [];
  const firstRoundMatchCount = Math.pow(2, roundCount - 1);

  const round0: TournamentMatch[] = [
    { opponent1: 'player', opponent2: 'bot_1', isCompleted: false }
  ];

  for (let botIndex = 2; botIndex <= firstRoundMatchCount * 2 - 1; botIndex += 2) {
    round0.push({
      opponent1: `bot_${botIndex}`,
      opponent2: `bot_${botIndex + 1}`,
      isCompleted: false
    });
  }

  rounds.push(round0);

  for (let roundIndex = 1; roundIndex < roundCount; roundIndex++) {
    const matchCount = Math.pow(2, roundCount - roundIndex - 1);
    rounds.push(
      Array.from({ length: matchCount }, () => ({
        opponent1: 'TBD',
        opponent2: 'TBD',
        isCompleted: false
      }))
    );
  }

  return rounds;
}

export function buildNextTournamentRoundMatches(winners: string[]): TournamentMatch[] {
  const matches: TournamentMatch[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    matches.push({
      opponent1: winners[i],
      opponent2: winners[i + 1],
      isCompleted: false
    });
  }
  return matches;
}

export function generateTournamentOpponents(
  difficulty: TournamentDifficulty | 'custom',
  botCount: number,
  customPresets?: AIPreset[]
): Record<string, TournamentOpponent> {
  const shuffledNames = [...TOURNAMENT_BOT_NAMES].sort(() => Math.random() - 0.5);
  const opponents: Record<string, TournamentOpponent> = {};

  const botIds = Array.from({ length: botCount }, (_, index) => `bot_${index + 1}`);
  const behaviorPool: Array<'passive' | 'defensive' | 'aggressive'> = [
    'passive', 'defensive', 'aggressive', 'defensive', 'aggressive', 'defensive', 'aggressive'
  ];
  const shuffledBehaviors = Array.from({ length: botCount }, (_, index) =>
    behaviorPool[index % behaviorPool.length]
  ).sort(() => Math.random() - 0.5);

  const usePresets = customPresets && customPresets.length > 0;

  botIds.forEach((id, index) => {
    const name = shuffledNames[index % shuffledNames.length];
    const hue = Math.floor(Math.random() * 360);
    const behavior = shuffledBehaviors[index];

    let reactionLatency = 0.25;
    let anticipationFactor = 0.40;
    let movementComplexity = 50;
    let weaponSwapIQ = 50;
    let playstyle = 50;
    let resolvedBehavior: 'passive' | 'defensive' | 'aggressive' = 'defensive';
    let archetype = 'none';

    if (usePresets) {
      const preset = customPresets.length === 1
        ? customPresets[0]
        : customPresets[Math.floor(Math.random() * customPresets.length)];

      reactionLatency = preset.tuning.aiReactionLatency ?? 0.25;
      anticipationFactor = preset.tuning.aiAnticipationFactor ?? 0.40;
      movementComplexity = preset.tuning.aiMovementComplexity ?? 50;
      weaponSwapIQ = preset.tuning.aiWeaponSwapIQ ?? 50;
      playstyle = preset.tuning.aiPlaystyle ?? 50;
      resolvedBehavior = playstyleToBehavior(playstyle);
      archetype = 'none';
    } else {
      if (difficulty === 'easy') {
        reactionLatency = 0.5 + Math.random() * 0.15;
        anticipationFactor = Math.random() * 0.1;
        movementComplexity = 10 + Math.floor(Math.random() * 15);
        weaponSwapIQ = 5 + Math.floor(Math.random() * 15);
      } else if (difficulty === 'normal') {
        reactionLatency = 0.2 + Math.random() * 0.1;
        anticipationFactor = 0.3 + Math.random() * 0.2;
        movementComplexity = 40 + Math.floor(Math.random() * 20);
        weaponSwapIQ = 40 + Math.floor(Math.random() * 20);
      } else if (difficulty === 'hard') {
        reactionLatency = 0.08 + Math.random() * 0.06;
        anticipationFactor = 0.65 + Math.random() * 0.15;
        movementComplexity = 70 + Math.floor(Math.random() * 15);
        weaponSwapIQ = 70 + Math.floor(Math.random() * 15);
      } else if (difficulty === 'nightmare') {
        reactionLatency = 0.01 + Math.random() * 0.02;
        anticipationFactor = 0.9 + Math.random() * 0.09;
        movementComplexity = 90 + Math.floor(Math.random() * 10);
        weaponSwapIQ = 90 + Math.floor(Math.random() * 10);
      }

      if (behavior === 'passive') playstyle = 0 + Math.floor(Math.random() * 15);
      else if (behavior === 'defensive') playstyle = 40 + Math.floor(Math.random() * 20);
      else if (behavior === 'aggressive') playstyle = 85 + Math.floor(Math.random() * 15);

      const generatedArchetype = pickRandomArchetype();
      const personalityKnobs = applyPersonalityKnobs(
        {
          difficulty,
          reactionLatency,
          anticipationFactor,
          movementComplexity,
          weaponSwapIQ,
          aiPlaystyle: playstyle,
          weaponPrioritization: 50,
        },
        generatedArchetype
      );

      reactionLatency = personalityKnobs.reactionLatency;
      anticipationFactor = personalityKnobs.anticipationFactor;
      movementComplexity = personalityKnobs.movementComplexity;
      weaponSwapIQ = personalityKnobs.weaponSwapIQ;
      playstyle = personalityKnobs.aiPlaystyle;
      resolvedBehavior = playstyleToBehavior(playstyle);
      archetype = generatedArchetype;
    }

    opponents[id] = {
      id,
      name,
      hue,
      difficulty: usePresets ? 'custom' : difficulty as TournamentDifficulty,
      reactionLatency,
      anticipationFactor,
      movementComplexity,
      weaponSwapIQ,
      playstyle,
      behavior: resolvedBehavior,
      archetype,
    };
  });

  return opponents;
}

export const getTournamentOpponentPower = (opp: TournamentOpponent): number =>
  (1.5 - opp.reactionLatency) * 40 +
  opp.anticipationFactor * 30 +
  opp.movementComplexity * 0.2 +
  opp.weaponSwapIQ * 0.1;

export const simulateBotMatch = (
  match: TournamentMatch,
  opponents: Record<string, TournamentOpponent>,
  killsToWin: number
): TournamentMatch => {
  const opp1 = opponents[match.opponent1];
  const opp2 = opponents[match.opponent2];

  const power1 = getTournamentOpponentPower(opp1);
  const power2 = getTournamentOpponentPower(opp2);
  const prob1 = power1 / (power1 + power2);

  const winnerId = Math.random() < prob1 ? match.opponent1 : match.opponent2;
  const scoreWinner = killsToWin;
  const minLoser = Math.max(1, Math.ceil(killsToWin / 2));
  const scoreLoser = minLoser + Math.floor(Math.random() * Math.max(1, killsToWin - minLoser));

  return {
    ...match,
    winner: winnerId,
    score1: winnerId === match.opponent1 ? scoreWinner : scoreLoser,
    score2: winnerId === match.opponent2 ? scoreWinner : scoreLoser,
    isCompleted: true
  };
};
