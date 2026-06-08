import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

export type MainMenuTab = 'single' | 'multi' | 'spec' | 'theater';
export type MainMenuSplitter = 'customization' | 'chat';

interface MainMenuFrameLayout {
  setupFr: number;
  customizationFr: number;
  chatWidth: number;
}

interface UseMainMenuFrameLayoutOptions {
  activeMenuTab: MainMenuTab;
  isMobile: boolean;
  isPainting: boolean;
  onCustomizationFrameHidden?: () => void;
}

const MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY = 'ibrawls_main_menu_frame_layout_v1';
const MAIN_MENU_SETUP_MIN_PX = 280;
const MAIN_MENU_CUSTOMIZATION_MIN_PX = 420;
const MAIN_MENU_CHAT_MIN_PX = 280;
const MAIN_MENU_CHAT_MAX_PX = 520;
const MAIN_MENU_SPLITTER_WIDTH_PX = 28;

const DEFAULT_MAIN_MENU_FRAME_LAYOUT: MainMenuFrameLayout = {
  setupFr: 1,
  customizationFr: 1.8,
  chatWidth: 360,
};

const clampNumber = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const clampMainMenuFrameLayout = (layout: Partial<MainMenuFrameLayout> | null | undefined): MainMenuFrameLayout => ({
  setupFr: clampNumber(layout?.setupFr ?? DEFAULT_MAIN_MENU_FRAME_LAYOUT.setupFr, 0.55, 3.5),
  customizationFr: clampNumber(layout?.customizationFr ?? DEFAULT_MAIN_MENU_FRAME_LAYOUT.customizationFr, 0.8, 4),
  chatWidth: clampNumber(layout?.chatWidth ?? DEFAULT_MAIN_MENU_FRAME_LAYOUT.chatWidth, MAIN_MENU_CHAT_MIN_PX, MAIN_MENU_CHAT_MAX_PX),
});

