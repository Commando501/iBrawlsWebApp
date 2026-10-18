import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Radar } from 'lucide-react';
import type { ReplayFile } from '../../types';
import { ReplayHeatmapCanvas, replayHasHeatmapEvents } from './ReplayHeatmapCanvas';
import { formatReplayDuration, getHeatmapPreviewFrame, type TheaterLibraryStatus } from './theaterLibrary';

class HeatmapBoundary extends React.Component<{ children: React.ReactNode; onError: () => void }, { failed: boolean }> {
  declare props: { children: React.ReactNode; onError: () => void };
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

interface InlineReplayHeatmapProps {
  replay: ReplayFile | null;
  active?: boolean;
  previewRequested?: boolean;
  stopToken?: number;
  libraryStatus?: TheaterLibraryStatus;
}

/** One real map renderer for the selected replay, with no prerecorded or unrelated footage. */
export function InlineReplayHeatmap({ replay, active = true, previewRequested = false, stopToken = 0, libraryStatus = 'ready' }: InlineReplayHeatmapProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [manualMode, setManualMode] = useState<'auto' | 'playing' | 'paused'>('auto');
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [failed, setFailed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const previousStopToken = useRef(stopToken);
  const hasEvents = replayHasHeatmapEvents(replay);
  const autoRequested = hovered || focused || previewRequested;
  const playing = active && hasEvents && !failed && visible && libraryStatus === 'ready'
    && (manualMode === 'playing' || (manualMode === 'auto' && autoRequested && !reducedMotion));
  useEffect(() => { if (!active) { setHovered(false); setFocused(false); setManualMode('auto'); } }, [active]);
  const frame = getHeatmapPreviewFrame(replay, playing ? elapsed : null);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { setReducedMotion(preference.matches); setManualMode('auto'); };
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const update = () => {
      setVisible(!document.hidden);
      if (document.hidden) setManualMode('paused');
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => { if (!autoRequested) setManualMode((mode) => mode === 'paused' ? 'auto' : mode); }, [autoRequested]);
  useEffect(() => { if (previousStopToken.current !== stopToken) { previousStopToken.current = stopToken; setManualMode('paused'); } }, [stopToken]);
  useEffect(() => {
    if (!playing) { setElapsed(0); return; }
    let animation = 0;
    const start = performance.now();
    let lastUpdate = -100;
    const tick = (now: number) => {
      // Heatmap events do not need a full React render at the display's frame rate.
      if (now - lastUpdate >= 100) { setElapsed(now - start); lastUpdate = now; }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing]);

  const unavailableTitle = libraryStatus === 'loading' ? 'Loading replay heatmap'
    : libraryStatus === 'error' ? 'Replay library unavailable'
    : failed ? 'Heatmap preview unavailable'
    : !replay ? 'Select a replay to see its heatmap' : 'No heatmap events in this recording';
  const unavailableCopy = libraryStatus === 'loading' ? 'Your recorded matches are being loaded.'
    : libraryStatus === 'error' ? 'Your saved recordings have not been changed.'
    : failed ? 'You can still watch the replay or open its full heatmap.'
    : !replay ? 'Kills, deaths, and medals appear here for the selected match.'
    : 'This replay can still be watched with the regular replay controls.';

  return (
    <figure className="theater-heatmap" aria-label="Selected match heatmap" data-playing={playing}>
      <figcaption className="theater-heatmap-title"><strong>MATCH HEATMAP</strong><span>{playing ? 'TIMELINE PREVIEW' : 'FULL MATCH'}</span></figcaption>
      <div className="theater-heatmap-surface" tabIndex={hasEvents ? 0 : undefined}
        aria-label={hasEvents ? 'Heatmap preview. Hover or focus to play the recorded event timeline.' : unavailableTitle}
        onPointerEnter={(event) => { if (event.pointerType !== 'touch') setHovered(true); }}
        onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
        {active && replay && hasEvents && libraryStatus === 'ready' && !failed ? (
          <HeatmapBoundary onError={() => setFailed(true)}>
            <ReplayHeatmapCanvas replay={replay} time={frame.time} mode="preview" showControls={false} className="theater-heatmap-canvas" />
            <div className="theater-heatmap-legend" aria-hidden="true"><span>Kills</span><span>Deaths</span><span>Medals</span></div>
            <span className="theater-heatmap-counter">{frame.eventCount} / {replay.heatmap!.events.length} events</span>
          </HeatmapBoundary>
        ) : <div className="theater-heatmap-unavailable"><Radar size={30} aria-hidden="true" /><strong>{unavailableTitle}</strong><p>{unavailableCopy}</p></div>}
      </div>
      <div className="theater-heatmap-progress" aria-hidden="true"><span style={{ width: `${frame.progress * 100}%` }} /></div>
      <div className="theater-heatmap-playbar">
        <span>{playing ? `${formatReplayDuration(frame.time ?? 0)} / ${formatReplayDuration(frame.duration)}` : reducedMotion ? 'Motion reduced · Play when ready' : hasEvents ? 'Hover or focus to preview' : 'Full match heatmap'}</span>
        <button type="button" disabled={!hasEvents || failed || libraryStatus !== 'ready'}
          aria-label={playing ? 'Pause heatmap preview' : 'Play heatmap preview'}
          onClick={() => setManualMode(playing ? 'paused' : 'playing')}>
          {playing ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}{playing ? 'Pause' : 'Play'} preview
        </button>
      </div>
    </figure>
  );
}
