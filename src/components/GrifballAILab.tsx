import { useState, useSyncExternalStore } from 'react';
import { grifballLab, type LabScenario } from '../game/grifballLabStore';
import { defaultGrifballTactics, resolveTeamTactics, TACTICS_FIELDS, type TacticalNumber, type TeamTactics } from '../game/grifballTacticsConfig';

const button = 'rounded border border-slate-600 bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm min-w-0';
const tabs = ['Team roles', 'Spacing', 'Space / threats', 'Runner / escort', 'Tanking', 'Defense / passing', 'Styles'] as const;
const scenarios: Record<LabScenario, string> = { pickup: 'Contested pickup', escort: 'Runner escort', turnover: 'Possession turnover', outnumbered: 'Outnumbered defense', crowding: 'Shared hammer exposure', goal: 'Goal approach', lane: 'Runner lane pressure', pursuit: 'Rear pursuit', rendezvous: 'Coverage rendezvous' };

export function GrifballAILab({ onSetup, canSetup }: { onSetup: () => void; canSetup: boolean }) {
  const lab = useSyncExternalStore(grifballLab.subscribe, grifballLab.getSnapshot);
  const [scope, setScope] = useState<'both' | 'blue' | 'red'>('both');
  const [tab, setTab] = useState<(typeof tabs)[number]>('Team roles');
  const [collapsed, setCollapsed] = useState(false);
  const [name, setName] = useState('');
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [scenario, setScenario] = useState<LabScenario>('pickup');
  const [seed, setSeed] = useState(1);
  const [duration, setDuration] = useState(15);
  if (!lab.open) return null;
  const tuning = scope === 'both' ? lab.config.defaults : resolveTeamTactics(lab.config, scope);
  const safe = (action: () => void) => { try { action(); setError(''); } catch (e) { setError((e as Error).message); } };
  const edit = (patch: Partial<TeamTactics>) => safe(() => grifballLab.setConfig(scope === 'both'
    ? { ...lab.config, defaults: { ...lab.config.defaults, ...patch } }
    : { ...lab.config, teams: { ...lab.config.teams, [scope]: { ...lab.config.teams[scope], ...patch } } }));
  const resetModule = () => {
    const defaults = defaultGrifballTactics().defaults;
    const keys = tab === 'Runner / escort' ? ['runnerEnabled', ...Object.keys(TACTICS_FIELDS).filter(key => TACTICS_FIELDS[key as TacticalNumber].module === 'runner')] : tab === 'Space / threats' ? ['spaceEnabled', ...Object.keys(TACTICS_FIELDS).filter(key => TACTICS_FIELDS[key as TacticalNumber].module === 'space')] : tab === 'Team roles' ? ['enabled', 'preserveSlots', 'safetyFirst', 'refreshSeconds', 'reassignmentAdvantage'] : ['spacingEnabled', ...Object.keys(TACTICS_FIELDS).filter(key => TACTICS_FIELDS[key as TacticalNumber].module === 'spacing')];
    edit(Object.fromEntries(keys.map(key => [key, defaults[key as keyof TeamTactics]])));
  };
  const selected = lab.diagnostics?.assignments.find(a => a.botId === lab.selectedBot);
  const runnerPlay = lab.diagnostics?.runnerPlans.find(play => !selected || play.carrierId === selected.botId || play.carrierId === selected.carrierId);
  const module = tab === 'Team roles' ? 'roles' : tab === 'Space / threats' ? 'space' : tab === 'Runner / escort' ? 'runner' : 'spacing';
  const advanced = new Set(['runnerProgressWeight', 'runnerRiskWeight', 'runnerDangerMargin', 'runnerSwitchAdvantage', 'runnerCommitSeconds']);
  const renderFields = (expert: boolean) => Object.entries(TACTICS_FIELDS).filter(([key, field]) => field.module === module && advanced.has(key) === expert).map(([key, field]) => <label key={key} className="block space-y-1"><span className="flex justify-between text-sm"><span>{field.label}</span><span className="text-cyan-300">{tuning[key as TacticalNumber]} {field.unit}</span></span><input aria-label={field.label} type="range" className="w-full accent-cyan-400" min={field.min} max={field.max} step={field.step} value={tuning[key as TacticalNumber]} onChange={e => edit({ [key]: Number(e.target.value) })} /><span className="block text-xs text-slate-400">{field.description} Range {field.min}–{field.max}{field.unit ? ` ${field.unit}` : ''}; default {field.value}.</span></label>);

  return <aside aria-label="Grifball AI Lab" className="fixed right-0 top-0 z-[150] h-[100dvh] border-l border-cyan-500/30 bg-slate-950/95 text-slate-100 shadow-2xl flex flex-col select-text" style={{ width: collapsed ? 200 : 440, minWidth: collapsed ? 200 : 320, maxWidth: '100vw', resize: collapsed ? 'none' : 'horizontal', overflow: 'auto', direction: 'rtl' }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <div className="flex flex-col h-full min-h-0" style={{ direction: 'ltr' }}>
      <header className="p-4 border-b border-slate-700 flex items-center justify-between gap-2">
        <div><h2 className="font-bold text-cyan-300">Grifball AI Lab</h2><p className="text-xs text-slate-400">Offline tactical workspace</p></div>
        <button className={button} aria-label={collapsed ? 'Expand lab' : 'Collapse lab'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '+' : '−'}</button>
        <button className={button} aria-label="Close lab" onClick={() => grifballLab.close()}>×</button>
      </header>
      {!collapsed && <>
        <div className="p-3 border-b border-slate-700 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={!lab.connected} onClick={() => grifballLab.setRunning(!lab.running)}>{lab.running ? 'Pause' : 'Run'}</button>
            <button className={button} disabled={!lab.connected || lab.running || lab.comparing} onClick={() => grifballLab.command({ type: 'step' })}>Step 1/60 s</button>
            <button className={button} disabled={!lab.connected} onClick={() => grifballLab.command({ type: 'restart' })}>Restart scenario</button>
          </div>
          <p className="text-xs text-slate-400">{lab.connected ? `${lab.running ? 'Running' : 'Paused'} · ${lab.diagnostics?.metrics.seconds.toFixed(2) ?? '0.00'} s · edits apply at the next tick` : 'Tune here, then start an offline Grifball match to inspect and run scenarios.'}</p>
          {!lab.connected && canSetup && <button className={button} onClick={onSetup}>Set up Grifball match</button>}
          <p role="status" className="text-xs text-cyan-200">{lab.message}</p>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-5">
          <section aria-label="Tactical presets" className="space-y-2">
            <p className="text-sm font-semibold">{lab.activePreset}{JSON.stringify(lab.config) !== lab.savedConfig ? ' · Unsaved changes' : ' · Saved'}</p>
            <div className="flex gap-2"><select aria-label="Tactical preset" className={`${input} flex-1`} value="" onChange={e => grifballLab.selectPreset(e.target.value)}><option value="">Load local preset…</option>{lab.presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</select><button className={button} disabled={!lab.presets.some(p => p.name === lab.activePreset)} onClick={() => grifballLab.deletePreset(lab.activePreset)}>Delete</button></div>
            <div className="flex gap-2"><input aria-label="New tactical preset name" placeholder="Preset name" className={`${input} flex-1`} maxLength={80} value={name} onChange={e => setName(e.target.value)} /><button className={button} onClick={() => safe(() => grifballLab.savePreset(name))}>Save</button></div>
            <details><summary className="text-xs cursor-pointer text-cyan-300">Import / export JSON</summary><textarea aria-label="Tactical configuration JSON" className={`${input} w-full mt-2 font-mono text-xs`} rows={5} value={json} onChange={e => setJson(e.target.value)} /><div className="flex gap-2 mt-2"><button className={button} onClick={() => setJson(JSON.stringify(lab.config, null, 2))}>Export to text</button><button className={button} onClick={() => safe(() => { if (json.length > 64000) throw new Error('Configuration is too large.'); grifballLab.setConfig(JSON.parse(json)); })}>Import text</button></div><p className="text-xs text-slate-400 mt-2">Schema v3; v1 and v2 imports migrate automatically. Local to this browser; separate from combat presets and cloud saves.</p></details>
          </section>
          <section aria-label="Tactical modules" className="space-y-3">
            <label className="flex justify-between items-center text-sm">Edit scope<select className={input} value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="both">Both teams · defaults</option><option value="blue">Blue override</option><option value="red">Red override</option></select></label>
            <p className="text-xs text-slate-400">Team overrides take precedence over shared defaults. {scope !== 'both' ? `${Object.keys(lab.config.teams[scope] ?? {}).length} explicit overrides; remaining values inherit defaults.` : `Overrides: blue ${Object.keys(lab.config.teams.blue ?? {}).length}, red ${Object.keys(lab.config.teams.red ?? {}).length}.`}</p>
            {scope !== 'both' && <button className={button} onClick={() => safe(() => grifballLab.setConfig({ ...lab.config, teams: { ...lab.config.teams, [scope]: {} } }))}>Clear {scope} overrides</button>}
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="AI modules">{tabs.map((title, i) => <button key={title} role="tab" aria-selected={tab === title} className={`${button} ${tab === title ? 'border-cyan-400 text-cyan-300' : ''}`} onClick={() => setTab(title)}>{title}{i > 3 ? ' · Roadmap' : ''}</button>)}</div>
            <div role="tabpanel" aria-label={tab} className="space-y-4">
              {tab === 'Team roles' || tab === 'Spacing' || tab === 'Space / threats' || tab === 'Runner / escort' ? <fieldset disabled={lab.comparing} className="space-y-4">
                {(tab === 'Team roles' ? [
                  ['enabled', 'Team coordination', 'Off: independent ball recovery and carrier pursuit; no formation orders.'],
                  ['preserveSlots', 'Keep support assignments', 'Retain surviving support slots across position updates.'],
                  ['safetyFirst', 'Prioritize safety', 'Fill safety before lead pressure when fewer teammates are available.'],
                ] : tab === 'Runner / escort' ? [['runnerEnabled', 'Runner routes and coordinated escort', 'Requires Team coordination and Space / threats. Off: goal-directed runner movement and standard support positions.']] : tab === 'Space / threats' ? [['spaceEnabled', 'Space and threat model', 'Score reachable support positions using visible attacks, teammate support and escape space. Ground routes protect objective movement.']] : [['spacingEnabled', 'Custom spacing', 'Off: use standard formation offsets, separation and threat boundaries. Roles remain active.']]).map(([key, label, description]) => <label className="block text-sm" key={key}><span className="flex items-center gap-2"><input type="checkbox" checked={Boolean(tuning[key as keyof TeamTactics])} onChange={e => edit({ [key]: e.target.checked })} />{label}</span><span className="block text-xs text-slate-400 mt-1">{description}</span></label>)}
                {tab === 'Runner / escort' && (!tuning.enabled || !tuning.spaceEnabled) && <p className="text-xs text-amber-300">Inactive for this scope: enable Team coordination and Space / threats first.</p>}
                {renderFields(false)}
                {tab === 'Runner / escort' && <details><summary className="text-xs text-cyan-300 cursor-pointer">Advanced route weights</summary><div className="space-y-4 mt-3">{renderFields(true)}</div></details>}
                <div className="flex gap-2"><button className={button} onClick={resetModule}>Reset module</button><button className={button} onClick={() => safe(() => grifballLab.setConfig(defaultGrifballTactics()))}>Reset all teams</button></div>
              </fieldset> : <p className="text-sm text-slate-400">Planned for milestone {tab === 'Tanking' ? '4' : tab === 'Defense / passing' ? '5' : '6'}. Controls will appear when the behavior is implemented. Current escort offsets and safety depth are in Spacing.</p>}
            </div>
          </section>
          <section aria-label="Scenario controls" className="space-y-2 border-t border-slate-700 pt-4">
            <h3 className="font-semibold">Repeat a play</h3>
            <select aria-label="Scenario" className={`${input} w-full`} value={scenario} onChange={e => setScenario(e.target.value as LabScenario)}>{Object.entries(scenarios).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <label className="flex justify-between items-center text-xs">Random seed<input className={`${input} w-36`} type="number" min={0} max={4294967295} value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
            <p className="text-xs text-slate-400">Load uses the current map, roster and mechanics. Observer is the default. Join runner is exploratory; comparisons use scripted bots. Seed and scenario changes require Load.</p>
            <div className="flex flex-wrap gap-2"><button className={button} disabled={!lab.connected || lab.comparing} onClick={() => grifballLab.command({ type: 'scenario', scenario, seed })}>Load scenario</button><button className={button} disabled={!lab.connected || lab.comparing} onClick={() => grifballLab.command({ type: 'capture' })}>Capture current play</button><button className={button} disabled={!lab.connected || lab.comparing} onClick={() => grifballLab.command({ type: 'join' })}>Join runner</button></div>
          </section>
          <section aria-label="AI inspector" className="space-y-2 border-t border-slate-700 pt-4">
            <h3 className="font-semibold">Inspect decisions</h3>
            <div className="flex gap-2"><select aria-label="Inspect team" className={input} value={lab.selectedTeam} onChange={e => grifballLab.update({ selectedTeam: e.target.value, selectedBot: '' })}><option value="all">Both teams</option><option value="blue">Blue</option><option value="red">Red</option></select><select aria-label="Inspect bot" className={`${input} flex-1`} value={lab.selectedBot} onChange={e => grifballLab.update({ selectedBot: e.target.value })}><option value="">All bots</option>{lab.diagnostics?.assignments.filter(a => lab.selectedTeam === 'all' || a.team === lab.selectedTeam).map(a => <option key={a.botId} value={a.botId}>{a.botId} · {a.role}</option>)}</select></div>
            <div className="flex flex-wrap gap-3 text-xs">{Object.entries(lab.overlays).map(([key, enabled]) => <label key={key}><input type="checkbox" checked={enabled} onChange={e => grifballLab.update({ overlays: { ...lab.overlays, [key]: e.target.checked } })} /> {key}</label>)}</div>
            {selected && <div className="rounded bg-slate-800 p-3 text-xs space-y-1"><p>{selected.botId} · {selected.team} · {selected.role}</p><p>Destination: {selected.destination.x.toFixed(1)}, {selected.destination.z.toFixed(1)} m</p><p>Threat: {lab.diagnostics?.threats[selected.botId] ?? 'None'}</p><p>{selected.reason}</p>{selected.escort && <p>{selected.escort.kind} · target {selected.escort.targetId ?? 'clear lane'} · interception point {selected.escort.destination.x.toFixed(1)}, {selected.escort.destination.z.toFixed(1)}</p>}{selected.space && <><p>Route: {selected.space.route.status} · {selected.space.route.points.length} waypoints</p>{selected.space.selected && <><p>Enemy attack: {Number.isFinite(selected.space.selected.enemyETA) ? `${selected.space.selected.enemyETA.toFixed(2)} s` : 'No reachable threat'} · Ally support: {Number.isFinite(selected.space.selected.supportETA) ? `${selected.space.selected.supportETA.toFixed(2)} s` : 'Unavailable'}</p><p>Shared exposures: {selected.space.selected.sharedExposure} · Escape directions: {selected.space.selected.escape}/8 · Score: {selected.space.selected.score.toFixed(2)} (lower is better)</p></>}<details><summary className="cursor-pointer text-cyan-300">Candidate positions</summary><ul>{selected.space.candidates.map((c, i) => <li key={i}>{c.point.x.toFixed(1)}, {c.point.z.toFixed(1)}: {c.route === 'blocked' ? 'Blocked' : `${c.score.toFixed(2)} · ${c.sharedExposure} shared · ${c.escape}/8 exits`}</li>)}</ul></details><p className="text-slate-400">Ground-route and attack-time estimates; airborne repositioning is not modeled.</p></>}</div>}
            {runnerPlay && <div aria-label="Runner route decision" className="rounded bg-slate-800 p-3 text-xs space-y-2"><p className="font-semibold">Carrier {runnerPlay.carrierId}: {runnerPlay.selected.action}</p><p>{runnerPlay.reason}</p><p>Wait used {runnerPlay.waitUsed.toFixed(1)} s · Without progress {runnerPlay.stalledSeconds.toFixed(1)} s{runnerPlay.forcedProgress ? ' · Progress timeout active' : ''}</p><details><summary className="cursor-pointer text-cyan-300">Runner candidate routes</summary><ul className="space-y-1 mt-2">{runnerPlay.candidates.map((c, i) => <li key={i}>{c.action}: {Number.isFinite(c.score) ? `${c.score.toFixed(2)} score · ${c.risk.toFixed(2)} risk · ${c.progress.toFixed(1)} m progress` : 'Unavailable'} · {c.route.status}</li>)}</ul></details><p className="text-slate-400">Higher route scores are better. Estimates do not guarantee that a screen wins its fight.</p></div>}
            <details><summary className="cursor-pointer text-xs text-cyan-300">Recent decisions · last 100</summary><ol className="max-h-48 overflow-y-auto text-xs text-slate-400 space-y-2 mt-2">{lab.diagnostics?.history.filter(entry => !lab.selectedBot || entry.includes(`· ${lab.selectedBot} `)).slice().reverse().map((entry, i) => <li key={i}>{entry}</li>)}</ol></details>
          </section>
          <section aria-label="Compare configurations" className="space-y-2 border-t border-slate-700 pt-4">
            <h3 className="font-semibold">Compare baseline / candidate</h3>
            <button className={button} disabled={lab.comparing} onClick={() => grifballLab.pinBaseline()}>Pin current configuration as baseline</button>
            <p className="text-xs text-slate-400">{lab.baseline ? 'Baseline pinned. Editing the candidate leaves it unchanged.' : 'Pin a baseline, change settings, then run both against the same scenario.'}</p>
            {lab.baseline && <details><summary className="text-xs cursor-pointer text-cyan-300">Configuration differences</summary><pre className="text-xs whitespace-pre-wrap max-h-48 overflow-auto">{(['blue', 'red'] as const).flatMap(team => { const a = resolveTeamTactics(lab.baseline!, team); const b = resolveTeamTactics(lab.config, team); return (Object.keys(a) as (keyof TeamTactics)[]).filter(key => a[key] !== b[key]).map(key => `${team} ${key}: ${a[key]} → ${b[key]}`); }).join('\n') || 'No differences'}</pre></details>}
            <label className="flex items-center justify-between text-xs">Seconds per run<input type="number" className={`${input} w-24`} min={1} max={120} value={duration} onChange={e => setDuration(Number(e.target.value))} /></label>
            <button className={button} disabled={!lab.connected || !lab.baseline || lab.comparing} onClick={() => grifballLab.command({ type: 'compare', seconds: duration, scenario, seed, baseline: lab.baseline!, candidate: lab.config })}>Run sequential A/B</button>
            {lab.results.length === 2 && <><p className="text-xs">{lab.results[0].setup.map} · {lab.results[0].setup.roster.length} bots · {scenarios[lab.results[0].scenario]} · seed {lab.results[0].seed} · {lab.results[0].metrics.seconds.toFixed(2)} s each</p><table className="w-full text-xs"><thead><tr><th className="text-left">Metric</th><th>Baseline</th><th>Candidate</th></tr></thead><tbody>{(['goals', 'possessionLosses', 'roleChanges', 'outsideSeconds', 'botSeconds', 'stuckSeconds', 'sharedExposureSeconds', 'blockedRouteSeconds', 'runnerWaitSeconds', 'runnerRouteChanges'] as const).map(key => <tr key={key}><td className="py-1">{({ goals: 'Total goals', possessionLosses: 'Possession losses', roleChanges: 'Role changes', outsideSeconds: 'Outside coverage (bot·s)', botSeconds: 'Assigned alive (bot·s)', stuckSeconds: 'Stuck (bot·s)', sharedExposureSeconds: 'Shared exposure (bot·s)', blockedRouteSeconds: 'Blocked route (bot·s)', runnerWaitSeconds: 'Runner waiting (s)', runnerRouteChanges: 'Runner action changes' })[key]}</td>{lab.results.map((result, i) => <td key={i} className="text-center">{result.metrics[key].toFixed(2)}</td>)}</tr>)}</tbody></table><details><summary className="text-xs cursor-pointer text-cyan-300">Retained A/B report · copy JSON</summary><textarea aria-label="A/B results JSON" readOnly className={`${input} w-full mt-2 font-mono text-xs`} rows={6} value={JSON.stringify(lab.results, null, 2)} /></details></>}
            <details><summary className="text-xs cursor-pointer text-cyan-300">Metric definitions</summary><p className="text-xs text-slate-400 mt-2">Goals: both teams combined. Possession losses: holder changes during live play, excluding scoring. Role changes: changes after initial assignment. Coverage: seconds outside the configured boundary, summed over alive assigned bots. Stuck: bot seconds after at least one second below 0.1 m/s while more than 2 m from destination. Assigned alive bot seconds is the denominator for coverage and stuck time. Shared exposure: assigned bot seconds whose selected position shares a predicted hammer blast; blocked route: assigned bot seconds with no reachable ground route. Runner waiting counts scripted carrier seconds assigned to wait. Runner action changes count action switches during the same possession, not endpoint refreshes. These are diagnostic indicators, not a win-rate ranking.</p></details>
          </section>
        </div>
      </>}
    </div>
  </aside>;
}
