import type React from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  AIPreset,
  AIBehaviorPreset,
  CharacterModelType,
  CustomMapData,
  DeviceInfo,
  GameStats,
  Keybindings,
  ReplayFile,
  TournamentState,
  UiElementPos,
  UniversalSettings,
} from '../types';
import type { AIArchetypeId } from '../game/aiPersonalities';
import { TOURNAMENT_DEFAULT_KILLS_TO_WIN } from '../features/tournament/tournament';
import { GrifballGame } from './GrifballGame';
import { HUD } from './HUD';
import { ChatOverlay, type ChatMessage } from './ChatOverlay';
import type { CharacterLoadout } from './VoxelModels';
import { MatchLoadingOverlay } from './loading/MatchLoadingOverlay';
import type { GameLoadingState, MultiplayerLoadingSnapshot } from './loading/loadingTypes';
import { ReplayHeatmapPanel } from './replay/ReplayHeatmapPanel';
import { ReplayHeatmapTheaterOverlay } from './replay/ReplayHeatmapTheaterOverlay';
import { TournamentVictoryOverlay } from './tournament/TournamentVictoryOverlay';
import type { GameplayMultiplayerRole } from './multiplayer/multiplayerConnectionConstants';

type SinglePlayerMode = 'sandbox' | 'tournament';

interface ReplayHeatmapPanelSize {
  width: number;
  height: number;
}

export interface ActiveGameMatchResult {
  opponentName: string;
  playerScore: number;
  opponentScore: number;
}

interface ActiveGameSurfaceProps {
  isPlaying: boolean;
  isTerminated: boolean;
  selectedMap: string;
  lobbyCustomMapData: CustomMapData | null;
  playerLoadout: CharacterLoadout;
  isPaused: boolean;
  isMatchLoadingActive: boolean;
  debugMode: boolean;
  effectiveAdminSettings: UniversalSettings;
  onStatsUpdate: (stats: GameStats) => void;
  onLoadingStateChange: (state: GameLoadingState) => void;
  onPauseToggle: () => void;
  isMultiplayer: boolean;
  multiplayerRole: GameplayMultiplayerRole;
  multiplayerSocket: WebSocket | null;
  multiplayerSpawnSlot: number;
  opponentClientId: string | undefined;
  selectedReplay: ReplayFile | null;
  onExitReplay: () => void;
  singlePlayerMode: SinglePlayerMode;
  tournamentState: TournamentState | null;
  keybindings: Keybindings;
  offlineBotCount: number;
  botDifficulties: Record<string, string>;
  botColors: Record<string, number>;
  botBehaviors: Record<string, AIBehaviorPreset>;
  botWeaponBehaviors: Record<string, string>;
  botArchetypes: Record<string, AIArchetypeId>;
  botModelTypes: Record<string, CharacterModelType>;
  aiPresets: AIPreset[];
  deviceInfo: DeviceInfo;
  forceMobileControls: boolean;
  mobileJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  mobileRightJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  mobileRightJoystickActiveRef: React.MutableRefObject<boolean>;
  gameLoadingState: GameLoadingState;
  playerName: string;
  localPlayerHue: number;
  multiplayerLoadingSnapshot: MultiplayerLoadingSnapshot;
  currentStats: GameStats;
  activeUiPositions: UiElementPos[];
  activeUiDefaults: UiElementPos[];
  onUpdateUiPositions: (positions: UiElementPos[]) => void;
  showUiAdjustment: boolean;
  replayHeatmapPanelCollapsed: boolean;
  replayHeatmapPanelSize: ReplayHeatmapPanelSize;
  onToggleReplayHeatmapPanelCollapsed: () => void;
  onReplayHeatmapResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  heatmapOnlyReplay: ReplayFile | null;
  heatmapOnlyTime: number;
  heatmapOnlyPlaying: boolean;
  onCloseHeatmapOnlyReplay: () => void;
  onHeatmapOnlyTimeChange: (time: number) => void;
  onSeekHeatmapOnlyReplay: (deltaSeconds: number) => void;
  onToggleHeatmapOnlyPlaying: () => void;
  matchResult: ActiveGameMatchResult | null;
  onReturnToTournamentBracket: (result: ActiveGameMatchResult) => void;
  chatMessages: ChatMessage[];
  onSendChatMessage: (text: string) => void;
}

