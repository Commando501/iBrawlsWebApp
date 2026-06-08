import { forwardRef } from 'react';

interface DataCollectionNoticeProps {
  onDismiss: () => void;
}

interface TerminatedOverlayProps {
  onReboot: () => void;
}

export function DataCollectionNotice({ onDismiss }: DataCollectionNoticeProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-[200] flex justify-center px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto max-w-2xl w-full bg-slate-900/95 backdrop-blur border border-sky-500/30 rounded-xl shadow-2xl px-4 py-3 flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">ðŸ“Š</span>
        <p className="text-[11px] text-white/70 leading-snug flex-1">
          <span className="font-bold text-sky-300">Heads up â€” this is a tech demo.</span>{' '}
          It collects anonymized gameplay stats and a sampled subset of match replays
          (with player names removed) to train and improve the AI. No accounts or
          personal information are stored.
        </p>
        <button
          onClick={onDismiss}
          className="shrink-0 px-3 h-8 bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-[11px] uppercase tracking-wider rounded cursor-pointer transition-all active:scale-95"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export function TerminatedOverlay({ onReboot }: TerminatedOverlayProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-2xl transition-all duration-300">
      <div className="w-full max-w-sm text-center px-4">
        <div className="w-16 h-16 rounded-full border border-red-500/30 flex items-center justify-center bg-red-950/30 mx-auto mb-6">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>

        <h2 className="text-3xl font-display font-black uppercase tracking-wider mb-2 text-red-400">
          SIMULATION CLOSED
        </h2>
        <p className="text-sm text-white/60 mb-8 leading-relaxed">
          The Grifball VR Sandbox prototype is offline. You can relaunch the client by clicking the button below.
        </p>

        <button
          id="reboot-sim-btn"
          onClick={onReboot}
          className="px-8 py-3.5 bg-blue-600 rounded text-xs select-none hover:bg-blue-500 active:scale-95 border border-blue-400/30 font-black tracking-widest uppercase transition-all duration-150 cursor-pointer pointer-events-auto"
        >
          Reboot Simulation
        </button>
      </div>
    </div>
  );
}

export const GamepadCursor = forwardRef<HTMLDivElement>((_, ref) => (
  <div
    ref={ref}
    style={{
      position: 'fixed',
      left: '50%',
      top: '50%',
      width: '32px',
      height: '32px',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: 99999,
      display: 'none',
    }}
  >
    <img
      src="/gamepad-cursor.png"
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
      }}
      alt="Controller Cursor"
    />
  </div>
));

GamepadCursor.displayName = 'GamepadCursor';
