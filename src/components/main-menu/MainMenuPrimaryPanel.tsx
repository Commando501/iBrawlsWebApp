import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset, Keybindings, ReplayFile, TournamentState, UniversalSettings } from '../../types';
import type { CustomMapData } from '../../types';
import type { MatchLobbyConfig } from '../../network/protocol';
import type { ChatMessage } from '../ChatOverlay';
import type { MultiplayerLoadingSlotPayload } from '../loading/loadingTypes';
import type { TournamentDifficulty } from '../../features/tournament/tournament';
import type {
  GameplayConnectionMode,
  GameplayConnectionStatus,
} from '../multiplayer/multiplayerConnectionConstants';
import type { SaveSystemStatus } from '../../settings/useSaveAccountSync';
import type { CharacterLoadout } from '../VoxelModels';
import type { CustomArmorCatalog } from '../customArmor';
import type { CustomizationChild, MainMenuContentParent, MainMenuTab, SystemChild } from './useMainMenuNav';
import { MultiplayerSetupPanel } from '../multiplayer/MultiplayerSetupPanel';
import {
  TheaterLibraryPanel,
  type ReplayUploadStatus,
  type TheaterMapFilter,
  type TheaterModeFilter,
} from '../replay/TheaterLibraryPanel';
import { ManualControlsPanel } from './ManualControlsPanel';
import { VisualGamepadMapper } from './VisualGamepadMapper';
import { ArmoryPanel, type PreviewWeapon } from './ArmoryPanel';
import { SaveCodesPanel } from './SaveCodesPanel';
import { ServiceRecordPanel } from './ServiceRecordPanel';
import { SinglePlayerSetupPanel } from './SinglePlayerSetupPanel';

type SinglePlayerMode = 'sandbox' | 'tournament' | 'ai-editor';
type QuickPlayStatus = 'idle' | 'searching' | 'matching';

interface MainMenuPrimaryPanelProps {
  parent: MainMenuContentParent;
  playChild: MainMenuTab;
  customizationChild: CustomizationChild;
  systemChild: SystemChild;
  isSignedIn: boolean;
  isAdmin: boolean;
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
  chatMessages: ChatMessage[];
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
  onSendChatMessage: (text: string) => void;
  onJoinGame: (target: string, isObserver?: boolean, password?: string, inviteToken?: string) => void;
  onApplyMatchmakerUrl: () => void;
  onResetMatchmakerUrl: () => void;
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
  keybindings: Keybindings;
  setKeybindings: Dispatch<SetStateAction<Keybindings>>;
  rebindingAction: keyof Keybindings | null;
  setRebindingAction: Dispatch<SetStateAction<keyof Keybindings | null>>;
  gamepadConnected: boolean;
  gamepadName: string;
  holdingGpButton: { buttonIndex: number; name: string; progress: number } | null;
  unassignedButtonMap: number | null;
  setUnassignedButtonMap: Dispatch<SetStateAction<number | null>>;
  pressedGpButtons: boolean[];
  hoveredAction: string | null;
  setHoveredAction: Dispatch<SetStateAction<string | null>>;
  leftStickActive: boolean;
  rightStickActive: boolean;
  isPainting: boolean;
  playerLoadout: CharacterLoadout;
  customArmorCatalog: CustomArmorCatalog;
  customizerWeapon: PreviewWeapon;
  setPlayerLoadout: Dispatch<SetStateAction<CharacterLoadout>>;
  setIsPainting: Dispatch<SetStateAction<boolean>>;
  setCustomizerWeapon: Dispatch<SetStateAction<PreviewWeapon>>;
  saveSystemStatus: SaveSystemStatus;
  saveCodeImportInput: string;
  onExportSaveCode: () => void;
  onResetAllSettings: () => void;
  onSaveCodeImportInputChange: (value: string) => void;
  onImportSaveCode: (value: string) => void;
}