export function ActiveGameSurface({
  isPlaying,
  isTerminated,
  selectedMap,
  lobbyCustomMapData,
  playerLoadout,
  isPaused,
  isMatchLoadingActive,
  debugMode,
  effectiveAdminSettings,
  onStatsUpdate,
  onLoadingStateChange,
  onPauseToggle,
  isMultiplayer,
  multiplayerRole,
  multiplayerSocket,
  multiplayerSpawnSlot,
  opponentClientId,
  selectedReplay,
  onExitReplay,
  singlePlayerMode,
  tournamentState,
  keybindings,
  offlineBotCount,
  botDifficulties,
  botColors,
  botBehaviors,
  botWeaponBehaviors,
  botArchetypes,
  botModelTypes,
  aiPresets,
  deviceInfo,
  forceMobileControls,
  mobileJoystickRef,
  mobileRightJoystickRef,
  mobileRightJoystickActiveRef,
  gameLoadingState,
  playerName,
  localPlayerHue,
  multiplayerLoadingSnapshot,
  currentStats,
  activeUiPositions,
  activeUiDefaults,
  onUpdateUiPositions,
  showUiAdjustment,
  replayHeatmapPanelCollapsed,
  replayHeatmapPanelSize,
  onToggleReplayHeatmapPanelCollapsed,
  onReplayHeatmapResizePointerDown,
  heatmapOnlyReplay,
  heatmapOnlyTime,
  heatmapOnlyPlaying,
  onCloseHeatmapOnlyReplay,
  onHeatmapOnlyTimeChange,
  onSeekHeatmapOnlyReplay,
  onToggleHeatmapOnlyPlaying,
  matchResult,
  onReturnToTournamentBracket,
  chatMessages,
  onSendChatMessage,
}: ActiveGameSurfaceProps) {
  const isTournamentMatch = singlePlayerMode === 'tournament' && tournamentState?.status === 'playing';
  const tournamentMatch = isTournamentMatch
    ? tournamentState.rounds[tournamentState.currentRound]?.[tournamentState.currentMatchIndex]
    : undefined;
  const opponentPlayerName = tournamentMatch
    ? tournamentState?.opponents[tournamentMatch.opponent2]?.name
    : undefined;
  const aiMatchSessionKey = isTournamentMatch && tournamentState
    ? `tournament-r${tournamentState.currentRound}-m${tournamentState.currentMatchIndex}`
    : 'sandbox';
  const matchKillsToWin = isTournamentMatch && tournamentState
    ? (tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN)
    : isMultiplayer && effectiveAdminSettings.gameMode !== 'grifball'
      ? (effectiveAdminSettings.iBrawlsKillTarget ?? 25)
    : undefined;
  const chatRole = multiplayerRole === 'observer' ? null : multiplayerRole;

  return (
    <>
      {isPlaying && !isTerminated && (
        <GrifballGame
          isPlaying={isPlaying}
          selectedMap={selectedMap}
          customMap={selectedMap === 'custom_file' ? (lobbyCustomMapData || undefined) : undefined}
          playerLoadout={playerLoadout}
          isPaused={isPaused || isMatchLoadingActive}
          debugMode={debugMode}
          adminSettings={effectiveAdminSettings}
          onStatsUpdate={onStatsUpdate}
          onLoadingStateChange={onLoadingStateChange}
          onPauseToggle={onPauseToggle}
          isMultiplayer={isMultiplayer}
          multiplayerRole={multiplayerRole}
          multiplayerSocket={multiplayerSocket}
          multiplayerSpawnSlot={multiplayerSpawnSlot}
          opponentClientId={opponentClientId}
          replayData={selectedReplay}
          onExitReplay={onExitReplay}
          opponentPlayerName={opponentPlayerName}
          keybindings={keybindings}
          offlineBotCount={offlineBotCount}
          botDifficulties={botDifficulties}
          botColors={botColors}
          botBehaviors={botBehaviors}
          botWeaponBehaviors={botWeaponBehaviors}
          botArchetypes={botArchetypes}
          botModelTypes={botModelTypes}
          aiPresets={aiPresets}
          aiMatchSessionKey={aiMatchSessionKey}
          matchKillsToWin={matchKillsToWin}
          deviceInfo={deviceInfo}
          forceMobileControls={forceMobileControls}
          mobileJoystickRef={mobileJoystickRef}
          mobileRightJoystickRef={mobileRightJoystickRef}
          mobileRightJoystickActiveRef={mobileRightJoystickActiveRef}
        />
      )}

      {isMatchLoadingActive && (
        <MatchLoadingOverlay
          mode={isMultiplayer ? 'multiplayer' : selectedReplay ? 'replay' : 'solo'}
          loadingState={gameLoadingState.ready && isMultiplayer
            ? { ...gameLoadingState, visible: true, stage: 'Waiting for fireteam' }
            : gameLoadingState}
          selectedMap={selectedMap}
          customMap={selectedMap === 'custom_file' ? lobbyCustomMapData : undefined}
          replayData={selectedReplay}
          playerName={playerName}
          playerHue={localPlayerHue}
          playerLoadout={playerLoadout}
          participants={multiplayerLoadingSnapshot.participants}
          waitingCount={multiplayerLoadingSnapshot.waitingCount}
        />
      )}

      {isPlaying && !isMatchLoadingActive && (!isPaused || showUiAdjustment) && (
        <HUD
          stats={currentStats}
          onPauseClick={onPauseToggle}
          uiPositions={activeUiPositions}
          uiDefaultPositions={activeUiDefaults}
          onUpdateUiPositions={onUpdateUiPositions}
          isAdjustmentMode={showUiAdjustment}
          deviceInfo={deviceInfo}
          forceMobileControls={forceMobileControls}
          mobileJoystickRef={mobileJoystickRef}
          mobileRightJoystickRef={mobileRightJoystickRef}
          mobileRightJoystickActiveRef={mobileRightJoystickActiveRef}
        />
      )}

      {isPlaying && !isMatchLoadingActive && selectedReplay && (
        <ReplayHeatmapPanel
          replay={selectedReplay}
          elapsedTime={currentStats.replayElapsedTime ?? 0}
          collapsed={replayHeatmapPanelCollapsed}
          size={replayHeatmapPanelSize}
          onToggleCollapsed={onToggleReplayHeatmapPanelCollapsed}
          onResizePointerDown={onReplayHeatmapResizePointerDown}
        />
      )}

      {heatmapOnlyReplay && (
        <ReplayHeatmapTheaterOverlay
          replay={heatmapOnlyReplay}
          time={heatmapOnlyTime}
          isPlaying={heatmapOnlyPlaying}
          onExit={onCloseHeatmapOnlyReplay}
          onTimeChange={onHeatmapOnlyTimeChange}
          onSeekBy={onSeekHeatmapOnlyReplay}
          onTogglePlaying={onToggleHeatmapOnlyPlaying}
        />
      )}

      {isPlaying && matchResult && (
        <TournamentVictoryOverlay
          opponentName={matchResult.opponentName}
          playerScore={matchResult.playerScore}
          opponentScore={matchResult.opponentScore}
          onReturnToBracket={() => onReturnToTournamentBracket(matchResult)}
        />
      )}

      {isPlaying && !isMatchLoadingActive && isMultiplayer && (
        <ChatOverlay
          messages={chatMessages}
          onSendMessage={onSendChatMessage}
          isMultiplayer={isMultiplayer}
          multiplayerRole={chatRole}
          deviceInfo={deviceInfo}
        />
      )}
    </>
  );
}
