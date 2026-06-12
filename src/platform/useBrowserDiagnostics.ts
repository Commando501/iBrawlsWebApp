import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceInfo } from '../types';
import type { HardwareHelpTab } from '../components/BrowserWarningModals';
import {
  checkGraphicsAcceleration,
  detectDeviceOS,
  detectMicrosoftEdge,
  type GraphicsCheckResult,
} from './browserCapabilities';
import type { V3QualityTier } from '../components/v3/v3ModelTypes';
import {
  selectV3QualityTier,
  type V3QualitySignals,
} from '../components/v3/v3QualityTiers';

export const EDGE_LOW_FPS_THRESHOLD = 20;
export const EDGE_LOW_FPS_SUSTAINED_MS = 5000;

const EDGE_LOW_FPS_STATE_UPDATE_STEP_MS = 500;

interface UseBrowserDiagnosticsOptions {
  isPlaying: boolean;
  isPaused: boolean;
  forceMobileControls?: boolean;
}

const getHardwareConcurrency = (): number | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency;

const getDeviceMemoryGb = (): number | undefined => {
  const nav = typeof navigator === 'undefined'
    ? undefined
    : navigator as Navigator & { deviceMemory?: number };
  return typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined;
};

const buildV3QualitySignals = (
  device: DeviceInfo,
  check: GraphicsCheckResult,
  forceMobileControls?: boolean,
  fps?: number,
  previousTier?: V3QualityTier
): V3QualitySignals => ({
  isMobile: device.isMobile,
  forceMobileControls,
  graphicsAccelerated: check.checked ? check.accelerated : true,
  hardwareConcurrency: getHardwareConcurrency(),
  deviceMemoryGb: getDeviceMemoryGb(),
  fps,
  previousTier,
});

