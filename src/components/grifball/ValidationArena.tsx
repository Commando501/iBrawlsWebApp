import { useMemo, useRef, useState } from 'react';
import { GrifballGame } from '../GrifballGame';
import type { GrifballGameProps } from './GrifballGameProps';
import type { TrialHandle, ValidationHost } from '../../game/grifballValidation/runner';

/** Private React host: no window automation bridge or shared live Lab state. */
export function useValidationArena() {
  const [trial, setTrial] = useState<GrifballGameProps['validationTrial'] | null>(null);
  const host = useMemo<ValidationHost>(() => ({
    load: (fixture, job, signal) => new Promise<TrialHandle>((resolve, reject) => {
      if (signal.aborted) { reject(new Error('Cancelled before arena load')); return; }
      const cancel = () => { setTrial(null); reject(new Error('Arena loading cancelled')); };
      signal.addEventListener('abort', cancel, { once: true });
      setTrial({ fixture, job,
        onReady: handle => { signal.removeEventListener('abort', cancel); resolve(handle); },
        onError: error => { signal.removeEventListener('abort', cancel); reject(error); },
      });
    }),
    unload: () => setTrial(null),
  }), []);
  return { trial, host };
}
export function ValidationArena({ trial }: { trial: GrifballGameProps['validationTrial'] | null }) {
  const joystick = useRef({ x: 0, y: 0 }), rightJoystick = useRef({ x: 0, y: 0 }), rightActive = useRef(false);
  return <div className="relative h-56 overflow-hidden rounded border border-slate-700 bg-slate-950" aria-label="Validation arena">
    {trial ? <GrifballGame key={trial.job.id} isPlaying isPaused={false} debugMode={false}
      adminSettings={trial.fixture.mechanics} onStatsUpdate={() => {}} onPauseToggle={() => {}}
      customMap={trial.fixture.map} selectedMap={trial.fixture.map.id} aiMatchSessionKey={trial.job.id}
      deviceInfo={{ isMobile: false, os: 'desktop' }} forceMobileControls={false}
      mobileJoystickRef={joystick} mobileRightJoystickRef={rightJoystick} mobileRightJoystickActiveRef={rightActive}
      validationTrial={trial} /> : <p className="p-4 text-xs text-slate-400">An isolated arena appears while each job runs. The existing match stays paused.</p>}
  </div>;
}
