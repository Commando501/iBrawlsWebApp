/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayerSettings } from './settings/usePlayerSettings';
import { useSaveAccountSync } from './settings/useSaveAccountSync';
import {
  OFFICIAL_MP_PRESET_NAME,
  useGameplayPresetControls,
} from './settings/useGameplayPresetControls';
import { useAiPresetControls } from './settings/useAiPresetControls';
import { useKeybindingControls } from './settings/useKeybindingControls';
import { ActiveGameSurface } from './components/ActiveGameSurface';
import { AppOverlayStack } from './components/AppOverlayStack';
import { useTheaterReplays } from './components/replay/useTheaterReplays';
import { useTournamentFlow } from './components/tournament/useTournamentFlow';
import { useAppSessionState } from './components/useAppSessionState';
import { useAppLifecycleActions, useCloseTournamentGameAction } from './components/useAppLifecycleActions';
import { useAppStatsUpdateHandler } from './components/useAppStatsUpdateHandler';
import { MainMenuOverlay } from './components/main-menu/MainMenuOverlay';
import { getMainMenuContentParent, useMainMenuNav, type MainMenuTab } from './components/main-menu/useMainMenuNav';
import { useMainMenuAdminState } from './components/main-menu/useMainMenuAdminState';
import { useBotSetupState } from './components/main-menu/useBotSetupState';
import { useCustomizationState } from './components/main-menu/useCustomizationState';
import {
  useBrowserDiagnostics,
} from './platform/useBrowserDiagnostics';
import { useLobbyConnection } from './components/multiplayer/useLobbyConnection';
import { useGameplayConnection } from './components/multiplayer/useGameplayConnection';
import { useMatchmakerEndpoint } from './components/multiplayer/useMatchmakerEndpoint';
import { useMultiplayerSessionState } from './components/multiplayer/useMultiplayerSessionState';
import { useHudLayoutControls } from './components/hud/useHudLayoutControls';
import { useCurrentGameStats } from './components/hud/useCurrentGameStats';
import { useMatchLoadingGate } from './components/loading/useMatchLoadingGate';
import { statTracker } from './stats/statTracker';
import { useStatCloudSync } from './stats/useStatCloudSync';

export { createHighFidelityObjectMesh } from './components/main-menu/MapPreview';

const APP_VERSION = '0.650a';