export function useBrowserDiagnostics({
  isPlaying,
  isPaused,
  forceMobileControls,
}: UseBrowserDiagnosticsOptions) {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => detectDeviceOS());
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [isEdgeBrowser] = useState<boolean>(() => detectMicrosoftEdge());
  const [graphicsCheck, setGraphicsCheck] = useState<GraphicsCheckResult>({
    checked: false,
    supported: true,
    accelerated: true,
  });
  const [v3QualityTier, setV3QualityTier] = useState<V3QualityTier>(() =>
    selectV3QualityTier(buildV3QualitySignals(detectDeviceOS(), graphicsCheck, forceMobileControls))
  );
  const [showGraphicsWarning, setShowGraphicsWarning] = useState<boolean>(false);
  const [edgeLowFpsSampleDurationMs, setEdgeLowFpsSampleDurationMs] = useState<number>(0);
  const [showEdgePerformanceWarning, setShowEdgePerformanceWarning] = useState<boolean>(false);
  const [edgePerformanceWarningDismissed, setEdgePerformanceWarningDismissed] = useState<boolean>(false);
  const [hardwareTab, setHardwareTab] = useState<HardwareHelpTab>('chrome');
  const edgeLowFpsSampleRef = useRef<{ lastSampleTime: number; durationMs: number }>({
    lastSampleTime: 0,
    durationMs: 0,
  });
  const edgeLowFpsStateUpdateRef = useRef<number>(0);

  useEffect(() => {
    const refreshDeviceInfo = () => setDeviceInfo(detectDeviceOS());
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('resize', refreshDeviceInfo);
    window.addEventListener('orientationchange', refreshDeviceInfo);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const checkResult = checkGraphicsAcceleration();
    setGraphicsCheck(checkResult);
    if (!checkResult.accelerated) {
      setShowGraphicsWarning(true);
    }

    return () => {
      window.removeEventListener('resize', refreshDeviceInfo);
      window.removeEventListener('orientationchange', refreshDeviceInfo);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    setV3QualityTier((previous) => {
      const next = selectV3QualityTier(buildV3QualitySignals(
        deviceInfo,
        graphicsCheck,
        forceMobileControls,
        undefined,
        previous
      ));
      return next === previous ? previous : next;
    });
  }, [deviceInfo, graphicsCheck, forceMobileControls]);

  const resetEdgeLowFpsDetection = useCallback(() => {
    edgeLowFpsSampleRef.current = { lastSampleTime: 0, durationMs: 0 };
    edgeLowFpsStateUpdateRef.current = 0;
    setEdgeLowFpsSampleDurationMs((previous) => previous === 0 ? previous : 0);
  }, []);

  useEffect(() => {
    if (isPlaying && !isPaused && isEdgeBrowser && graphicsCheck.checked && graphicsCheck.supported && graphicsCheck.accelerated) {
      return;
    }

    resetEdgeLowFpsDetection();
    if (!isPlaying) {
      setShowEdgePerformanceWarning(false);
    }
  }, [
    isPlaying,
    isPaused,
    isEdgeBrowser,
    graphicsCheck.checked,
    graphicsCheck.supported,
    graphicsCheck.accelerated,
    resetEdgeLowFpsDetection,
  ]);

  const trackEdgeLowFps = useCallback((fps: number | undefined) => {
    if (
      !isEdgeBrowser ||
      edgePerformanceWarningDismissed ||
      showEdgePerformanceWarning ||
      !isPlaying ||
      isPaused ||
      !graphicsCheck.checked ||
      !graphicsCheck.supported ||
      !graphicsCheck.accelerated
    ) {
      return;
    }

    const fpsValue = typeof fps === 'number' && Number.isFinite(fps) ? fps : 0;
    if (fpsValue <= 0) {
      return;
    }

    const now = performance.now();
    const sample = edgeLowFpsSampleRef.current;
    const elapsedMs = sample.lastSampleTime === 0
      ? 0
      : Math.min(Math.max(now - sample.lastSampleTime, 0), 1000);
    sample.lastSampleTime = now;

    if (fpsValue >= EDGE_LOW_FPS_THRESHOLD) {
      resetEdgeLowFpsDetection();
      return;
    }

    sample.durationMs += elapsedMs;
    if (
      sample.durationMs - edgeLowFpsStateUpdateRef.current >= EDGE_LOW_FPS_STATE_UPDATE_STEP_MS ||
      sample.durationMs >= EDGE_LOW_FPS_SUSTAINED_MS
    ) {
      edgeLowFpsStateUpdateRef.current = sample.durationMs;
      setEdgeLowFpsSampleDurationMs(Math.min(sample.durationMs, EDGE_LOW_FPS_SUSTAINED_MS));
    }

    if (sample.durationMs >= EDGE_LOW_FPS_SUSTAINED_MS) {
      setEdgeLowFpsSampleDurationMs(EDGE_LOW_FPS_SUSTAINED_MS);
      setShowEdgePerformanceWarning(true);
    }
  }, [
    isEdgeBrowser,
    edgePerformanceWarningDismissed,
    showEdgePerformanceWarning,
    isPlaying,
    isPaused,
    graphicsCheck.checked,
    graphicsCheck.supported,
    graphicsCheck.accelerated,
    resetEdgeLowFpsDetection,
  ]);

  const dismissEdgePerformanceWarning = useCallback(() => {
    setEdgePerformanceWarningDismissed(true);
    setShowEdgePerformanceWarning(false);
  }, []);

  const dismissGraphicsWarning = useCallback(() => {
    setShowGraphicsWarning(false);
  }, []);

  const trackV3PerformanceSample = useCallback((fps: number | undefined) => {
    setV3QualityTier((previous) => {
      const next = selectV3QualityTier(buildV3QualitySignals(
        deviceInfo,
        graphicsCheck,
        forceMobileControls,
        fps,
        previous
      ));
      return next === previous ? previous : next;
    });
  }, [deviceInfo, graphicsCheck, forceMobileControls]);

  return {
    deviceInfo,
    isOnline,
    graphicsCheck,
    v3QualityTier,
    showGraphicsWarning,
    dismissGraphicsWarning,
    edgeLowFpsSampleDurationMs,
    showEdgePerformanceWarning,
    dismissEdgePerformanceWarning,
    hardwareTab,
    setHardwareTab,
    trackEdgeLowFps,
    trackV3PerformanceSample,
  };
}
