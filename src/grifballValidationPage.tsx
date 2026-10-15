import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GrifballGame } from './components/GrifballGame';
import type { GrifballGameProps } from './components/grifball/GrifballGameProps';
import { createSuiteManifest } from './game/grifballValidation/profiles';
import { createSuitePlan } from './game/grifballValidation/plan';
import { runValidationSuite, type SuiteProgress, type TrialHandle } from './game/grifballValidation/runner';
import type { GrifballValidationBridge } from './game/grifballValidation/browserBridge';
import type { SuitePlan, SuiteManifest } from './game/grifballValidation/types';
import type { GameStats } from './types';
import './grifballValidation.css';

function pilot(kind: 'scenario' | 'match' | 'rosters'): SuiteManifest {
  const manifest = createSuiteManifest(kind === 'scenario' ? 'quick' : 'standard');
  manifest.profile = 'quick'; manifest.requiredGates = createSuiteManifest('quick').requiredGates;
  if (kind === 'scenario') manifest.cases = manifest.cases.filter(c => c.scenario === 'goal' || c.scenario === 'reinforcements');
  else manifest.cases = manifest.cases.filter(c => c.mode === 'match' && (kind === 'rosters' || c.roster === 'scripted-1v1'));
  for (const c of manifest.cases) {
    c.seeds = [101]; c.opponents = ['balanced']; c.mirrored = kind === 'rosters';
    c.simulationSeconds = kind === 'match' ? 240 : 5;
    c.watchdogSeconds = kind === 'match' ? 600 : 120;
  }
  return manifest;
}
const buttonStyle: React.CSSProperties = { border: '1px solid #64748b', borderRadius: 6, padding: '7px 12px', background: '#1e293b' };
function ValidationPage() {
  const [manifestText, setManifestText] = useState(() => JSON.stringify(pilot('scenario'), null, 2));
  const [mounted, setMounted] = useState<GrifballGameProps['validationTrial'] | null>(null);
  const [progress, setProgress] = useState<SuiteProgress | null>(null);
  const [running, setRunning] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof runValidationSuite>> | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const statsRef = useRef<GameStats | null>(null), abortRef = useRef<AbortController | null>(null);
  const joystick = useRef({ x: 0, y: 0 }), rightJoystick = useRef({ x: 0, y: 0 }), rightActive = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setStats(statsRef.current), 250);
    return () => { clearInterval(timer); abortRef.current?.abort(); };
  }, []);
  const busyRef = useRef(false), preparedRef = useRef<SuitePlan | null>(null);
  const stateObserverRef = useRef<((canonicalState: string) => void) | null>(null);
  const stateCanAdvanceRef = useRef<(() => boolean) | undefined>(undefined);
  const progressRef = useRef<SuiteProgress | null>(null);
  const execute = async (plan: SuitePlan, jobId?: string) => {
    if (busyRef.current) throw new Error('A validation job is already running');
    busyRef.current = true;
    setRunning(true); setError(''); setResult(null); setStats(null); statsRef.current = null;
    const abort = new AbortController(); abortRef.current = abort;
    try {
      const output = await runValidationSuite(plan, {
        load: (fixture, job, signal) => new Promise<TrialHandle>((resolve, reject) => {
          if (signal.aborted) { reject(new Error('Cancelled before arena load')); return; }
          const cancel = () => { setMounted(null); reject(new Error('Arena loading cancelled')); };
          signal.addEventListener('abort', cancel, { once: true });
          setMounted({ fixture, job,
            observeState: stateObserverRef.current ?? undefined,
            canAdvance: stateCanAdvanceRef.current,
            onReady: handle => { signal.removeEventListener('abort', cancel); resolve(handle); },
            onError: err => { signal.removeEventListener('abort', cancel); reject(err); },
          });
        }),
        unload: () => setMounted(null),
      }, { signal: abort.signal, jobIds: jobId ? [jobId] : undefined, onProgress: value => { progressRef.current = value; setProgress(value); } });
      setResult(output); return output;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); throw err; }
    finally { busyRef.current = false; setRunning(false); setMounted(null); abortRef.current = null; }
  };
  const executeRef = useRef(execute); executeRef.current = execute;
  useEffect(() => {
    const bridge: GrifballValidationBridge = {
      version: 1, buildId: import.meta.env.VITE_VALIDATION_BUILD_ID ?? '',
      async prepare(manifest, code, expectedPlanId) {
        if (busyRef.current) throw new Error('Cannot replace active inputs');
        const plan = await createSuitePlan(manifest, code);
        if (plan.id !== expectedPlanId) throw new Error('Browser and CLI frozen plans differ');
        if (busyRef.current) throw new Error('Cannot replace active inputs');
        preparedRef.current = plan;
        return plan.jobs.map(job => job.id);
      },
      async runJob(jobId) {
        const plan = preparedRef.current;
        const job = plan?.jobs.find(job => job.id === jobId);
        if (!plan || !job) throw new Error('Job is not in the prepared plan');
        const output = await executeRef.current(plan, job.id);
        if (output.results.length !== 1) throw new Error('Job produced no result');
        return output.results[0];
      },
      observeState(observer, canAdvance) {
        if (busyRef.current) throw new Error('Cannot change state observer during a trial');
        stateObserverRef.current = observer;
        stateCanAdvanceRef.current = observer ? canAdvance : undefined;
      },
      progress: () => progressRef.current,
      cancel: () => abortRef.current?.abort(),
    };
    window.__grifballValidation = bridge;
    return () => { delete window.__grifballValidation; };
  }, []);
  const run = async () => {
    try {
      const plan = await createSuitePlan(JSON.parse(manifestText), { commit: null, dirty: null, workingTreeHash: null, scope: [] });
      await execute(plan);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'grifball-live-validation.json'; a.click(); URL.revokeObjectURL(url);
  };
  return <main style={{ color: '#e2e8f0', background: '#0f172a', minHeight: '100vh', padding: 20, fontFamily: 'system-ui' }}>
    <h1 style={{ fontSize: 26, marginBottom: 8 }}>Grifball live validation</h1>
    <p>Live gameplay trials. The CLI collects durable results and repository checks; acceptance gates remain separate.</p>
    <p style={{ color: '#94a3b8', marginBottom: 12 }}>Manual sessions have no verified source identity. Use npm run validate:grifball for an isolated browser run with a saved report.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      <button style={buttonStyle} disabled={running} onClick={() => setManifestText(JSON.stringify(pilot('scenario'), null, 2))}>Scenario pilot</button>
      <button style={buttonStyle} disabled={running} onClick={() => setManifestText(JSON.stringify(pilot('match'), null, 2))}>Autonomous 1v1</button>
      <button style={buttonStyle} disabled={running} onClick={() => setManifestText(JSON.stringify(pilot('rosters'), null, 2))}>Roster and map pilot</button>
      <button style={{ ...buttonStyle, background: '#075985' }} disabled={running} onClick={() => void run()}>Run live jobs</button>
      <button style={buttonStyle} disabled={!running} onClick={() => abortRef.current?.abort()}>Cancel suite</button>
      <button style={buttonStyle} disabled={!result} onClick={download}>Export results</button>
    </div>
    <details><summary>Manifest JSON</summary><textarea aria-label="Manifest JSON" value={manifestText} disabled={running}
      onChange={e => setManifestText(e.target.value)} style={{ width: '100%', height: 220, fontFamily: 'monospace', background: '#020617', color: '#cbd5e1' }}/></details>
    <p role="status" style={{ margin: '12px 0' }}>{running ? `${progress?.stage ?? 'Preparing'} · ${progress?.completed ?? 0}/${progress?.total ?? '?'} jobs` : result ? `Finished · ${result.results.length} trials · overall ${result.report.verdict}` : 'Ready'}</p>
    {error && <p role="alert" style={{ color: '#fca5a5' }}>{error}</p>}
    {mounted && <p>{mounted.fixture.specification.id} · {mounted.job.variant} · {mounted.job.mirrored ? 'mirrored' : 'original'} · {stats?.grifball?.phase ?? 'loading'} · {stats?.grifball?.blueGoals ?? 0}–{stats?.grifball?.redGoals ?? 0}</p>}
    <div style={{ position: 'relative', height: '52vh', minHeight: 300, marginTop: 12, background: '#020617', overflow: 'hidden', borderRadius: 8 }}>
      {mounted ? <GrifballGame key={mounted.job.id} isPlaying isPaused={false} debugMode={false}
        adminSettings={mounted.fixture.mechanics} onStatsUpdate={value => { statsRef.current = value; }} onPauseToggle={() => {}}
        customMap={mounted.fixture.map} selectedMap={mounted.fixture.map.id} aiMatchSessionKey={mounted.job.id}
        deviceInfo={{ isMobile: false, os: 'desktop' }} forceMobileControls={false}
        mobileJoystickRef={joystick} mobileRightJoystickRef={rightJoystick} mobileRightJoystickActiveRef={rightActive}
        validationTrial={mounted} /> : <p style={{ padding: 24, color: '#94a3b8' }}>The dedicated arena appears while a job runs.</p>}
    </div>
    {result && <>
      <table style={{ width: '100%', marginTop: 16, textAlign: 'left' }}><thead><tr><th>Case / seed / style / side / variant</th><th>Termination</th><th>Ticks</th><th>Score</th><th>Result</th></tr></thead>
        <tbody>{result.results.map(r => <tr key={r.jobId}><td>{r.jobId.split('/')[0]} / {r.jobId.split('/').slice(2).join(' / ')}</td><td>{r.termination}</td><td>{r.end?.tick ?? 0}</td><td>{r.end ? `${r.end.scores.blue}–${r.end.scores.red}` : '—'}</td><td>{r.check.summary}</td></tr>)}</tbody></table>
      <details><summary>Result JSON</summary><pre data-testid="validation-result" style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(result, null, 2)}</pre></details>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render((import.meta.env.DEV || import.meta.env.MODE === 'validation') ? <ValidationPage/> : <p>Development validation is unavailable in this build.</p>);
