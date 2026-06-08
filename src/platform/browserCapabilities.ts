import type { DeviceInfo, DeviceOS } from '../types';

export interface GraphicsCheckResult {
  checked: boolean;
  supported: boolean;
  accelerated: boolean;
  details?: string;
}

export const detectDeviceOS = (): DeviceInfo => {
  if (typeof window === 'undefined') return { isMobile: false, os: 'desktop' };
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
  const navWithUaData = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const compactViewport = Math.min(window.innerWidth, window.innerHeight) <= 520;
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const touchCapable = maxTouchPoints > 0 || 'ontouchstart' in window;
  const reportsMobile = navWithUaData.userAgentData?.mobile === true;
  const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const iPadDesktopMode = /Macintosh/i.test(ua) && maxTouchPoints > 1;
  const isMobile = reportsMobile
    || mobileUserAgent
    || iPadDesktopMode
    || (touchCapable && coarsePointer)
    || (touchCapable && noHover)
    || compactViewport;
  let os: DeviceOS = 'desktop';

  if (/iPhone|iPad|iPod/i.test(ua) || iPadDesktopMode) {
    os = 'ios';
  } else if (/Android/i.test(ua)) {
    os = 'android';
  } else if (isMobile) {
    os = 'unknown';
  }

  return { isMobile, os };
};

export const detectMicrosoftEdge = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /\bEdg\//.test(navigator.userAgent || '');
};

export const checkGraphicsAcceleration = (): GraphicsCheckResult => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { checked: true, supported: true, accelerated: true };
  }
  try {
    const canvas = document.createElement('canvas');
    if (!canvas) {
      return { checked: true, supported: false, accelerated: false, details: 'Cannot create canvas' };
    }

    const glBasic = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!glBasic) {
      return { checked: true, supported: false, accelerated: false, details: 'WebGL not supported or disabled' };
    }

    const glAccelerated = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
                          canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });

    if (!glAccelerated) {
      let renderer = 'Software Rasterizer';
      const ext = glBasic.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        renderer = glBasic.getParameter(ext.UNMASKED_RENDERER_WEBGL) || renderer;
      }
      return { checked: true, supported: true, accelerated: false, details: renderer };
    }

    let renderer = 'Hardware Accelerated GPU';
    const ext = glAccelerated.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      renderer = glAccelerated.getParameter(ext.UNMASKED_RENDERER_WEBGL) || renderer;
    }
    return { checked: true, supported: true, accelerated: true, details: renderer };
  } catch (e) {
    return { checked: true, supported: false, accelerated: false, details: `Check error: ${e}` };
  }
};
