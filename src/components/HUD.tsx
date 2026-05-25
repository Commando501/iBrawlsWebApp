/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { GameStats, UiElementPos } from '../types';

interface HUDProps {
  stats: GameStats;
  onPauseClick: () => void;
  onThemeToggle?: () => void;
  uiPositions: UiElementPos[];
  onUpdateUiPositions: (positions: UiElementPos[]) => void;
  isAdjustmentMode: boolean;
}

interface DraggableHUDItemProps {
  id: string;
  uiItem?: UiElementPos;
  isAdjustmentMode: boolean;
  onToggleLock: (id: string) => void;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  children: React.ReactNode;
}

export const DraggableHUDItem: React.FC<DraggableHUDItemProps> = ({
  id,
  uiItem,
  isAdjustmentMode,
  onToggleLock,
  onMouseDown,
  children
}) => {
  if (!uiItem) return null;

  const getTransformStyle = (id: string) => {
    switch (id) {
      case 'scoreboard':
        return 'translate(-50%, 0)';
      case 'arenaStatus':
        return 'translate(-100%, 0)';
      case 'vitality':
        return 'translate(-100%, -100%)';
      case 'crosshair':
        return 'translate(-50%, -50%)';
      default:
        return 'none';
    }
  };

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${uiItem.x}%`,
    top: `${uiItem.y}%`,
    transform: getTransformStyle(id),
    zIndex: isAdjustmentMode ? 50 : undefined,
  };

  if (!isAdjustmentMode) {
    return (
      <div style={style} className="transition-all duration-300">
        {children}
      </div>
    );
  }

  return (
    <div 
      style={style}
      className={`group select-none relative pointer-events-auto transition-all p-2 rounded-xl border ${
        uiItem.locked 
          ? 'border-dashed border-white/20 bg-slate-950/40 hover:border-white/40' 
          : 'border-dashed border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.35)] hover:border-cyan-300 cursor-move'
      }`}
      onMouseDown={(e) => onMouseDown(id, e)}
    >
      {/* Label and Lock toggle buttons */}
      <div className="absolute -top-7 left-0 right-0 h-6 flex items-center justify-between px-1.5 bg-slate-950/90 border border-slate-800 rounded-md text-[9px] font-mono font-bold z-50 pointer-events-auto shadow-md">
        <span className="text-slate-300 uppercase tracking-tight truncate max-w-[125px]">{uiItem.name}</span>
        
        <button
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
  onUpdateUiPositions, 
  isAdjustmentMode 
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);

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
    onUpdateUiPositions(
      uiPositions.map((ui) => (ui.id === id ? { ...ui, locked: !ui.locked } : ui))
    );
  };

  const handleMouseDown = (id: string, e: React.MouseEvent) => {
    const item = uiPositions.find((ui) => ui.id === id);
    if (!item || item.locked) return;
    setDraggingId(id);
    e.stopPropagation();
    e.preventDefault();
  };

  useEffect(() => {
    if (!draggingId) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      // Calculate cursor position in percentages of the window space
      const pctX = (e.clientX / window.innerWidth) * 100;
      const pctY = (e.clientY / window.innerHeight) * 100;

      // Restrict within the viewport boundaries (avoid flying completely offscreen)
      const clampedX = Math.max(1, Math.min(99, pctX));
      const clampedY = Math.max(1, Math.min(99, pctY));

      onUpdateUiPositions(
        uiPositions.map((ui) => (ui.id === draggingId ? { ...ui, x: clampedX, y: clampedY } : ui))
      );
    };

    const handleWindowMouseUp = () => {
      setDraggingId(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [draggingId, uiPositions, onUpdateUiPositions]);

  return (
    <div className={`absolute inset-0 z-10 select-none font-sans text-white ${isAdjustmentMode ? 'pointer-events-auto bg-slate-900/10' : 'pointer-events-none'}`}>
      
      {/* Grid editor overlay line effect */}
      {isAdjustmentMode && (
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-100 pointer-events-none" />
      )}

      {/* 1. OBJECTIVES / GAMEMODE */}
      <DraggableHUDItem
        id="objective"
        uiItem={uiPositions.find(p => p.id === 'objective')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
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
      <DraggableHUDItem
        id="scoreboard"
        uiItem={uiPositions.find(p => p.id === 'scoreboard')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
        <div className="bg-black/50 backdrop-blur-lg border border-white/10 px-8 py-3 rounded-2xl flex items-center gap-6 md:gap-8 shadow-2xl">
          <div className="text-center">
            <p className="text-[10px] text-blue-400 font-bold tracking-tighter uppercase">
              {stats.isMultiplayer
                ? (stats.multiplayerRole === 'host' ? `${stats.playerClientId || 'Host'} (You)` : stats.opponentClientId || 'Host')
                : `${stats.playerClientId || 'Player'} (You)`}
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
                ? (stats.multiplayerRole === 'client' ? `${stats.playerClientId || 'Client'} (You)` : stats.opponentClientId || 'Client')
                : 'AI Bot'}
            </p>
            <p className="text-3xl font-black font-display">{stats.scoreEnemy.toString().padStart(2, '0')}</p>
          </div>
        </div>
      </DraggableHUDItem>

      {/* 3. ARENA STATUS INFO ON RIGHT */}
      <DraggableHUDItem
        id="arenaStatus"
        uiItem={uiPositions.find(p => p.id === 'arenaStatus')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
        <div className="flex flex-col items-end gap-1">
          <div className="bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-lg text-right">
            <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Map Status</p>
            <p className="text-lg font-bold tracking-tight uppercase font-display">Circular Arena</p>
            {stats.isMultiplayer && (
              <p className="text-[10.5px] font-mono mt-1 text-sky-400 font-extrabold flex items-center justify-end gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                PING: {stats.ping !== undefined ? `${stats.ping}ms` : 'calc...'}
              </p>
            )}
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

      {/* 4. DRAGGABLE KILL FEED */}
      <DraggableHUDItem
        id="eliminationFeed"
        uiItem={uiPositions.find(p => p.id === 'eliminationFeed')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
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
      <DraggableHUDItem
        id="radar"
        uiItem={uiPositions.find(p => p.id === 'radar')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
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

            {/* Radar edge compass indicators */}
            {(() => {
              const cosYaw = Math.cos(stats.playerYaw);
              const sinYaw = Math.sin(stats.playerYaw);
              const r = 58; // compass offset radius from center (72px)
              const center = 72; // half of 144px diameter
              return (
                <>
                  <span id="radar-compass-n" className="absolute text-[8px] font-mono text-cyan-400/50 font-extrabold transition-all duration-75" style={{ left: `${center + r * sinYaw - 3.5}px`, top: `${center - r * cosYaw - 5}px` }}>N</span>
                  <span id="radar-compass-e" className="absolute text-[8px] font-mono text-cyan-400/30 font-extrabold transition-all duration-75" style={{ left: `${center + r * cosYaw - 3.5}px`, top: `${center + r * sinYaw - 5}px` }}>E</span>
                  <span id="radar-compass-s" className="absolute text-[8px] font-mono text-cyan-400/30 font-extrabold transition-all duration-75" style={{ left: `${center - r * sinYaw - 3.5}px`, top: `${center + r * cosYaw - 5}px` }}>S</span>
                  <span id="radar-compass-w" className="absolute text-[8px] font-mono text-cyan-400/30 font-extrabold transition-all duration-75" style={{ left: `${center - r * cosYaw - 3.5}px`, top: `${center - r * sinYaw - 5}px` }}>W</span>
                </>
              );
            })()}

            {/* Math calculation & plot of enemy dot */}
            {(() => {
              // Compute real-time fallback layout calculations on mount
              const maxRange = 25; 
              const radarRadius = 72; 
              const scale = radarRadius / maxRange;

              const dx = stats.enemyX - stats.playerX;
              const dz = stats.enemyZ - stats.playerZ;
              const dist = Math.sqrt(dx * dx + dz * dz);

              const forward_x = -Math.sin(stats.playerYaw);
              const forward_z = -Math.cos(stats.playerYaw);
              const right_x = Math.cos(stats.playerYaw);
              const right_z = -Math.sin(stats.playerYaw);

              const local_y = dx * forward_x + dz * forward_z;
              const local_x = dx * right_x + dz * right_z;

              const ex = local_x * scale;
              const ey = -local_y * scale;

              const eLeft = radarRadius + ex - 6;
              const eTop = radarRadius + ey - 6;

              const showEnemy = stats.playerHP > 0 && stats.enemyHP > 0 && !stats.enemyIsCrouchMoving && dist <= maxRange;

              return (
                <div 
                  id="radar-enemy-dot-container"
                  className="absolute w-3 h-3 bg-red-500 rounded-full border border-white/40 shadow-[0_0_12px_#ef4444] animate-pulse z-30 flex items-center justify-center transition-all duration-75"
                  style={{ 
                    left: `${eLeft}px`, 
                    top: `${eTop}px`,
                    display: showEnemy ? 'flex' : 'none' 
                  }}
                >
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
              );
            })()}

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
      <DraggableHUDItem
        id="weaponDash"
        uiItem={uiPositions.find(p => p.id === 'weaponDash')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
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
      </DraggableHUDItem>

      {/* 7. HEALTH POINTS, LIVES AND STATUS FLAGS ROW */}
      <DraggableHUDItem
        id="vitality"
        uiItem={uiPositions.find(p => p.id === 'vitality')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
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
      </DraggableHUDItem>

      {/* 8. CENTER ROW COMPRESS CROSSHAIR */}
      <DraggableHUDItem
        id="crosshair"
        uiItem={uiPositions.find(p => p.id === 'crosshair')}
        isAdjustmentMode={isAdjustmentMode}
        onToggleLock={handleToggleLock}
        onMouseDown={handleMouseDown}
      >
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

              {/* Blue Team Row */}
              <div className={`grid grid-cols-12 items-center px-6 py-4 rounded-xl border transition-all duration-200 ${
                stats.scorePlayer >= stats.scoreEnemy 
                  ? 'bg-sky-500/10 border-sky-500/30 shadow-[0_0_15px_rgba(56,189,248,0.1)]' 
                  : 'bg-black/20 border-white/5'
              }`}>
                <div className="col-span-6 flex items-center gap-3">
                  <div className="w-3.5 h-3.5 rounded-full bg-sky-500 border-2 border-white/20 shadow-[0_0_8px_#38bdf8]" />
                  <div className="flex flex-col">
                    <span className="text-sm font-black tracking-tight text-white flex items-center gap-2">
                      {stats.isMultiplayer
                        ? (stats.multiplayerRole === 'host' ? `${stats.playerClientId || 'Host'} (You)` : stats.opponentClientId || 'Host')
                        : `${stats.playerClientId || 'Player'} (You)`}
                      {stats.scorePlayer >= stats.scoreEnemy && (
                        <span className="text-[9px] font-mono font-bold bg-sky-400/20 text-sky-300 px-2 py-0.5 rounded border border-sky-400/35">LEADER</span>
                      )}
                    </span>
                    <span className="text-[9px] font-mono text-white/30 uppercase mt-0.5">SANDBOX TEAM ALPHA</span>
                  </div>
                </div>
                <div className="col-span-2 text-center text-xl font-black font-display text-sky-400 drop-shadow-[0_0_4px_rgba(56,189,248,0.3)]">
                  {stats.scorePlayer}
                </div>
                <div className="col-span-2 text-center text-base font-bold font-mono text-white/80">
                  {stats.playerKills ?? 0}
                </div>
                <div className="col-span-2 text-center text-base font-bold font-mono text-white/60">
                  {stats.playerDeaths ?? 0}
                </div>
              </div>

              {/* Red Team Row */}
              <div className={`grid grid-cols-12 items-center px-6 py-4 rounded-xl border transition-all duration-200 ${
                stats.scoreEnemy >= stats.scorePlayer 
                  ? 'bg-red-500/10 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]' 
                  : 'bg-black/20 border-white/5'
              }`}>
                <div className="col-span-6 flex items-center gap-3">
                  <div className="w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white/20 shadow-[0_0_8px_#ef4444]" />
                  <div className="flex flex-col">
                    <span className="text-sm font-black tracking-tight text-white flex items-center gap-2">
                      {stats.isMultiplayer
                        ? (stats.multiplayerRole === 'client' ? `${stats.playerClientId || 'Client'} (You)` : stats.opponentClientId || 'Client')
                        : 'AI Bot'}
                      {stats.scoreEnemy >= stats.scorePlayer && (
                        <span className="text-[9px] font-mono font-bold bg-red-400/20 text-red-300 px-2 py-0.5 rounded border border-red-400/35">LEADER</span>
                      )}
                    </span>
                    <span className="text-[9px] font-mono text-white/30 uppercase mt-0.5">SANDBOX TEAM BETA</span>
                  </div>
                </div>
                <div className="col-span-2 text-center text-xl font-black font-display text-red-400 drop-shadow-[0_0_4px_rgba(239,68,68,0.3)]">
                  {stats.scoreEnemy}
                </div>
                <div className="col-span-2 text-center text-base font-bold font-mono text-white/80">
                  {stats.enemyKills ?? 0}
                </div>
                <div className="col-span-2 text-center text-base font-bold font-mono text-white/60">
                  {stats.enemyDeaths ?? 0}
                </div>
              </div>
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

    </div>
  );
};
