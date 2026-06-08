import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { ReplayFile } from '../../types';
import { ReplayHeatmapCanvas } from './ReplayHeatmapCanvas';

interface ReplayHeatmapPanelSize {
  width: number;
  height: number;
}

interface ReplayHeatmapPanelProps {
  replay: ReplayFile;
  elapsedTime: number;
  collapsed: boolean;
  size: ReplayHeatmapPanelSize;
  onToggleCollapsed: () => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function ReplayHeatmapPanel({
  replay,
  elapsedTime,
  collapsed,
  size,
  onToggleCollapsed,
  onResizePointerDown,
}: ReplayHeatmapPanelProps) {
  const panelStyle: CSSProperties = {
    width: collapsed
      ? 'min(250px, calc(100vw - 1rem))'
      : `min(${size.width}px, calc(100vw - 1rem))`,
    height: collapsed
      ? 46
      : `min(${size.height}px, calc(100dvh - 9rem))`,
  };
  const canvasStyle: CSSProperties = { height: 'calc(100% - 44px)' };

  return (
    <div
      className="fixed top-3 right-3 z-[1001] pointer-events-auto rounded-xl border border-cyan-500/25 bg-slate-950/90 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl overflow-hidden"
      style={panelStyle}
    >
      <div className="h-11 px-3 flex items-center justify-between gap-2 border-b border-white/10 bg-black/35">
        <div className="min-w-0">
          <p className="text-[9px] font-mono font-black uppercase tracking-[0.22em] text-cyan-300">
            Replay Heatmap
          </p>
          <p className="text-[9px] font-mono text-white/45 truncate">
            {Math.round(elapsedTime)}s / {Math.round(replay.duration ?? 0)}s
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          title={collapsed ? 'Expand heatmap' : 'Collapse heatmap'}
          aria-label={collapsed ? 'Expand heatmap' : 'Collapse heatmap'}
        >
          {collapsed ? '+' : '-'}
        </button>
      </div>
      {!collapsed && (
        <>
          <ReplayHeatmapCanvas
            replay={replay}
            time={elapsedTime}
            mode="panel"
            className="border-0 rounded-none"
            style={canvasStyle}
          />
          <button
            type="button"
            onPointerDown={onResizePointerDown}
            className="hidden md:flex absolute bottom-1.5 right-1.5 h-5 w-5 items-end justify-end rounded border border-white/15 bg-black/60 text-white/50 hover:text-white hover:border-cyan-300/50 cursor-nwse-resize"
            title="Resize heatmap"
            aria-label="Resize heatmap"
          >
            <span className="block h-2.5 w-2.5 border-b-2 border-r-2 border-current" />
          </button>
        </>
      )}
    </div>
  );
}
