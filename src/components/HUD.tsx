/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  GameStats,
  UiElementPos,
  DeviceInfo,
} from '../types';
import { LeftAnalogStick, RightActionButtonPad } from './MobileGamepad';
import { DraggableHUDItem, clampUiScale } from './hud/DraggableHUDItem';

interface HUDProps {
  stats: GameStats;
  onPauseClick: () => void;
  onThemeToggle?: () => void;
  uiPositions: UiElementPos[];
  uiDefaultPositions: UiElementPos[];
  onUpdateUiPositions: (positions: UiElementPos[]) => void;
  isAdjustmentMode: boolean;
  deviceInfo: DeviceInfo;
  forceMobileControls: boolean;
  mobileJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  mobileRightJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  mobileRightJoystickActiveRef: React.MutableRefObject<boolean>;
}

export const renderMedalIcon = (iconName: string) => {
  switch (iconName) {
    case 'double':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="rgba(34, 211, 238, 0.4)" stroke="rgb(34, 211, 238)" />
          <path d="M16 6l1.54 3.13L21 9.63l-2.5 2.43.59 3.44-3.09-1.62-3.09 1.62.59-3.44-2.5-2.43 3.46-.5L16 6z" fill="rgba(6, 182, 212, 0.6)" stroke="rgb(6, 182, 212)" />
        </svg>
      );
    case 'triple':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2C9.5 5.5 8 8.5 8 11.5c0 2.5 1.8 4.5 4 4.5s4-2 4-4.5c0-3-1.5-6-4-9.5z" fill="rgba(234, 179, 8, 0.4)" stroke="rgb(234, 179, 8)" />
          <path d="M12 7c-1.5 2-2.5 4-2.5 5.5 0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5C14.5 11 13.5 9 12 7z" fill="rgba(250, 204, 21, 0.6)" stroke="rgb(250, 204, 21)" />
          <path d="M12 11c-.6.8-1 1.6-1 2.2 0 .6.4 1 1 1s1-.4 1-1c0-.6-.4-1.4-1-2.2z" fill="rgb(254, 240, 138)" stroke="rgb(254, 240, 138)" />
        </svg>
      );
    case 'quadra':
    case 'overkill':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 14h6v2H9v-2z" fill="rgb(168, 85, 247)" />
          <path d="M12 2C7.5 2 4 5.5 4 10c0 3 1.5 5.5 4 7v3a1 1 0 001 1h6a1 1 0 001-1v-3c2.5-1.5 4-4 4-7 0-4.5-3.5-8-8-8z" fill="rgba(168, 85, 247, 0.4)" stroke="rgb(168, 85, 247)" />
          <circle cx="9" cy="10" r="1.5" fill="rgb(240, 230, 255)" />
          <circle cx="15" cy="10" r="1.5" fill="rgb(240, 230, 255)" />
        </svg>
      );
    case 'bulltrue':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(239, 68, 68, 0.4)" stroke="rgb(239, 68, 68)" />
          <path d="M7 7l10 10M17 7L7 17" stroke="rgb(239, 68, 68)" strokeWidth="3" />
        </svg>
      );
    case 'spawnslayer':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" fill="rgba(34, 197, 94, 0.3)" stroke="rgb(34, 197, 94)" />
          <circle cx="12" cy="12" r="5" stroke="rgb(34, 197, 94)" strokeDasharray="3 3" />
          <path d="M12 8v4l2.5 1.5" stroke="rgb(34, 197, 94)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case 'killingspree':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 21h14a1 1 0 001-1v-4l-3.5-3.5L12 17l-4.5-4.5L4 16v4a1 1 0 001 1z" fill="rgba(249, 115, 22, 0.4)" stroke="rgb(249, 115, 22)" />
          <path d="M12 3l3 6.5L21 8.5l-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 8.5l6-1L12 3z" fill="rgba(251, 146, 60, 0.6)" stroke="rgb(251, 146, 60)" />
        </svg>
      );
    case 'hammertime':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 4h5v4h-5V4zM4 17l11-11 3 3-11 11H4v-3z" fill="rgba(244, 63, 94, 0.4)" stroke="rgb(244, 63, 94)" />
          <path d="M3 21c3-3 8-1 10-4" stroke="rgb(244, 63, 94)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'swordslayer':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L9 8h2v8H9l3 6 3-6h-2V8h2L12 2z" fill="rgba(6, 182, 212, 0.4)" stroke="rgb(6, 182, 212)" />
          <path d="M7 12h10M5 16h14" stroke="rgb(6, 182, 212)" strokeWidth="1.5" />
        </svg>
      );
    case 'closecall':
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 12h4l2-6 3 12 2-8 2 2h5" stroke="rgb(249, 115, 22)" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" stroke="white" fill="none" />
        </svg>
      );
  }
};

// Sleek glowing Energy Sword SVG
export const SwordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20l2.5-2.5" stroke="rgba(255,255,255,0.7)" strokeWidth="3" />
    <path d="M6 17.5c2 -1 3.5 -2.5 4 -4.5" stroke="rgba(255,255,255,0.9)" />
    <path d="M5.5 18.5L16 8c1.5 -1.5 3 -2.5 5 -3c-0.5 2 -1.5 3.5 -3 5L8 20.5z" fill="rgba(34, 211, 238, 0.25)" stroke="rgb(34, 211, 238)" />
    <path d="M8.5 15.5L17 7c1 -1 2 -1.8 3.5 -2.2c-0.4 1.5 -1.2 2.5 -2.2 3.5L9.5 17z" fill="rgba(6, 182, 212, 0.4)" stroke="rgb(6, 182, 212)" />
  </svg>
);

// Sleek glowing Gravity Hammer SVG
export const HammerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20L15 9" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" />
    <path d="M5 19l1.5-1.5M7.5 16.5l1.5-1.5" stroke="rgba(255,255,255,0.4)" />
    <path d="M14 6l4-4l4 4l-4 4z" fill="rgba(59, 130, 246, 0.35)" stroke="rgb(59, 130, 246)" strokeWidth="2" />
    <path d="M13 7l2-2m2 8l2-2" stroke="rgb(59, 130, 246)" strokeWidth="2" />
    <path d="M12 8l-2.5-2.5L12 3" fill="rgba(29, 78, 216, 0.2)" stroke="rgb(29, 78, 216)" />
    <circle cx="18" cy="6" r="1.5" fill="rgb(191, 219, 254)" stroke="rgb(96, 165, 250)" strokeWidth="1" />
  </svg>
);

// Crossed Sword & Sword clashing trade SVG
export const SwordVsSwordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`relative flex items-center justify-center ${className}`}>
    <svg className="w-full h-full absolute transform -rotate-12 scale-90 translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l2.5-2.5" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" />
      <path d="M5.5 18.5L16 8c1.5 -1.5 3 -2.5 5 -3c-0.5 2 -1.5 3.5 -3 5L8 20.5z" fill="rgba(34, 211, 238, 0.2)" stroke="rgb(34, 211, 238)" />
    </svg>
    <svg className="w-full h-full absolute transform rotate-75 scale-90 translate-y-0.5 -translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l2.5-2.5" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" />
      <path d="M5.5 18.5L16 8c1.5 -1.5 3 -2.5 5 -3c-0.5 2 -1.5 3.5 -3 5L8 20.5z" fill="rgba(34, 211, 238, 0.2)" stroke="rgb(34, 211, 238)" />
    </svg>
    <svg className="w-6 h-6 absolute text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,1)] animate-ping" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" strokeLinecap="round" />
    </svg>
    <svg className="w-5 h-5 absolute text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 7l1.5 3.5h3.5l-2.8 2.2l1.1 3.3l-3.3-2l-3.3 2l1.1-3.3l-2.8-2.2h3.5z" />
    </svg>
  </div>
);

