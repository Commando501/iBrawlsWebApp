import type { ReplayFile } from '../../types';
import { ReplayHeatmapCanvas } from './ReplayHeatmapCanvas';

interface ReplayHeatmapTheaterOverlayProps {
  replay: ReplayFile;
  time: number;
  isPlaying: boolean;
  onExit: () => void;
  onTimeChange: (time: number) => void;
  onSeekBy: (deltaSeconds: number) => void;
  onTogglePlaying: () => void;
}

const formatReplayTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, seconds);
  return `${Math.floor(safeSeconds / 60)}:${String(Math.floor(safeSeconds % 60)).padStart(2, '0')}`;
};

export function ReplayHeatmapTheaterOverlay({
  replay,
  time,
  isPlaying,
  onExit,
  onTimeChange,
  onSeekBy,
  onTogglePlaying,
}: ReplayHeatmapTheaterOverlayProps) {
  const duration = replay.duration ?? 0;

  return (
    <div className="fixed inset-0 z-[1300] flex flex-col bg-slate-950 text-white p-3 sm:p-5 pointer-events-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] font-mono font-black uppercase tracking-[0.28em] text-cyan-300">
            Theater Heatmap
          </p>
          <h2 className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white truncate">
            {replay.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="h-10 px-4 rounded-lg border border-red-500/30 bg-red-950/25 text-red-300 hover:bg-red-950/45 font-black text-xs uppercase tracking-widest"
        >
          Exit
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <ReplayHeatmapCanvas
          replay={replay}
          time={time}
          mode="theater"
          className="h-full min-h-0"
        />
      </div>

      <div className="mt-3 rounded-xl border border-cyan-500/20 bg-black/45 p-3 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="w-12 text-left text-[10px] font-mono font-black text-cyan-300">
            {formatReplayTime(time)}
          </span>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={time}
            onChange={(event) => onTimeChange(parseFloat(event.target.value))}
            className="flex-1 accent-cyan-400"
          />
          <span className="w-12 text-right text-[10px] font-mono font-black text-white/45">
            {formatReplayTime(duration)}
          </span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => onSeekBy(-5)}
            className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
            title="Rewind 5 seconds"
          >
            &lt;
          </button>
          <button
            type="button"
            onClick={onTogglePlaying}
            className="h-10 px-5 rounded-lg bg-cyan-400 text-slate-950 font-black text-xs uppercase tracking-widest"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => onSeekBy(5)}
            className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
            title="Forward 5 seconds"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  );
}