// Visual Keyboard + Mouse keybind editor component
export default function App() {
  const {
    forceMobileControls,
    setForceMobileControls,
    isPlaying,
    setIsPlaying,
    matchResult,
    setMatchResult,
    showDataNotice,
    dismissDataNotice,
    isPaused,
    setIsPaused,
    debugMode,
    isTerminated,
    setIsTerminated,
    showAdminPanel,
    setShowAdminPanel,
    showUiAdjustment,
    setShowUiAdjustment,
    showLightingMenu,
    setShowLightingMenu,
    showKeybindsMenu,
    setShowKeybindsMenu,
    chatMessages,
    setChatMessages,
    closeGamePanels,
    toggleDebugMode,
    handlePauseToggle,
  } = useAppSessionState();

  // Mobile touch joysticks references for 60fps low-latency input
  const mobileJoystickRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const mobileRightJoystickRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const mobileRightJoystickActiveRef = useRef<boolean>(false);
  const {
    deviceInfo,
    isOnline,
    graphicsCheck,
    showGraphicsWarning,
    dismissGraphicsWarning,
    edgeLowFpsSampleDurationMs,
    showEdgePerformanceWarning,
    dismissEdgePerformanceWarning,
    hardwareTab,
    setHardwareTab,
    trackEdgeLowFps,
  } = useBrowserDiagnostics({
    isPlaying,
    isPaused,
  });
  const {
    offlineBotCount,
    setOfflineBotCount,
    botDifficulties,
    setBotDifficulties,
    botBehaviors,
    setBotBehaviors,
    botWeaponBehaviors,
    botArchetypes,
    setBotArchetypes,
    botModelTypes,
    setBotModelTypes,
    botColors,
    setBotColors,
    showBotSetupMenu,
    setShowBotSetupMenu,
    selectedMap,
    setSelectedMap,
    lobbyCustomMapData,
    setLobbyCustomMapData,
  } = useBotSetupState();
  const {
    customizerWeapon,
    setCustomizerWeapon,
    isPainting,
    setIsPainting,
    playerLoadout,
    setPlayerLoadout,
    customArmorCatalog,
    setCustomArmorCatalog,
  } = useCustomizationState();

  const {
    keybindings,
    setKeybindings,
    rebindingAction,
    setRebindingAction,
    keybindsModalTab,
    setKeybindsModalTab,
    gamepadConnected,
    gamepadName,
    holdingGpButton,
    unassignedButtonMap,
    setUnassignedButtonMap,
    pressedGpButtons,
    hoveredAction,
    setHoveredAction,
    leftStickActive,
    rightStickActive,
    controllerCursorRef,
  } = useKeybindingControls({
    isPlaying,
    isPaused,
    deviceInfo,
    forceMobileControls,
    hasMatchResult: matchResult !== null,
  });

  // Multiplayer States
  const {
    connectionMode,
    setConnectionMode,
    isMultiplayer,
    setIsMultiplayer,
    multiplayerRole,
    setMultiplayerRole,
    multiplayerSocket,
    setMultiplayerSocket,
    connectionStatus,
    setConnectionStatus,
    connectionError,
    setConnectionError,
    opponentClientId,
    setOpponentClientId,
    multiplayerPlayerCount,
    setMultiplayerPlayerCount,
    multiplayerSpawnSlot,
    setMultiplayerSpawnSlot,
    gameplayClientId,
    setGameplayClientId,
    matchLobbyConfig,
    setMatchLobbyConfig,
    handleHostGameRef,
    handleJoinGameRef,
  } = useMultiplayerSessionState();

  const handleMainMenuNavChange = useCallback(() => {
    setIsPainting(false);
    setRebindingAction(null);
  }, []);

  const {
    nav: mainMenuNav,
    selectParent: selectMainMenuParent,
    selectPlayChild: selectMainMenuPlayChild,
    selectCustomizationChild: selectMainMenuCustomizationChild,
    selectSystemChild: selectMainMenuSystemChild,
  } = useMainMenuNav({ onNavChange: handleMainMenuNavChange });
  const activeMenuTab = mainMenuNav.playChild;
  const activeMenuContentParent = getMainMenuContentParent(mainMenuNav);

  const handleReplayWatchSelected = useCallback(() => {
    setIsPlaying(true);
    setIsPaused(false);
  }, []);

  const {
    selectedReplay,
    setSelectedReplay,
    savedReplays,
    cachedReplays,
    replaySizes,
    replayUploadStatus,
    heatmapOnlyReplay,
    heatmapOnlyTime,
    heatmapOnlyPlaying,
    replayHeatmapPanelCollapsed,
    replayHeatmapPanelSize,
    theaterSearchQuery,
    theaterMapFilter,
    theaterModeFilter,
    setTheaterSearchQuery,
    setTheaterMapFilter,
    setTheaterModeFilter,
    editReplayName,
    editReplayDesc,
    showEditModal,
    setEditReplayName,
    setEditReplayDesc,
    saveCachedName,
    saveCachedDesc,
    showSaveModal,
    setSaveCachedName,
    setSaveCachedDesc,
    setHeatmapOnlyTime,
    handleOpenHeatmapReplay,
    handleWatchReplay,
    handleEditReplay,
    handleSaveCachedReplay,
    handleDeleteTheaterReplay,
    handleContributeReplay,
    handleReplayHeatmapResizePointerDown,
    handleToggleReplayHeatmapPanelCollapsed,
    handleCloseHeatmapOnlyReplay,
    handleSeekHeatmapOnlyReplay,
    handleToggleHeatmapOnlyPlaying,
    handleCloseEditReplayModal,
    handleUpdateReplayMeta,
    handleCloseSaveCachedModal,
    handleCommitCachedReplay,
  } = useTheaterReplays({
    isTheaterTabActive: activeMenuContentParent === 'play' && mainMenuNav.playChild === 'theater',
    onWatchReplay: handleReplayWatchSelected,
  });

  const {
    uiLayouts,
    activeUiDefaults,
    activeUiPositions,
    uiAdjusterPosition,
    uiAdjusterToolbarRef,
    applySavedUiLayouts,
    resetUiLayouts,
    handleUpdateUiPositions,
    handleResetUiPositions,
    handleUiAdjusterPointerDown,
  } = useHudLayoutControls({
    isMobile: deviceInfo.isMobile,
    showUiAdjustment,
  });


  const {
    adminSettings,
    setAdminSettings,
    playerName,
    setPlayerName,
    localPlayerHue,
    getSavedPlayerHue,
    handlePlayerNameChange,
  } = usePlayerSettings();

  // Account session + cloud settings sync
  const {
    showAdminDashboard,
    setShowAdminDashboard,
    closeAdminDashboard,
    collapsedSections,
    setCollapsedSections,
    toggleSectionCollapse,
  } = useMainMenuAdminState();

  const {
    account,
    saveCodeImportInput,
    saveSystemStatus,
    setSaveCodeImportInput,
    handleExportSaveCode,
    handleImportSaveCode,
    handleResetAllSettings,
    handleLoggedIn,
    handleRegistered,
    handleLoggedOut,
    handleAccountChanged,
  } = useSaveAccountSync({
    adminSettings,
    setAdminSettings,
    playerName,
    setPlayerName,
    onPlayerNameChange: handlePlayerNameChange,
    uiLayouts,
    applySavedUiLayouts,
    resetUiLayouts,
    keybindings,
    setKeybindings,
    playerLoadout,
    setPlayerLoadout,
    customArmorCatalog,
    setCustomArmorCatalog,
    setCollapsedSections,
    onLoggedOut: closeAdminDashboard,
  });

  const {
    userIp,
    lanIp,
    hostIdCode,
    setHostIdCode,
    joinIpOrId,
    setJoinIpOrId,
    customUrlInput,
    setCustomUrlInput,
    getWsUrl,
    buildWsUrl,
    redactWsUrl,
    applyMatchmakerUrl,
    resetMatchmakerUrl,
  } = useMatchmakerEndpoint({
    account,
    isOnline,
    setConnectionStatus,
    setConnectionError,
  });

  const {
    gameLoadingState,
    multiplayerLoadingSnapshot,
    isMatchLoadingActive,
    resetMatchLoading,
    mergeLoadingParticipants,
    upsertLoadingParticipantSlot,
    upsertLoadingParticipantStatus,
    removeLoadingParticipantById,
    handleGameLoadingStateChange,
  } = useMatchLoadingGate({
    isPlaying,
    isMultiplayer,
    multiplayerRole,
    multiplayerSpawnSlot,
    multiplayerSocket,
    gameplayClientId,
    setGameplayClientId,
    playerName,
    playerHue: localPlayerHue,
    playerLoadout,
    selectedReplayId: selectedReplay?.id,
    selectedMap,
    lobbyCustomMapData,
  });

  const buildGameplayWsUrl = useCallback((baseUrl: string, includeAccountToken = true) => {
    return buildWsUrl(baseUrl, 'gameplay', undefined, includeAccountToken);
  }, [buildWsUrl]);

  const {
    sendChatMessage,
    handleHostGame,
    handleJoinGame,
    startHostedMatch,
    cancelHostOrJoin,
    handleJoinObserver,
    handleJoinPlayer,
  } = useGameplayConnection({
    connectionMode,
    userIp,
    lanIp,
    hostIdCode,
    setHostIdCode,
    setJoinIpOrId,
    playerName,
    playerHue: localPlayerHue,
    playerLoadout,
    selectedMap,
    setSelectedMap,
    lobbyCustomMapData,
    setLobbyCustomMapData,
    adminSettings,
    setAdminSettings,
    matchLobbyConfig,
    setMatchLobbyConfig,
    isMultiplayer,
    multiplayerSocket,
    multiplayerRole,
    gameplayClientId,
    getWsUrl,
    buildGameplayWsUrl,
    redactWsUrl,
    setConnectionStatus,
    setConnectionError,
    setChatMessages,
    setMultiplayerSocket,
    setIsMultiplayer,
    setMultiplayerRole,
    setGameplayClientId,
    setOpponentClientId,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setIsPlaying,
    setIsPaused,
    setIsTerminated,
    mergeLoadingParticipants,
    upsertLoadingParticipantSlot,
    upsertLoadingParticipantStatus,
    removeLoadingParticipantById,
  });

  useEffect(() => {
    handleHostGameRef.current = handleHostGame;
    handleJoinGameRef.current = handleJoinGame;
  }, [handleHostGame, handleJoinGame]);

  const handleJoinRelayLobby = useCallback((
    target: string,
    isObserver: boolean = false,
    password?: string,
    inviteToken?: string
  ) => {
    setConnectionMode('relay');
    selectMainMenuPlayChild('multi');
    handleJoinGame(target, isObserver, password, inviteToken, 'relay');
  }, [
    handleJoinGame,
    setConnectionMode,
    selectMainMenuPlayChild,
  ]);

  const {
    gameplayPresets,
    selectedPresetName,
    newPresetNameInput,
    setNewPresetNameInput,
    multiplayerPreset,
    mpAdminSettings,
    setMpAdminSettings,
    effectiveAdminSettings,
    publishStatus,
    isPublishing,
    multiplayerBotConfig,
    handleSavePreset,
    handleDeletePreset,
    handleSelectPreset,
    handleBotConfigChange,
    refreshMultiplayerPreset,
    handlePublishOfficial,
  } = useGameplayPresetControls({
    adminSettings,
    setAdminSettings,
    isMultiplayer,
    officialPresetName: OFFICIAL_MP_PRESET_NAME,
  });

  const {
    aiPresets,
    newAiPresetNameInput,
    setNewAiPresetNameInput,
    handleSaveAIPreset,
    handleDeleteAIPreset,
    handleSelectAIPreset,
    handleSelectAIArchetype,
  } = useAiPresetControls({
    adminSettings,
    setAdminSettings,
    setBotDifficulties,
  });

  const buildLobbyWsUrl = useCallback((name: string) => {
    return buildWsUrl(getWsUrl(), 'lobby', name);
  }, [buildWsUrl, getWsUrl]);

  const {
    menuSocket,
    clientId,
    onlineCount,
    onlineClients,
    activeInvite,
    clearActiveInvite,
    inviteNotifications,
    setInviteNotifications,
    ping,
    quickPlayStatus,
    setQuickPlayStatus,
    lobbyChatMessages,
    sendLobbyChatMessage,
    handleQuickPlay,
    handleCancelQuickPlay,
    closeMenuSocket,
    declineInvite,
  } = useLobbyConnection({
    isOnline,
    playerName,
    accountId: account?.id,
    multiplayerSocket,
    connectionStatus,
    hostIdCode,
    joinIpOrId,
    isPlaying,
    isMultiplayer,
    multiplayerRole,
    multiplayerPlayerCount,
    matchLobbyConfig,
    buildLobbyWsUrl,
    redactWsUrl,
    refreshMultiplayerPreset,
    setConnectionError,
    handleQuickplayHostRef: handleHostGameRef,
    handleQuickplayJoinRef: handleJoinGameRef,
  });

  const closeTournamentGame = useCloseTournamentGameAction({
    multiplayerSocket,
    setIsTerminated,
    setIsPlaying,
    setIsPaused,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    closeGamePanels,
    setQuickPlayStatus,
  });

  const {
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
  } = useTournamentFlow({
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
    onCloseTournamentGame: closeTournamentGame,
  });

  const {
    currentStats,
    setCurrentStats,
  } = useCurrentGameStats({
    getSavedPlayerHue,
    ping,
  });

  const {
    handleCancelHostOrJoin,
    handleApplyMatchmakerUrl,
    handleResetMatchmakerUrl,
    handleStartGame,
    handleCloseGame,
    handleResumeGame,
    handleResetMatch,
    handleReturnToMain,
  } = useAppLifecycleActions({
    multiplayerSocket,
    singlePlayerMode,
    setIsPlaying,
    setIsPaused,
    setIsTerminated,
    setIsMultiplayer,
    setMultiplayerRole,
    setMultiplayerSocket,
    setConnectionStatus,
    setQuickPlayStatus,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setOpponentClientId,
    closeGamePanels,
    cancelHostOrJoin,
    applyMatchmakerUrl,
    resetMatchmakerUrl,
    closeMenuSocket,
  });

  const handleStatsUpdate = useAppStatsUpdateHandler({
    singlePlayerMode,
    tournamentState,
    matchResult,
    setMatchResult,
    setIsPaused,
    handleCompleteTournamentMatch,
    trackEdgeLowFps,
    setCurrentStats,
    isMultiplayer,
    multiplayerRole,
    multiplayerSocket,
    ping,
    clientId,
    opponentClientId,
    matchLobbyConfig,
  });

  const activeMatchSettings = useMemo(() => {
    if (!matchLobbyConfig) return effectiveAdminSettings;
    return {
      ...effectiveAdminSettings,
      gameMode: matchLobbyConfig.gameMode,
      iBrawlsKillTarget: matchLobbyConfig.gameMode === 'sandbox'
        ? matchLobbyConfig.winTarget
        : effectiveAdminSettings.iBrawlsKillTarget,
      grifballGoalTarget: matchLobbyConfig.gameMode === 'grifball'
        ? matchLobbyConfig.winTarget
        : effectiveAdminSettings.grifballGoalTarget,
      matchTimerSeconds: matchLobbyConfig.matchTimerSeconds,
    };
  }, [effectiveAdminSettings, matchLobbyConfig]);

  // ── Lifetime stat tracking ────────────────────────────────────────────────
  // Open/close the tracked match on play transitions. Replays and the AI
  // editor never count; frames themselves are observed inside the stats
  // update handler.
  useStatCloudSync(account);
  const statMatchGameMode = activeMatchSettings.gameMode === 'grifball' ? 'grifball' : 'sandbox';
  const prevIsPlayingForStatsRef = useRef(false);
  useEffect(() => {
    const wasPlaying = prevIsPlayingForStatsRef.current;
    prevIsPlayingForStatsRef.current = isPlaying;
    if (isPlaying && !wasPlaying) {
      if (selectedReplay || singlePlayerMode === 'ai-editor') return;
      statTracker.beginMatch({
        isMultiplayer,
        gameMode: statMatchGameMode,
        singlePlayerMode,
      });
    } else if (!isPlaying && wasPlaying) {
      statTracker.endMatch('abandoned');
    }
  }, [isPlaying, selectedReplay, singlePlayerMode, isMultiplayer, statMatchGameMode]);

  return (
    <div className="relative w-full h-[100dvh] bg-[#050b1a] text-white overflow-hidden select-none font-sans flex flex-col">
      {/* BACKGROUND ARENA SIMULATION GRID */}
      <div
        className="absolute inset-0 z-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at center, transparent 0%, #050b1a 80%),
            repeating-linear-gradient(0deg, #1e293b 0px, #1e293b 1px, transparent 1px, transparent 40px),
            repeating-linear-gradient(90deg, #1e293b 0px, #1e293b 1px, transparent 1px, transparent 40px)
          `,
        }}
      />

	      <ActiveGameSurface
	        isPlaying={isPlaying}
	        isTerminated={isTerminated}
	        selectedMap={selectedMap}
	        lobbyCustomMapData={lobbyCustomMapData}
	        playerLoadout={playerLoadout}
	        isPaused={isPaused}
	        isMatchLoadingActive={isMatchLoadingActive}
	        debugMode={debugMode}
	        effectiveAdminSettings={activeMatchSettings}
	        onStatsUpdate={handleStatsUpdate}
	        onLoadingStateChange={handleGameLoadingStateChange}
	        onPauseToggle={handlePauseToggle}
	        isMultiplayer={isMultiplayer}
	        multiplayerRole={multiplayerRole}
	        multiplayerSocket={multiplayerSocket}
	        matchLobbyConfig={matchLobbyConfig}
	        multiplayerSpawnSlot={multiplayerSpawnSlot}
	        opponentClientId={opponentClientId}
	        selectedReplay={selectedReplay}
	        onExitReplay={() => {
	          setIsPlaying(false);
	          setSelectedReplay(null);
	          setIsPaused(false);
	        }}
	        singlePlayerMode={singlePlayerMode}
	        tournamentState={tournamentState}
	        keybindings={keybindings}
	        offlineBotCount={offlineBotCount}
	        botDifficulties={botDifficulties}
	        botColors={botColors}
	        botBehaviors={botBehaviors}
	        botWeaponBehaviors={botWeaponBehaviors}
	        botArchetypes={botArchetypes}
	        botModelTypes={botModelTypes}
	        aiPresets={aiPresets}
	        deviceInfo={deviceInfo}
	        forceMobileControls={forceMobileControls}
	        mobileJoystickRef={mobileJoystickRef}
	        mobileRightJoystickRef={mobileRightJoystickRef}
	        mobileRightJoystickActiveRef={mobileRightJoystickActiveRef}
	        gameLoadingState={gameLoadingState}
	        playerName={playerName}
	        localPlayerHue={localPlayerHue}
	        multiplayerLoadingSnapshot={multiplayerLoadingSnapshot}
	        currentStats={currentStats}
	        activeUiPositions={activeUiPositions}
	        activeUiDefaults={activeUiDefaults}
	        onUpdateUiPositions={handleUpdateUiPositions}
	        showUiAdjustment={showUiAdjustment}
	        replayHeatmapPanelCollapsed={replayHeatmapPanelCollapsed}
	        replayHeatmapPanelSize={replayHeatmapPanelSize}
	        onToggleReplayHeatmapPanelCollapsed={handleToggleReplayHeatmapPanelCollapsed}
	        onReplayHeatmapResizePointerDown={handleReplayHeatmapResizePointerDown}
	        heatmapOnlyReplay={heatmapOnlyReplay}
	        heatmapOnlyTime={heatmapOnlyTime}
	        heatmapOnlyPlaying={heatmapOnlyPlaying}
	        onCloseHeatmapOnlyReplay={handleCloseHeatmapOnlyReplay}
	        onHeatmapOnlyTimeChange={setHeatmapOnlyTime}
	        onSeekHeatmapOnlyReplay={handleSeekHeatmapOnlyReplay}
	        onToggleHeatmapOnlyPlaying={handleToggleHeatmapOnlyPlaying}
	        matchResult={matchResult}
	        onReturnToTournamentBracket={(result) => {
	          handleCompleteTournamentMatch(true, result.playerScore, result.opponentScore);
	          setMatchResult(null);
	        }}
	        chatMessages={chatMessages}
	        onSendChatMessage={sendChatMessage}
	      />

      <MainMenuOverlay
        isVisible={!isPlaying && !isTerminated}
        showAdminDashboard={showAdminDashboard}
        adminDashboard={{
          account,
          settings: mpAdminSettings as unknown as Record<string, unknown>,
          onSettingChange: (key, value) => setMpAdminSettings(prev => ({ ...prev, [key]: value })),
          mechanicsSettings: mpAdminSettings,
          setMechanicsSettings: setMpAdminSettings,
          collapsedSections,
          onToggleSection: toggleSectionCollapse,
          multiplayerPreset,
          onPublish: handlePublishOfficial,
          isPublishing,
          publishStatus,
          botConfig: multiplayerBotConfig,
          onBotConfigChange: handleBotConfigChange,
          onClose: () => setShowAdminDashboard(false),
        }}
        header={{
          appVersion: APP_VERSION,
          deviceInfo,
          activeParent: mainMenuNav.parent,
          isOnline,
          onlineCount,
          onSelectParent: selectMainMenuParent,
        }}
        childNav={{
          parent: mainMenuNav.parent,
          playChild: mainMenuNav.playChild,
          customizationChild: mainMenuNav.customizationChild,
          systemChild: mainMenuNav.systemChild,
          isAdmin: account?.isAdmin ?? false,
          onSelectPlayChild: selectMainMenuPlayChild,
          onSelectCustomizationChild: selectMainMenuCustomizationChild,
          onSelectSystemChild: selectMainMenuSystemChild,
          onOpenAdminDashboard: () => setShowAdminDashboard(true),
        }}
        primaryPanel={{
          parent: activeMenuContentParent,
          playChild: mainMenuNav.playChild,
          customizationChild: mainMenuNav.customizationChild,
          systemChild: mainMenuNav.systemChild,
          isSignedIn: account !== null,
          singlePlayerMode,
          setSinglePlayerMode,
          adminSettings,
          setAdminSettings,
          aiPresets,
          newAiPresetNameInput,
          setNewAiPresetNameInput,
          onSelectAIPreset: handleSelectAIPreset,
          onDeleteAIPreset: handleDeleteAIPreset,
          onSelectAIArchetype: handleSelectAIArchetype,
          onSaveAIPreset: handleSaveAIPreset,
          onOpenBotSetup: () => setShowBotSetupMenu(true),
          tournamentState,
          selectedTournamentPresets,
          setSelectedTournamentPresets,
          tournamentKillsToWin,
          setTournamentKillsToWin,
          tournamentRoundCount,
          setTournamentRoundCount,
          onInitializeTournament: handleInitializeTournament,
          playerName,
          playerHue: adminSettings.playerHue ?? 200,
          selectedMap,
          onSelectedMapChange: setSelectedMap,
          lobbyCustomMapData,
          onCustomMapDataChange: setLobbyCustomMapData,
          matchLobbyConfig,
          multiplayerRole,
          multiplayerSocket,
          multiplayerPlayerCount,
          lobbyParticipants: multiplayerLoadingSnapshot.participants,
          chatMessages,
          isPlaying,
          onStartTournamentMatch: handleStartTournamentMatch,
          onResetTournament: handleResetTournament,
          connectionMode,
          onConnectionModeChange: setConnectionMode,
          isOnline,
          userIp,
          lanIp,
          hostIdCode,
          connectionStatus,
          connectionError,
          quickPlayStatus,
          joinIpOrId,
          onJoinIpOrIdChange: setJoinIpOrId,
          customUrlInput,
          onCustomUrlInputChange: setCustomUrlInput,
          onCancelHostOrJoin: handleCancelHostOrJoin,
          onCancelQuickPlay: handleCancelQuickPlay,
          onQuickPlay: handleQuickPlay,
          onHostGame: (config, password) => handleHostGame(undefined, config, password),
          onStartHostedMatch: startHostedMatch,
          onSendChatMessage: sendChatMessage,
          onJoinGame: handleJoinGame,
          onApplyMatchmakerUrl: handleApplyMatchmakerUrl,
          onResetMatchmakerUrl: handleResetMatchmakerUrl,
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
          onEditReplay: handleEditReplay,
          onDeleteReplay: handleDeleteTheaterReplay,
          onContributeReplay: handleContributeReplay,
          onOpenHeatmapReplay: handleOpenHeatmapReplay,
          onSaveCachedReplay: handleSaveCachedReplay,
          onWatchReplay: handleWatchReplay,
          keybindings,
          setKeybindings,
          rebindingAction,
          setRebindingAction,
          gamepadConnected,
          gamepadName,
          holdingGpButton,
          unassignedButtonMap,
          setUnassignedButtonMap,
          pressedGpButtons,
          hoveredAction,
          setHoveredAction,
          leftStickActive,
          rightStickActive,
          isPainting,
          playerLoadout,
          customArmorCatalog,
          customizerWeapon,
          setPlayerLoadout,
          setIsPainting,
          setCustomizerWeapon,
          saveSystemStatus,
          saveCodeImportInput,
          onExportSaveCode: handleExportSaveCode,
          onResetAllSettings: handleResetAllSettings,
          onSaveCodeImportInputChange: setSaveCodeImportInput,
          onImportSaveCode: handleImportSaveCode,
        }}
        broadcastRail={{
          account,
          playerName,
          playerHue: localPlayerHue,
          onlineClients,
          clientId,
          connectionStatus,
          connectionMode,
          menuSocket,
          hostIdCode,
          lobbyChatMessages,
          onPlayerNameChange: handlePlayerNameChange,
          onRegistered: handleRegistered,
          onLoggedIn: handleLoggedIn,
          onLoggedOut: handleLoggedOut,
          onAccountChanged: handleAccountChanged,
          onJoinGame: handleJoinRelayLobby,
          setInviteNotifications,
          onSendLobbyChatMessage: sendLobbyChatMessage,
        }}
      />
      <AppOverlayStack
        dataNotice={{
          isVisible: showDataNotice,
          onDismiss: dismissDataNotice,
        }}
        terminated={{
          isVisible: isTerminated,
          onReboot: handleStartGame,
        }}
        pause={{
          isVisible: isPaused && isPlaying && !showUiAdjustment && !matchResult,
          props: {
            showAdminPanel,
            showLightingMenu,
            showKeybindsMenu,
            multiplayerRole,
            isMultiplayer,
            debugMode,
            isReplay: selectedReplay !== null,
            onResume: handleResumeGame,
            onJoinPlayer: handleJoinPlayer,
            onJoinObserver: handleJoinObserver,
            onResetMatch: handleResetMatch,
            onOpenBotSetup: () => setShowBotSetupMenu(true),
            onOpenKeybindings: () => setShowKeybindsMenu(true),
            onOpenUiAdjustment: () => setShowUiAdjustment(true),
            onOpenLighting: () => setShowLightingMenu(true),
            onOpenAdminPanel: () => setShowAdminPanel(true),
            onToggleDebugMode: toggleDebugMode,
            onExitReplay: () => {
              setIsPlaying(false);
              setSelectedReplay(null);
              setIsPaused(false);
            },
            onReturnToMain: handleReturnToMain,
            selectedPresetName,
            gameplayPresets,
            newPresetNameInput,
            setNewPresetNameInput,
            officialPresetName: OFFICIAL_MP_PRESET_NAME,
            multiplayerPreset,
            onSelectPreset: handleSelectPreset,
            onSavePreset: handleSavePreset,
            onDeletePreset: handleDeletePreset,
            adminSettings,
            setAdminSettings,
            collapsedSections,
            onToggleSection: toggleSectionCollapse,
            onCloseAdminPanel: () => setShowAdminPanel(false),
            keybindsModalTab,
            setKeybindsModalTab,
            keybindings,
            setKeybindings,
            rebindingAction,
            setRebindingAction,
            forceMobileControls,
            setForceMobileControls,
            gamepadConnected,
            gamepadName,
            holdingGpButton,
            unassignedButtonMap,
            setUnassignedButtonMap,
            pressedGpButtons,
            hoveredAction,
            setHoveredAction,
            leftStickActive,
            rightStickActive,
            onCloseKeybindings: () => {
              setShowKeybindsMenu(false);
              setRebindingAction(null);
            },
            onCloseLighting: () => setShowLightingMenu(false),
          },
        }}
        uiAdjustment={{
          isVisible: showUiAdjustment,
          position: uiAdjusterPosition,
          toolbarRef: uiAdjusterToolbarRef,
          onDragStart: handleUiAdjusterPointerDown,
          onReset: handleResetUiPositions,
          onSave: () => setShowUiAdjustment(false),
        }}
        directInvite={{
          invite: activeInvite,
          onAccept: (roomCode, inviteToken) => {
            clearActiveInvite();
            setConnectionMode('relay');
            handleJoinGame(roomCode, false, undefined, inviteToken, 'relay');
          },
          onDecline: declineInvite,
        }}
        botSetup={{
          isOpen: showBotSetupMenu,
          isPlaying,
          offlineBotCount,
          onOfflineBotCountChange: setOfflineBotCount,
          adminSettings,
          setAdminSettings,
          playerName,
          selectedMap,
          onSelectedMapChange: setSelectedMap,
          lobbyCustomMapData,
          onCustomMapDataChange: setLobbyCustomMapData,
          botColors,
          setBotColors,
          botDifficulties,
          setBotDifficulties,
          botArchetypes,
          setBotArchetypes,
          botModelTypes,
          setBotModelTypes,
          aiPresets,
          onClose: () => setShowBotSetupMenu(false),
          onApplyAndResume: () => {
            setShowBotSetupMenu(false);
            setIsPaused(false);
          },
          onInitializeSimulation: () => {
            setShowBotSetupMenu(false);
            handleStartGame();
          },
        }}
        replayEdit={{
          isVisible: showEditModal,
          props: {
            name: editReplayName,
            description: editReplayDesc,
            onNameChange: setEditReplayName,
            onDescriptionChange: setEditReplayDesc,
            onClose: handleCloseEditReplayModal,
            onUpdate: handleUpdateReplayMeta,
          },
        }}
        replaySaveCached={{
          isVisible: showSaveModal,
          props: {
            name: saveCachedName,
            description: saveCachedDesc,
            onNameChange: setSaveCachedName,
            onDescriptionChange: setSaveCachedDesc,
            onClose: handleCloseSaveCachedModal,
            onCommit: handleCommitCachedReplay,
          },
        }}
        edgeWarning={{
          isVisible: showEdgePerformanceWarning,
          currentFps: currentStats.fps,
          edgeLowFpsSampleDurationMs,
          graphicsCheck,
          onDismiss: dismissEdgePerformanceWarning,
        }}
        graphicsWarning={{
          isVisible: showGraphicsWarning,
          graphicsCheck,
          hardwareTab,
          onHardwareTabChange: setHardwareTab,
          onDismiss: dismissGraphicsWarning,
        }}
        inviteNotifications={inviteNotifications}
        controllerCursorRef={controllerCursorRef}
      />    </div>
  );
}
