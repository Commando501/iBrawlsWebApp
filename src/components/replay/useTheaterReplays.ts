import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import type { ReplayFile } from '../../types';
import {
  deleteReplay,
  getCachedReplays,
  getReplayStorageSizeBytes,
  getSavedReplays,
  saveCachedReplay,
  updateReplayMeta,
} from '../../game/theaterDatabase';
import { contributeReplay } from '../../services/replayUpload';
import type { ReplayUploadStatus, TheaterMapFilter, TheaterModeFilter } from './TheaterLibraryPanel';

interface ReplayHeatmapPanelSize {
  width: number;
  height: number;
}

interface UseTheaterReplaysOptions {
  isTheaterTabActive: boolean;
  onWatchReplay: (replay: ReplayFile) => void;
}

const clampNumber = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

export const useTheaterReplays = ({
  isTheaterTabActive,
  onWatchReplay,
}: UseTheaterReplaysOptions) => {
  const [selectedReplay, setSelectedReplay] = useState<ReplayFile | null>(null);
  const [savedReplays, setSavedReplays] = useState<ReplayFile[]>([]);
  const [cachedReplays, setCachedReplays] = useState<ReplayFile[]>([]);
  const [replaySizes, setReplaySizes] = useState<Record<string, number>>({});
  const [replayUploadStatus, setReplayUploadStatus] = useState<Record<string, ReplayUploadStatus>>({});
  const [heatmapOnlyReplay, setHeatmapOnlyReplay] = useState<ReplayFile | null>(null);
  const [heatmapOnlyTime, setHeatmapOnlyTime] = useState<number>(0);
  const [heatmapOnlyPlaying, setHeatmapOnlyPlaying] = useState<boolean>(false);
  const [replayHeatmapPanelCollapsed, setReplayHeatmapPanelCollapsed] = useState<boolean>(false);
  const [replayHeatmapPanelSize, setReplayHeatmapPanelSize] = useState<ReplayHeatmapPanelSize>({
    width: 360,
    height: 280,
  });

  const [theaterSearchQuery, setTheaterSearchQuery] = useState<string>('');
  const [theaterMapFilter, setTheaterMapFilter] = useState<TheaterMapFilter>('all');
  const [theaterModeFilter, setTheaterModeFilter] = useState<TheaterModeFilter>('all');

  const [editReplayId, setEditReplayId] = useState<string | null>(null);
  const [editReplayName, setEditReplayName] = useState<string>('');
  const [editReplayDesc, setEditReplayDesc] = useState<string>('');
  const [showEditModal, setShowEditModal] = useState<boolean>(false);

  const [saveCachedId, setSaveCachedId] = useState<string | null>(null);
  const [saveCachedName, setSaveCachedName] = useState<string>('');
  const [saveCachedDesc, setSaveCachedDesc] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);

  const loadTheaterReplays = useCallback(async () => {
    try {
      const saved = await getSavedReplays();
      const cached = await getCachedReplays();
      setSavedReplays(saved);
      setCachedReplays(cached);
      const sizes: Record<string, number> = {};
      for (const replay of [...saved, ...cached]) {
        sizes[replay.id] = getReplayStorageSizeBytes(replay);
      }
      setReplaySizes(sizes);
    } catch (err) {
      console.error('Failed to load theater replays from IndexedDB:', err);
    }
  }, []);

  useEffect(() => {
    if (isTheaterTabActive) {
      loadTheaterReplays();
    }
  }, [isTheaterTabActive, loadTheaterReplays]);

  useEffect(() => {
    if (selectedReplay) {
      setReplayHeatmapPanelCollapsed(false);
    }
  }, [selectedReplay?.id]);

  useEffect(() => {
    if (!heatmapOnlyReplay || !heatmapOnlyPlaying) return;
    let frameId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;
      setHeatmapOnlyTime((current) => {
        const next = Math.min(heatmapOnlyReplay.duration ?? 0, current + dt);
        if (next >= (heatmapOnlyReplay.duration ?? 0)) {
          setHeatmapOnlyPlaying(false);
        }
        return next;
      });
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [heatmapOnlyReplay, heatmapOnlyPlaying]);

  const handleOpenHeatmapReplay = useCallback((replay: ReplayFile) => {
    setHeatmapOnlyReplay(replay);
    setHeatmapOnlyTime(0);
    setHeatmapOnlyPlaying(true);
  }, []);

  const handleWatchReplay = useCallback((replay: ReplayFile) => {
    setSelectedReplay(replay);
    onWatchReplay(replay);
  }, [onWatchReplay]);

  const handleEditReplay = useCallback((replay: ReplayFile) => {
    setEditReplayId(replay.id);
    setEditReplayName(replay.name);
    setEditReplayDesc(replay.description);
    setShowEditModal(true);
  }, []);

  const handleSaveCachedReplay = useCallback((replay: ReplayFile) => {
    setSaveCachedId(replay.id);
    setSaveCachedName(`${replay.playerName} vs ${replay.opponentName}`);
    setSaveCachedDesc(`Saved match on ${replay.mapType} map in ${replay.mode} mode.`);
    setShowSaveModal(true);
  }, []);

  const handleDeleteTheaterReplay = useCallback(async (replay: ReplayFile, isCached: boolean) => {
    await deleteReplay(replay.id, isCached);
    await loadTheaterReplays();
  }, [loadTheaterReplays]);

  const handleContributeReplay = useCallback(async (replay: ReplayFile) => {
    setReplayUploadStatus((status) => ({ ...status, [replay.id]: 'uploading' }));
    const result = await contributeReplay(replay);
    setReplayUploadStatus((status) => ({ ...status, [replay.id]: result.ok ? 'done' : 'error' }));
  }, []);

  const handleReplayHeatmapResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = replayHeatmapPanelSize;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setReplayHeatmapPanelSize({
        width: clampNumber(startSize.width + moveEvent.clientX - startX, 280, 680),
        height: clampNumber(startSize.height + moveEvent.clientY - startY, 210, 560),
      });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [replayHeatmapPanelSize]);

  const handleToggleReplayHeatmapPanelCollapsed = useCallback(() => {
    setReplayHeatmapPanelCollapsed((value) => !value);
  }, []);

  const handleCloseHeatmapOnlyReplay = useCallback(() => {
    setHeatmapOnlyPlaying(false);
    setHeatmapOnlyReplay(null);
  }, []);

  const handleSeekHeatmapOnlyReplay = useCallback((deltaSeconds: number) => {
    setHeatmapOnlyTime((time) => Math.min(
      heatmapOnlyReplay?.duration ?? 0,
      Math.max(0, time + deltaSeconds)
    ));
  }, [heatmapOnlyReplay?.duration]);

  const handleToggleHeatmapOnlyPlaying = useCallback(() => {
    setHeatmapOnlyPlaying((value) => !value);
  }, []);

  const handleCloseEditReplayModal = useCallback(() => {
    setShowEditModal(false);
  }, []);

  const handleUpdateReplayMeta = useCallback(async () => {
    if (!editReplayId || !editReplayName.trim()) return;
    await updateReplayMeta(editReplayId, editReplayName.trim(), editReplayDesc.trim());
    setShowEditModal(false);
    await loadTheaterReplays();
  }, [editReplayDesc, editReplayId, editReplayName, loadTheaterReplays]);

  const handleCloseSaveCachedModal = useCallback(() => {
    setShowSaveModal(false);
  }, []);

  const handleCommitCachedReplay = useCallback(async () => {
    if (!saveCachedId || !saveCachedName.trim()) return;
    await saveCachedReplay(saveCachedId, saveCachedName.trim(), saveCachedDesc.trim());
    setShowSaveModal(false);
    await loadTheaterReplays();
  }, [loadTheaterReplays, saveCachedDesc, saveCachedId, saveCachedName]);

  return {
    selectedReplay,
    setSelectedReplay: setSelectedReplay as Dispatch<SetStateAction<ReplayFile | null>>,
    savedReplays,
    cachedReplays,
    replaySizes,
    replayUploadStatus,
    heatmapOnlyReplay,
    heatmapOnlyTime,
    heatmapOnlyPlaying,
    replayHeatmapPanelCollapsed,
    replayHeatmapPanelSize,
    theaterSearchQuery,
    theaterMapFilter,
    theaterModeFilter,
    setTheaterSearchQuery,
    setTheaterMapFilter,
    setTheaterModeFilter,
    editReplayName,
    editReplayDesc,
    showEditModal,
    setEditReplayName,
    setEditReplayDesc,
    saveCachedName,
    saveCachedDesc,
    showSaveModal,
    setSaveCachedName,
    setSaveCachedDesc,
    setHeatmapOnlyTime,
    handleOpenHeatmapReplay,
    handleWatchReplay,
    handleEditReplay,
    handleSaveCachedReplay,
    handleDeleteTheaterReplay,
    handleContributeReplay,
    handleReplayHeatmapResizePointerDown,
    handleToggleReplayHeatmapPanelCollapsed,
    handleCloseHeatmapOnlyReplay,
    handleSeekHeatmapOnlyReplay,
    handleToggleHeatmapOnlyPlaying,
    handleCloseEditReplayModal,
    handleUpdateReplayMeta,
    handleCloseSaveCachedModal,
    handleCommitCachedReplay,
  };
};
