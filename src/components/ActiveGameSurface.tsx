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
import { GameStatsView, type GameStatsStore } from './hud/useCurrentGameStats';
import { ChatOverlay, type ChatMessage } from './ChatOverlay';
import type { CharacterLoadout } from './VoxelModels';
import { MatchLoadingOverlay } from './loading/MatchLoadingOverlay';
import type { GameLoadingState, MultiplayerLoadingSnapshot } from './loading/loadingTypes';
import { ReplayHeatmapPanel } from './replay/ReplayHeatmapPanel';
import { ReplayHeatmapTheaterOverlay } from './replay/ReplayHeatmapTheaterOverlay';
import { TournamentVictoryOverlay } from './tournament/TournamentVictoryOverlay';
import type { GameplayMultiplayerRole } from './multiplayer/multiplayerConnectionConstants';
import type { MatchLobbyConfig } from '../network/protocol';
import type { VisualModelPolicy } from '../model/modelSystem';
import type { V3QualityTier } from './v3/v3ModelTypes';
import { LoadedMapIndicator } from './LoadedMapIndicator';

type SinglePlayerMode = 'sandbox' | 'tournament' | 'ai-editor';

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
  trainingMapSnapshot?: CustomMapData | null;
  playerLoadout: CharacterLoadout;
  visualModelPolicy?: VisualModelPolicy | null;
  v3QualityTier?: V3QualityTier;
  isPaused: boolean;
  isMatchLoadingActive: boolean;
  debugMode: boolean;
  effectiveAdminSettings: UniversalSettings;
  onStatsUpdate: (stats: GameStats) => void;
  onLoadingStateChange: (state: GameLoadingState) => void;
  onCancelLoading: () => void;
  onPauseToggle: () => void;
  isMultiplayer: boolean;
  multiplayerRole: GameplayMultiplayerRole;
  multiplayerSocket: WebSocket | null;
  gameplayClientId?: string;
  matchLobbyConfig: MatchLobbyConfig | null;
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
  statsStore: GameStatsStore;
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

export function resolveActiveGameSettings(
  effectiveAdminSettings: UniversalSettings,
  isTournamentMatch: boolean
): UniversalSettings {
  if (!isTournamentMatch || effectiveAdminSettings.gameMode !== 'grifball') {
    return effectiveAdminSettings;
  }

  return {
    ...effectiveAdminSettings,
    gameMode: 'sandbox',
  };
}

/** Both the renderer and status use this exact session snapshot. */
export function resolveSessionCustomMap({ selectedMap, selectedReplay, lobbyCustomMapData, isMultiplayer, matchLobbyConfig, singlePlayerMode, trainingMapSnapshot }: Pick<ActiveGameSurfaceProps,
  'selectedMap' | 'selectedReplay' | 'lobbyCustomMapData' | 'isMultiplayer' | 'matchLobbyConfig' | 'singlePlayerMode' | 'trainingMapSnapshot'
>): CustomMapData | undefined {
  if (selectedReplay) return undefined; // Playback resolves its own recorded geometry.
  if (selectedMap === 'custom_file') return lobbyCustomMapData ?? undefined;
  if (isMultiplayer) return matchLobbyConfig?.customMap?.id === selectedMap ? matchLobbyConfig.customMap : undefined;
  return singlePlayerMode === 'sandbox' && trainingMapSnapshot?.id === selectedMap ? trainingMapSnapshot : undefined;
}

export function ActiveGameSurface({
  isPlaying,
  isTerminated,
  selectedMap,
  lobbyCustomMapData,
  trainingMapSnapshot,
  playerLoadout,
  visualModelPolicy,
  v3QualityTier,
  isPaused,
  isMatchLoadingActive,
  debugMode,
  effectiveAdminSettings,
  onStatsUpdate,
  onLoadingStateChange,
  onCancelLoading,
  onPauseToggle,
  isMultiplayer,
  multiplayerRole,
  multiplayerSocket,
  gameplayClientId,
  matchLobbyConfig,
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
  statsStore,
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
  const activeGameSettings = resolveActiveGameSettings(effectiveAdminSettings, isTournamentMatch);
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
    : isMultiplayer && activeGameSettings.gameMode !== 'grifball'
      ? (activeGameSettings.iBrawlsKillTarget ?? 25)
    : undefined;
  const chatRole = multiplayerRole === 'observer' ? null : multiplayerRole;
  const activeCustomMap = resolveSessionCustomMap({ selectedMap, selectedReplay, lobbyCustomMapData, isMultiplayer, matchLobbyConfig, singlePlayerMode, trainingMapSnapshot });

  return (
    <>
      {isPlaying && !isTerminated && (
        <GrifballGame
          isPlaying={isPlaying}
          selectedMap={selectedMap}
          customMap={activeCustomMap ?? undefined}
          playerLoadout={playerLoadout}
          visualModelPolicy={visualModelPolicy ?? undefined}
          v3QualityTier={v3QualityTier}
          isPaused={isPaused || isMatchLoadingActive}
          isMatchLoading={isMatchLoadingActive}
          debugMode={debugMode}
          adminSettings={activeGameSettings}
          onStatsUpdate={onStatsUpdate}
          onLoadingStateChange={onLoadingStateChange}
          onPauseToggle={onPauseToggle}
          isMultiplayer={isMultiplayer}
          multiplayerRole={multiplayerRole}
          multiplayerSocket={multiplayerSocket}
          gameplayClientId={gameplayClientId}
          matchLobbyConfig={isMultiplayer ? matchLobbyConfig : null}
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
          loadingState={gameLoadingState.ready && !gameLoadingState.error && isMultiplayer
            ? { ...gameLoadingState, visible: true, stage: 'Waiting for fireteam' }
            : gameLoadingState}
          selectedMap={selectedMap}
          customMap={activeCustomMap}
          replayData={selectedReplay}
          playerName={playerName}
          playerHue={localPlayerHue}
          playerLoadout={playerLoadout}
          visualModelPolicy={visualModelPolicy}
          participants={multiplayerLoadingSnapshot.participants}
          waitingCount={multiplayerLoadingSnapshot.waitingCount}
          onCancel={onCancelLoading}
        />
      )}

      {isPlaying && !isTerminated && !isMatchLoadingActive && !selectedReplay && activeCustomMap?.balanceScale && (
        <div className={`fixed z-40 ${multiplayerRole === 'observer' ? 'left-3 top-[28%] max-w-[calc(100vw-24px)]' : 'bottom-2 left-2 max-w-[calc(100vw-112px)] sm:left-1/2 sm:max-w-[calc(100vw-24px)] sm:-translate-x-1/2'} pointer-events-none w-max`}>
          <LoadedMapIndicator map={activeCustomMap} session={isMultiplayer
            ? multiplayerRole === 'host' ? 'Host' : multiplayerRole === 'observer' ? 'Observer' : 'Client'
            : 'Training'} />
        </div>
      )}

      <GameStatsView store={statsStore}>{currentStats => <>
      {isPlaying && (isMatchLoadingActive || !isPaused || showUiAdjustment) && (
        <HUD
          stats={currentStats}
          arenaShape={activeCustomMap?.mapShape}
          prepareForPlay={isMatchLoadingActive}
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
      </>}</GameStatsView>

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
