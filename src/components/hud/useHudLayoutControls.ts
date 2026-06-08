import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { UiElementPos } from '../../types';
import {
  DEFAULT_DESKTOP_UI_POSITIONS,
  DEFAULT_MOBILE_UI_POSITIONS,
  MOBILE_HUD_LAYOUT_VERSION,
  MOBILE_HUD_LAYOUT_VERSION_KEY,
  type UiLayoutState,
  getDefaultUiLayouts,
  mergeUiPositions,
  normalizeUiLayouts,
} from '../../ui/hudLayouts';

interface UseHudLayoutControlsOptions {
  isMobile: boolean;
  showUiAdjustment: boolean;
}

const UI_POSITIONS_STORAGE_KEY = 'grifball_ui_positions';

export const useHudLayoutControls = ({
  isMobile,
  showUiAdjustment,
}: UseHudLayoutControlsOptions) => {
  const activeUiLayoutMode: keyof UiLayoutState = isMobile ? 'mobile' : 'desktop';
  const activeUiDefaults = activeUiLayoutMode === 'mobile'
    ? DEFAULT_MOBILE_UI_POSITIONS
    : DEFAULT_DESKTOP_UI_POSITIONS;

  const [uiLayouts, setUiLayouts] = useState<UiLayoutState>(() => {
    try {
      const shouldResetSavedMobileLayout =
        localStorage.getItem(MOBILE_HUD_LAYOUT_VERSION_KEY) !== MOBILE_HUD_LAYOUT_VERSION;
      const saved = localStorage.getItem(UI_POSITIONS_STORAGE_KEY);
      const layouts = saved
        ? normalizeUiLayouts(JSON.parse(saved), shouldResetSavedMobileLayout)
        : getDefaultUiLayouts();

      if (shouldResetSavedMobileLayout) {
        localStorage.setItem(MOBILE_HUD_LAYOUT_VERSION_KEY, MOBILE_HUD_LAYOUT_VERSION);
        localStorage.setItem(UI_POSITIONS_STORAGE_KEY, JSON.stringify(layouts));
      }

      return layouts;
    } catch (e) {
      console.error(e);
    }
    return getDefaultUiLayouts();
  });

  const uiLayoutsRef = useRef<UiLayoutState>(uiLayouts);
  const activeUiPositions = uiLayouts[activeUiLayoutMode];

  useEffect(() => {
    uiLayoutsRef.current = uiLayouts;
  }, [uiLayouts]);

  const persistUiLayouts = useCallback((layouts: UiLayoutState) => {
    try {
      localStorage.setItem(UI_POSITIONS_STORAGE_KEY, JSON.stringify(layouts));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const applyUiLayouts = useCallback((newLayouts: UiLayoutState, shouldPersist = true) => {
    uiLayoutsRef.current = newLayouts;
    setUiLayouts(newLayouts);
    if (shouldPersist) {
      persistUiLayouts(newLayouts);
    }
  }, [persistUiLayouts]);

  const applySavedUiLayouts = useCallback((rawLayouts: unknown) => {
    applyUiLayouts(normalizeUiLayouts(rawLayouts));
  }, [applyUiLayouts]);

  const resetUiLayouts = useCallback(() => {
    applyUiLayouts(getDefaultUiLayouts());
  }, [applyUiLayouts]);

  const applyActiveUiPositions = useCallback((newPositions: UiElementPos[], shouldPersist = true) => {
    applyUiLayouts({
      ...uiLayoutsRef.current,
      [activeUiLayoutMode]: mergeUiPositions(activeUiDefaults, newPositions),
    }, shouldPersist);
  }, [activeUiDefaults, activeUiLayoutMode, applyUiLayouts]);

  const handleUpdateUiPositions = useCallback((newPositions: UiElementPos[]) => {
    applyActiveUiPositions(newPositions);
  }, [applyActiveUiPositions]);

  const handleResetUiPositions = useCallback(() => {
    applyActiveUiPositions(activeUiDefaults);
  }, [activeUiDefaults, applyActiveUiPositions]);

  const [isDraggingUiAdjuster, setIsDraggingUiAdjuster] = useState<boolean>(false);
  const uiAdjusterToolbarRef = useRef<HTMLDivElement>(null);
  const uiAdjusterPointerIdRef = useRef<number | null>(null);
  const defaultUiAdjusterPosition = activeUiDefaults.find((position) => position.id === 'hudAdjuster');
  const uiAdjusterPosition =
    activeUiPositions.find((position) => position.id === 'hudAdjuster') ??
    defaultUiAdjusterPosition;

  const clampUiAdjusterPositionToViewport = useCallback((clientX: number, clientY: number) => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const toolbarRect = uiAdjusterToolbarRef.current?.getBoundingClientRect();
    const toolbarWidth = toolbarRect?.width ?? 0;
    const toolbarHeight = toolbarRect?.height ?? 0;
    const margin = isMobile ? 8 : 16;

    const minX = ((toolbarWidth / 2 + margin) / viewportWidth) * 100;
    const maxX = ((viewportWidth - toolbarWidth / 2 - margin) / viewportWidth) * 100;
    const minY = (margin / viewportHeight) * 100;
    const maxY = ((viewportHeight - toolbarHeight - margin) / viewportHeight) * 100;
    const pctX = (clientX / viewportWidth) * 100;
    const pctY = (clientY / viewportHeight) * 100;

    return {
      x: Math.max(minX, Math.min(Math.max(minX, maxX), pctX)),
      y: Math.max(minY, Math.min(Math.max(minY, maxY), pctY)),
    };
  }, [isMobile]);

  const handleUiAdjusterPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    uiAdjusterPointerIdRef.current = event.pointerId;
    setIsDraggingUiAdjuster(true);
    event.stopPropagation();
    event.preventDefault();
  }, []);

  useEffect(() => {
    if (!isDraggingUiAdjuster) return;

    let animationFrameId: number | null = null;
    let pendingPosition: { x: number; y: number } | null = null;

    const flushPendingPosition = () => {
      animationFrameId = null;
      if (!pendingPosition || !defaultUiAdjusterPosition) return;

      const { x, y } = pendingPosition;
      pendingPosition = null;
      const currentPositions = uiLayoutsRef.current[activeUiLayoutMode];

      const nextPositions = currentPositions.some((position) => position.id === 'hudAdjuster')
        ? currentPositions.map((position) =>
            position.id === 'hudAdjuster' && (position.x !== x || position.y !== y)
              ? { ...position, x, y }
              : position
          )
        : [
            ...currentPositions,
            { ...defaultUiAdjusterPosition, x, y },
          ];

      applyActiveUiPositions(nextPositions, false);
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (uiAdjusterPointerIdRef.current !== null && event.pointerId !== uiAdjusterPointerIdRef.current) return;
      const clampedPosition = clampUiAdjusterPositionToViewport(event.clientX, event.clientY);

      pendingPosition = clampedPosition;
      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(flushPendingPosition);
      }
    };

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (uiAdjusterPointerIdRef.current !== null && event.pointerId !== uiAdjusterPointerIdRef.current) return;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        flushPendingPosition();
      }
      persistUiLayouts(uiLayoutsRef.current);
      uiAdjusterPointerIdRef.current = null;
      setIsDraggingUiAdjuster(false);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [
    activeUiLayoutMode,
    applyActiveUiPositions,
    clampUiAdjusterPositionToViewport,
    defaultUiAdjusterPosition,
    isDraggingUiAdjuster,
    persistUiLayouts,
  ]);

  useEffect(() => {
    if (!showUiAdjustment || !uiAdjusterPosition || !defaultUiAdjusterPosition) return;

    const animationFrameId = window.requestAnimationFrame(() => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
      const clampedPosition = clampUiAdjusterPositionToViewport(
        (uiAdjusterPosition.x / 100) * viewportWidth,
        (uiAdjusterPosition.y / 100) * viewportHeight
      );

      if (
        Math.abs(clampedPosition.x - uiAdjusterPosition.x) < 0.1 &&
        Math.abs(clampedPosition.y - uiAdjusterPosition.y) < 0.1
      ) {
        return;
      }

      const nextPositions = activeUiPositions.some((position) => position.id === 'hudAdjuster')
        ? activeUiPositions.map((position) =>
            position.id === 'hudAdjuster'
              ? { ...position, x: clampedPosition.x, y: clampedPosition.y }
              : position
          )
        : [
            ...activeUiPositions,
            { ...defaultUiAdjusterPosition, x: clampedPosition.x, y: clampedPosition.y },
          ];

      applyActiveUiPositions(nextPositions);
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [
    activeUiLayoutMode,
    activeUiPositions,
    applyActiveUiPositions,
    clampUiAdjusterPositionToViewport,
    defaultUiAdjusterPosition,
    showUiAdjustment,
    uiAdjusterPosition,
  ]);

  return {
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
  };
};