// Crossed Sword & Hammer clashing trade SVG
export const SwordVsHammerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`relative flex items-center justify-center ${className}`}>
    <svg className="w-full h-full absolute transform -rotate-12 scale-90 translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l2.5-2.5" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" />
      <path d="M5.5 18.5L16 8c1.5 -1.5 3 -2.5 5 -3c-0.5 2 -1.5 3.5 -3 5L8 20.5z" fill="rgba(34, 211, 238, 0.2)" stroke="rgb(34, 211, 238)" />
    </svg>
    <svg className="w-full h-full absolute transform rotate-75 scale-90 translate-y-0.5 -translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20L15 9" stroke="rgba(255,255,255,0.7)" strokeWidth="2" />
      <path d="M14 6l4-4l4 4l-4 4z" fill="rgba(59, 130, 246, 0.2)" stroke="rgb(59, 130, 246)" />
    </svg>
    <svg className="w-6 h-6 absolute text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,1)] animate-ping" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" strokeLinecap="round" />
    </svg>
    <svg className="w-5 h-5 absolute text-amber-500 drop-shadow-[0_0_6px_rgba(245,158,11,0.8)]" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 7l1.5 3.5h3.5l-2.8 2.2l1.1 3.3l-3.3-2l-3.3 2l1.1-3.3l-2.8-2.2h3.5z" />
    </svg>
  </div>
);

// Crossed Hammer & Hammer clashing trade SVG
export const HammerVsHammerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`relative flex items-center justify-center ${className}`}>
    <svg className="w-full h-full absolute transform -rotate-12 scale-90 translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20L15 9" stroke="rgba(255,255,255,0.7)" />
      <path d="M14 6l4-4l4 4l-4 4z" fill="rgba(59, 130, 246, 0.2)" stroke="rgb(59, 130, 246)" />
    </svg>
    <svg className="w-full h-full absolute transform rotate-75 scale-90 translate-y-0.5 -translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20L15 9" stroke="rgba(255,255,255,0.7)" />
      <path d="M14 6l4-4l4 4l-4 4z" fill="rgba(59, 130, 246, 0.2)" stroke="rgb(59, 130, 246)" />
    </svg>
    <svg className="w-6 h-6 absolute text-yellow-400 drop-shadow-[0_0_8px_rgba(234,179,8,1)] animate-ping" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" strokeLinecap="round" />
    </svg>
    <svg className="w-5 h-5 absolute text-blue-400 drop-shadow-[0_0_6px_rgba(96,165,250,0.8)]" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 7l1.5 3.5h3.5l-2.8 2.2l1.1 3.3l-3.3-2l-3.3 2l1.1-3.3l-2.8-2.2h3.5z" />
    </svg>
  </div>
);

// Helper function to clean bracketed weapon info from attacker name
export const cleanFeedName = (name: string): string => {
  return name.replace(/\s*\[.*?\]$/, '');
};

// Render correct kill feed weapon/clashing icon
export const renderKillFeedIcon = (weaponType: string) => {
  switch (weaponType) {
    case 'sword':
      return <SwordIcon className="w-6 h-6 text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.7)]" />;
    case 'hammer':
      return <HammerIcon className="w-6 h-6 text-blue-400 drop-shadow-[0_0_4px_rgba(59,130,246,0.7)]" />;
    case 'sword_vs_sword':
      return <SwordVsSwordIcon className="w-8 h-8" />;
    case 'sword_vs_hammer':
    case 'hammer_vs_sword':
      return <SwordVsHammerIcon className="w-8 h-8" />;
    case 'hammer_vs_hammer':
      return <HammerVsHammerIcon className="w-8 h-8" />;
    default:
      return <SwordIcon className="w-6 h-6 text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.7)]" />;
  }
};

