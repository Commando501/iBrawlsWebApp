import React from 'react';
import {
  EDGE_LOW_FPS_SUSTAINED_MS,
  EDGE_LOW_FPS_THRESHOLD,
} from '../platform/useBrowserDiagnostics';
import {
  EdgePerformanceWarningModal,
  GraphicsAccelerationWarningModal,
} from './BrowserWarningModals';
import {
  DataCollectionNotice,
  GamepadCursor,
  TerminatedOverlay,
} from './AppShellOverlays';
import { UiAdjustmentToolbar } from './hud/UiAdjustmentToolbar';
import { BotSetupOverlay } from './main-menu/BotSetupOverlay';
import {
  DirectInviteModal,
  InviteNotificationsDrawer,
} from './multiplayer/InviteOverlays';
import { PauseOverlay } from './pause/PauseOverlay';
import {
  ReplayEditModal,
  ReplaySaveCachedModal,
} from './replay/ReplayArchiveModals';

type PauseOverlayProps = React.ComponentProps<typeof PauseOverlay>;
type UiAdjustmentToolbarProps = React.ComponentProps<typeof UiAdjustmentToolbar>;
type BotSetupOverlayProps = React.ComponentProps<typeof BotSetupOverlay>;
type ReplayEditModalProps = React.ComponentProps<typeof ReplayEditModal>;
type ReplaySaveCachedModalProps = React.ComponentProps<typeof ReplaySaveCachedModal>;
type EdgePerformanceWarningModalProps = React.ComponentProps<typeof EdgePerformanceWarningModal>;
type GraphicsAccelerationWarningModalProps = React.ComponentProps<typeof GraphicsAccelerationWarningModal>;
type DirectInviteModalProps = React.ComponentProps<typeof DirectInviteModal>;

interface AppOverlayStackProps {
  dataNotice: {
    isVisible: boolean;
    onDismiss: () => void;
  };
  terminated: {
    isVisible: boolean;
    onReboot: () => void;
  };
  pause: {
    isVisible: boolean;
    props: PauseOverlayProps;
  };
  uiAdjustment: {
    isVisible: boolean;
    position: UiAdjustmentToolbarProps['position'] | null;
    toolbarRef: UiAdjustmentToolbarProps['toolbarRef'];
    onDragStart: UiAdjustmentToolbarProps['onDragStart'];
    onReset: UiAdjustmentToolbarProps['onReset'];
    onSave: UiAdjustmentToolbarProps['onSave'];
  };
  directInvite: {
    invite: DirectInviteModalProps['invite'] | null;
    onAccept: DirectInviteModalProps['onAccept'];
    onDecline: DirectInviteModalProps['onDecline'];
  };
  botSetup: BotSetupOverlayProps;
  replayEdit: {
    isVisible: boolean;
    props: ReplayEditModalProps;
  };
  replaySaveCached: {
    isVisible: boolean;
    props: ReplaySaveCachedModalProps;
  };
  edgeWarning: {
    isVisible: boolean;
    currentFps?: EdgePerformanceWarningModalProps['currentFps'];
    edgeLowFpsSampleDurationMs: EdgePerformanceWarningModalProps['edgeLowFpsSampleDurationMs'];
    graphicsCheck: EdgePerformanceWarningModalProps['graphicsCheck'];
    onDismiss: EdgePerformanceWarningModalProps['onDismiss'];
  };
  graphicsWarning: {
    isVisible: boolean;
    graphicsCheck: GraphicsAccelerationWarningModalProps['graphicsCheck'];
    hardwareTab: GraphicsAccelerationWarningModalProps['hardwareTab'];
    onHardwareTabChange: GraphicsAccelerationWarningModalProps['onHardwareTabChange'];
    onDismiss: GraphicsAccelerationWarningModalProps['onDismiss'];
  };
  inviteNotifications: string[];
  controllerCursorRef: React.Ref<HTMLDivElement>;
}

