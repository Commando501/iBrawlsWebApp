import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset, ReplayFile, TournamentState, UniversalSettings } from '../../types';
import type { CustomMapData } from '../../types';
import type { MatchLobbyConfig } from '../../network/protocol';
import type { MultiplayerLoadingSlotPayload } from '../loading/loadingTypes';
import type { TournamentDifficulty } from '../../features/tournament/tournament';
import type {
  GameplayConnectionMode,
  GameplayConnectionStatus,
} from '../multiplayer/multiplayerConnectionConstants';
import type { MainMenuTab } from './useMainMenuFrameLayout';
import { MultiplayerSetupPanel } from '../multiplayer/MultiplayerSetupPanel';
import {
  TheaterLibraryPanel,
  type ReplayUploadStatus,
  type TheaterMapFilter,
  type TheaterModeFilter,
} from '../replay/TheaterLibraryPanel';
import { SinglePlayerSetupPanel } from './SinglePlayerSetupPanel';
import { SpectatorSetupPanel } from './SpectatorSetupPanel';

type SinglePlayerMode = 'sandbox' | 'tournament';
type QuickPlayStatus = 'idle' | 'searching' | 'matching';

interface MainMenuPrimaryPanelProps {
  activeMenuTab: MainMenuTab;
  singlePlayerMode: SinglePlayerMode;
  setSinglePlayerMode: Dispatch<SetStateAction<SinglePlayerMode>>;
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  aiPresets: AIPreset[];
  newAiPresetNameInput: string;
  setNewAiPresetNameInput: Dispatch<SetStateAction<string>>;
  onSelectAIPreset: (id: string) => void;
  onDeleteAIPreset: (id: string) => void;
  onSelectAIArchetype: (id: string) => void;
  onSaveAIPreset: (name: string) => void;
  onOpenBotSetup: () => void;
  tournamentState: TournamentState | null;
  selectedTournamentPresets: string[];
  setSelectedTournamentPresets: Dispatch<SetStateAction<string[]>>;
  tournamentKillsToWin: number;
  setTournamentKillsToWin: Dispatch<SetStateAction<number>>;
  tournamentRoundCount: number;
  setTournamentRoundCount: Dispatch<SetStateAction<number>>;
  onInitializeTournament: (
    difficulty: TournamentDifficulty | 'custom',
    killsToWin?: number,
    roundCount?: number,
    selectedPresets?: AIPreset[]
  ) => void;
  playerName: string;
  playerHue: number;
  selectedMap: string;
  onSelectedMapChange: (value: string) => void;
  lobbyCustomMapData: CustomMapData | null;
  onCustomMapDataChange: (value: CustomMapData | null) => void;
  matchLobbyConfig: MatchLobbyConfig | null;
  multiplayerRole: 'host' | 'client' | 'observer' | null;
  multiplayerSocket: WebSocket | null;
  multiplayerPlayerCount: number;
  lobbyParticipants: MultiplayerLoadingSlotPayload[];
  isPlaying: boolean;
  onStartTournamentMatch: () => void;
  onResetTournament: () => void;
  connectionMode: GameplayConnectionMode;
  onConnectionModeChange: (mode: GameplayConnectionMode) => void;
  isOnline: boolean;
  userIp: string;
  lanIp: string;
  hostIdCode: string;
  connectionStatus: GameplayConnectionStatus;
  connectionError: string;
  quickPlayStatus: QuickPlayStatus;
  joinIpOrId: string;
  onJoinIpOrIdChange: (value: string) => void;
  customUrlInput: string;
  onCustomUrlInputChange: (value: string) => void;
  onCancelHostOrJoin: () => void;
  onCancelQuickPlay: () => void;
  onQuickPlay: () => void;
  onHostGame: (config: MatchLobbyConfig, password?: string) => void;
  onStartHostedMatch: () => void;
  onJoinGame: (target: string, isObserver?: boolean, password?: string, inviteToken?: string) => void;
  onApplyMatchmakerUrl: () => void;
  onResetMatchmakerUrl: () => void;
  onSpectateLiveMatch: () => void;
  savedReplays: ReplayFile[];
  cachedReplays: ReplayFile[];
  replaySizes: Record<string, number>;
  replayUploadStatus: Record<string, ReplayUploadStatus>;
  theaterSearchQuery: string;
  theaterMapFilter: TheaterMapFilter;
  theaterModeFilter: TheaterModeFilter;
  setTheaterSearchQuery: (value: string) => void;
  setTheaterMapFilter: (value: TheaterMapFilter) => void;
  setTheaterModeFilter: (value: TheaterModeFilter) => void;
  onEditReplay: (replay: ReplayFile) => void;
  onDeleteReplay: (replay: ReplayFile, isCached: boolean) => void | Promise<void>;
  onContributeReplay: (replay: ReplayFile) => void | Promise<void>;
  onOpenHeatmapReplay: (replay: ReplayFile) => void;
  onSaveCachedReplay: (replay: ReplayFile) => void;
  onWatchReplay: (replay: ReplayFile) => void;
}

