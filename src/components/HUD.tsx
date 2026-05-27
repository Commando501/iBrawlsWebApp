/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Lock, Minus, Plus, RotateCcw, Unlock } from 'lucide-react';
import {
  GameStats,
  UiElementPos,
  DeviceInfo,
  UI_ELEMENT_SCALE_MAX,
  UI_ELEMENT_SCALE_MIN,
  UI_ELEMENT_SCALE_STEP,
} from '../types';
import { LeftAnalogStick, RightActionButtonPad } from './MobileGamepad';

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

interface DraggableHUDItemProps {
  id: string;
  uiItem?: UiElementPos;
  isAdjustmentMode: boolean;
  onToggleLock: (id: string) => void;
  onUpdateScale: (id: string, scale: number) => void;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  defaultScale: number;
  isMobileLayout: boolean;
  children: React.ReactNode;
}

const clampUiScale = (scale: number) => (
  Math.round(Math.max(UI_ELEMENT_SCALE_MIN, Math.min(UI_ELEMENT_SCALE_MAX, scale)) * 100) / 100
);

export const DraggableHUDItem: React.FC<DraggableHUDItemProps> = ({
  id,
  uiItem,
  isAdjustmentMode,
  onToggleLock,
  onUpdateScale,
  onPointerDown,
  defaultScale,
  isMobileLayout,
  children
}) => {
  if (!uiItem) return null;

  const getTransformStyle = (id: string, scale: number) => {
    let baseTransform = 'none';
    switch (id) {
      case 'scoreboard':
        baseTransform = 'translate(-50%, 0)';
        break;
      case 'arenaStatus':
      case 'technicalSpecs':
        baseTransform = 'translate(-100%, 0)';
        break;
      case 'vitality':
        baseTransform = 'translate(-100%, -100%)';
        break;
      case 'crosshair':
      case 'spectatorCard':
        baseTransform = 'translate(-50%, -50%)';
        break;
      case 'mobileLeftAnalog':
        baseTransform = isMobileLayout ? 'translate(0, -100%)' : 'none';
        break;
      case 'mobileRightButtons':
        baseTransform = isMobileLayout ? 'translate(-100%, -100%)' : 'none';
        break;
      case 'weaponDash':
        baseTransform = isMobileLayout ? 'translate(-50%, -100%)' : 'none';
        break;
      case 'eliminationFeed':
        baseTransform = isMobileLayout ? 'translate(-50%, -50%)' : 'none';
        break;
      case 'radar':
        baseTransform = isMobileLayout ? 'translate(0, -100%)' : 'none';
        break;
    }
    const scaleTransform = `scale(${scale})`;
    return baseTransform === 'none' ? scaleTransform : `${scaleTransform} ${baseTransform}`;
  };

  const getTransformOrigin = (id: string) => {
    switch (id) {
      case 'scoreboard':
        return 'top center';
      case 'arenaStatus':
      case 'technicalSpecs':
        return 'top right';
      case 'vitality':
        return 'bottom right';
      case 'crosshair':
      case 'spectatorCard':
      case 'eliminationFeed':
        return 'center';
      case 'mobileLeftAnalog':
      case 'radar':
        return 'bottom left';
      case 'mobileRightButtons':
        return 'bottom right';
      case 'weaponDash':
        return isMobileLayout ? 'bottom center' : 'top left';
      default:
        return 'top left';
    }
  };

  const scale = clampUiScale(uiItem.scale ?? 1);
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${uiItem.x}%`,
    top: `${uiItem.y}%`,
    transform: getTransformStyle(id, scale),
    transformOrigin: getTransformOrigin(id),
    zIndex: isAdjustmentMode ? 50 : undefined,
    willChange: isAdjustmentMode && !uiItem.locked ? 'left, top, transform' : undefined,
    touchAction: isAdjustmentMode ? 'none' : undefined,
  };

  const updateScale = (nextScale: number) => onUpdateScale(id, clampUiScale(nextScale));

  if (!isAdjustmentMode) {
    return (
      <div data-hud-id={id} style={style} className="transition-all duration-300">
        {children}
      </div>
    );
  }

  return (
    <div 
      data-hud-id={id}
      style={style}
      className={`group select-none relative pointer-events-auto transition-colors p-2 rounded-xl border ${
        uiItem.locked 
          ? 'border-dashed border-white/20 bg-slate-950/40 hover:border-white/40' 
          : 'border-dashed border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.35)] hover:border-cyan-300 cursor-move'
      }`}
      onPointerDown={(e) => onPointerDown(id, e)}
    >
      {/* Label and Lock toggle buttons */}
      <div className="absolute -top-7 left-0 right-0 h-6 flex items-center justify-between px-1.5 bg-slate-950/90 border border-slate-800 rounded-md text-[9px] font-mono font-bold z-50 pointer-events-auto shadow-md">
        <span className="text-slate-300 uppercase tracking-tight truncate max-w-[125px]">{uiItem.name}</span>
        
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(id);
          }}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer transition-all ${
            uiItem.locked 
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-400' 
              : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
          }`}
        >
          {uiItem.locked ? (
            <>
              <Lock className="w-2.5 h-2.5" />
              <span>LOCKED</span>
            </>
          ) : (
            <>
              <Unlock className="w-2.5 h-2.5 text-emerald-300 animate-pulse" />
              <span className="text-emerald-100">UNLOCKED</span>
            </>
          )}
        </button>
      </div>

      {!uiItem.locked && (
        <div className="absolute -bottom-8 left-0 h-7 flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950/90 px-1.5 text-[9px] font-mono font-bold text-slate-200 shadow-md z-50 pointer-events-auto">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              updateScale(scale - UI_ELEMENT_SCALE_STEP);
            }}
            className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center cursor-pointer"
            title="Decrease size"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="min-w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              updateScale(scale + UI_ELEMENT_SCALE_STEP);
            }}
            className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center cursor-pointer"
            title="Increase size"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              updateScale(defaultScale);
            }}
            className="w-5 h-5 rounded bg-cyan-950/70 hover:bg-cyan-900 text-cyan-300 flex items-center justify-center cursor-pointer"
            title="Reset size"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Dragging Overlay shield to optimize dragging and prevent sub-clicks */}
      {!uiItem.locked && (
        <div className="absolute inset-0 z-30 bg-cyan-500/5 cursor-move rounded-xl pointer-events-none" />
      )}

      {children}
    </div>
  );
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
      const clampedX = Math.max(1, Math.min(99, pctX));
      const clampedY = Math.max(1, Math.min(99, pctY));

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
              {stats.isMultiplayer
                ? (stats.multiplayerRole === 'host' ? `${stats.settings.playerName || stats.playerClientId || 'Host'} (You)` : stats.opponentPlayerName || stats.opponentClientId || 'Host')
                : `${stats.settings.playerName || stats.playerClientId || 'Player'} (You)`}
            </p>
            <p className="text-3xl font-black font-display">{stats.scorePlayer.toString().padStart(2, '0')}</p>
          </div>
          <div className="h-8 w-[1px] bg-white/20"></div>
          <div className="text-center">
            <p className="text-[10px] text-white/55 font-bold uppercase tracking-widest">Time Remaining</p>
            <p className="text-2xl font-mono tracking-widest text-[#38bdf8]">{formatTime(stats.gameTime)}</p>
          </div>
          <div className="h-8 w-[1px] bg-white/20"></div>
          <div className="text-center">
            <p className="text-[10px] text-red-500 font-bold tracking-tighter uppercase">
              {stats.isMultiplayer
                ? (stats.multiplayerRole === 'client' ? `${stats.settings.playerName || stats.playerClientId || 'Client'} (You)` : stats.opponentPlayerName || stats.opponentClientId || 'Client')
                : 'AI Bot'}
            </p>
            <p className="text-3xl font-black font-display">{stats.scoreEnemy.toString().padStart(2, '0')}</p>
          </div>
        </div>
      </DraggableHUDItem>

      {/* 3. ARENA STATUS INFO ON RIGHT */}
      <DraggableHUDItem {...getDraggableProps('arenaStatus')}>
        <div className="flex flex-col items-end gap-1">
          <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-lg text-right">
            <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Map Status</p>
            <p className="text-lg font-bold tracking-tight uppercase font-display">Circular Arena</p>
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

      {/* 4. TECHNICAL SPECIFICS */}
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
                  const attackerIsBlue = death.attacker.includes('Blue');
                  return (
                    <div 
                      key={death.id} 
                      className="bg-slate-950/70 backdrop-blur-md border border-white/10 rounded-md px-3 py-1.5 flex items-center gap-2 shadow-lg text-[11px] font-bold whitespace-nowrap"
                    >
                      <span className={attackerIsBlue ? 'text-sky-400 drop-shadow-[0_0_2px_rgba(56,189,248,0.3)]' : 'text-orange-400'}>
                        {death.attacker}
                      </span>
                      
                      <span className="text-[9.5px] font-mono text-white/50 lowercase italic">
                        slammed
                      </span>
                      
                      <span className={attackerIsBlue ? 'text-orange-400' : 'text-sky-400 drop-shadow-[0_0_2px_rgba(56,189,248,0.3)]'}>
                        {death.victim}
                      </span>
                      
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)] animate-pulse" />
                    </div>
                  );
                })
              ) : (
                /* Mock preview item for user alignment edit mode */
                <div className="bg-slate-950/70 backdrop-blur-md border border-cyan-500/30 rounded-md px-3 py-1.5 flex items-center gap-2 shadow-lg text-[11px] font-bold whitespace-nowrap opacity-60">
                  <span className="text-sky-400">Blue Player (You)</span>
                  <span className="text-[9.5px] font-mono text-white/50 lowercase italic">slammed</span>
                  <span className="text-orange-400">Red AI Player</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)] animate-pulse" />
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
                    THRUST BOOST [Q]
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
                const playersList = [
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
                    hp: stats.playerHP
                  }
                ];

                if (!stats.isMultiplayer) {
                  // Single player main AI bot
                  playersList.push({
                    id: 'main_ai',
                    name: 'AI Bot',
                    score: stats.scoreEnemy,
                    kills: stats.enemyKills ?? 0,
                    deaths: stats.enemyDeaths ?? 0,
                    isLocal: false,
                    hue: 0,
                    hp: stats.enemyHP
                  });
                }

                if (stats.otherPlayers) {
                  stats.otherPlayers.forEach((player) => {
                    playersList.push({
                      id: player.id,
                      name: player.playerName,
                      score: player.score ?? 0,
                      kills: player.kills ?? 0,
                      deaths: player.deaths ?? 0,
                      isLocal: false,
                      hue: player.hue,
                      hp: player.hp
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
                            {player.isLocal ? 'SANDBOX TEAM ALPHA' : 'SANDBOX TEAM BETA'}
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
                onClick={() => window.dispatchEvent(new CustomEvent('cycle-observer-target'))}
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
                onClick={() => window.dispatchEvent(new CustomEvent('cycle-observer-target'))}
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

    </div>
  );
};