export function AppOverlayStack({
  dataNotice,
  terminated,
  pause,
  uiAdjustment,
  directInvite,
  botSetup,
  replayEdit,
  replaySaveCached,
  edgeWarning,
  graphicsWarning,
  inviteNotifications,
  controllerCursorRef,
}: AppOverlayStackProps) {
  return (
    <>
      {dataNotice.isVisible && (
        <DataCollectionNotice onDismiss={dataNotice.onDismiss} />
      )}

      {terminated.isVisible && (
        <TerminatedOverlay onReboot={terminated.onReboot} />
      )}

      {pause.isVisible && (
        <PauseOverlay
          showAdminPanel={pause.props.showAdminPanel}
          showLightingMenu={pause.props.showLightingMenu}
          showKeybindsMenu={pause.props.showKeybindsMenu}
          multiplayerRole={pause.props.multiplayerRole}
          isMultiplayer={pause.props.isMultiplayer}
          debugMode={pause.props.debugMode}
          isReplay={pause.props.isReplay}
          onResume={pause.props.onResume}
          onJoinPlayer={pause.props.onJoinPlayer}
          onJoinObserver={pause.props.onJoinObserver}
          onResetMatch={pause.props.onResetMatch}
          onOpenBotSetup={pause.props.onOpenBotSetup}
          onOpenKeybindings={pause.props.onOpenKeybindings}
          onOpenUiAdjustment={pause.props.onOpenUiAdjustment}
          onOpenLighting={pause.props.onOpenLighting}
          onOpenAdminPanel={pause.props.onOpenAdminPanel}
          onToggleDebugMode={pause.props.onToggleDebugMode}
          onExitReplay={pause.props.onExitReplay}
          onReturnToMain={pause.props.onReturnToMain}
          selectedPresetName={pause.props.selectedPresetName}
          gameplayPresets={pause.props.gameplayPresets}
          newPresetNameInput={pause.props.newPresetNameInput}
          setNewPresetNameInput={pause.props.setNewPresetNameInput}
          officialPresetName={pause.props.officialPresetName}
          multiplayerPreset={pause.props.multiplayerPreset}
          onSelectPreset={pause.props.onSelectPreset}
          onSavePreset={pause.props.onSavePreset}
          onDeletePreset={pause.props.onDeletePreset}
          adminSettings={pause.props.adminSettings}
          setAdminSettings={pause.props.setAdminSettings}
          collapsedSections={pause.props.collapsedSections}
          onToggleSection={pause.props.onToggleSection}
          onCloseAdminPanel={pause.props.onCloseAdminPanel}
          keybindsModalTab={pause.props.keybindsModalTab}
          setKeybindsModalTab={pause.props.setKeybindsModalTab}
          keybindings={pause.props.keybindings}
          setKeybindings={pause.props.setKeybindings}
          rebindingAction={pause.props.rebindingAction}
          setRebindingAction={pause.props.setRebindingAction}
          forceMobileControls={pause.props.forceMobileControls}
          setForceMobileControls={pause.props.setForceMobileControls}
          gamepadConnected={pause.props.gamepadConnected}
          gamepadName={pause.props.gamepadName}
          holdingGpButton={pause.props.holdingGpButton}
          unassignedButtonMap={pause.props.unassignedButtonMap}
          setUnassignedButtonMap={pause.props.setUnassignedButtonMap}
          pressedGpButtons={pause.props.pressedGpButtons}
          hoveredAction={pause.props.hoveredAction}
          setHoveredAction={pause.props.setHoveredAction}
          leftStickActive={pause.props.leftStickActive}
          rightStickActive={pause.props.rightStickActive}
          onCloseKeybindings={pause.props.onCloseKeybindings}
          onCloseLighting={pause.props.onCloseLighting}
        />
      )}

      {uiAdjustment.isVisible && uiAdjustment.position && (
        <UiAdjustmentToolbar
          position={uiAdjustment.position}
          toolbarRef={uiAdjustment.toolbarRef}
          onDragStart={uiAdjustment.onDragStart}
          onReset={uiAdjustment.onReset}
          onSave={uiAdjustment.onSave}
        />
      )}

      {directInvite.invite && (
        <DirectInviteModal
          invite={directInvite.invite}
          onAccept={directInvite.onAccept}
          onDecline={directInvite.onDecline}
        />
      )}

      <BotSetupOverlay
        isOpen={botSetup.isOpen}
        isPlaying={botSetup.isPlaying}
        offlineBotCount={botSetup.offlineBotCount}
        onOfflineBotCountChange={botSetup.onOfflineBotCountChange}
        adminSettings={botSetup.adminSettings}
        setAdminSettings={botSetup.setAdminSettings}
        playerName={botSetup.playerName}
        selectedMap={botSetup.selectedMap}
        onSelectedMapChange={botSetup.onSelectedMapChange}
        lobbyCustomMapData={botSetup.lobbyCustomMapData}
        onCustomMapDataChange={botSetup.onCustomMapDataChange}
        botColors={botSetup.botColors}
        setBotColors={botSetup.setBotColors}
        botDifficulties={botSetup.botDifficulties}
        setBotDifficulties={botSetup.setBotDifficulties}
        botArchetypes={botSetup.botArchetypes}
        setBotArchetypes={botSetup.setBotArchetypes}
        botModelTypes={botSetup.botModelTypes}
        setBotModelTypes={botSetup.setBotModelTypes}
        aiPresets={botSetup.aiPresets}
        onClose={botSetup.onClose}
        onApplyAndResume={botSetup.onApplyAndResume}
        onInitializeSimulation={botSetup.onInitializeSimulation}
      />

      {replayEdit.isVisible && (
        <ReplayEditModal
          name={replayEdit.props.name}
          description={replayEdit.props.description}
          onNameChange={replayEdit.props.onNameChange}
          onDescriptionChange={replayEdit.props.onDescriptionChange}
          onClose={replayEdit.props.onClose}
          onUpdate={replayEdit.props.onUpdate}
        />
      )}

      {replaySaveCached.isVisible && (
        <ReplaySaveCachedModal
          name={replaySaveCached.props.name}
          description={replaySaveCached.props.description}
          onNameChange={replaySaveCached.props.onNameChange}
          onDescriptionChange={replaySaveCached.props.onDescriptionChange}
          onClose={replaySaveCached.props.onClose}
          onCommit={replaySaveCached.props.onCommit}
        />
      )}

      {edgeWarning.isVisible && (
        <EdgePerformanceWarningModal
          currentFps={edgeWarning.currentFps}
          edgeLowFpsSampleDurationMs={edgeWarning.edgeLowFpsSampleDurationMs}
          graphicsCheck={edgeWarning.graphicsCheck}
          lowFpsThreshold={EDGE_LOW_FPS_THRESHOLD}
          sustainedMs={EDGE_LOW_FPS_SUSTAINED_MS}
          onDismiss={edgeWarning.onDismiss}
        />
      )}

      {graphicsWarning.isVisible && (
        <GraphicsAccelerationWarningModal
          graphicsCheck={graphicsWarning.graphicsCheck}
          hardwareTab={graphicsWarning.hardwareTab}
          onHardwareTabChange={graphicsWarning.onHardwareTabChange}
          onDismiss={graphicsWarning.onDismiss}
        />
      )}

      <InviteNotificationsDrawer notifications={inviteNotifications} />
      <GamepadCursor ref={controllerCursorRef} />
    </>
  );
}