export function MainMenuPrimaryPanel({
  activeMenuTab,
  singlePlayerMode,
  setSinglePlayerMode,
  adminSettings,
  setAdminSettings,
  aiPresets,
  newAiPresetNameInput,
  setNewAiPresetNameInput,
  onSelectAIPreset,
  onDeleteAIPreset,
  onSelectAIArchetype,
  onSaveAIPreset,
  onOpenBotSetup,
  tournamentState,
  selectedTournamentPresets,
  setSelectedTournamentPresets,
  tournamentKillsToWin,
  setTournamentKillsToWin,
  tournamentRoundCount,
  setTournamentRoundCount,
  onInitializeTournament,
  playerName,
  playerHue,
  selectedMap,
  onSelectedMapChange,
  lobbyCustomMapData,
  onCustomMapDataChange,
  matchLobbyConfig,
  multiplayerRole,
  multiplayerSocket,
  multiplayerPlayerCount,
  lobbyParticipants,
  isPlaying,
  onStartTournamentMatch,
  onResetTournament,
  connectionMode,
  onConnectionModeChange,
  isOnline,
  userIp,
  lanIp,
  hostIdCode,
  connectionStatus,
  connectionError,
  quickPlayStatus,
  joinIpOrId,
  onJoinIpOrIdChange,
  customUrlInput,
  onCustomUrlInputChange,
  onCancelHostOrJoin,
  onCancelQuickPlay,
  onQuickPlay,
  onHostGame,
  onStartHostedMatch,
  onJoinGame,
  onApplyMatchmakerUrl,
  onResetMatchmakerUrl,
  onSpectateLiveMatch,
  savedReplays,
  cachedReplays,
  replaySizes,
  replayUploadStatus,
  theaterSearchQuery,
  theaterMapFilter,
  theaterModeFilter,
  setTheaterSearchQuery,
  setTheaterMapFilter,
  setTheaterModeFilter,
  onEditReplay,
  onDeleteReplay,
  onContributeReplay,
  onOpenHeatmapReplay,
  onSaveCachedReplay,
  onWatchReplay,
}: MainMenuPrimaryPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-0.5">
      {activeMenuTab === 'single' ? (
        <SinglePlayerSetupPanel
          singlePlayerMode={singlePlayerMode}
          setSinglePlayerMode={setSinglePlayerMode}
          adminSettings={adminSettings}
          setAdminSettings={setAdminSettings}
          aiPresets={aiPresets}
          newAiPresetNameInput={newAiPresetNameInput}
          setNewAiPresetNameInput={setNewAiPresetNameInput}
          onSelectAIPreset={onSelectAIPreset}
          onDeleteAIPreset={onDeleteAIPreset}
          onSelectAIArchetype={onSelectAIArchetype}
          onSaveAIPreset={onSaveAIPreset}
          onOpenBotSetup={onOpenBotSetup}
          tournamentState={tournamentState}
          selectedTournamentPresets={selectedTournamentPresets}
          setSelectedTournamentPresets={setSelectedTournamentPresets}
          tournamentKillsToWin={tournamentKillsToWin}
          setTournamentKillsToWin={setTournamentKillsToWin}
          tournamentRoundCount={tournamentRoundCount}
          setTournamentRoundCount={setTournamentRoundCount}
          onInitializeTournament={onInitializeTournament}
          playerName={playerName}
          playerHue={playerHue}
          isPlaying={isPlaying}
          onStartTournamentMatch={onStartTournamentMatch}
          onResetTournament={onResetTournament}
        />
      ) : activeMenuTab === 'multi' ? (
        <MultiplayerSetupPanel
          connectionMode={connectionMode}
          onConnectionModeChange={onConnectionModeChange}
          isOnline={isOnline}
          userIp={userIp}
          lanIp={lanIp}
          hostIdCode={hostIdCode}
          connectionStatus={connectionStatus}
          connectionError={connectionError}
          quickPlayStatus={quickPlayStatus}
          adminSettings={adminSettings}
          selectedMap={selectedMap}
          onSelectedMapChange={onSelectedMapChange}
          lobbyCustomMapData={lobbyCustomMapData}
          onCustomMapDataChange={onCustomMapDataChange}
          matchLobbyConfig={matchLobbyConfig}
          multiplayerRole={multiplayerRole}
          multiplayerSocket={multiplayerSocket}
          multiplayerPlayerCount={multiplayerPlayerCount}
          lobbyParticipants={lobbyParticipants}
          joinIpOrId={joinIpOrId}
          onJoinIpOrIdChange={onJoinIpOrIdChange}
          customUrlInput={customUrlInput}
          onCustomUrlInputChange={onCustomUrlInputChange}
          onCancelHostOrJoin={onCancelHostOrJoin}
          onCancelQuickPlay={onCancelQuickPlay}
          onQuickPlay={onQuickPlay}
          onHostGame={onHostGame}
          onStartHostedMatch={onStartHostedMatch}
          onJoinGame={onJoinGame}
          onApplyMatchmakerUrl={onApplyMatchmakerUrl}
          onResetMatchmakerUrl={onResetMatchmakerUrl}
        />
      ) : activeMenuTab === 'spec' ? (
        <SpectatorSetupPanel onSpectateLiveMatch={onSpectateLiveMatch} />
      ) : (
        <TheaterLibraryPanel
          savedReplays={savedReplays}
          cachedReplays={cachedReplays}
          replaySizes={replaySizes}
          replayUploadStatus={replayUploadStatus}
          searchQuery={theaterSearchQuery}
          mapFilter={theaterMapFilter}
          modeFilter={theaterModeFilter}
          onSearchQueryChange={setTheaterSearchQuery}
          onMapFilterChange={setTheaterMapFilter}
          onModeFilterChange={setTheaterModeFilter}
          onEditReplay={onEditReplay}
          onDeleteReplay={onDeleteReplay}
          onContributeReplay={onContributeReplay}
          onOpenHeatmapReplay={onOpenHeatmapReplay}
          onSaveCachedReplay={onSaveCachedReplay}
          onWatchReplay={onWatchReplay}
        />
      )}
    </div>
  );
}
