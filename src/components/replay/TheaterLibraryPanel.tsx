import React, { useEffect, useId, useMemo, useState } from 'react';
import { Clock3, Film, Play, Search, X } from 'lucide-react';
import type { ReplayFile } from '../../types';
import { formatReplaySizeMB } from '../../game/theaterDatabase';
import { replayHasHeatmapEvents } from './ReplayHeatmapCanvas';
import { InlineReplayHeatmap } from './InlineReplayHeatmap';
import {
  formatReplayDuration, getSelectedTheaterReplay, getTheaterCollection,
  type TheaterCollection, type TheaterLibraryStatus, type TheaterMapFilter, type TheaterModeFilter,
} from './theaterLibrary';


export type { TheaterMapFilter, TheaterModeFilter } from './theaterLibrary';
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
  active?: boolean;
  libraryStatus?: TheaterLibraryStatus;
  libraryError?: string;
}

function formatReplayDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function mapLabel(replay: ReplayFile): string {
  return String(replay.mapType).replace(/[_-]/g, ' ');
}

export function TheaterLibraryPanel({
  savedReplays, cachedReplays, replaySizes, replayUploadStatus, searchQuery, mapFilter, modeFilter,
  onSearchQueryChange, onMapFilterChange, onModeFilterChange, onEditReplay, onDeleteReplay,
  onContributeReplay, onOpenHeatmapReplay, onSaveCachedReplay, onWatchReplay,
  active = true, libraryStatus = 'ready', libraryError,
}: TheaterLibraryPanelProps) {
  const id = useId();
  const [collection, setCollection] = useState<TheaterCollection>('saved');
  const [selection, setSelection] = useState<Record<TheaterCollection, string | null>>({ saved: null, recent: null });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [stopToken, setStopToken] = useState(0);
  useEffect(() => { if (!active) { setHoveredId(null); setFocusedId(null); } }, [active]);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const replays = useMemo(() => getTheaterCollection({ collection, savedReplays, cachedReplays, searchQuery, mapFilter, modeFilter }),
    [collection, savedReplays, cachedReplays, searchQuery, mapFilter, modeFilter]);
  const replay = libraryStatus === 'ready' ? getSelectedTheaterReplay(replays, selection[collection]) : null;
  const isCached = collection === 'recent';
  const uploadStatus = replay ? replayUploadStatus[replay.id] : undefined;
  const hasFilters = Boolean(searchQuery || mapFilter !== 'all' || modeFilter !== 'all');
  const selectReplay = (selected: ReplayFile) => setSelection((current) => ({ ...current, [collection]: selected.id }));
  const pausePreview = () => setStopToken((token) => token + 1);
  const resetFilters = () => { onSearchQueryChange(''); onMapFilterChange('all'); onModeFilterChange('all'); };
  const selectCollection = (next: TheaterCollection) => { setCollection(next); setHoveredId(null); setFocusedId(null); pausePreview(); };
  const runAction = (action: (selected: ReplayFile) => void, selected: ReplayFile) => { pausePreview(); action(selected); };
  const deleteReplay = async (selected: ReplayFile) => {
    pausePreview();
    if (!window.confirm(isCached ? 'Delete this rolling cache match replay?' : 'Delete this match replay permanent record?')) return;
    try { await onDeleteReplay(selected, isCached); setActionError(null); }
    catch { setActionError({ id: selected.id, message: 'The replay could not be deleted. Please try again.' }); }
  };
  const contributeReplay = async (selected: ReplayFile) => {
    pausePreview();
    try { await onContributeReplay(selected); setActionError(null); }
    catch { setActionError({ id: selected.id, message: 'Contribution failed. Your replay is still saved. Please try again.' }); }
  };

  return (
    <section className="theater-library" aria-label="Theater replay library">
      <header className="theater-heading"><div><h2>Theater</h2><p>Keep the matches worth coming back to.</p></div><span>YOUR REPLAY LIBRARY</span></header>
      <div className="theater-collections" role="tablist" aria-label="Replay collection">
        {(['saved', 'recent'] as const).map((item) => (
          <button key={item} type="button" role="tab" id={`${id}-${item}`} aria-selected={collection === item}
            aria-controls={`${id}-panel`} tabIndex={collection === item ? 0 : -1}
            onClick={() => selectCollection(item)} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'saved' : event.key === 'End' ? 'recent' : collection === 'saved' ? 'recent' : 'saved';
              selectCollection(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}>
            {item === 'saved' ? 'Saved' : 'Recent'}<span>{item === 'saved' ? savedReplays.length : cachedReplays.length}</span>
          </button>
        ))}
      </div>
      <div className="theater-workspace" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${collection}`}>
        <div className="theater-browser">
          {isCached ? <div className="theater-cache-note"><Clock3 size={32} aria-hidden="true" /><div><strong>Your last 5 matches</strong><p>New matches replace the oldest. Save a replay to keep it in your library.</p></div></div> : <div className="theater-filters">
            <label htmlFor={`${id}-search`}>Search saved replays</label>
            <div className="theater-search"><Search size={18} aria-hidden="true" /><input id={`${id}-search`} type="search" value={searchQuery}
              placeholder="Search by name or description" onChange={(event) => onSearchQueryChange(event.target.value)} />
              {searchQuery && <button type="button" aria-label="Clear search" onClick={() => onSearchQueryChange('')}><X size={16} /></button>}
            </div>
            <div className="theater-filter-row">
              <label>Map<select value={mapFilter} onChange={(event) => onMapFilterChange(event.target.value as TheaterMapFilter)}><option value="all">All maps</option><option value="hangar">Hangar</option><option value="circle">Circle</option></select></label>
              <label>Mode<select value={modeFilter} onChange={(event) => onModeFilterChange(event.target.value as TheaterModeFilter)}><option value="all">All modes</option><option value="sandbox">Sandbox</option><option value="tournament">Tournament</option></select></label>
              <button type="button" className="theater-text-button" onClick={resetFilters}>Reset filters</button>
            </div>
          </div>}
          <div className="theater-list-heading"><span>{isCached ? 'RECENT MATCHES' : 'SAVED REPLAYS'}</span><span>{replays.length} {replays.length === 1 ? 'replay' : 'replays'}</span></div>
          <div className="theater-replay-list" aria-label={isCached ? 'Recent matches' : 'Saved replays'} aria-busy={libraryStatus === 'loading'}>
            {libraryStatus !== 'ready' ? <div className="theater-empty" role="status"><Film size={32} aria-hidden="true" /><h3>{libraryStatus === 'loading' ? 'Loading your replays' : 'Your library could not be loaded'}</h3><p>{libraryStatus === 'loading' ? 'Your recorded matches will appear here.' : libraryError || 'Please close Theater and try again. Your saved recordings have not been changed.'}</p></div>
              : replays.length === 0 ? <div className="theater-empty"><Film size={32} aria-hidden="true" /><h3>{isCached ? 'No recent matches yet' : hasFilters ? 'No matching replays' : 'Your replay library starts here'}</h3><p>{isCached ? 'Complete a training match or tournament fight to create your first recording.' : hasFilters ? 'Try a different name, description, map, or mode.' : 'Record a local training match, then save it from Recent to keep it here.'}</p>{!isCached && hasFilters && <button type="button" className="theater-secondary" onClick={resetFilters}>Reset filters</button>}{!isCached && !hasFilters && cachedReplays.length > 0 && <button type="button" className="theater-secondary" onClick={() => selectCollection('recent')}>Browse recent matches</button>}</div>
                : replays.map((item, index) => <button type="button" key={item.id} className="theater-replay-row" aria-pressed={replay?.id === item.id}
                  onClick={() => selectReplay(item)} onPointerEnter={(event) => { if (event.pointerType !== 'touch') { selectReplay(item); setHoveredId(item.id); } }}
                  onPointerLeave={() => setHoveredId(null)} onFocus={() => { selectReplay(item); setFocusedId(item.id); }} onBlur={() => setFocusedId(null)}
                  onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? replays.length - 1 : Math.max(0, Math.min(replays.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
                    const rowContainer = event.currentTarget.parentElement as HTMLElement | null;
                    const buttons = rowContainer?.querySelectorAll<HTMLButtonElement>('.theater-replay-row');
                    buttons?.[next]?.focus();
                  }}>
                  <span className="theater-replay-number">{String(index + 1).padStart(2, '0')}</span><span className="theater-replay-copy"><strong>{item.name || `Match — ${formatReplayDate(item.date)}`}</strong><small>{mapLabel(item)} · {item.mode === 'tournament' ? 'Tournament' : 'Sandbox'}{replayUploadStatus[item.id] === 'uploading' ? ' · Sending' : replayUploadStatus[item.id] === 'done' ? ' · Contributed' : ''}</small></span><span className="theater-replay-end"><b>{formatReplayDuration(item.duration)}</b><small>{formatReplayDate(item.date)}</small></span>
                </button>)}
          </div>
        </div>
        <aside className="theater-detail" aria-label="Selected replay">
          <React.Fragment key={`${collection}:${replay?.id ?? 'none'}`}><InlineReplayHeatmap replay={replay} stopToken={stopToken} libraryStatus={libraryStatus} active={active}
            previewRequested={Boolean(replay && (hoveredId === replay.id || focusedId === replay.id))} /></React.Fragment>
          {replay ? <>
            <div className="theater-detail-heading"><span>{isCached ? 'RECENT MATCH · AUTOMATIC RECORDING' : 'SAVED REPLAY'}</span><h3 title={replay.name}>{replay.name || 'Untitled match'}</h3>{replay.description && <p title={replay.description}>{replay.description}</p>}</div>
            <dl className="theater-facts"><div><dt>Map</dt><dd>{mapLabel(replay)}</dd></div><div><dt>Mode</dt><dd>{replay.mode === 'tournament' ? 'Tournament' : 'Sandbox'}</dd></div><div><dt>Duration / size</dt><dd>{formatReplayDuration(replay.duration)} · {formatReplaySizeMB(replaySizes[replay.id] ?? 0)}</dd></div><div><dt>Pilot</dt><dd>{replay.playerName}</dd></div><div><dt>Opponent</dt><dd>{replay.opponentName}</dd></div><div><dt>Recorded</dt><dd>{formatReplayDate(replay.date)}</dd></div></dl>
            <div className="theater-actions">
              <div className="theater-primary-actions"><button type="button" className="theater-primary" onClick={() => runAction(onWatchReplay, replay)}><Play size={15} aria-hidden="true" />Watch replay</button><button type="button" className="theater-secondary" onClick={() => runAction(isCached ? onSaveCachedReplay : onEditReplay, replay)}>{isCached ? 'Save to library' : 'Edit details'}</button></div>
              <div className="theater-utility-actions"><button type="button" className="theater-text-button" disabled={!replayHasHeatmapEvents(replay)} onClick={() => runAction(onOpenHeatmapReplay, replay)}>Open heatmap</button>{!isCached && <button type="button" className="theater-text-button" disabled={uploadStatus === 'uploading' || uploadStatus === 'done'} onClick={() => void contributeReplay(replay)} title="Send an anonymous, compressed replay to AI training with player names removed">{uploadStatus === 'uploading' ? 'Sending…' : uploadStatus === 'done' ? 'Contributed' : uploadStatus === 'error' ? 'Retry contribution' : 'Contribute'}</button>}<button type="button" className="theater-delete" onClick={() => void deleteReplay(replay)}>Delete</button></div>
              {!isCached && uploadStatus && <p className={`theater-action-status ${uploadStatus === 'error' ? 'is-error' : ''}`} role="status">{uploadStatus === 'uploading' ? 'Sending anonymous replay. You can browse another match.' : uploadStatus === 'done' ? 'Replay contributed to AI training.' : 'Contribution failed. Your replay is still saved.'}</p>}
              {actionError?.id === replay.id && <p className="theater-action-status is-error" role="alert">{actionError.message}</p>}
            </div>
          </> : <p className="theater-detail-empty">Select a recording to watch, manage, or explore its match events.</p>}
        </aside>
      </div>
    </section>
  );
}
