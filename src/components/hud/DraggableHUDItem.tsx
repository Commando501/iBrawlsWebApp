import React from 'react';
import { Lock, Minus, Plus, RotateCcw, Unlock } from 'lucide-react';
import {
  UiElementPos,
  UI_ELEMENT_SCALE_MAX,
  UI_ELEMENT_SCALE_MIN,
  UI_ELEMENT_SCALE_STEP,
} from '../../types';

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

export const clampUiScale = (scale: number) => (
  Math.round(Math.max(UI_ELEMENT_SCALE_MIN, Math.min(UI_ELEMENT_SCALE_MAX, scale)) * 100) / 100
);

const getTransformStyle = (id: string, scale: number, isMobileLayout: boolean) => {
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
    case 'medalPopup':
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

const getTransformOrigin = (id: string, isMobileLayout: boolean) => {
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
    case 'medalPopup':
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

  const scale = clampUiScale(uiItem.scale ?? 1);
  const scaleControlsPlacementClass = isMobileLayout && uiItem.y > 64
    ? 'bottom-full mb-1 left-0'
    : '-bottom-8 left-0';
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${uiItem.x}%`,
    top: `${uiItem.y}%`,
    transform: getTransformStyle(id, scale, isMobileLayout),
    transformOrigin: getTransformOrigin(id, isMobileLayout),
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
        <div className={`absolute ${scaleControlsPlacementClass} h-7 flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950/90 px-1.5 text-[9px] font-mono font-bold text-slate-200 shadow-md z-50 pointer-events-auto`}>
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

      {!uiItem.locked && (
        <div className="absolute inset-0 z-30 bg-cyan-500/5 cursor-move rounded-xl pointer-events-none" />
      )}

      {children}
    </div>
  );
};
