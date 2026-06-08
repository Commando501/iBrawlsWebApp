import React from 'react';
import type { ReplayFile } from '../../types';
import { formatReplaySizeMB } from '../../game/theaterDatabase';
import { ReplayHeatmapCanvas, replayHasHeatmapEvents } from './ReplayHeatmapCanvas';

export type TheaterMapFilter = 'all' | 'hangar' | 'circle';
export type TheaterModeFilter = 'all' | 'sandbox' | 'tournament';
export type ReplayUploadStatus = 'uploading' | 'done' | 'error';

interface TheaterLibraryPanelProps {
  savedReplays: ReplayFile[];
  cachedReplays: ReplayFile[];
  replaySizes: Record<string, number>;
  replayUploadStatus: Record<string, ReplayUploadStatus>;
  searchQuery: string;
  mapFilter: TheaterMapFilter;
  modeFilter: TheaterModeFilter;
  onSearchQueryChange: (value: string) => void;
  onMapFilterChange: (value: TheaterMapFilter) => void;
  onModeFilterChange: (value: TheaterModeFilter) => void;
  onEditReplay: (replay: ReplayFile) => void;
  onDeleteReplay: (replay: ReplayFile, isCached: boolean) => void | Promise<void>;
  onContributeReplay: (replay: ReplayFile) => void | Promise<void>;
  onOpenHeatmapReplay: (replay: ReplayFile) => void;
  onSaveCachedReplay: (replay: ReplayFile) => void;
  onWatchReplay: (replay: ReplayFile) => void;
}

