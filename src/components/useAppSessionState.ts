import { useCallback, useState } from 'react';
import type { ChatMessage } from './ChatOverlay';

export const DATA_NOTICE_SEEN_KEY = 'ibrawls_data_notice_seen';

type DataNoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface AppMatchResult {
  winner: 'player' | 'bot';
  opponentName: string;
  playerScore: number;
  opponentScore: number;
}

export interface AppSessionSnapshot {
  forceMobileControls: boolean;
  isPlaying: boolean;
  matchResult: AppMatchResult | null;
  showDataNotice: boolean;
  isPaused: boolean;
  debugMode: boolean;
  isTerminated: boolean;
  showAdminPanel: boolean;
  showUiAdjustment: boolean;
  showLightingMenu: boolean;
  showKeybindsMenu: boolean;
  chatMessages: ChatMessage[];
}

function getDataNoticeStorage(): DataNoticeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function shouldShowDataNotice(storage: DataNoticeStorage | null): boolean {
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(DATA_NOTICE_SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markDataNoticeSeen(storage: DataNoticeStorage | null): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(DATA_NOTICE_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function createInitialAppSessionSnapshot(showDataNotice = false): AppSessionSnapshot {
  return {
    forceMobileControls: false,
    isPlaying: false,
    matchResult: null,
    showDataNotice,
    isPaused: false,
    debugMode: false,
    isTerminated: false,
    showAdminPanel: false,
    showUiAdjustment: false,
    showLightingMenu: false,
    showKeybindsMenu: false,
    chatMessages: [],
  };
}

export function useAppSessionState() {
  const initial = createInitialAppSessionSnapshot();
  const [forceMobileControls, setForceMobileControls] = useState<boolean>(initial.forceMobileControls);
  const [isPlaying, setIsPlaying] = useState<boolean>(initial.isPlaying);
  const [matchResult, setMatchResult] = useState<AppMatchResult | null>(initial.matchResult);
  const [showDataNotice, setShowDataNotice] = useState<boolean>(() => shouldShowDataNotice(getDataNoticeStorage()));
  const [isPaused, setIsPaused] = useState<boolean>(initial.isPaused);
  const [debugMode, setDebugMode] = useState<boolean>(initial.debugMode);
  const [isTerminated, setIsTerminated] = useState<boolean>(initial.isTerminated);
  const [showAdminPanel, setShowAdminPanel] = useState<boolean>(initial.showAdminPanel);
  const [showUiAdjustment, setShowUiAdjustment] = useState<boolean>(initial.showUiAdjustment);
  const [showLightingMenu, setShowLightingMenu] = useState<boolean>(initial.showLightingMenu);
  const [showKeybindsMenu, setShowKeybindsMenu] = useState<boolean>(initial.showKeybindsMenu);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => initial.chatMessages);

  const dismissDataNotice = useCallback(() => {
    markDataNoticeSeen(getDataNoticeStorage());
    setShowDataNotice(false);
  }, []);

  const closePauseSubmenus = useCallback(() => {
    setShowAdminPanel(false);
    setShowLightingMenu(false);
    setShowKeybindsMenu(false);
  }, []);

  const closeGamePanels = useCallback(() => {
    setShowAdminPanel(false);
    setShowUiAdjustment(false);
    setShowLightingMenu(false);
  }, []);

  const toggleDebugMode = useCallback(() => {
    setDebugMode(prev => !prev);
  }, []);

  const handlePauseToggle = useCallback(() => {
    if (showUiAdjustment) {
      setShowUiAdjustment(false);
      return;
    }

    setIsPaused(prev => !prev);
    if (isPaused) {
      closePauseSubmenus();
    }
  }, [closePauseSubmenus, isPaused, showUiAdjustment]);

  return {
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
    closePauseSubmenus,
    closeGamePanels,
    toggleDebugMode,
    handlePauseToggle,
  };
}
