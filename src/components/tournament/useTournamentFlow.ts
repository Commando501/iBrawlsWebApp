import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset, AIBehaviorPreset, TournamentState, UniversalSettings } from '../../types';
import { sfx } from '../AudioEngine';
import {
  TOURNAMENT_DEFAULT_KILLS_TO_WIN,
  TOURNAMENT_DEFAULT_ROUND_COUNT,
  type TournamentDifficulty,
  buildInitialTournamentRounds,
  buildNextTournamentRoundMatches,
  generateTournamentOpponents,
  getTournamentBotCount,
  simulateBotMatch,
} from '../../features/tournament/tournament';
import { getArchetypeDef, type AIArchetypeId } from '../../game/aiPersonalities';

type SinglePlayerMode = 'sandbox' | 'tournament';
type MultiplayerRole = 'host' | 'client' | 'observer' | null;

interface UseTournamentFlowOptions {
  playerName: string;
  multiplayerSocket: WebSocket | null;
  setIsMultiplayer: Dispatch<SetStateAction<boolean>>;
  setMultiplayerRole: Dispatch<SetStateAction<MultiplayerRole>>;
  setMultiplayerSocket: Dispatch<SetStateAction<WebSocket | null>>;
  setMultiplayerPlayerCount: Dispatch<SetStateAction<number>>;
  setMultiplayerSpawnSlot: Dispatch<SetStateAction<number>>;
  setOfflineBotCount: Dispatch<SetStateAction<number>>;
  setBotColors: Dispatch<SetStateAction<Record<string, number>>>;
  setBotDifficulties: Dispatch<SetStateAction<Record<string, string>>>;
  setBotBehaviors: Dispatch<SetStateAction<Record<string, AIBehaviorPreset>>>;
  setBotArchetypes: Dispatch<SetStateAction<Record<string, AIArchetypeId>>>;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setIsTerminated: Dispatch<SetStateAction<boolean>>;
  setShowAdminPanel: Dispatch<SetStateAction<boolean>>;
  setShowUiAdjustment: Dispatch<SetStateAction<boolean>>;
  setShowLightingMenu: Dispatch<SetStateAction<boolean>>;
  onCloseTournamentGame: () => void;
}

const TOURNAMENT_STORAGE_KEY = 'ibrawls_tournament_state';