function formatReplayDuration(secondsTotal: number): string {
  const minutes = Math.floor(secondsTotal / 60);
  const seconds = Math.floor(secondsTotal % 60);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function formatReplayDate(date: string): string {
  try {
    return new Date(date).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date;
  }
}

function replayMatchesFilters(
  replay: ReplayFile,
  searchQuery: string,
  mapFilter: TheaterMapFilter,
  modeFilter: TheaterModeFilter
): boolean {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchesMap = mapFilter === 'all' || replay.mapType === mapFilter;
  const matchesMode = modeFilter === 'all' || replay.mode === modeFilter;
  const matchesSearch =
    normalizedQuery.length === 0 ||
    replay.name.toLowerCase().includes(normalizedQuery) ||
    replay.description.toLowerCase().includes(normalizedQuery);

  return matchesMap && matchesMode && matchesSearch;
}

function ReplayHeatmapPreview({ replay }: { replay: ReplayFile }) {
  return (
    <ReplayHeatmapCanvas
      replay={replay}
      mode="preview"
      showControls={false}
      className="h-24 min-h-24"
    />
  );
}

function ReplayMetaGrid({ replay }: { replay: ReplayFile }) {
  return (
    <div className="grid grid-cols-2 gap-1 text-[9px] font-mono text-white/50 border-t border-b border-white/5 py-1.5">
      <div>
        Map: <span className="text-white/80 font-bold uppercase">{replay.mapType}</span>
      </div>
      <div>
        Mode: <span className="text-white/80 font-bold uppercase">{replay.mode}</span>
      </div>
      <div>
        Pilot: <span className="text-white/80 font-bold uppercase">{replay.playerName}</span>
      </div>
      <div>
        Opponent: <span className="text-white/80 font-bold uppercase">{replay.opponentName}</span>
      </div>
    </div>
  );
}

function SavedReplayCard({
  replay,
  replaySize,
  uploadStatus,
  onEditReplay,
  onDeleteReplay,
  onContributeReplay,
  onOpenHeatmapReplay,
  onWatchReplay,
}: {
  replay: ReplayFile;
  replaySize: number;
  uploadStatus?: ReplayUploadStatus;
  onEditReplay: (replay: ReplayFile) => void;
  onDeleteReplay: (replay: ReplayFile, isCached: boolean) => void | Promise<void>;
  onContributeReplay: (replay: ReplayFile) => void | Promise<void>;
  onOpenHeatmapReplay: (replay: ReplayFile) => void;
  onWatchReplay: (replay: ReplayFile) => void;
}) {
  const durationStr = formatReplayDuration(replay.duration);
  const sizeStr = formatReplaySizeMB(replaySize);
  const formattedDate = formatReplayDate(replay.date);
  const canOpenHeatmap = replayHasHeatmapEvents(replay);

  return (
    <div className="bg-slate-950/45 border border-white/5 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-md hover:border-pink-500/30 transition-all shrink-0">
      <div className="flex justify-between items-start gap-2">
        <div className="flex flex-col min-w-0">
          <h4 className="text-xs font-black uppercase text-[#f43f5e] truncate" title={replay.name}>
            {replay.name}
          </h4>
          {replay.description && (
            <p className="text-[10px] text-white/50 italic mt-0.5 line-clamp-2 leading-relaxed" title={replay.description}>
              {replay.description}
            </p>
          )}
        </div>
        <span className="text-[9px] font-mono font-bold text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded shrink-0">
          {durationStr} / {sizeStr}
        </span>
      </div>

      <ReplayMetaGrid replay={replay} />
      <ReplayHeatmapPreview replay={replay} />

      <div className="flex items-center justify-between mt-0.5 gap-2">
        <span className="text-[9px] font-mono text-white/30">{formattedDate}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onEditReplay(replay)}
            className="px-2 h-7 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[9.5px] font-bold text-white/60 hover:text-white uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center"
            title="Edit meta descriptions"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={async () => {
              if (window.confirm('Delete this match replay permanent record?')) {
                await onDeleteReplay(replay, false);
              }
            }}
            className="p-1 bg-red-950/20 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 rounded text-[9.5px] font-bold text-red-400 hover:text-red-300 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center w-7 h-7"
            title="Delete Replay"
          >
            Del
          </button>
          <button
            type="button"
            onClick={() => onContributeReplay(replay)}
            disabled={uploadStatus === 'uploading' || uploadStatus === 'done'}
            className="px-2 h-7 bg-sky-950/30 hover:bg-sky-900/50 border border-sky-500/20 hover:border-sky-500/40 rounded text-[9.5px] font-bold text-sky-300 hover:text-sky-200 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center disabled:opacity-50"
            title="Upload this replay to AI training now (anonymous, names removed, compressed)"
          >
            {uploadStatus === 'uploading'
              ? 'Sending'
              : uploadStatus === 'done'
              ? 'Sent'
              : uploadStatus === 'error'
              ? 'Retry'
              : 'Contribute'}
          </button>
          <button
            type="button"
            onClick={() => onOpenHeatmapReplay(replay)}
            disabled={!canOpenHeatmap}
            className="px-2.5 h-7 bg-cyan-950/30 hover:bg-cyan-900/50 border border-cyan-500/20 hover:border-cyan-500/40 rounded text-[9.5px] font-bold text-cyan-300 hover:text-cyan-200 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            title={canOpenHeatmap ? 'Watch this replay as a 2D heatmap' : 'No heatmap data in this replay'}
          >
            Heatmap
          </button>
          <button
            type="button"
            onClick={() => onWatchReplay(replay)}
            className="px-3 h-7 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-[9.5px] font-black text-white uppercase tracking-widest rounded border border-emerald-500/20 hover:shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all cursor-pointer flex items-center gap-1.5"
          >
            Watch
          </button>
        </div>
      </div>
    </div>
  );
}

