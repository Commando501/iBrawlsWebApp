import type { PointerEvent, Ref } from 'react';
import { Check, Move, RotateCcw } from 'lucide-react';

interface UiAdjustmentToolbarPosition {
  x: number;
  y: number;
}

interface UiAdjustmentToolbarProps {
  position: UiAdjustmentToolbarPosition;
  toolbarRef: Ref<HTMLDivElement>;
  onDragStart: (event: PointerEvent<HTMLDivElement>) => void;
  onReset: () => void;
  onSave: () => void;
}

export function UiAdjustmentToolbar({
  position,
  toolbarRef,
  onDragStart,
  onReset,
  onSave,
}: UiAdjustmentToolbarProps) {
  return (
    <div
      ref={toolbarRef}
      id="ui-adjustment-toolbar"
      className="mobile-ui-adjust-toolbar absolute z-50 bg-slate-950/90 border border-cyan-500/50 backdrop-blur-md rounded-xl p-4 shadow-2xl flex items-center gap-6 pointer-events-auto max-w-[90vw] select-none"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, 0)',
        touchAction: 'none',
      }}
    >
      <div
        id="ui-adjustment-drag-handle"
        className="flex items-start gap-3 cursor-move"
        onPointerDown={onDragStart}
        title="Move HUD Canvas Adjuster"
      >
        <Move className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
        <div className="flex flex-col">
          <h4 className="text-xs font-sans font-black tracking-widest text-cyan-400 uppercase">HUD Canvas Adjuster</h4>
          <p className="text-[10px] text-white/55 font-medium">Click UNLOCKED on an element to drag it. Click LOCK/UNLOCK to toggle attributes.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          id="ui-adjustment-reset"
          onClick={onReset}
          className="px-3 py-1.5 bg-slate-900 border border-slate-700 hover:border-slate-600 text-[10px] font-mono font-bold tracking-widest uppercase transition-all duration-150 rounded cursor-pointer flex items-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
          Reset
        </button>

        <button
          id="ui-adjustment-save"
          onClick={onSave}
          className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border border-cyan-400/30 text-[10px] font-sans font-extrabold tracking-widest uppercase text-white transition-all duration-150 rounded shadow-[0_0_15px_rgba(6,182,212,0.3)] cursor-pointer flex items-center gap-1.5"
        >
          <Check className="w-3.5 h-3.5" />
          Save & Exit
        </button>
      </div>
    </div>
  );
}