export const HUD: React.FC<HUDProps> = ({ 
  stats, 
  onPauseClick, 
  uiPositions, 
  uiDefaultPositions,
  onUpdateUiPositions, 
  isAdjustmentMode,
  deviceInfo,
  forceMobileControls,
  mobileJoystickRef,
  mobileRightJoystickRef,
  mobileRightJoystickActiveRef
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draftUiPositions, setDraftUiPositions] = useState<UiElementPos[]>(uiPositions);
  const draftUiPositionsRef = useRef<UiElementPos[]>(uiPositions);
  const onUpdateUiPositionsRef = useRef(onUpdateUiPositions);
  const draggingPointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    onUpdateUiPositionsRef.current = onUpdateUiPositions;
  }, [onUpdateUiPositions]);

  useEffect(() => {
    if (draggingId) return;
    draftUiPositionsRef.current = uiPositions;
    setDraftUiPositions(uiPositions);
  }, [draggingId, uiPositions]);

  const updateDraftUiPositions = (nextPositions: UiElementPos[]) => {
    draftUiPositionsRef.current = nextPositions;
    setDraftUiPositions(nextPositions);
  };

  // Format seconds to MM:SS
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const grifballScoreboard = stats.grifball?.scoreboard;
  const blueScoreboardTeam = grifballScoreboard?.teams.find((team) => team.id === 'blue');
  const redScoreboardTeam = grifballScoreboard?.teams.find((team) => team.id === 'red');

  const getStanceLabel = () => {
    if (stats.playerHP <= 0) return 'DEAD';
    if (stats.isJumping) return 'STANCE: JUMPING';
    if (stats.isCrouching) return 'STANCE: CROUCHING';
    return 'STANCE: STANDING';
  };

  // Cooldown bar width percentage
  const cooldownPct = Math.round(stats.weaponCooldown * 100);

  const handleToggleLock = (id: string) => {
    const nextPositions = draftUiPositionsRef.current.map((ui) => (
      ui.id === id ? { ...ui, locked: !ui.locked } : ui
    ));
    updateDraftUiPositions(nextPositions);
    onUpdateUiPositions(nextPositions);
  };

  const handleUpdateScale = (id: string, scale: number) => {
    const nextScale = clampUiScale(scale);
    const nextPositions = draftUiPositionsRef.current.map((ui) => (
      ui.id === id && ui.scale !== nextScale
        ? { ...ui, scale: nextScale }
        : ui
    ));
    updateDraftUiPositions(nextPositions);
    onUpdateUiPositions(nextPositions);
  };

  const handlePointerDown = (id: string, e: React.PointerEvent) => {
    const item = draftUiPositionsRef.current.find((ui) => ui.id === id);
    if (!item || item.locked) return;
    draggingPointerIdRef.current = e.pointerId;
    
    // Compute starting offset in viewport percentage coords
    const pctX = (e.clientX / window.innerWidth) * 100;
    const pctY = (e.clientY / window.innerHeight) * 100;
    dragOffsetRef.current = {
      x: pctX - item.x,
      y: pctY - item.y
    };

    setDraggingId(id);
    e.stopPropagation();
    e.preventDefault();
  };

  useEffect(() => {
    if (!draggingId) return;

    let animationFrameId: number | null = null;
    let pendingPosition: { x: number; y: number } | null = null;

    const flushPendingPosition = () => {
      animationFrameId = null;
      if (!pendingPosition) return;

      const { x, y } = pendingPosition;
      pendingPosition = null;

      const nextPositions = draftUiPositionsRef.current.map((ui) => (
        ui.id === draggingId && (ui.x !== x || ui.y !== y)
          ? { ...ui, x, y }
          : ui
      ));

      updateDraftUiPositions(nextPositions);
    };

    const handleWindowPointerMove = (e: PointerEvent) => {
      if (draggingPointerIdRef.current !== null && e.pointerId !== draggingPointerIdRef.current) return;
      // Calculate cursor position in percentages of the window space
      const pctX = (e.clientX / window.innerWidth) * 100;
      const pctY = (e.clientY / window.innerHeight) * 100;

      // Restrict within the viewport boundaries (avoid flying completely offscreen)
      const clampedX = Math.max(1, Math.min(99, pctX - dragOffsetRef.current.x));
      const clampedY = Math.max(1, Math.min(99, pctY - dragOffsetRef.current.y));

      pendingPosition = { x: clampedX, y: clampedY };
      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(flushPendingPosition);
      }
    };

    const handleWindowPointerUp = (e: PointerEvent) => {
      if (draggingPointerIdRef.current !== null && e.pointerId !== draggingPointerIdRef.current) return;
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        flushPendingPosition();
      }
      onUpdateUiPositionsRef.current(draftUiPositionsRef.current);
      draggingPointerIdRef.current = null;
      setDraggingId(null);
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
  }, [draggingId]);

  const usesMobileHud = deviceInfo.isMobile;
  const showsMobileControls = deviceInfo.isMobile || forceMobileControls;
  const getUiItem = (id: string) => draftUiPositions.find(p => p.id === id);
  const getDefaultScale = (id: string) => clampUiScale(uiDefaultPositions.find(p => p.id === id)?.scale ?? 1);
  const getDraggableProps = (id: string) => ({
    id,
    uiItem: getUiItem(id),
    isAdjustmentMode,
    onToggleLock: handleToggleLock,
    onUpdateScale: handleUpdateScale,
    onPointerDown: handlePointerDown,
    defaultScale: getDefaultScale(id),
    isMobileLayout: usesMobileHud,
  });

  return (
    <div className={`absolute inset-0 z-10 select-none font-sans text-white ${usesMobileHud ? 'mobile-hud' : 'desktop-hud'} ${isAdjustmentMode ? 'hud-adjusting pointer-events-auto bg-slate-900/10' : 'pointer-events-none'}`}>

      {/* Grifball ball carrier status */}
      {stats.grifball?.phase === 'playing' && stats.grifball.ballCarrierName && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none z-20">
          {stats.grifball.phase === 'playing' && stats.grifball.ballCarrierName && (
            <div className={`px-3 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${stats.grifball.ballCarrierTeam === 'red' ? 'bg-red-500/30 text-red-200' : 'bg-blue-500/30 text-blue-200'}`}>
              🏉 {stats.grifball.ballCarrierName}
            </div>
          )}
        </div>
      )}

      {/* Grifball countdown — big centered number before the ball goes live */}
      {stats.grifball && stats.grifball.phase === 'countdown' && (
        <div className="absolute top-[28%] left-1/2 -translate-x-1/2 pointer-events-none z-20 flex flex-col items-center">
          <p className="text-[11px] uppercase tracking-[0.4em] text-white/60 font-bold mb-1">Ball live in</p>
          <p className="text-7xl font-black text-amber-300 drop-shadow-[0_0_18px_rgba(252,211,77,0.6)] tabular-nums">
            {Math.max(1, Math.ceil(stats.grifball.countdown))}
          </p>
        </div>
      )}

      {/* Grifball GOAL! / match-winner celebration */}
      {stats.grifball && (stats.grifball.phase === 'scored' || stats.grifball.phase === 'matchEnd') && (
        <div className="absolute top-[26%] left-1/2 -translate-x-1/2 pointer-events-none z-30 flex flex-col items-center animate-pulse">
          {stats.grifball.phase === 'matchEnd' ? (
            <>
              <p className={`text-8xl font-black uppercase tracking-tight drop-shadow-[0_0_22px_rgba(250,204,21,0.6)] ${stats.grifball.winningTeam === 'red' ? 'text-red-400' : 'text-blue-400'}`}>
                {stats.grifball.winningTeam === 'red' ? 'Red' : 'Blue'} Wins
              </p>
              <p className="text-sm uppercase tracking-[0.4em] text-white/70 font-bold mt-2">
                {stats.grifball.blueGoals} – {stats.grifball.redGoals} · Final
              </p>
            </>
          ) : (
            <>
              <p className={`text-8xl font-black uppercase tracking-tight drop-shadow-[0_0_22px_rgba(16,185,129,0.6)] ${stats.grifball.ballCarrierTeam === 'red' ? 'text-red-400' : 'text-blue-400'}`}>
                Goal!
              </p>
              <p className="text-sm uppercase tracking-[0.35em] text-white/70 font-bold mt-2">
                {stats.grifball.ballCarrierTeam === 'red' ? 'Red' : 'Blue'} scores
              </p>
            </>
          )}
        </div>
      )}

      {/* Grifball ball-carrier controls + Pass-charge meter (local player) */}
      {stats.grifball && stats.grifball.localCarrying && (
        <div className="absolute top-[58%] left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 flex flex-col items-center gap-3">
          <div className="bg-black/60 backdrop-blur-md border border-orange-400/40 rounded-lg px-4 py-1.5 flex items-center gap-3">
            <span className="text-orange-300 font-black text-sm uppercase tracking-wider">🏉 Ball</span>
            <span className="text-[11px] text-white/70 font-mono">LMB Punch · Hold RMB Pass</span>
          </div>
          {stats.grifball.passCharge > 0 && (
            <div className="w-96 h-5 bg-black/60 border border-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-[width] duration-75"
                style={{ width: `${Math.round(stats.grifball.passCharge * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Grid editor overlay line effect */}
      {isAdjustmentMode && (
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-100 pointer-events-none" />
      )}

      {/* 1. OBJECTIVES / GAMEMODE */}
      <DraggableHUDItem {...getDraggableProps('objective')}>
        <div className="flex flex-col gap-1 items-center md:items-start w-full md:w-auto">
          <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-lg">
            <p className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">Objective</p>
            <p className="text-xl font-black tracking-tight uppercase">GRIFBALL CLASSIC</p>
          </div>
          <div className="flex gap-2 mt-2">
            <div className="bg-blue-600/30 backdrop-blur-sm border border-blue-400/30 px-3 py-1 rounded text-xs font-mono">{stats.playerMaxHP} HP MAX</div>
            <div className="bg-red-600/30 backdrop-blur-sm border border-red-400/30 px-3 py-1 rounded text-xs font-mono">RESPAWN: 3.0S</div>
          </div>
        </div>
      </DraggableHUDItem>

      {/* 2. CORE SCOREBOARD */}
      <DraggableHUDItem {...getDraggableProps('scoreboard')}>
        <div className="bg-black/50 backdrop-blur-lg border border-white/10 px-8 py-3 rounded-2xl flex items-center gap-6 md:gap-8 shadow-2xl">
          <div className="text-center">
            <p className="text-[10px] text-blue-400 font-bold tracking-tighter uppercase">
              {grifballScoreboard
                ? (blueScoreboardTeam?.label ?? 'Blue Team')
                : stats.isMultiplayer
                  ? (stats.multiplayerRole === 'host' ? `${stats.settings.playerName || stats.playerClientId || 'Host'} (You)` : stats.opponentPlayerName || stats.opponentClientId || 'Host')
                  : `${stats.settings.playerName || stats.playerClientId || 'Player'} (You)`}
            </p>
            <p className="text-3xl font-black font-display">
              {(grifballScoreboard ? (blueScoreboardTeam?.score ?? stats.grifball?.blueGoals ?? 0) : stats.scorePlayer).toString().padStart(2, '0')}
            </p>
          </div>
          <div className="h-8 w-[1px] bg-white/20"></div>
          <div className="text-center">
            <p className="text-[10px] text-white/55 font-bold uppercase tracking-widest">Time Remaining</p>
            <p className="text-2xl font-mono tracking-widest text-[#38bdf8]">{formatTime(stats.gameTime)}</p>
          </div>
          <div className="h-8 w-[1px] bg-white/20"></div>
          <div className="text-center">
            <p className="text-[10px] text-red-500 font-bold tracking-tighter uppercase">
              {grifballScoreboard
                ? (redScoreboardTeam?.label ?? 'Red Team')
                : stats.isMultiplayer
                  ? (stats.multiplayerRole === 'client' ? `${stats.settings.playerName || stats.playerClientId || 'Client'} (You)` : stats.opponentPlayerName || stats.opponentClientId || 'Client')
                  : (stats.opponentPlayerName || 'AI Bot')}
            </p>
            <p className="text-3xl font-black font-display">
              {(grifballScoreboard ? (redScoreboardTeam?.score ?? stats.grifball?.redGoals ?? 0) : stats.scoreEnemy).toString().padStart(2, '0')}
            </p>
          </div>
        </div>
      </DraggableHUDItem>

      {/* 3. ARENA STATUS INFO ON RIGHT */}
      <DraggableHUDItem {...getDraggableProps('arenaStatus')}>
        <div className="flex flex-col items-end gap-1">
          <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-lg text-right">
            <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Map Status</p>
            <p className="text-lg font-bold tracking-tight uppercase font-display">{stats.grifball ? 'Grifball Court' : 'Circular Arena'}</p>
          </div>
          
          {/* Pause Button (Interactive pointer-events toggled!) */}
          <button 
            id="pause-button"
            onClick={(e) => {
              e.stopPropagation();
              onPauseClick();
            }}
            className="pointer-events-auto mt-2 px-3 py-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-[10px] font-bold tracking-widest uppercase transition-all duration-150 cursor-pointer"
          >
            Pause [ESC]
          </button>
        </div>
      </DraggableHUDItem>

      <DraggableHUDItem {...getDraggableProps('technicalSpecs')}>
        <div className="bg-slate-950/65 backdrop-blur-md border border-cyan-400/20 px-4 py-2.5 rounded-lg text-right shadow-lg min-w-40">
          <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold">Technical Specs</p>
          <div className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 items-baseline font-mono">
            <span className="text-[10px] text-white/45 font-bold uppercase tracking-wider">FPS</span>
            <span className="text-sm text-white font-black tabular-nums">
              {stats.fps !== undefined && stats.fps > 0 ? stats.fps : 'calc...'}
            </span>
            <span className="text-[10px] text-white/45 font-bold uppercase tracking-wider">Ping</span>
            <span className="text-sm text-white font-black tabular-nums">
              {stats.ping !== undefined ? `${stats.ping}ms` : 'calc...'}
            </span>
          </div>
        </div>
      </DraggableHUDItem>

      {/* 4. DRAGGABLE KILL FEED */}
      <DraggableHUDItem {...getDraggableProps('eliminationFeed')}>
        {((stats.lastDeaths && stats.lastDeaths.length > 0) || isAdjustmentMode) ? (
          <div id="death-feed" className="flex flex-col items-start gap-2 max-w-xs pointer-events-none">
            <p className="text-[9px] font-mono font-bold tracking-[0.2em] text-white/30 uppercase ml-1">
              ELIMINATION FEED
            </p>
            <div className="flex flex-col items-start gap-1.5 w-full">
              {stats.lastDeaths && stats.lastDeaths.length > 0 ? (
                stats.lastDeaths.map((death) => {
                  const attackerClean = cleanFeedName(death.attacker);
                  const attackerIsBlue = death.attacker.includes('Blue') || death.attacker.includes('You');
                  
                  // Graceful weapon fallback detection if weapon is not set
                  let weaponType = death.weapon;
                  if (!weaponType) {
                    const lowerAttacker = death.attacker.toLowerCase();
                    if (lowerAttacker.includes('sword trade')) {
                      weaponType = 'sword_vs_sword';
                    } else if (lowerAttacker.includes('lunge/hammer trade')) {
                      weaponType = 'sword_vs_hammer';
                    } else if (lowerAttacker.includes('lunge') || lowerAttacker.includes('slash')) {
                      weaponType = 'sword';
                    } else {
                      weaponType = 'sword'; // default fallback
                    }
                  }

                  return (
                    <div 
                      key={death.id} 
                      className="bg-slate-950/70 backdrop-blur-md border border-white/10 rounded-md px-3 py-1.5 flex items-center gap-2 shadow-lg text-[11px] font-bold whitespace-nowrap pointer-events-auto"
                    >
                      <span className={attackerIsBlue ? 'text-sky-400 drop-shadow-[0_0_2px_rgba(56,189,248,0.3)]' : 'text-orange-400'}>
                        {attackerClean}
                      </span>
                      
                      {/* Premium glowing weapon/trade SVG icon */}
                      <span className="w-8 h-8 flex items-center justify-center">
                        {renderKillFeedIcon(weaponType)}
                      </span>
                      
                      <span className={attackerIsBlue ? 'text-orange-400' : 'text-sky-400 drop-shadow-[0_0_2px_rgba(56,189,248,0.3)]'}>
                        {death.victim}
                      </span>

                      {death.medals && death.medals.length > 0 && (
                        <div className="flex items-center gap-1 border-l border-white/15 pl-1.5 ml-1">
                          {death.medals.map((medal, index) => (
                            <div 
                              key={index} 
                              className="group/medal relative w-5 h-5 flex items-center justify-center rounded bg-slate-900/50 border border-white/10 shadow-[0_0_5px_var(--medal-color)] hover:bg-slate-800/80 transition-all cursor-help"
                              style={{ '--medal-color': medal.color } as any}
                            >
                              <div className="w-3.5 h-3.5" style={{ color: medal.color }}>
                                {renderMedalIcon(medal.icon)}
                              </div>
                              
                              {/* Glowing Tooltip Card */}
                              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-white/20 text-white rounded-lg p-2 text-[9px] font-mono font-bold uppercase tracking-wider hidden group-hover/medal:flex flex-col gap-0.5 z-[9999] shadow-[0_10px_25px_rgba(0,0,0,0.5)] pointer-events-none whitespace-nowrap min-w-36 text-center">
                                <span className="font-black text-xs drop-shadow-[0_0_6px_var(--medal-color)]" style={{ color: medal.color }}>{medal.name}</span>
                                <span className="text-[8px] text-white/60 lowercase italic font-normal">{medal.description}</span>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-950" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)] animate-pulse ml-0.5" />
                    </div>
                  );
                })
              ) : (
                /* Mock preview item for user alignment edit mode */
                <div className="bg-slate-950/70 backdrop-blur-md border border-cyan-500/30 rounded-md px-3 py-1.5 flex items-center gap-2 shadow-lg text-[11px] font-bold whitespace-nowrap opacity-80 pointer-events-auto">
                  <span className="text-sky-400">Blue Player (You)</span>
                  <span className="w-8 h-8 flex items-center justify-center">
                    <SwordIcon className="w-6 h-6 text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.7)]" />
                  </span>
                  <span className="text-orange-400">Red AI Player</span>
                  
                  {/* Mock medals preview inside HUD editor */}
                  <div className="flex items-center gap-1 border-l border-cyan-500/30 pl-1.5 ml-1">
                    <div className="relative w-5 h-5 flex items-center justify-center rounded bg-slate-900/50 border border-white/10 shadow-[0_0_5px_cyan] cursor-help">
                      <div className="w-3.5 h-3.5 text-cyan-400">
                        {renderMedalIcon('double')}
                      </div>
                    </div>
                    <div className="relative w-5 h-5 flex items-center justify-center rounded bg-slate-900/50 border border-white/10 shadow-[0_0_5px_crimson] cursor-help">
                      <div className="w-3.5 h-3.5 text-red-500">
                        {renderMedalIcon('bulltrue')}
                      </div>
                    </div>
                  </div>

                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)] animate-pulse ml-0.5" />
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DraggableHUDItem>

      {/* 5. MOTION TRACKER RADAR */}
      <DraggableHUDItem {...getDraggableProps('radar')}>
        <div id="motion-tracker-radar" className="flex flex-col items-start gap-1 pointer-events-none select-none">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-[#22d3ee]/60 uppercase ml-1">
              TACTICAL RADAR
            </span>
            <span 
              id="radar-status-badge"
              className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                stats.playerIsCrouchMoving 
                  ? 'bg-amber-950/40 text-amber-400 border-amber-500/20' 
                  : 'bg-cyan-950/40 text-cyan-400 border-cyan-500/20'
              }`}
            >
              <span id="radar-status-text">
                {stats.playerHP <= 0 
                  ? 'OFFLINE' 
                  : stats.playerIsCrouchMoving 
                    ? 'SIGNAL STEALTH' 
                    : 'ACTIVE'}
              </span>
            </span>
          </div>
          
          <div className="relative w-36 h-36 rounded-full border border-cyan-500/30 bg-slate-950/70 backdrop-blur-md shadow-[0_0_15px_rgba(6,182,212,0.15)] overflow-hidden flex items-center justify-center">
            {/* Concentric Grid lines */}
            <div className="absolute w-[115px] h-[115px] border border-cyan-500/10 rounded-full" />
            <div className="absolute w-[72px] h-[72px] border border-cyan-500/15 border-dashed rounded-full" />
            <div className="absolute w-[30px] h-[30px] border border-cyan-500/10 rounded-full" />
            
            {/* Crosshair grids */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[1px] h-full bg-cyan-500/5" />
              <div className="h-[1px] w-full bg-cyan-500/5" />
            </div>

            {/* Radar edge compass indicators — positioned via transform in updateRadarDOM (GPU-composited, no transition lag) */}
            <span id="radar-compass-n" className="absolute text-[8px] font-mono text-cyan-400/50 font-extrabold" style={{ left: 0, top: 0 }}>N</span>
            <span id="radar-compass-e" className="absolute text-[8px] font-mono text-cyan-400/30 font-extrabold" style={{ left: 0, top: 0 }}>E</span>
            <span id="radar-compass-s" className="absolute text-[8px] font-mono text-cyan-400/30 font-extrabold" style={{ left: 0, top: 0 }}>S</span>
            <span id="radar-compass-w" className="absolute text-[8px] font-mono text-cyan-400/30 font-extrabold" style={{ left: 0, top: 0 }}>W</span>

            {/* Enemy dots — dynamically populated per-frame by updateRadarDOM (supports N enemies) */}
            <div id="radar-enemies-container" className="absolute inset-0 pointer-events-none" />

            {/* Player friendly indicator arrow centered */}
            <svg 
              id="radar-player-arrow"
              className={stats.playerHP > 0 && !stats.playerIsCrouchMoving 
                ? "absolute w-3.5 h-3.5 text-[#22d3ee] drop-shadow-[0_0_4px_rgba(34,211,238,0.7)] z-20"
                : "absolute w-3.5 h-3.5 text-white/20 z-20"
              }
              style={{ 
                left: '65px', 
                top: '65px',
                display: stats.playerHP > 0 ? 'block' : 'none'
              }} 
              viewBox="0 0 24 24" 
              fill={stats.playerHP > 0 && !stats.playerIsCrouchMoving ? "currentColor" : "none"}
              stroke={stats.playerHP > 0 && !stats.playerIsCrouchMoving ? undefined : "currentColor"}
              strokeWidth={stats.playerHP > 0 && !stats.playerIsCrouchMoving ? undefined : "2"}
            >
              {/* Arrow pointing UP since map is relative-rotated to player view yaw */}
              <path d="M12 2L4 22L12 17L20 22L12 2Z" />
            </svg>
          </div>
        </div>
      </DraggableHUDItem>

      {/* 6. WEAPON CHARGING SYSTEMS & DASH SYSTEM */}
      <DraggableHUDItem {...getDraggableProps('weaponDash')}>
        {stats.isObserverMode ? (
          <div className="bg-black/60 backdrop-blur-md border border-cyan-500/30 p-4 rounded-xl shadow-2xl min-w-[280px]">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#22d3ee] animate-pulse" />
              <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-widest">
                Spectator Controls
              </span>
            </div>
            <h2 className="text-xl font-black uppercase tracking-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-white to-cyan-300">
              FLIGHT ENGINE ACTIVE
            </h2>
            <p className="text-[9.5px] font-mono tracking-widest text-[#94a3b8] uppercase mt-0.5">
              MANEUVER OVERRIDE SYSTEMS
            </p>
            
            <div className="mt-2.5 pt-2 border-t border-white/5 flex flex-col gap-1 text-[8.5px] font-mono text-slate-300">
              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span>MOVE CAMERA:</span>
                <span className="text-cyan-400 font-extrabold">[W][A][S][D]</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span>RISE UP:</span>
                <span className="text-cyan-400 font-extrabold">[SPACE]</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span>LOWER DOWN:</span>
                <span className="text-cyan-400 font-extrabold">[C]</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span>SPEED MULTIPLIER:</span>
                <span className="text-cyan-400 font-extrabold">[LSHIFT]</span>
              </div>
              {stats.observerCamMode === 'third' && (
                <div className="flex justify-between py-0.5 text-cyan-300 animate-pulse">
                  <span>ORBIT ZOOM:</span>
                  <span className="text-cyan-300 font-extrabold">[SCROLL WHEEL]</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row items-start md:items-end gap-4 md:gap-6">
            <div className="bg-black/45 backdrop-blur-md border border-white/10 p-4 rounded-xl shadow-2xl min-w-[240px]">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-2.5 h-2.5 rounded-full ${stats.weaponReady ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-yellow-500 animate-pulse'}`} />
                <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">
                  {stats.weaponReady ? 'Weapon Charged' : 'Chambering Rebound...'}
                </span>
              </div>
              <h2 className="text-2xl font-black uppercase tracking-tight font-display text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-indigo-300">
                {stats.activeWeapon === 'sword' ? 'Katar Sword' : 'Gravity Hammer'}
              </h2>
              <p className="text-[9.5px] font-mono tracking-widest text-[#94a3b8] uppercase mt-0.5">
                {stats.playerHP <= 0 
                  ? 'SYSTEM SHUT DOWN' 
                  : stats.activeWeapon === 'sword' 
                    ? 'Katar Indian Push Dagger' 
                    : 'Overhand Impact Wave Detector'}
              </p>
              {/* Visual keybindings overlay */}
              <div className="mt-2.5 pt-2 border-t border-white/5 flex flex-col gap-1 text-[8.5px] font-mono text-slate-400">
                {stats.activeWeapon === 'sword' ? (
                  <>
                    <div className="flex justify-between">
                      <span>LUNGING ATTACK:</span>
                      <span className="text-cyan-400 font-extrabold">[LEFT CLICK]</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span className="italic">(requires hovering enemy)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>SLASH SWEEP:</span>
                      <span className="text-cyan-400 font-extrabold">[RIGHT CLICK]</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span>VERTICAL CRUSH:</span>
                      <span className="text-amber-400 font-extrabold">[LEFT CLICK]</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>(shocks ground area)</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between border-t border-white/5 pt-1 mt-0.5 text-[8s] text-indigo-300">
                  <span>SWAP WEAPONS:</span>
                  <span>[1] or [2] / [SCROLL]</span>
                </div>
                <div className="flex justify-between text-[8s] text-emerald-300">
                  <span>PICKUP BALL:</span>
                  <span>[E] / [X]</span>
                </div>
              </div>
            </div>

            {/* Cooldown Sliding Progress Meter & Dash System */}
            <div className="flex flex-col gap-3">
              {/* Weapon Energy cooling */}
              <div className="flex flex-col">
                <span className="text-[9px] font-mono text-white/40 uppercase mb-1">
                  {stats.activeWeapon === 'sword' ? 'SWORD CAPACITOR' : 'COOLING SYSTEM'} ({cooldownPct}%)
                </span>
                <div className="w-44 h-2.5 bg-white/10 rounded-full overflow-hidden border border-white/10 shadow-inner">
                  <div 
                    className={`h-full transition-all duration-75 ${
                      stats.weaponReady 
                        ? stats.activeWeapon === 'sword'
                          ? 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]'
                          : 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.9)]' 
                        : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.7)]'
                    }`}
                    style={{ width: `${cooldownPct}%` }}
                  />
                </div>
              </div>

              {/* Dash Jetpack Thruster ready bar */}
              <div className="flex flex-col">
                <div className="flex justify-between w-44 mb-1">
                  <span className="text-[9px] font-mono text-white/40 uppercase">
                    THRUST BOOST [Q / LB]
                  </span>
                  <span className={`text-[9.5px] font-mono font-bold tracking-tight ${stats.playerDashReady ? 'text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.5)]' : 'text-amber-400'}`}>
                    {stats.playerDashReady ? 'READY' : `${stats.playerDashCooldownTimer.toFixed(1)}s`}
                  </span>
                </div>
                <div className="w-44 h-2.5 bg-white/10 rounded-full overflow-hidden border border-white/10 shadow-inner">
                  <div 
                    className={`h-full transition-all duration-75 ${
                      stats.playerDashReady 
                        ? 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]' 
                        : 'bg-amber-500/50'
                    }`}
                    style={{ 
                      width: stats.playerDashReady 
                        ? '100%' 
                        : `${Math.max(0, Math.min(100, Math.round(((stats.settings.dashCooldown - stats.playerDashCooldownTimer) / stats.settings.dashCooldown) * 100)))}%` 
                    }}
                  />
                </div>
              </div>

              {/* Sword Lunge Distance Tracker */}
              <div className="flex flex-col">
                <div className="flex justify-between w-44 mb-1">
                  <span className="text-[9px] font-mono text-white/40 uppercase">
                    SWORD LUNGE LMT
                  </span>
                  <span className="text-[9.5px] font-mono font-bold tracking-tight text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.5)]">
                    {stats.settings?.swordLungeDistance !== undefined ? `${stats.settings.swordLungeDistance.toFixed(1)}m` : '14.5m'}
                  </span>
                </div>
                <div className="w-44 h-2.5 bg-white/10 rounded-full overflow-hidden border border-white/10 shadow-inner bg-black/10">
                  <div 
                    className="h-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)] transition-all duration-300"
                    style={{ 
                      width: `${Math.max(0, Math.min(100, Math.round(((stats.settings?.swordLungeDistance ?? 14.5) / 25.0) * 100)))}%` 
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </DraggableHUDItem>

      {/* 7. HEALTH POINTS, LIVES AND STATUS FLAGS ROW */}
      <DraggableHUDItem {...getDraggableProps('vitality')}>
        {stats.isObserverMode ? (
          <div className="inline-flex flex-col md:flex-row items-end md:items-center gap-3">
            <div className="bg-black/45 backdrop-blur-md border border-cyan-500/30 px-4 py-2.5 rounded-lg text-right shadow-lg">
              <p className="text-[9px] text-cyan-400 font-bold uppercase tracking-wider mb-0.5">ROLE</p>
              <p className="font-mono text-xs tracking-wide text-white font-extrabold">SPECTATOR</p>
            </div>

            <div className="px-6 py-2.5 rounded-lg flex flex-col justify-center transition-all duration-300 shadow-xl border bg-cyan-950/60 border-cyan-500/40 text-cyan-200">
              <p className="text-[10px] font-black uppercase leading-none mb-1 text-center font-mono text-cyan-400/80">
                CAMERA VIEW
              </p>
              <div className="flex items-baseline justify-center gap-1">
                <p className="text-xs font-black tracking-tight text-white uppercase font-mono">
                  {stats.observerCamMode === 'free' ? 'Free Camera' : stats.observerCamMode === 'third' ? 'Third Person (Orbital)' : 'First Person'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="inline-flex flex-col md:flex-row items-end md:items-center gap-3">
            <div className="bg-black/30 backdrop-blur-md border border-white/10 px-4 py-2.5 rounded-lg text-right shadow-lg">
              <p className="text-[9px] text-white/55 font-bold uppercase tracking-wider mb-0.5">Physic Frame</p>
              <p className="font-mono text-xs tracking-wide text-indigo-300">{getStanceLabel()}</p>
            </div>

            <div className={`px-6 py-2.5 rounded-lg flex flex-col justify-center transition-all duration-300 shadow-xl border ${
              stats.playerHP <= 0 
                ? 'bg-red-950/60 border-red-500/40 text-red-200' 
                : 'bg-white text-slate-900 border-white'
            }`}>
              <p className="text-[10px] font-black uppercase leading-none mb-1 text-center font-mono">
                {stats.playerHP <= 0 ? 'STATUS: DEAD' : 'VITALITY'}
              </p>
              <div className="flex items-baseline justify-center gap-1">
                {stats.playerHP <= 0 ? (
                  <p className="text-xl font-black leading-none font-display text-[#ef4444]">
                    RESPAWN: {stats.playerRespawnTimer.toFixed(1)}S
                  </p>
                ) : (
                  <p className="text-2xl font-black leading-none font-display tracking-tight text-slate-900">
                    {stats.playerHP} / {stats.playerMaxHP} HP
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </DraggableHUDItem>

      {/* 8. CENTER ROW COMPRESS CROSSHAIR */}
      {!stats.isObserverMode && (
        <DraggableHUDItem {...getDraggableProps('crosshair')}>
          <div className="relative flex items-center justify-center pointer-events-none">
            {/* Crosshair Outer Ring */}
            {stats.activeWeapon === 'sword' ? (
              <div 
                className={`w-12 h-12 border-2 rounded-full flex items-center justify-center transition-all duration-150 ${
                  stats.crosshairColor === 'red'
                    ? 'border-red-500 bg-red-500/15 shadow-[0_0_15px_rgba(239,68,68,0.85)] scale-110'
                    : 'border-white bg-white/5 shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                }`}
              >
                {/* Inner dot or target bracket/lines */}
                <div className={`w-1.5 h-1.5 rounded-full ${stats.crosshairColor === 'red' ? 'bg-red-500 animate-pulse' : 'bg-white/70'}`} />
                
                {/* Decorative crosshair notches for Sword locking */}
                <div className={`absolute w-0.5 h-2 -top-1 ${stats.crosshairColor === 'red' ? 'bg-red-500' : 'bg-white/30'}`} />
                <div className={`absolute w-0.5 h-2 -bottom-1 ${stats.crosshairColor === 'red' ? 'bg-red-500' : 'bg-white/30'}`} />
                <div className={`absolute h-0.5 w-2 -left-1 ${stats.crosshairColor === 'red' ? 'bg-red-500' : 'bg-white/30'}`} />
                <div className={`absolute h-0.5 w-2 -right-1 ${stats.crosshairColor === 'red' ? 'bg-red-500' : 'bg-white/30'}`} />
                
                {/* Lunge Prompter text overlay */}
                {stats.crosshairColor === 'red' && (
                  <div className="absolute text-[8px] font-mono text-red-400 font-extrabold top-14 whitespace-nowrap animate-bounce uppercase">
                    Lunge Ready
                  </div>
                )}
              </div>
            ) : (
              <div className="w-10 h-10 border-2 border-white/40 rounded-full flex items-center justify-center transition-all duration-200">
                {/* Center target node */}
                <div className={`w-1 h-1 rounded-full ${stats.playerHP <= 0 ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)]' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)]'}`} />
              </div>
            )}

            {/* SPREAD INDICATOR RINGS IF STRIKE RECENTLY OCCURRED (DEBUG TRACE RADIUS ON HUD) */}
            {stats.debugMode && (
              <>
                {/* Radius Circle Viz (dash border matches 4.5m debug mockup scaling) */}
                <div className="absolute w-80 h-80 border-2 border-dashed border-red-500/10 rounded-full animate-pulse pointer-events-none"></div>
                <div className="absolute w-40 h-40 border border-red-500/20 rounded-full pointer-events-none"></div>
                
                <div className="absolute bottom-[-100px] bg-black/60 backdrop-blur-md px-3 py-1.5 border border-red-500/50 rounded text-[9px] font-mono tracking-widest text-red-400 uppercase text-center shadow-lg whitespace-nowrap">
                  DEBUG: DAMAGE_TRACE_RADIUS = {stats.debugDamageRadius.toFixed(1)}M
                  {stats.lastStrikePos && (
                    <div className="text-[8px] text-white/50 lowercase">
                      impact [x: {stats.lastStrikePos[0].toFixed(1)}, z: {stats.lastStrikePos[2].toFixed(1)}]
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </DraggableHUDItem>
      )}

      {/* 9. FULL IN-GAME SCOREBOARD OVERLAY */}
      {stats.showScoreboard && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/65 backdrop-blur-md z-[999] pointer-events-none animate-fade-in">
          <div className="w-full max-w-2xl bg-gradient-to-b from-slate-900/90 to-slate-950/95 border-2 border-cyan-500/30 rounded-2xl p-8 md:p-10 shadow-[0_0_60px_rgba(6,182,212,0.25)] relative overflow-hidden backdrop-blur-2xl">
            {/* Holographic grid lines inside scoreboard container */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.02)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none" />
            
            {/* Top decorative cyan line notches */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />

            {/* Scoreboard Header */}
            <div className="text-center mb-8 relative z-10">
              <span className="text-[10px] font-mono font-bold tracking-[0.4em] text-cyan-400 uppercase">TACTICAL SIMULATION</span>
              <h2 className="text-4xl font-sans font-black italic tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-white to-indigo-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.4)] mt-1">
                COMBAT SCOREBOARD
              </h2>
              <div className="h-[2px] w-24 bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent mt-3 mx-auto" />
            </div>

            {/* Main Scoreboard Rows Grid */}
            <div className="flex flex-col gap-4 relative z-10 w-full font-sans">
              {/* Header Titles */}
              <div className="grid grid-cols-12 px-6 py-2 text-[10px] font-mono font-extrabold tracking-[0.2em] text-white/30 uppercase border-b border-white/5">
                <div className="col-span-6 text-left">Combatant</div>
                <div className="col-span-2 text-center">Score</div>
                <div className="col-span-2 text-center">Kills</div>
                <div className="col-span-2 text-center">Deaths</div>
              </div>

              {(() => {
                const playersList = grifballScoreboard
                  ? grifballScoreboard.combatants.map((player) => {
                    const team = grifballScoreboard.teams.find((scoreboardTeam) => scoreboardTeam.id === player.team);
                    return {
                      id: player.id,
                      name: player.name,
                      score: player.score,
                      kills: player.kills,
                      deaths: player.deaths,
                      isLocal: player.isLocal,
                      hue: player.hue,
                      hp: player.hp,
                      teamLabel: team?.label ?? `${player.team} Team`,
                    };
                  })
                  : [
                    {
                      id: 'local_player',
                      name: stats.isMultiplayer
                        ? (stats.multiplayerRole === 'host' ? `${stats.settings.playerName || stats.playerClientId || 'Host'} (You)` : `${stats.settings.playerName || stats.playerClientId || 'Client'} (You)`)
                        : `${stats.settings.playerName || 'Player'} (You)`,
                      score: stats.scorePlayer,
                      kills: stats.playerKills ?? 0,
                      deaths: stats.playerDeaths ?? 0,
                      isLocal: true,
                      hue: stats.settings.playerHue ?? 200,
                      hp: stats.playerHP,
                      teamLabel: 'SANDBOX TEAM ALPHA',
                    }
                  ];

                if (!grifballScoreboard && !stats.isMultiplayer) {
                  // Single player main AI bot
                  playersList.push({
                    id: 'main_ai',
                    name: stats.opponentPlayerName || 'AI Bot',
                    score: stats.scoreEnemy,
                    kills: stats.enemyKills ?? 0,
                    deaths: stats.enemyDeaths ?? 0,
                    isLocal: false,
                    hue: 0,
                    hp: stats.enemyHP,
                    teamLabel: 'SANDBOX TEAM BETA',
                  });
                }

                if (!grifballScoreboard && stats.otherPlayers) {
                  stats.otherPlayers.forEach((player) => {
                    playersList.push({
                      id: player.id,
                      name: player.playerName,
                      score: player.score ?? 0,
                      kills: player.kills ?? 0,
                      deaths: player.deaths ?? 0,
                      isLocal: false,
                      hue: player.hue,
                      hp: player.hp,
                      teamLabel: 'SANDBOX TEAM BETA',
                    });
                  });
                }

                // Sort by score descending
                playersList.sort((a, b) => b.score - a.score);

                return playersList.map((player, index) => {
                  const isLeader = index === 0 && player.score > 0;
                  return (
                    <div 
                      key={player.id}
                      className={`grid grid-cols-12 items-center px-6 py-4 rounded-xl border transition-all duration-200 ${
                        player.isLocal 
                          ? 'bg-sky-500/10 border-sky-500/30 shadow-[0_0_15px_rgba(56,189,248,0.1)]' 
                          : 'bg-black/20 border-white/5'
                      }`}
                    >
                      <div className="col-span-6 flex items-center gap-3">
                        <div 
                          className="w-3.5 h-3.5 rounded-full border-2 border-white/20 shadow-md"
                          style={{ 
                            backgroundColor: `hsl(${player.hue}, 80%, 50%)`,
                            boxShadow: `0 0 8px hsl(${player.hue}, 80%, 50%)`
                          }}
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-black tracking-tight text-white flex items-center gap-2">
                            {player.name}
                            {isLeader && (
                              <span className="text-[8px] font-mono font-bold bg-amber-400/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-400/35">LEADER</span>
                            )}
                            {player.hp <= 0 && (
                              <span className="text-[8px] font-mono font-bold bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded border border-red-500/35">DEAD</span>
                            )}
                          </span>
                          <span className="text-[9px] font-mono text-white/30 uppercase mt-0.5">
                            {player.teamLabel}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-2 text-center text-xl font-black font-display text-cyan-400 drop-shadow-[0_0_4px_rgba(6,182,212,0.3)]">
                        {player.score}
                      </div>
                      <div className="col-span-2 text-center text-base font-bold font-mono text-white/80">
                        {player.kills}
                      </div>
                      <div className="col-span-2 text-center text-base font-bold font-mono text-white/60">
                        {player.deaths}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Footer game state indicator */}
            <div className="mt-8 pt-4 border-t border-white/5 flex justify-between items-center text-[9px] font-mono text-white/30 relative z-10">
              <span className="uppercase tracking-wider">ELAPSED TIME: {formatTime(stats.gameTime)}</span>
              <span className="uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping inline-block" />
                HOLD [U] TO KEEP OPEN
              </span>
            </div>
          </div>
        </div>
      )}
      {/* 10. HOLOGRAPHIC SPECTATE SELECTOR */}
      {stats.isObserverMode && (
        <DraggableHUDItem {...getDraggableProps('spectatorCard')}>
          <div className="bg-black/60 backdrop-blur-lg border border-cyan-500/40 p-4 rounded-xl shadow-[0_0_20px_rgba(6,182,212,0.25)] flex flex-col items-center gap-3 min-w-[280px]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-cyan-400 uppercase">
                SPECTATE PANEL
              </span>
            </div>
            
            <div className="flex items-center justify-between w-full gap-4 py-1.5 px-3 bg-cyan-950/40 border border-cyan-500/20 rounded-lg">
              {/* Previous target button */}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('cycle-observer-target', { detail: { direction: 'prev' } }))}
                className="pointer-events-auto text-cyan-400 hover:text-cyan-300 font-black text-lg transition-all p-1 hover:scale-125 cursor-pointer bg-transparent border-none animate-pulse"
                title="Select Previous Target"
              >
                ◀
              </button>
              
              <div className="text-center flex flex-col justify-center min-w-[150px]">
                <p className="text-[8px] font-mono text-cyan-400/50 uppercase tracking-widest leading-none mb-1">
                  SPECTATING
                </p>
                <p className="text-sm font-black text-white tracking-tight uppercase leading-none truncate max-w-[180px]">
                  {stats.observerTargetName || 'Spartan'}
                </p>
                <p className="text-[9px] font-mono text-cyan-300 uppercase mt-0.5 leading-none font-extrabold">
                  {stats.observerTargetRole === 'host' ? 'ALPHA (BLUE)' : 'BETA (RED)'}
                </p>
              </div>
              
              {/* Next target button */}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('cycle-observer-target', { detail: { direction: 'next' } }))}
                className="pointer-events-auto text-cyan-400 hover:text-cyan-300 font-black text-lg transition-all p-1 hover:scale-125 cursor-pointer bg-transparent border-none animate-pulse"
                title="Select Next Target"
              >
                ▶
              </button>
            </div>
            
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('cycle-observer-mode'))}
              className="pointer-events-auto w-full py-2 bg-gradient-to-r from-cyan-600/30 to-blue-600/30 hover:from-cyan-500/40 hover:to-blue-500/40 border border-cyan-500/30 hover:border-cyan-400 rounded-lg text-xs font-mono font-bold tracking-wider text-cyan-300 transition-all cursor-pointer flex items-center justify-center gap-2 hover:shadow-[0_0_12px_rgba(6,182,212,0.3)]"
            >
              <span>SWITCH CAMERA [V]</span>
            </button>
          </div>
        </DraggableHUDItem>
      )}

      {/* 🔟 MOBILE VIRTUAL GAMEPAD INTERFACES */}
      {showsMobileControls && (
        <>
          {/* MOBILE LEFT JOYSTICK */}
          <DraggableHUDItem {...getDraggableProps('mobileLeftAnalog')}>
            <LeftAnalogStick
              mobileJoystickRef={mobileJoystickRef}
              isAdjustmentMode={isAdjustmentMode}
            />
          </DraggableHUDItem>

          {/* MOBILE RIGHT GAMEPAD BUTTONS & LOOK JOYSTICK */}
          <DraggableHUDItem {...getDraggableProps('mobileRightButtons')}>
            <RightActionButtonPad
              mobileRightJoystickRef={mobileRightJoystickRef}
              mobileRightJoystickActiveRef={mobileRightJoystickActiveRef}
              isAdjustmentMode={isAdjustmentMode}
              activeWeapon={stats.activeWeapon}
              stats={stats}
            />
          </DraggableHUDItem>
        </>
      )}

      {/* 11. CSS Keyframe Animations for Medals */}
      <style>{`
        @keyframes medal-slide-up {
          0% {
            opacity: 0;
            transform: translateY(35px) scale(0.8);
          }
          8% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          85% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-45px) scale(0.85);
          }
        }
        .animate-bounce-slow {
          animation: bounce-slow 2s infinite ease-in-out;
        }
        @keyframes bounce-slow {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }
      `}</style>

      {/* 12. HALO-STYLE CENTRAL MEDAL POPUP */}
      {(stats.activeMedalPopup || isAdjustmentMode) && (
        <DraggableHUDItem {...getDraggableProps('medalPopup')}>
          <div 
            key={stats.activeMedalPopup?.key ?? 'preview'}
            className="flex flex-col items-center pointer-events-none select-none"
            style={{
              animation: isAdjustmentMode ? 'none' : 'medal-slide-up 2.4s cubic-bezier(0.19, 1, 0.22, 1) forwards'
            }}
          >
            {/* Outer glowing glassmorphic card */}
            <div 
              className="flex flex-col items-center bg-slate-950/85 border border-white/20 rounded-xl px-5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.6),0_0_20px_var(--medal-glow)] backdrop-blur-xl relative overflow-hidden min-w-[170px] max-w-[220px]"
              style={{
                '--medal-glow': stats.activeMedalPopup?.medal.color ?? 'rgb(249, 115, 22)'
              } as any}
            >
              {/* Holographic scanning laser line */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:100%_3px] pointer-events-none" />
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              
              {/* Rotating/pulsing starburst background flare */}
              <div 
                className="absolute w-20 h-20 rounded-full filter blur-xl opacity-25 animate-pulse"
                style={{ background: stats.activeMedalPopup?.medal.color ?? 'rgb(249, 115, 22)' }}
              />

              {/* Glowing Medal SVG Icon */}
              <div 
                className="w-10 h-10 relative flex items-center justify-center animate-bounce-slow"
                style={{ filter: `drop-shadow(0 0 5px ${stats.activeMedalPopup?.medal.color ?? 'rgb(249, 115, 22)'})` }}
              >
                {renderMedalIcon(stats.activeMedalPopup?.medal.icon ?? 'killingspree')}
              </div>

              {/* Medal Details */}
              <div className="text-center mt-1.5 z-10 flex flex-col gap-0.5 font-sans">
                <span className="text-[7.5px] font-mono font-black tracking-[0.25em] text-white/40 leading-none">
                  {stats.activeMedalPopup ? 'MEDAL EARNED' : 'PREVIEW NOTIFICATION'}
                </span>
                <h3 
                  className="text-base font-black italic tracking-tighter uppercase drop-shadow-[0_0_6px_rgba(255,255,255,0.3)] mt-0.5 leading-none"
                  style={{ color: stats.activeMedalPopup?.medal.color ?? 'rgb(249, 115, 22)' }}
                >
                  {stats.activeMedalPopup?.medal.name ?? 'Killing Spree'}
                </h3>
                <p className="text-[8px] font-mono tracking-widest text-[#94a3b8] uppercase font-bold mt-1 max-w-[150px] leading-tight mx-auto">
                  {stats.activeMedalPopup?.medal.description ?? '5 KILLS WITHOUT DYING'}
                </p>
              </div>
            </div>
          </div>
        </DraggableHUDItem>
      )}

      {/* 🎬 THEATER REPLAY PLAYBACK BOTTOM CONTROL BAR */}
      {stats.isReplayMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-3xl bg-slate-950/85 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-4 flex flex-col gap-3 shadow-[0_20px_50px_rgba(0,0,0,0.8),0_0_20px_rgba(6,182,212,0.15)] z-[1000] pointer-events-auto">
          {/* Timeline slider and scrubber */}
          <div className="flex items-center gap-4 w-full">
            <span className="text-[10px] font-mono text-cyan-400 font-extrabold w-12 text-left">
              {formatTime(stats.replayElapsedTime ?? 0)}
            </span>
            <input 
              type="range"
              min={0}
              max={stats.replayDuration ?? 100}
              step={0.1}
              value={stats.replayElapsedTime ?? 0}
              onChange={(e) => {
                const targetTime = parseFloat(e.target.value);
                window.dispatchEvent(new CustomEvent('replay-seek', { detail: { time: targetTime } }));
              }}
              className="flex-1 accent-cyan-400 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer hover:bg-white/20 transition-all"
            />
            <span className="text-[10px] font-mono text-white/40 w-12 text-right">
              {formatTime(stats.replayDuration ?? 0)}
            </span>
          </div>

          {/* Interactive controls row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Play, Pause, and Skip buttons */}
            <div className="flex items-center gap-3">
              {/* Skip backward 5s */}
              <button
                onClick={() => {
                  const targetTime = Math.max(0, (stats.replayElapsedTime ?? 0) - 5);
                  window.dispatchEvent(new CustomEvent('replay-seek', { detail: { time: targetTime } }));
                }}
                className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center transition-all cursor-pointer select-none font-bold text-xs"
                title="Rewind 5 Seconds"
              >
                ⏪
              </button>

              {/* Play/Pause */}
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('replay-toggle-play'));
                }}
                className="w-11 h-11 rounded-xl bg-gradient-to-b from-[#22d3ee] to-[#0891b2] hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] text-slate-950 flex items-center justify-center transition-all cursor-pointer select-none font-black text-sm"
                title={stats.replayIsPlaying ? "Pause Replay" : "Play Replay"}
              >
                {stats.replayIsPlaying ? "⏸️" : "▶️"}
              </button>

              {/* Skip forward 5s */}
              <button
                onClick={() => {
                  const targetTime = Math.min(stats.replayDuration ?? 100, (stats.replayElapsedTime ?? 0) + 5);
                  window.dispatchEvent(new CustomEvent('replay-seek', { detail: { time: targetTime } }));
                }}
                className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center transition-all cursor-pointer select-none font-bold text-xs"
                title="Fast Forward 5 Seconds"
              >
                ⏩
              </button>
            </div>

            {/* Playback speed selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-white/40 uppercase">Speed:</span>
              <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/10 gap-1 select-none">
                {([0.5, 1.0, 1.5, 2.0, 4.0] as const).map(speed => (
                  <button
                    key={speed}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('replay-change-speed', { detail: { speed } }));
                    }}
                    className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-bold tracking-tight uppercase transition-all duration-150 cursor-pointer border-none ${
                      stats.replaySpeedMultiplier === speed
                        ? 'bg-cyan-400 text-slate-950 font-black'
                        : 'text-white/50 hover:text-white/80 bg-transparent'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* Camera Perspective selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-white/40 uppercase">Cam:</span>
              <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/10 gap-1 select-none">
                {([
                  { id: 'free', label: 'Free' },
                  { id: 'first', label: '1st' },
                  { id: 'third', label: 'Orbit' }
                ] as const).map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => {
                      if (mode.id === 'free') {
                        window.dispatchEvent(new CustomEvent('replay-change-target', { detail: { id: 'free' } }));
                      } else {
                        window.dispatchEvent(new CustomEvent('replay-change-cam-mode', { detail: { mode: mode.id } }));
                        if (stats.replayCurrentTargetId === 'free') {
                          window.dispatchEvent(new CustomEvent('replay-change-target', { detail: { id: 'player' } }));
                        }
                      }
                    }}
                    className={`px-2.5 py-1 rounded text-[9.5px] font-mono font-bold tracking-tight uppercase transition-all duration-150 cursor-pointer border-none ${
                      stats.observerCamMode === mode.id || (mode.id === 'free' && stats.replayCurrentTargetId === 'free')
                        ? 'bg-cyan-400 text-slate-950 font-black'
                        : 'text-white/50 hover:text-white/80 bg-transparent'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target locking dropdown */}
            {stats.replayPlayerList && stats.replayPlayerList.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-white/40 uppercase">Lock:</span>
                <select
                  value={stats.replayCurrentTargetId ?? 'free'}
                  onChange={(e) => {
                    const targetId = e.target.value;
                    window.dispatchEvent(new CustomEvent('replay-change-target', { detail: { id: targetId } }));
                    if (targetId !== 'free' && stats.observerCamMode === 'free') {
                      window.dispatchEvent(new CustomEvent('replay-change-cam-mode', { detail: { mode: 'third' } }));
                    }
                  }}
                  className="bg-black/60 border border-white/10 text-cyan-400 font-bold uppercase rounded px-2.5 py-1.5 text-[9.5px] tracking-wider outline-none cursor-pointer focus:border-[#22d3ee] transition-all font-sans"
                >
                  <option value="free">🎥 Free Cam (Spectator)</option>
                  <optgroup label="Lock Onto Player">
                    {stats.replayPlayerList.map(p => (
                      <option key={p.id} value={p.id}>
                        👤 {p.name} {p.id === 'player' ? '(You)' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