function CachedReplayCard({
  replay,
  replaySize,
  onDeleteReplay,
  onOpenHeatmapReplay,
  onSaveCachedReplay,
  onWatchReplay,
}: {
  replay: ReplayFile;
  replaySize: number;
  onDeleteReplay: (replay: ReplayFile, isCached: boolean) => void | Promise<void>;
  onOpenHeatmapReplay: (replay: ReplayFile) => void;
  onSaveCachedReplay: (replay: ReplayFile) => void;
  onWatchReplay: (replay: ReplayFile) => void;
}) {
  const durationStr = formatReplayDuration(replay.duration);
  const sizeStr = formatReplaySizeMB(replaySize);
  const formattedDate = formatReplayDate(replay.date);
  const canOpenHeatmap = replayHasHeatmapEvents(replay);

  return (
    <div className="bg-slate-950/45 border border-white/5 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-md border-l-4 border-l-[#f59e0b] hover:border-l-yellow-400 transition-all shrink-0">
      <div className="flex justify-between items-start gap-2">
        <div className="flex flex-col min-w-0 text-left">
          <h4 className="text-xs font-black uppercase text-[#eab308] truncate">
            {replay.name || `Rolling Cache Match - ${formattedDate}`}
          </h4>
          <span className="text-[9px] text-white/40 italic mt-0.5">
            [Auto-saved from local match]
          </span>
        </div>
        <span className="text-[9px] font-mono font-bold text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded shrink-0">
          {durationStr} / {sizeStr}
        </span>
      </div>

      <ReplayMetaGrid replay={replay} />
      <ReplayHeatmapPreview replay={replay} />

      <div className="flex items-center justify-between mt-0.5 gap-2">
        <span className="text-[9px] font-mono text-white/30">{formattedDate}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={async () => {
              if (window.confirm('Delete this rolling cache match replay?')) {
                await onDeleteReplay(replay, true);
              }
            }}
            className="p-1 bg-red-950/20 hover:bg-red-900/40 border border-red-500/20 hover:border-red-500/40 rounded text-[9.5px] font-bold text-red-400 hover:text-red-300 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center w-7 h-7 whitespace-nowrap"
            title="Delete from cache"
            aria-label="Delete from cache"
          >
            Del
          </button>
          <button
            type="button"
            onClick={() => onSaveCachedReplay(replay)}
            className="px-2.5 h-7 bg-white/5 hover:bg-white/10 border border-white/10 text-[9.5px] font-bold text-white/80 hover:text-white uppercase tracking-wider rounded transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap"
            title="Save permanently to Archives"
          >
            Save Permanent
          </button>
          <button
            type="button"
            onClick={() => onOpenHeatmapReplay(replay)}
            disabled={!canOpenHeatmap}
            className="px-2.5 h-7 bg-cyan-950/30 hover:bg-cyan-900/50 border border-cyan-500/20 hover:border-cyan-500/40 rounded text-[9.5px] font-bold text-cyan-300 hover:text-cyan-200 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            title={canOpenHeatmap ? 'Watch this replay as a 2D heatmap' : 'No heatmap data in this replay'}
          >
            Heatmap
          </button>
          <button
            type="button"
            onClick={() => onWatchReplay(replay)}
            className="px-3 h-7 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-[9.5px] font-black text-white uppercase tracking-widest rounded border border-amber-500/20 hover:shadow-[0_0_10px_rgba(245,158,11,0.3)] transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
          >
            Watch
          </button>
        </div>
      </div>
    </div>
  );
}