const loadTournamentState = (): TournamentState | null => {
  try {
    const saved = localStorage.getItem(TOURNAMENT_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

const persistTournamentState = (state: TournamentState | null) => {
  if (state) {
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(TOURNAMENT_STORAGE_KEY);
  }
};

const resetTournamentBotArchetypes = (mainArchetype: AIArchetypeId): Record<string, AIArchetypeId> => ({
  main_ai: mainArchetype,
  bot_2: 'none',
  bot_3: 'none',
  bot_4: 'none',
  bot_5: 'none',
  bot_6: 'none',
  bot_7: 'none',
});

export function useTournamentFlow({
  playerName,
  multiplayerSocket,
  setIsMultiplayer,
  setMultiplayerRole,
  setMultiplayerSocket,
  setMultiplayerPlayerCount,
  setMultiplayerSpawnSlot,
  setOfflineBotCount,
  setBotColors,
  setBotDifficulties,
  setBotBehaviors,
  setBotArchetypes,
  setAdminSettings,
  setIsPlaying,
  setIsPaused,
  setIsTerminated,
  setShowAdminPanel,
  setShowUiAdjustment,
  setShowLightingMenu,
  onCloseTournamentGame,
}: UseTournamentFlowOptions) {
  const [singlePlayerMode, setSinglePlayerMode] = useState<SinglePlayerMode>('sandbox');
  const [tournamentState, setTournamentState] = useState<TournamentState | null>(loadTournamentState);
  const [tournamentKillsToWin, setTournamentKillsToWin] = useState(TOURNAMENT_DEFAULT_KILLS_TO_WIN);
  const [tournamentRoundCount, setTournamentRoundCount] = useState(TOURNAMENT_DEFAULT_ROUND_COUNT);
  const [selectedTournamentPresets, setSelectedTournamentPresets] = useState<string[]>([]);

  const saveTournamentState = useCallback((state: TournamentState | null) => {
    setTournamentState(state);
    persistTournamentState(state);
  }, []);

  const handleInitializeTournament = useCallback((
    difficulty: TournamentDifficulty | 'custom',
    killsToWin: number = TOURNAMENT_DEFAULT_KILLS_TO_WIN,
    roundCount: number = TOURNAMENT_DEFAULT_ROUND_COUNT,
    selectedPresets?: AIPreset[]
  ) => {
    const opponents = generateTournamentOpponents(difficulty, getTournamentBotCount(roundCount), selectedPresets);
    const rounds = buildInitialTournamentRounds(roundCount);

    saveTournamentState({
      difficulty,
      killsToWin,
      roundCount,
      currentRound: 0,
      currentMatchIndex: 0,
      opponents,
      rounds,
      status: 'bracket',
    });
    setSinglePlayerMode('tournament');
  }, [saveTournamentState]);

  const handleStartTournamentMatch = useCallback(() => {
    if (!tournamentState) return;

    const roundIndex = tournamentState.currentRound;
    const matchIndex = tournamentState.currentMatchIndex;
    const match = tournamentState.rounds[roundIndex][matchIndex];
    const opponent = tournamentState.opponents[match.opponent2];
    if (!opponent) return;

    sfx.init();
    sfx.resume();
    sfx.playRespawn();

    setIsMultiplayer(false);
    setMultiplayerRole(null);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setMultiplayerSocket(null);

    setOfflineBotCount(1);
    setBotColors({ main_ai: opponent.hue });
    setBotDifficulties({ main_ai: 'custom' });
    setBotBehaviors({ main_ai: opponent.behavior });

    const opponentArchetype = (opponent.archetype ?? 'none') as AIArchetypeId;
    setBotArchetypes(resetTournamentBotArchetypes(opponentArchetype));

    setAdminSettings(prev => ({
      ...prev,
      aiDifficulty: 'custom',
      aiReactionLatency: opponent.reactionLatency,
      aiAnticipationFactor: opponent.anticipationFactor,
      aiMovementComplexity: opponent.movementComplexity,
      aiWeaponSwapIQ: opponent.weaponSwapIQ,
      aiPlaystyle: opponent.playstyle,
      aiWeaponPrioritization: getArchetypeDef(opponentArchetype)?.knobOverrides.aiWeaponPrioritization ?? prev.aiWeaponPrioritization ?? 50,
      aiArchetype: opponentArchetype,
      playerName,
    }));

    saveTournamentState({
      ...tournamentState,
      status: 'playing',
    });

    setIsPlaying(true);
    setIsPaused(false);
    setIsTerminated(false);
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  }, [
    tournamentState,
    multiplayerSocket,
    playerName,
    saveTournamentState,
    setAdminSettings,
    setBotArchetypes,
    setBotBehaviors,
    setBotColors,
    setBotDifficulties,
    setIsMultiplayer,
    setIsPaused,
    setIsPlaying,
    setIsTerminated,
    setMultiplayerPlayerCount,
    setMultiplayerRole,
    setMultiplayerSocket,
    setMultiplayerSpawnSlot,
    setOfflineBotCount,
    setShowAdminPanel,
    setShowLightingMenu,
    setShowUiAdjustment,
  ]);

  const handleCompleteTournamentMatch = useCallback((playerWon: boolean, scorePlayer: number, scoreEnemy: number) => {
    if (!tournamentState) return;

    const roundIndex = tournamentState.currentRound;
    const matchIndex = tournamentState.currentMatchIndex;
    const rounds = [...tournamentState.rounds];
    const opponents = tournamentState.opponents;

    const playerMatch = {
      ...rounds[roundIndex][matchIndex],
      winner: playerWon ? 'player' : rounds[roundIndex][matchIndex].opponent2,
      score1: scorePlayer,
      score2: scoreEnemy,
      isCompleted: true,
    };
    rounds[roundIndex][matchIndex] = playerMatch;

    if (!playerWon) {
      saveTournamentState({
        ...tournamentState,
        rounds,
        status: 'gameover',
      });
      onCloseTournamentGame();
      return;
    }

    const killsToWin = tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN;
    const simulatedMatches = rounds[roundIndex].map((match, idx) => {
      if (idx === 0) return playerMatch;
      return simulateBotMatch(match, opponents, killsToWin);
    });
    rounds[roundIndex] = simulatedMatches;

    const totalRounds = tournamentState.roundCount ?? tournamentState.rounds.length;
    if (roundIndex === totalRounds - 1) {
      saveTournamentState({
        ...tournamentState,
        rounds,
        status: 'victory',
      });
      onCloseTournamentGame();
      return;
    }

    const nextRoundIndex = roundIndex + 1;
    const currentWinners = simulatedMatches.map(match => match.winner!);
    rounds[nextRoundIndex] = buildNextTournamentRoundMatches(currentWinners);

    saveTournamentState({
      ...tournamentState,
      currentRound: nextRoundIndex,
      rounds,
      status: 'bracket',
    });
    onCloseTournamentGame();
  }, [onCloseTournamentGame, saveTournamentState, tournamentState]);

  const handleResetTournament = useCallback(() => {
    saveTournamentState(null);
    setSinglePlayerMode('tournament');
  }, [saveTournamentState]);

  return {
    singlePlayerMode,
    setSinglePlayerMode,
    tournamentState,
    tournamentKillsToWin,
    setTournamentKillsToWin,
    tournamentRoundCount,
    setTournamentRoundCount,
    selectedTournamentPresets,
    setSelectedTournamentPresets,
    handleInitializeTournament,
    handleStartTournamentMatch,
    handleCompleteTournamentMatch,
    handleResetTournament,
  };
}