export const useMainMenuFrameLayout = ({
  activeMenuTab,
  isMobile,
  isPainting,
  onCustomizationFrameHidden,
}: UseMainMenuFrameLayoutOptions) => {
  const [showCustomizationFrame, setShowCustomizationFrame] = useState<boolean>(true);
  const [mainMenuFrameLayout, setMainMenuFrameLayout] = useState<MainMenuFrameLayout>(() => {
    try {
      const saved = localStorage.getItem(MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY);
      return saved ? clampMainMenuFrameLayout(JSON.parse(saved)) : DEFAULT_MAIN_MENU_FRAME_LAYOUT;
    } catch (e) {
      console.error('Failed to load main menu frame layout:', e);
      return DEFAULT_MAIN_MENU_FRAME_LAYOUT;
    }
  });

  const mainMenuLayoutRef = useRef<HTMLDivElement | null>(null);
  const mainMenuContentGridRef = useRef<HTMLDivElement | null>(null);
  const mainMenuFrameLayoutRef = useRef<MainMenuFrameLayout>(mainMenuFrameLayout);

  useEffect(() => {
    mainMenuFrameLayoutRef.current = mainMenuFrameLayout;
  }, [mainMenuFrameLayout]);

  const persistMainMenuFrameLayout = useCallback((layout: MainMenuFrameLayout) => {
    try {
      localStorage.setItem(MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch (e) {
      console.error('Failed to save main menu frame layout:', e);
    }
  }, []);

  const applyMainMenuFrameLayout = useCallback((layout: Partial<MainMenuFrameLayout>, shouldPersist = true) => {
    const nextLayout = clampMainMenuFrameLayout(layout);
    mainMenuFrameLayoutRef.current = nextLayout;
    setMainMenuFrameLayout(nextLayout);
    if (shouldPersist) {
      persistMainMenuFrameLayout(nextLayout);
    }
    return nextLayout;
  }, [persistMainMenuFrameLayout]);

  const handleToggleCustomizationFrame = useCallback(() => {
    setShowCustomizationFrame((visible) => {
      const nextVisible = !visible;
      if (!nextVisible) {
        onCustomizationFrameHidden?.();
      }
      return nextVisible;
    });
  }, [onCustomizationFrameHidden]);

  const handleResetMainMenuFrameLayout = useCallback(() => {
    mainMenuFrameLayoutRef.current = DEFAULT_MAIN_MENU_FRAME_LAYOUT;
    setMainMenuFrameLayout(DEFAULT_MAIN_MENU_FRAME_LAYOUT);
    try {
      localStorage.removeItem(MAIN_MENU_FRAME_LAYOUT_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to reset main menu frame layout:', e);
    }
  }, []);

  const handleMainMenuSplitterPointerDown = useCallback((
    splitter: MainMenuSplitter,
    e: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (isMobile) return;
    const pointerId = e.pointerId;
    let animationFrameId: number | null = null;
    let pendingLayout: MainMenuFrameLayout | null = null;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const flushPendingLayout = () => {
      animationFrameId = null;
      if (!pendingLayout) return;
      const layout = pendingLayout;
      pendingLayout = null;
      applyMainMenuFrameLayout(layout, false);
    };

    const scheduleLayout = (layout: MainMenuFrameLayout) => {
      pendingLayout = layout;
      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(flushPendingLayout);
      }
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;

      if (splitter === 'customization') {
        const rect = mainMenuContentGridRef.current?.getBoundingClientRect();
        if (!rect) return;
        const availableWidth = rect.width - MAIN_MENU_SPLITTER_WIDTH_PX;
        const minTotalWidth = MAIN_MENU_SETUP_MIN_PX + MAIN_MENU_CUSTOMIZATION_MIN_PX;
        if (availableWidth <= minTotalWidth) return;

        const setupPx = clampNumber(
          event.clientX - rect.left,
          MAIN_MENU_SETUP_MIN_PX,
          availableWidth - MAIN_MENU_CUSTOMIZATION_MIN_PX
        );
        const totalFr = mainMenuFrameLayoutRef.current.setupFr + mainMenuFrameLayoutRef.current.customizationFr;

        scheduleLayout({
          ...mainMenuFrameLayoutRef.current,
          setupFr: (setupPx / availableWidth) * totalFr,
          customizationFr: ((availableWidth - setupPx) / availableWidth) * totalFr,
        });
        return;
      }

      const rect = mainMenuLayoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      scheduleLayout({
        ...mainMenuFrameLayoutRef.current,
        chatWidth: clampNumber(rect.right - event.clientX, MAIN_MENU_CHAT_MIN_PX, MAIN_MENU_CHAT_MAX_PX),
      });
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        flushPendingLayout();
      }
      persistMainMenuFrameLayout(mainMenuFrameLayoutRef.current);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
  }, [applyMainMenuFrameLayout, isMobile, persistMainMenuFrameLayout]);

  const shouldRenderCustomizationFrame = showCustomizationFrame && activeMenuTab !== 'theater';

  const mainMenuLayoutStyle = useMemo(() => ({
    '--main-menu-chat-width': `${mainMenuFrameLayout.chatWidth}px`,
  } as CSSProperties), [mainMenuFrameLayout.chatWidth]);

  const mainMenuContentGridStyle = useMemo(() => ({
    '--main-menu-setup-fr': `${mainMenuFrameLayout.setupFr}fr`,
    '--main-menu-customization-fr': `${mainMenuFrameLayout.customizationFr}fr`,
    gridTemplateColumns: shouldRenderCustomizationFrame
      ? isPainting
        ? 'minmax(0, 1fr)'
        : `minmax(${MAIN_MENU_SETUP_MIN_PX}px, var(--main-menu-setup-fr)) ${MAIN_MENU_SPLITTER_WIDTH_PX}px minmax(${MAIN_MENU_CUSTOMIZATION_MIN_PX}px, var(--main-menu-customization-fr))`
      : 'minmax(0, 1fr)',
    minWidth: 0,
  } as CSSProperties), [
    isPainting,
    mainMenuFrameLayout.customizationFr,
    mainMenuFrameLayout.setupFr,
    shouldRenderCustomizationFrame,
  ]);

  const mainMenuChatStyle = useMemo(() => ({
    width: 'var(--main-menu-chat-width)',
    flexShrink: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  } as CSSProperties), []);

  return {
    showCustomizationFrame,
    shouldRenderCustomizationFrame,
    mainMenuLayoutRef,
    mainMenuContentGridRef,
    mainMenuLayoutStyle,
    mainMenuContentGridStyle,
    mainMenuChatStyle,
    handleToggleCustomizationFrame,
    handleResetMainMenuFrameLayout,
    handleMainMenuSplitterPointerDown,
  };
};