export function TheaterLibraryPanel({
  savedReplays,
  cachedReplays,
  replaySizes,
  replayUploadStatus,
  searchQuery,
  mapFilter,
  modeFilter,
  onSearchQueryChange,
  onMapFilterChange,
  onModeFilterChange,
  onEditReplay,
  onDeleteReplay,
  onContributeReplay,
  onOpenHeatmapReplay,
  onSaveCachedReplay,
  onWatchReplay,
}: TheaterLibraryPanelProps) {
  const filteredSavedReplays = savedReplays.filter((replay) =>
    replayMatchesFilters(replay, searchQuery, mapFilter, modeFilter)
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-2 gap-4 text-left">
      <div className="flex flex-col h-full min-h-0 gap-4">
        <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-3 shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.30)]">
          <span className="text-[10px] font-mono font-bold tracking-[0.4em] uppercase text-[#e11d48]">THEATER MODE</span>
          <h2 className="text-xl font-display font-black italic uppercase tracking-tight" style={{ background: 'linear-gradient(90deg,#e11d48,#fff,#f43f5e)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', lineHeight: 1 }}>
            Saved Replays
          </h2>
          <p className="text-[11.5px] text-white/60 leading-normal">
            Select a recorded match replay to watch with full fly-camera controls, perspective changes, and timeline seeking.
          </p>
        </div>

        <div className="bg-slate-950/35 border border-white/5 rounded-xl p-3 flex flex-col gap-2 shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search saved replays..."
              className="w-full h-9 bg-black/60 border border-white/10 rounded px-3 text-xs tracking-wide text-[#e11d48] placeholder:text-white/20 focus:border-[#e11d48] outline-none transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange('')}
                className="absolute right-3.5 top-2 text-[10px] font-bold text-white/40 hover:text-white"
              >
                x
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[8px] font-mono text-white/40 uppercase tracking-widest">Map Filter</span>
              <select
                value={mapFilter}
                onChange={(event) => onMapFilterChange(event.target.value as TheaterMapFilter)}
                className="h-8 bg-black/60 border border-white/10 rounded px-2 text-[10.5px] text-white/70 outline-none focus:border-[#e11d48] cursor-pointer"
              >
                <option value="all">All Maps</option>
                <option value="hangar">Hangar</option>
                <option value="circle">Circle</option>
              </select>
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[8px] font-mono text-white/40 uppercase tracking-widest">Mode Filter</span>
              <select
                value={modeFilter}
                onChange={(event) => onModeFilterChange(event.target.value as TheaterModeFilter)}
                className="h-8 bg-black/60 border border-white/10 rounded px-2 text-[10.5px] text-white/70 outline-none focus:border-[#e11d48] cursor-pointer"
              >
                <option value="all">All Modes</option>
                <option value="sandbox">Sandbox</option>
                <option value="tournament">Tourney</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2.5 pr-1">
          {filteredSavedReplays.length === 0 ? (
            <div className="bg-black/30 border border-white/5 rounded-lg p-5 text-center my-auto">
              <p className="text-xs text-white/40 italic font-medium">No saved replays found.</p>
              <p className="text-[10px] text-white/30 mt-1 leading-normal">
                Record a local training match, then save it from the rolling cache panel.
              </p>
            </div>
          ) : (
            filteredSavedReplays.map((replay) => (
              <React.Fragment key={replay.id}>
                <SavedReplayCard
                  replay={replay}
                  replaySize={replaySizes[replay.id] ?? 0}
                  uploadStatus={replayUploadStatus[replay.id]}
                  onEditReplay={onEditReplay}
                  onDeleteReplay={onDeleteReplay}
                  onContributeReplay={onContributeReplay}
                  onOpenHeatmapReplay={onOpenHeatmapReplay}
                  onWatchReplay={onWatchReplay}
                />
              </React.Fragment>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col h-full min-h-0 gap-4 text-left">
        <div className="bg-slate-950/45 border border-white/10 rounded-xl p-4.5 flex flex-col gap-3 shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.30)]">
          <span className="text-[10px] font-mono font-bold tracking-[0.4em] uppercase text-[#f59e0b]">AUTO-SAVE CACHE</span>
          <h2 className="text-xl font-display font-black italic uppercase tracking-tight" style={{ background: 'linear-gradient(90deg,#f59e0b,#fff,#eab308)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', lineHeight: 1 }}>
            Rolling Match Cache
          </h2>
          <p className="text-[11.5px] text-white/60 leading-normal">
            Keeps a rolling buffer of your last 5 matches. These are overwritten sequentially as new matches finish. Transfer them to Saved Replays to store them permanently.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2.5 pr-1">
          {cachedReplays.length === 0 ? (
            <div className="bg-black/30 border border-white/5 rounded-lg p-5 text-center my-auto">
              <p className="text-xs text-white/40 italic font-medium">Rolling cache is currently empty.</p>
              <p className="text-[10px] text-white/30 mt-1 leading-normal">
                Complete a training match or tournament fight to see your replay automatically cached here.
              </p>
            </div>
          ) : (
            cachedReplays.map((replay) => (
              <React.Fragment key={replay.id}>
                <CachedReplayCard
                  replay={replay}
                  replaySize={replaySizes[replay.id] ?? 0}
                  onDeleteReplay={onDeleteReplay}
                  onOpenHeatmapReplay={onOpenHeatmapReplay}
                  onSaveCachedReplay={onSaveCachedReplay}
                  onWatchReplay={onWatchReplay}
                />
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
