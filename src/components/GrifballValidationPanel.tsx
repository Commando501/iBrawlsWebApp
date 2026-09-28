import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { grifballLab } from '../game/grifballLabStore';
import { defaultGrifballTactics } from '../game/grifballTacticsConfig';
import { createSuiteManifest } from '../game/grifballValidation/profiles';
import { createSuitePlan } from '../game/grifballValidation/plan';
import { validateManifest } from '../game/grifballValidation/manifest';
import { runValidationSuite, type SuiteProgress } from '../game/grifballValidation/runner';
import { MAP_IDS, type SuiteManifest, type SuitePlan, type SuiteProfile } from '../game/grifballValidation/types';
import { JobBoundary } from '../game/grifballValidation/jobBoundary';
import { appendLabResult, checkpointLabel, importLabRun, labRunReport, newLabRun, readableLabReport,
  BROWSER_JOB_LIMIT, REPORT_BYTES, UNKNOWN_CODE, type LabRun, type LabRuntimeIdentity } from '../game/grifballValidation/labReport';
import { deleteLabRun, listLabRuns, saveLabRun } from '../game/grifballValidation/labReportStorage';
import { useValidationArena, ValidationArena } from './grifball/ValidationArena';

const button = 'rounded border border-slate-600 bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'rounded border border-slate-600 bg-slate-950 p-2 text-xs min-w-0 w-full';
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function runtimeIdentity(): LabRuntimeIdentity {
  return { kind: 'lab-browser', buildId: import.meta.env.VITE_VALIDATION_BUILD_ID || null,
    userAgent: navigator.userAgent, fixedHz: 60, model: 'v2-medium' };
}
export function GrifballValidationPanel({ visible }: { visible: boolean }) {
  const lab = useSyncExternalStore(grifballLab.subscribe, grifballLab.getSnapshot);
  const [profile, setProfile] = useState<SuiteProfile>('quick');
  const [draft, setDraft] = useState<SuiteManifest | null>(() => createSuiteManifest('quick'));
  const [baseline, setBaseline] = useState('defaults'), [candidate, setCandidate] = useState('current');
  const [plan, setPlan] = useState<SuitePlan | null>(null), [manifestText, setManifestText] = useState('');
  const [busy, setBusy] = useState(false), [freezing, setFreezing] = useState(false), [error, setError] = useState('');
  const [pauseRequested, setPauseRequested] = useState(false), [progress, setProgress] = useState<SuiteProgress | null>(null);
  const [runs, setRuns] = useState<LabRun[]>([]), [selected, setSelected] = useState<LabRun | null>(null);
  const [active, setActive] = useState<LabRun | null>(null);
  const control = useRef<{ abort: AbortController; boundary: JobBoundary } | null>(null);
  const busyRef = useRef(false), alive = useRef(true);
  const { host, trial } = useValidationArena();
  useEffect(() => {
    alive.current = true;
    listLabRuns().then(rows => { if (alive.current) { setRuns(rows); setSelected(rows[0] ?? null); } }).catch(e => setError(`Report storage: ${String(e)}`));
    return () => { alive.current = false; control.current?.abort.abort(); };
  }, []);
  const runShown = active ?? selected;
  const report = useMemo(() => runShown ? labRunReport(runShown) : null, [runShown]);
  const changeDraft = (next: SuiteManifest | null) => { setDraft(next); setPlan(null); setError(''); };
  const resolveConfig = (key: string, variant: 'baseline' | 'candidate') => {
    if (key === 'manifest') return draft![variant];
    if (key === 'defaults') return defaultGrifballTactics();
    if (key === 'current') return lab.config;
    if (key === 'pinned' && lab.baseline) return lab.baseline;
    const preset = lab.presets.find(p => `preset:${p.name}` === key);
    if (preset) return preset.config;
    throw new Error('That preset is no longer available. Select another configuration.');
  };
  const freezeInputs = async () => {
    if (!draft || freezing) return;
    setFreezing(true); setError(''); setPlan(null);
    try {
      const frozen = await createSuitePlan({ ...draft, baseline: resolveConfig(baseline, 'baseline'), candidate: resolveConfig(candidate, 'candidate') }, UNKNOWN_CODE);
      if (frozen.jobs.length > BROWSER_JOB_LIMIT) throw new Error(`Use the CLI for more than ${BROWSER_JOB_LIMIT} jobs.`);
      setPlan(frozen);
    } catch (e) { setError(String(e)); } finally { setFreezing(false); }
  };
  const execute = async (frozen: SuitePlan, jobIds?: string[], parentId: string | null = null) => {
    if (busyRef.current || lab.comparing) return;
    setProgress(null);
    busyRef.current = true; setBusy(true); setError(''); setPauseRequested(false);
    const abort = new AbortController(), boundary = new JobBoundary(); control.current = { abort, boundary };
    let current: LabRun | null = null;
    const publish = () => { if (alive.current && current) setActive(current); };
    try {
      if (!navigator.locks) throw new Error('Run validation in a browser with Web Locks on localhost or HTTPS.');
      await navigator.locks.request('ibrawls-grifball-validation-run', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('A validation suite is running in another tab. Finish or cancel it first.');
        if (abort.signal.aborted) return;
        grifballLab.setRunning(false); grifballLab.update({ validating: true });
        current = newLabRun(frozen, runtimeIdentity(), jobIds, parentId); publish();
        await saveLabRun(current);
        await runValidationSuite(frozen, host, { signal: abort.signal, jobIds,
          beforeJob: async job => {
            if (boundary.paused) {
              current = { ...current!, status: 'paused', currentJobId: null }; publish(); await saveLabRun(current);
              await boundary.wait(abort.signal);
            }
            if (abort.signal.aborted) return;
            current = { ...current!, status: 'running', currentJobId: job.id }; publish(); await saveLabRun(current);
          },
          onProgress: value => { if (alive.current) setProgress(value); },
          onResult: async result => { current = appendLabResult(current!, result); publish(); await saveLabRun(current); },
        });
        current = { ...current!, status: abort.signal.aborted ? 'cancelled' : current!.results.length === current!.selectedJobIds.length ? 'completed' : 'error', currentJobId: null };
        await saveLabRun(current);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (current) {
        current = { ...(current as LabRun), status: 'error', currentJobId: null, error: message };
        try { await saveLabRun(current); } catch { /* In-memory report remains exportable. */ }
      }
      if (alive.current) setError(message);
    } finally {
      abort.abort(); host.unload(); control.current = null; busyRef.current = false;
      grifballLab.update({ validating: false });
      if (alive.current) {
        setBusy(false); setActive(null); if (current) setSelected(current);
        try { setRuns(await listLabRuns()); } catch (e) { setError(`Report storage: ${String(e)}. Export the visible report to keep it.`); }
      }
    }
  };
  const rerun = async (caseId: string) => {
    if (!runShown) return;
    try {
      // New report, fresh runtime and inputs; never replace a previous failure with a rerun pass.
      const next = await createSuitePlan(runShown.plan.manifest, UNKNOWN_CODE);
      await execute(next, next.jobs.filter(j => j.caseId === caseId).map(j => j.id), runShown.id);
    } catch (e) { setError(String(e)); }
  };
  const selectConfig = (label: string, value: string, update: (value: string) => void) => <label className="block space-y-1">{label}<select className={input} aria-label={label} value={value} onChange={e => { update(e.target.value); setPlan(null); }}>
    <option value="defaults">Built-in defaults</option><option value="current">Current Lab configuration</option>
    <option value="pinned" disabled={!lab.baseline}>Pinned Lab baseline</option><option value="manifest">Imported manifest configuration</option>
    {lab.presets.map(p => <option value={`preset:${p.name}`} key={p.name}>{p.name}</option>)}
  </select></label>;
  const currentJob = active?.plan.jobs.find(j => j.id === active.currentJobId);
  const currentCase = active?.plan.cases.find(c => c.specification.id === currentJob?.caseId);
  return <section aria-label="Validation suite" hidden={!visible} className="overflow-y-auto flex-1 min-h-0 p-4 space-y-4 text-xs" style={!visible ? { display: 'none' } : undefined}>
    <div><h3 className="font-semibold text-base text-cyan-300">Run validation</h3><p className="mt-1 text-slate-400">Repeatable trials with frozen inputs. Browser runs collect trial evidence; correctness is checked here. Pinned repeatability, execution parity, calibrated performance and repository checks use CLI evidence. Human review stays separate.</p></div>
    <fieldset disabled={busy || freezing} className="space-y-3">
      <label className="block space-y-1">Profile<select aria-label="Validation profile" className={input} value={profile} onChange={e => {
        const value = e.target.value as SuiteProfile; setProfile(value); changeDraft(value === 'acceptance' ? null : createSuiteManifest(value));
      }}><option value="quick">Quick · default: 4 scenarios, 32 jobs</option><option value="standard">Standard · default: 23 cases, 184 jobs</option><option value="acceptance">Acceptance · authored manifest required</option></select></label>
      {!draft && <p className="text-amber-200">Import an acceptance manifest with calibrated performance budgets and held-out match seeds. No default acceptance claim is available.</p>}
      <div className="grid grid-cols-2 gap-2">{selectConfig('Baseline', baseline, setBaseline)}{selectConfig('Candidate', candidate, setCandidate)}</div>
      {draft && <details><summary className="cursor-pointer text-cyan-200">Cases and maps · {draft.cases.length} selected</summary>
        <div className="space-y-2 mt-2">
          <label className="block">Map override<select aria-label="Validation map" className={input} value="" onChange={e => { if (e.target.value) changeDraft({ ...draft, cases: draft.cases.map(c => ({ ...c, mapId: e.target.value as typeof MAP_IDS[number] })) }); }}><option value="">Choose a map for all selected cases…</option>{MAP_IDS.map(id => <option key={id}>{id}</option>)}</select></label>
          {draft.cases.map(c => <div key={c.id} className="border-b border-slate-800 pb-2 break-words"><strong>{c.id}</strong><p>{c.mapId} · {c.roster} · seeds {c.seeds.join(', ')} · {c.opponents.join(', ')} · {c.mirrored ? 'both sides' : 'original side'} · {c.simulationSeconds}s cap</p><button className={`${button} mt-1`} disabled={draft.cases.length === 1} onClick={() => changeDraft({ ...draft, cases: draft.cases.filter(other => other.id !== c.id) })}>Remove {c.id}</button></div>)}
          <p className="text-slate-400">Reselect a profile to restore its cases. Use manifest JSON to specify individual maps, seeds, opponents and durations.</p>
        </div>
      </details>}
      <details><summary className="cursor-pointer text-cyan-200">Manifest JSON</summary>
        <textarea aria-label="Validation manifest JSON" rows={6} className={`${input} mt-2 font-mono`} value={manifestText} onChange={e => setManifestText(e.target.value)} />
        <div className="flex flex-wrap gap-2 mt-2"><button className={button} disabled={!draft} onClick={() => setManifestText(JSON.stringify(draft, null, 2))}>Copy draft to editor</button>
          <button className={button} onClick={() => { try { if (manifestText.length > 512000) throw new Error('Manifest exceeds 512 KB'); const m = validateManifest(JSON.parse(manifestText)); changeDraft(m); setProfile(m.profile); setBaseline('manifest'); setCandidate('manifest'); } catch (e) { setError(String(e)); } }}>Use manifest</button></div>
      </details>
      {draft && <p className="text-slate-400 break-words">Required gates: {draft.requiredGates.join(', ')}.</p>}
      <button className={button} disabled={!draft} onClick={() => void freezeInputs()}>{freezing ? 'Freezing…' : 'Freeze inputs'}</button>
    </fieldset>
    {plan && <div className="rounded border border-cyan-800 bg-cyan-950/20 p-3 space-y-2" aria-label="Frozen validation inputs">
      <strong>{plan.preview.caseCount} cases · {plan.preview.jobCount} jobs · frozen</strong>
      <p>{plan.preview.maxSimulationSeconds.toLocaleString()} simulated seconds maximum. Wall-time estimate unavailable until calibrated; each case has a loading + execution watchdog.</p>
      <p>For different configurations, the CLI first runs an additional identical-baseline control matrix. Browser runs leave that control unverified.</p>
      <p>60 Hz · scripted bots · V2 medium · goal target {plan.manifest.mechanics.goalTarget}. Later Lab edits cannot change these inputs.</p>
      <details><summary className="cursor-pointer">Inspect frozen configuration and hashes</summary><pre className="overflow-auto max-h-64 text-[10px]">{JSON.stringify({ planId: plan.id, baseline: plan.manifest.baseline, candidate: plan.manifest.candidate, cases: plan.cases.map(c => ({ ...c.specification, inputHash: c.inputHash, mapHash: c.mapHash })) }, null, 2)}</pre></details>
      <button className={button} disabled={busy || lab.comparing} onClick={() => void execute(plan)}>Run suite</button>
    </div>}
    {busy && <div className="space-y-2" role="region" aria-label="Active validation run">
      <p role="status" className="text-cyan-200">{active?.status === 'paused' ? 'Paused between jobs' : pauseRequested ? 'Pause requested — finishing current job' : progress?.stage ?? 'Preparing'} · {active?.results.length ?? 0}/{active?.selectedJobIds.length ?? plan?.jobs.length ?? 0} jobs saved</p>
      <progress className="w-full accent-cyan-400" aria-label="Validation progress" value={active?.results.length ?? 0} max={active?.selectedJobIds.length || 1}/>
      {currentJob && <p className="break-words">{currentJob.caseId} · {currentJob.variant} · seed {currentJob.seed} · {currentJob.opponent} · {currentJob.mirrored ? 'mirrored' : 'original'} · {currentCase?.roster.length} scripted bots</p>}
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => { if (pauseRequested) control.current?.boundary.resume(); else control.current?.boundary.pause(); setPauseRequested(!pauseRequested); }}>{pauseRequested ? 'Resume suite' : 'Pause after job'}</button><button className={button} onClick={() => control.current?.abort.abort()}>Cancel suite</button></div>
      <ValidationArena trial={trial}/>
      <p className="text-slate-400">Closing the Lab cancels this run. For tick-by-tick diagnosis, use the Tuning view’s single-scenario step control.</p>
    </div>}
    {error && <p role="alert" className="rounded border border-rose-800 p-2 text-rose-200 break-words">{error}</p>}
    <section aria-label="Validation report history" className="border-t border-slate-700 pt-4 space-y-3">
      <h3 className="font-semibold text-sm">Saved reports</h3>
      <p className="text-slate-400">Newest 12 reports, up to 32 MiB total and 8 MiB each. Oldest reports are evicted as needed. Each report retains at most 1,024 trace frames (64 per trial). Export to keep evidence longer.</p>
      <select aria-label="Saved validation report" className={input} disabled={busy} value={selected?.id ?? ''} onChange={e => setSelected(runs.find(r => r.id === e.target.value) ?? null)}><option value="">Select a report…</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.plan.manifest.profile} · {r.source} · {r.results.length} trials</option>)}</select>
      <label className="block">Import Lab or CLI report JSON<input aria-label="Import validation report" type="file" accept=".json,application/json" className="block w-full mt-1" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        try { if (file.size > REPORT_BYTES) throw new Error('Import is limited to 8 MiB.'); const imported = await importLabRun(await file.text()); await saveLabRun(imported); setRuns(await listLabRuns()); setSelected(imported); setError(''); } catch (e) { setError(String(e)); }
      }}/></label>
      {runShown && report && <div className="space-y-3" role="region" aria-label="Validation report">
        <div className="rounded bg-slate-800 p-3 space-y-1 break-words"><p className="font-semibold">Suite: {report.verdict} · M7: {report.milestone7Verdict}</p><p>{checkpointLabel(runShown, busy)}</p><p>{runShown.results.length}/{runShown.plan.jobs.length} trials recorded · {runShown.source === 'imported' ? 'Imported reference only — excluded from current acceptance.' : 'Local browser evidence'}</p>{Boolean(runShown.cliPreviousFailures) && <p className="text-rose-200">Retained failed attempts: {runShown.cliPreviousFailures}</p>}<p>Build: {runShown.runtime.buildId ?? 'unverified browser build'} · 60 Hz · V2 medium</p><details><summary>Runtime and plan identity</summary><p>{runShown.runtime.userAgent}</p><p>Commit: {runShown.plan.code.commit ?? 'unverified'}</p><p>Plan: {runShown.plan.id}</p><p>Run: {runShown.id}{runShown.parentId ? ` · Rerun of ${runShown.parentId}` : ''}</p></details>{runShown.error && <p className="text-rose-200">{runShown.error}</p>}</div>
        <div className="flex flex-wrap gap-2"><button className={button} onClick={() => download(JSON.stringify(runShown, null, 2), `grifball-${runShown.id}.json`, 'application/json')}>Export report JSON</button><button className={button} onClick={() => download(readableLabReport(runShown), `grifball-${runShown.id}.txt`, 'text/plain')}>Download readable report</button><button className={button} disabled={busy} onClick={async () => { try { await deleteLabRun(runShown.id); const rows = await listLabRuns(); setRuns(rows); setSelected(rows[0] ?? null); } catch (e) { setError(String(e)); } }}>Delete report</button></div>
        <details open><summary className="text-amber-200 cursor-pointer">Missing required evidence · {report.missingRequired.length}</summary><ul className="list-disc pl-4 max-h-36 overflow-auto break-all mt-2">{report.missingRequired.map(id => <li key={id}>{id}</li>)}</ul></details>
        {['correctness', 'reproducibility', 'execution-parity', 'performance', 'quality', 'human-review'].map(id => {
          const gate = report.gates.find(g => g.id === id)!;
          return <div key={id} className="border-b border-slate-800 pb-2"><strong>{id === 'human-review' ? 'Human review' : id} · {gate.verdict}</strong><p className="text-slate-400">{gate.summary}{id === 'performance' ? ' Browser wall time is not a calibrated performance measurement.' : ''}</p></div>;
        })}
        <details><summary className="cursor-pointer text-cyan-200">Repository and UI gates</summary>{report.gates.filter(g => !['correctness', 'reproducibility', 'execution-parity', 'performance', 'quality', 'human-review'].includes(g.id)).map(g => <p key={g.id}>{g.id}: {g.verdict} · {g.summary}</p>)}</details>
        <h4 className="font-semibold">Case results</h4>
        {runShown.plan.cases.map(c => {
          const checks = report.jobs.filter(j => runShown.plan.jobs.find(job => job.id === j.id)?.caseId === c.specification.id);
          return <details key={c.specification.id} className="rounded border border-slate-700 p-2"><summary className="cursor-pointer break-words">{c.specification.id} · {checks.filter(j => j.state === 'completed').length}/{checks.length} completed · {checks.filter(j => j.verdict === 'fail').length} failed</summary>
            <p className="mt-2 text-slate-400">{c.specification.mapId} · {c.roster.length} scripted bots</p><button className={`${button} my-2`} disabled={busy} onClick={() => void rerun(c.specification.id)}>Rerun case {c.specification.id}</button>
            {checks.map(check => { const r = runShown.results.find(r => r.jobId === check.id); const j = runShown.plan.jobs.find(j => j.id === check.id)!;
              return <div key={check.id} className="border-t border-slate-800 py-2 space-y-1"><p>{j.variant} · {j.seed} · {j.opponent} · {j.mirrored ? 'mirrored' : 'original'}: {check.state} / {check.verdict}</p><p className="break-words">{check.summary}</p>{r && <p>{r.termination} · tick {r.end?.tick ?? 0} · score {r.end?.scores.blue ?? 0}–{r.end?.scores.red ?? 0} · {r.trace.length} trace frames ({r.droppedTraceEntries} omitted)</p>}<details><summary>Job identity and diagnostics</summary><p className="break-all">{check.id}</p>{r && <pre className="overflow-auto max-h-48 text-[10px]">{JSON.stringify(r, null, 2)}</pre>}</details></div>;
            })}
          </details>;
        })}
      </div>}
    </section>
  </section>;
}