export function MainMenuPrimaryPanel(props: MainMenuPrimaryPanelProps) {
  const { parent, playChild, customizationChild, systemChild } = props;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-0.5 flex-1 min-w-0">
      {parent === 'play' && (
        playChild === 'single' ? (
          <SinglePlayerSetupPanel
            singlePlayerMode={props.singlePlayerMode}
            setSinglePlayerMode={props.setSinglePlayerMode}
            adminSettings={props.adminSettings}
            setAdminSettings={props.setAdminSettings}
            aiPresets={props.aiPresets}
            newAiPresetNameInput={props.newAiPresetNameInput}
            setNewAiPresetNameInput={props.setNewAiPresetNameInput}
            onSelectAIPreset={props.onSelectAIPreset}
            onDeleteAIPreset={props.onDeleteAIPreset}
            onSelectAIArchetype={props.onSelectAIArchetype}
            onSaveAIPreset={props.onSaveAIPreset}
            onOpenBotSetup={props.onOpenBotSetup}
            tournamentState={props.tournamentState}
            selectedTournamentPresets={props.selectedTournamentPresets}
            setSelectedTournamentPresets={props.setSelectedTournamentPresets}
            tournamentKillsToWin={props.tournamentKillsToWin}
            setTournamentKillsToWin={props.setTournamentKillsToWin}
            tournamentRoundCount={props.tournamentRoundCount}
            setTournamentRoundCount={props.setTournamentRoundCount}
            onInitializeTournament={props.onInitializeTournament}
            playerName={props.playerName}
            playerHue={props.playerHue}
            isPlaying={props.isPlaying}
            isAdmin={props.isAdmin}
            onStartTournamentMatch={props.onStartTournamentMatch}
            onResetTournament={props.onResetTournament}
          />
        ) : playChild === 'multi' ? (
          <MultiplayerSetupPanel
            connectionMode={props.connectionMode}
            onConnectionModeChange={props.onConnectionModeChange}
            isOnline={props.isOnline}
            userIp={props.userIp}
            lanIp={props.lanIp}
            hostIdCode={props.hostIdCode}
            connectionStatus={props.connectionStatus}
            connectionError={props.connectionError}
            quickPlayStatus={props.quickPlayStatus}
            adminSettings={props.adminSettings}
            isAdmin={props.isAdmin}
            selectedMap={props.selectedMap}
            onSelectedMapChange={props.onSelectedMapChange}
            lobbyCustomMapData={props.lobbyCustomMapData}
            onCustomMapDataChange={props.onCustomMapDataChange}
            matchLobbyConfig={props.matchLobbyConfig}
            multiplayerRole={props.multiplayerRole}
            multiplayerSocket={props.multiplayerSocket}
            multiplayerPlayerCount={props.multiplayerPlayerCount}
            lobbyParticipants={props.lobbyParticipants}
            chatMessages={props.chatMessages}
            joinIpOrId={props.joinIpOrId}
            onJoinIpOrIdChange={props.onJoinIpOrIdChange}
            customUrlInput={props.customUrlInput}
            onCustomUrlInputChange={props.onCustomUrlInputChange}
            onCancelHostOrJoin={props.onCancelHostOrJoin}
            onCancelQuickPlay={props.onCancelQuickPlay}
            onQuickPlay={props.onQuickPlay}
            onHostGame={props.onHostGame}
            onStartHostedMatch={props.onStartHostedMatch}
            onSendChatMessage={props.onSendChatMessage}
            onJoinGame={props.onJoinGame}
            onApplyMatchmakerUrl={props.onApplyMatchmakerUrl}
            onResetMatchmakerUrl={props.onResetMatchmakerUrl}
          />
        ) : (
          <TheaterLibraryPanel
            savedReplays={props.savedReplays}
            cachedReplays={props.cachedReplays}
            replaySizes={props.replaySizes}
            replayUploadStatus={props.replayUploadStatus}
            searchQuery={props.theaterSearchQuery}
            mapFilter={props.theaterMapFilter}
            modeFilter={props.theaterModeFilter}
            onSearchQueryChange={props.setTheaterSearchQuery}
            onMapFilterChange={props.setTheaterMapFilter}
            onModeFilterChange={props.setTheaterModeFilter}
            onEditReplay={props.onEditReplay}
            onDeleteReplay={props.onDeleteReplay}
            onContributeReplay={props.onContributeReplay}
            onOpenHeatmapReplay={props.onOpenHeatmapReplay}
            onSaveCachedReplay={props.onSaveCachedReplay}
            onWatchReplay={props.onWatchReplay}
          />
        )
      )}

      {parent === 'customization' && (
        customizationChild === 'armory' ? (
          <ArmoryPanel
            isPainting={props.isPainting}
            playerLoadout={props.playerLoadout}
            customArmorCatalog={props.customArmorCatalog}
            playerHue={props.playerHue}
            customizerWeapon={props.customizerWeapon}
            setPlayerLoadout={props.setPlayerLoadout}
            setIsPainting={props.setIsPainting}
            setCustomizerWeapon={props.setCustomizerWeapon}
            setAdminSettings={props.setAdminSettings}
          />
        ) : customizationChild === 'hotkeys' ? (
          <ManualControlsPanel
            keybindings={props.keybindings}
            setKeybindings={props.setKeybindings}
            rebindingAction={props.rebindingAction}
            setRebindingAction={props.setRebindingAction}
          />
        ) : customizationChild === 'gamepad' ? (
          <VisualGamepadMapper
            keybindings={props.keybindings}
            setKeybindings={props.setKeybindings}
            rebindingAction={props.rebindingAction}
            setRebindingAction={props.setRebindingAction}
            gamepadConnected={props.gamepadConnected}
            gamepadName={props.gamepadName}
            holdingGpButton={props.holdingGpButton}
            unassignedButtonMap={props.unassignedButtonMap}
            setUnassignedButtonMap={props.setUnassignedButtonMap}
            pressedGpButtons={props.pressedGpButtons}
            hoveredAction={props.hoveredAction}
            setHoveredAction={props.setHoveredAction}
            leftStickActive={props.leftStickActive}
            rightStickActive={props.rightStickActive}
          />
        ) : null
      )}

      {parent === 'system' && (
        systemChild === 'service' ? (
          <ServiceRecordPanel isSignedIn={props.isSignedIn} />
        ) : (
          <SaveCodesPanel
            saveSystemStatus={props.saveSystemStatus}
            saveCodeImportInput={props.saveCodeImportInput}
            onExportSaveCode={props.onExportSaveCode}
            onResetAllSettings={props.onResetAllSettings}
            onSaveCodeImportInputChange={props.onSaveCodeImportInputChange}
            onImportSaveCode={props.onImportSaveCode}
          />
        )
      )}
    </div>
  );
}
