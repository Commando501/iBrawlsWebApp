import type { GraphicsCheckResult } from '../platform/browserCapabilities';

export type HardwareHelpTab = 'chrome' | 'firefox' | 'safari';

interface EdgePerformanceWarningModalProps {
  currentFps?: number;
  edgeLowFpsSampleDurationMs: number;
  graphicsCheck: GraphicsCheckResult;
  lowFpsThreshold: number;
  sustainedMs: number;
  onDismiss: () => void;
}

interface GraphicsAccelerationWarningModalProps {
  graphicsCheck: GraphicsCheckResult;
  hardwareTab: HardwareHelpTab;
  onHardwareTabChange: (tab: HardwareHelpTab) => void;
  onDismiss: () => void;
}

const HARDWARE_HELP_TABS: { id: HardwareHelpTab; label: string }[] = [
  { id: 'chrome', label: 'Chrome / Edge' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'safari', label: 'Safari' },
];

export function EdgePerformanceWarningModal({
  currentFps,
  edgeLowFpsSampleDurationMs,
  graphicsCheck,
  lowFpsThreshold,
  sustainedMs,
  onDismiss,
}: EdgePerformanceWarningModalProps) {
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
      <div className="mobile-modal w-full max-w-lg bg-slate-900 border border-sky-500/20 hover:border-sky-500/30 rounded-2xl p-6 shadow-[0_0_30px_rgba(14,165,233,0.15)] flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto transition-all duration-300">
        <div className="flex justify-between items-start border-b border-white/5 pb-4 shrink-0">
          <div className="flex flex-col">
            <span className="text-[10px] text-sky-400 font-bold uppercase tracking-[0.2em] mb-1 font-display">
              EDGE PERFORMANCE WARNING
            </span>
            <h3 className="text-xl font-black tracking-tight text-white uppercase font-display leading-tight">
              Edge Graphics Path Degraded
            </h3>
          </div>
          <button
            onClick={onDismiss}
            className="text-white/40 hover:text-white font-bold cursor-pointer p-1 transition-colors text-base"
            title="Dismiss warning"
          >
            x
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-xs text-white/60 leading-relaxed">
            Microsoft Edge is using a <strong className="text-sky-300">low-performance graphics path</strong> on this device. WebGL acceleration is enabled, but iBrawls detected sustained gameplay under <strong className="text-white">{lowFpsThreshold} FPS</strong> for <strong className="text-white">{sustainedMs / 1000} seconds</strong>. Edge is not recommended for this device; Chrome or Firefox should provide the best performance.
          </p>

          <div className="bg-black/45 border border-white/5 rounded-xl p-4 flex flex-col gap-2.5 font-mono text-[11px] shadow-inner select-text">
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-white/45">Browser:</span>
              <span className="text-sky-300 font-bold">Microsoft Edge</span>
            </div>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-white/45">WebGL Acceleration:</span>
              <span className="text-emerald-400 font-bold">ENABLED</span>
            </div>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-white/45">Recent FPS:</span>
              <span className="text-amber-300 font-bold">
                {currentFps !== undefined && currentFps > 0 ? currentFps : 'Low'}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-white/45">Low-FPS Window:</span>
              <span className="text-amber-300 font-bold">
                {(edgeLowFpsSampleDurationMs / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-white/45">Detected Renderer:</span>
              <span className="text-sky-300 font-bold break-all">
                {graphicsCheck.details || 'Hardware Accelerated GPU'}
              </span>
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-xl p-4 text-xs select-text leading-relaxed">
            <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
              <li>Open <code className="bg-black/40 px-1 py-0.5 rounded text-sky-300 font-mono">edge://gpu</code> and confirm WebGL is listed as hardware accelerated.</li>
              <li>Open <code className="bg-black/40 px-1 py-0.5 rounded text-sky-300 font-mono">edge://settings/system</code> and keep <strong className="text-white">Use graphics acceleration when available</strong> enabled.</li>
              <li>Update Edge from <code className="bg-black/40 px-1 py-0.5 rounded text-sky-300 font-mono">edge://settings/help</code>, then fully restart the browser.</li>
              <li>Update your GPU driver from Intel, NVIDIA, AMD, or your PC manufacturer.</li>
              <li>If Chrome or Firefox stays much faster on the same device, use one of those browsers for iBrawls.</li>
            </ol>
          </div>
        </div>

        <div className="flex gap-3 mt-3 shrink-0">
          <button
            onClick={onDismiss}
            className="flex-1 py-3.5 bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white font-sans font-black text-xs uppercase tracking-widest rounded-lg border border-sky-500/20 active:scale-95 shadow-[0_0_15px_rgba(14,165,233,0.25)] transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <span>Dismiss & Play Anyway</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function GraphicsAccelerationWarningModal({
  graphicsCheck,
  hardwareTab,
  onHardwareTabChange,
  onDismiss,
}: GraphicsAccelerationWarningModalProps) {
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
      <div className="mobile-modal w-full max-w-lg bg-slate-900 border border-amber-500/20 hover:border-amber-500/30 rounded-2xl p-6 shadow-[0_0_30px_rgba(245,158,11,0.15)] flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto transition-all duration-300">
        <div className="flex justify-between items-start border-b border-white/5 pb-4 shrink-0">
          <div className="flex flex-col">
            <span className="text-[10px] text-amber-500 font-bold uppercase tracking-[0.2em] mb-1 font-display flex items-center gap-1.5 animate-pulse">
              SYSTEM HARDWARE WARNING
            </span>
            <h3 className="text-xl font-black tracking-tight text-white uppercase font-display leading-tight">
              Graphics Acceleration Disabled
            </h3>
          </div>
          <button
            onClick={onDismiss}
            className="text-white/40 hover:text-white font-bold cursor-pointer p-1 transition-colors text-base"
            title="Dismiss warning"
          >
            x
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-xs text-white/60 leading-relaxed">
            We detected that your browser is running with <strong className="text-amber-400">graphics acceleration turned off</strong> or is using a slow CPU software rasterizer. iBrawls requires hardware-accelerated WebGL to render high-performance 3D character models and environments smoothly. Without it, you will experience heavy lag, stuttering, and extremely low frame rates.
          </p>

          <div className="bg-black/45 border border-white/5 rounded-xl p-4 flex flex-col gap-2.5 font-mono text-[11px] shadow-inner select-text">
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-white/45">WebGL 3D Context:</span>
              <span className={graphicsCheck.supported ? 'text-emerald-400 font-bold' : 'text-rose-500 font-bold'}>
                {graphicsCheck.supported ? 'AVAILABLE' : 'UNSUPPORTED / BLOCKED'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-white/45">Detected Renderer:</span>
              <span className="text-amber-400 font-bold break-all">
                {graphicsCheck.details || 'Unknown CPU/Software Driver'}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 mt-1.5">
            <span className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">
              How to Enable Hardware Acceleration:
            </span>

            <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 gap-1 select-none">
              {HARDWARE_HELP_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => onHardwareTabChange(tab.id)}
                  className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer text-center ${
                    hardwareTab === tab.id
                      ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 font-extrabold shadow-[inset_0_1px_3px_rgba(245,158,11,0.1)]'
                      : 'text-white/40 hover:text-white/70 border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-white/5 border border-white/5 rounded-xl p-4 text-xs select-text leading-relaxed">
              {hardwareTab === 'chrome' && (
                <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
                  <li>Open your browser settings (enter <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono">chrome://settings/system</code> in the address bar).</li>
                  <li>Toggle on <strong className="text-white">"Use graphics acceleration when available"</strong> (or "Use hardware acceleration when available").</li>
                  <li>Click the <strong className="text-amber-400">Relaunch</strong> button to restart the browser.</li>
                  <li>If still slow, enter <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono">chrome://flags</code>, search for <strong className="text-white">"Override software rendering list"</strong>, set it to <strong className="text-emerald-400">Enabled</strong>, and relaunch.</li>
                </ol>
              )}

              {hardwareTab === 'firefox' && (
                <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
                  <li>Click the Firefox menu button and select <strong className="text-white">Settings</strong> (or go to <code className="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono">about:preferences</code>).</li>
                  <li>In the **General** panel, scroll down to the <strong className="text-white">Performance</strong> section.</li>
                  <li>Uncheck <strong className="text-white">"Use recommended performance settings"</strong>.</li>
                  <li>Check <strong className="text-white">"Use hardware acceleration when available"</strong>.</li>
                  <li>Restart Firefox to apply the changes.</li>
                </ol>
              )}

              {hardwareTab === 'safari' && (
                <ol className="list-decimal pl-4 flex flex-col gap-2 text-white/75 font-medium">
                  <li>Open <strong className="text-white">Safari Settings / Preferences</strong> (or press <kbd className="bg-black/40 px-1 py-0.5 rounded text-[10px] font-mono">Cmd+,</kbd>).</li>
                  <li>Go to the <strong className="text-white">Advanced</strong> tab.</li>
                  <li>Ensure that <strong className="text-white">"Use hardware acceleration"</strong> is checked (if available).</li>
                  <li>On iOS/macOS, ensure your system is not running in <strong className="text-amber-400">Low Power Mode</strong>, which often disables GPU acceleration for web pages.</li>
                </ol>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-3 shrink-0">
          <button
            onClick={onDismiss}
            className="flex-1 py-3.5 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white font-sans font-black text-xs uppercase tracking-widest rounded-lg border border-amber-500/20 active:scale-95 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <span>Dismiss & Play Anyway</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
