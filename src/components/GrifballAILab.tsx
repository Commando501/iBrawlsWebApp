import { GrifballValidationPanel } from './GrifballValidationPanel';
import { GrifballPlayerStyleControls } from './GrifballPlayerStyleControls';
import { GRIFBALL_PLAYER_STYLES, resolveGrifballPlayerStyle } from '../game/grifballPlayerStyles';
import { GrifballEvaluationPanel } from './GrifballEvaluationPanel';
import { useState, useSyncExternalStore } from 'react';
import { grifballLab, type LabScenario } from '../game/grifballLabStore';
import { defaultGrifballTactics, resolveTeamTactics, TACTICS_FIELDS, type TacticalNumber, type TeamTactics } from '../game/grifballTacticsConfig';

const button = 'rounded border border-slate-600 bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm min-w-0';
const tabs = ['Team roles', 'Spacing', 'Space / threats', 'Runner / escort', 'Tanking', 'Defense / passing', 'Styles', 'Player agency'] as const;
const scenarios: Record<LabScenario, string> = { pickup: 'Contested pickup', escort: 'Runner escort', turnover: 'Possession turnover', outnumbered: 'Outnumbered defense', crowding: 'Shared hammer exposure', goal: 'Goal approach', lane: 'Runner lane pressure', pursuit: 'Rear pursuit', rendezvous: 'Coverage rendezvous', tanking: 'Tank and cover', double: 'Two-player opening', breakthrough: 'Runner breakthrough', delay: 'Outnumbered delay', cut: 'Defend a runner cut', lastdefender: 'Last defender emergency', reinforcements: 'Respawn recovery', pass: 'Open passing lane', passdenied: 'Contested passing lane', stylematch: 'Style matchup', adaptation: 'Observe a compact approach' };

export function GrifballAILab({ onSetup, canSetup }: { onSetup: () => void; canSetup: boolean }) {
  const lab = useSyncExternalStore(grifballLab.subscribe, grifballLab.getSnapshot);
  const [scope, setScope] = useState<'both' | 'blue' | 'red'>('both');
  const [tab, setTab] = useState<(typeof tabs)[number]>('Team roles');
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<'tuning' | 'validation'>('tuning');
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
    const moduleKeys: Record<(typeof tabs)[number], (keyof TeamTactics)[]> = {
      'Team roles': ['enabled', 'preserveSlots', 'safetyFirst'], Spacing: ['spacingEnabled'],
      'Space / threats': ['spaceEnabled'], 'Runner / escort': ['runnerEnabled', 'runnerClashEnabled'], Tanking: ['tankingEnabled'],
      'Defense / passing': ['passSupportEnabled', 'passRecoveryEnabled', 'hammerDefenseEnabled', 'defenseEnabled', 'swordGuardEnabled', 'passingEnabled'], Styles: ['stylesEnabled', 'adaptationEnabled'],
      'Player agency': [],
    };
    const keys = [...moduleKeys[tab], ...Object.keys(TACTICS_FIELDS).filter(key => TACTICS_FIELDS[key as TacticalNumber].module === module)];
    edit(Object.fromEntries(keys.map(key => [key, defaults[key as keyof TeamTactics]])));
  };
  const selected = lab.diagnostics?.assignments.find(a => a.botId === lab.selectedBot);
  const runnerPlay = lab.diagnostics?.runnerPlans.find(play => !selected || play.carrierId === selected.botId || play.carrierId === selected.carrierId);
  const passPlay = selected?.pass ?? lab.diagnostics?.passPlans.find(p => !selected || p.selected?.receiverId === selected.botId);
  const seconds = (v: number) => Number.isFinite(v) ? `${v.toFixed(2)} s` : 'Unavailable';
  const module = tab === 'Player agency' ? 'agency' : tab === 'Styles' ? 'styles' : tab === 'Defense / passing' ? 'defense' : tab === 'Team roles' ? 'roles' : tab === 'Space / threats' ? 'space' : tab === 'Runner / escort' ? 'runner' : tab === 'Tanking' ? 'tanking' : 'spacing';
  const advanced = new Set(['adaptationConfidence', 'adaptationMinSamples', 'defenseRespawnWait', 'defenseTransitionSeconds', 'passThreatMargin', 'runnerProgressWeight', 'runnerRiskWeight', 'runnerDangerMargin', 'runnerSwitchAdvantage', 'runnerCommitSeconds', 'tankMinimumScore', 'tankProtectionWeight', 'tankOpeningWeight', 'tankDelayWeight', 'tankTradeWeight', 'tankCoverageWeight']);
  const renderFields = (expert: boolean) => Object.entries(TACTICS_FIELDS).filter(([key, field]) => field.module === module && advanced.has(key) === expert).map(([key, field]) => <label key={key} className="block space-y-1"><span className="flex justify-between text-sm"><span>{field.label}</span><span className="text-cyan-300">{tuning[key as TacticalNumber]} {field.unit}</span></span><input aria-label={field.label} type="range" className="w-full accent-cyan-400" min={field.min} max={field.max} step={field.step} value={tuning[key as TacticalNumber]} onChange={e => edit({ [key]: Number(e.target.value) })} /><span className="block text-xs text-slate-400">{field.description} Range {field.min}–{field.max}{field.unit ? ` ${field.unit}` : ''}; default {field.value}.</span></label>);

  return <>
    {lab.validating && <div className="fixed inset-0 z-[149] bg-black/20" aria-hidden="true" onPointerDown={e => e.stopPropagation()}/>}
    <aside aria-label="Grifball AI Lab" className="fixed right-0 top-0 z-[150] h-[100dvh] border-l border-cyan-500/30 bg-slate-950 text-slate-100 shadow-2xl flex flex-col select-text" style={{ width: collapsed ? 200 : 440, minWidth: collapsed ? 200 : 320, maxWidth: '100vw', resize: collapsed ? 'none' : 'horizontal', overflow: 'auto', direction: 'rtl' }} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <div className="flex flex-col h-full min-h-0" style={{ direction: 'ltr' }}>
      <header className="p-4 border-b border-slate-700 flex items-center justify-between gap-2">
        <div><h2 className="font-bold text-cyan-300">Grifball AI Lab</h2><p className="text-xs text-slate-400">Offline tactical workspace</p></div>
        <button className={button} aria-label={collapsed ? 'Expand lab' : 'Collapse lab'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '+' : '−'}</button>
        <button className={button} aria-label="Close lab" onClick={() => grifballLab.close()}>×</button>
      </header>
      {!collapsed && <div className="flex gap-2 p-3 border-b border-slate-700" role="tablist" aria-label="Lab workspace">
        <button className={button} role="tab" aria-selected={view === 'tuning'} onClick={() => setView('tuning')}>Tuning</button>
        <button className={button} role="tab" aria-selected={view === 'validation'} disabled={lab.comparing} onClick={() => setView('validation')}>Validation</button>
      </div>}
      <GrifballValidationPanel visible={!collapsed && view === 'validation'}/>
      {!collapsed && view === 'tuning' && <>
        <div className="p-3 border-b border-slate-700 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={!lab.connected || lab.validating} onClick={() => grifballLab.setRunning(!lab.running)}>{lab.running ? 'Pause' : 'Run'}</button>
            <button className={button} disabled={!lab.connected || lab.running || lab.comparing || lab.validating} onClick={() => grifballLab.command({ type: 'step' })}>Step 1/60 s</button>
            <button className={button} disabled={!lab.connected || lab.validating} onClick={() => grifballLab.command({ type: 'restart' })}>Restart scenario</button>
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
            <details><summary className="text-xs cursor-pointer text-cyan-300">Import / export JSON</summary><textarea aria-label="Tactical configuration JSON" className={`${input} w-full mt-2 font-mono text-xs`} rows={5} value={json} onChange={e => setJson(e.target.value)} /><div className="flex gap-2 mt-2"><button className={button} onClick={() => setJson(JSON.stringify(lab.config, null, 2))}>Export to text</button><button className={button} onClick={() => safe(() => { if (json.length > 64000) throw new Error('Configuration is too large.'); grifballLab.setConfig(JSON.parse(json)); })}>Import text</button></div><p className="text-xs text-slate-400 mt-2">Schema v{lab.config.schemaVersion}; v1–v26 imports migrate with loose-ball support positioning individuality off. Versions 1–25 also migrate with loose-ball recovery individuality off. Versions 1–24 also migrate with defensive marking individuality off. Versions 1–23 also migrate with runner patience individuality off. Versions 1–22 also migrate with engagement persistence individuality off. Versions 1–21 also migrate with double-team individuality off. Versions 1–20 also migrate with escort positioning individuality off. Versions 1–19 also migrate with pass landing support individuality off. Versions 1–18 also migrate with pass landing support off and cover depth 4 m. Versions 1–17 also migrate with pass recovery individuality off. Versions 1–16 also migrate with adaptive pass recovery off. Versions 1–15 also migrate with hammer defense individuality off. Versions 1–14 also migrate with hammer pass defense off. Versions 1–13 also migrate with sword defense individuality off. Versions 1–12 also migrate with sword punch awareness off. Versions 1–11 also migrate with counter individuality off. Versions 1–10 also migrate with punch-clash timing off. Versions 1–9 also migrate with passing individuality off. Versions 1–8 also migrate with defensive individuality off. Versions 1–7 also migrate with runner individuality off, and versions 1–6 with support initiative off. Local to this browser; separate from combat presets and cloud saves.</p></details>
          </section>
          <section aria-label="Tactical modules" className="space-y-3">
            <label className="flex justify-between items-center text-sm">Edit scope<select className={input} value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="both">Both teams · defaults</option><option value="blue">Blue override</option><option value="red">Red override</option></select></label>
            <p className="text-xs text-slate-400">Team overrides take precedence over shared defaults. {scope !== 'both' ? `${Object.keys(lab.config.teams[scope] ?? {}).length} explicit overrides; remaining values inherit defaults.` : `Overrides: blue ${Object.keys(lab.config.teams.blue ?? {}).length}, red ${Object.keys(lab.config.teams.red ?? {}).length}.`}</p>
            {scope !== 'both' && <button className={button} onClick={() => safe(() => grifballLab.setConfig({ ...lab.config, teams: { ...lab.config.teams, [scope]: {} } }))}>Clear {scope} overrides</button>}
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="AI modules">{tabs.map((title) => <button key={title} role="tab" aria-selected={tab === title} className={`${button} ${tab === title ? 'border-cyan-400 text-cyan-300' : ''}`} onClick={() => setTab(title)}>{title}</button>)}</div>
            <div role="tabpanel" aria-label={tab} className="space-y-4">
              {<fieldset disabled={lab.comparing} className="space-y-4">
                {(tab === 'Player agency' ? [] : tab === 'Styles' ? [['stylesEnabled', 'Team styles', 'Apply bounded preferences to enabled modules. Off: use module settings directly and clear style memory.'], ['adaptationEnabled', 'Learn opponent tendencies', 'Observe nearby movement before adapting. Off: clear evidence and keep the configured style.']] : tab === 'Team roles' ? [
                  ['enabled', 'Team coordination', 'Off: independent ball recovery and carrier pursuit; no formation orders.'],
                  ['preserveSlots', 'Keep support assignments', 'Retain surviving support slots across position updates.'],
                  ['safetyFirst', 'Prioritize safety', 'Fill safety before lead pressure when fewer teammates are available.'],
                ] : tab === 'Defense / passing' ? [['passSupportEnabled', 'Pass landing support', 'Keep a separate last defender and lateral cover around our released pass’s predicted landing area. Follows the assigned scripted receiver, including recovery handoffs. Requires coordination, space awareness, coordinated defense and passing. Off by default.'], ['passRecoveryEnabled', 'Adaptive pass recovery', 'Reassign a released pass when another scripted teammate can collect it sufficiently sooner. Uses the current ball trajectory after deflections and bounces. Requires coordination, space awareness and Pass and receive decisions. Off by default.'], ['hammerDefenseEnabled', 'Hammer pass defense', 'Ready grounded hammer defenders time a stationary strike against an observed enemy throw. Requires coordination, space awareness, coordinated defense and hammer ball deflection in match rules. Off by default.'], ['defenseEnabled', 'Coordinated defense', 'Requires Team coordination and Space / threats. Off: tanking and earlier goal-side coverage.'], ['swordGuardEnabled', 'Sword punch awareness', 'Ready grounded sword defenders give a visible runner punch room before resuming combat. Requires coordination, space awareness and coordinated defense. Off by default.'], ['passingEnabled', 'Pass and receive decisions', 'Requires Team coordination, Space / threats and throwing enabled in match rules. Off: carry the ball and use ordinary recovery.']] : tab === 'Tanking' ? [['tankingEnabled', 'Coordinated tanking', 'Requires Team coordination and Space / threats. Off: earlier escort target selection and normal combat coordination.']] : tab === 'Runner / escort' ? [['runnerEnabled', 'Runner routes and coordinated escort', 'Requires Team coordination and Space / threats. Off: goal-directed runner movement and standard support positions.'], ['runnerClashEnabled', 'Runner punch-clash timing', 'React to visible sword attacks with a timed punch. Requires coordination, space awareness and runner planning. Off: existing proximity punches.']] : tab === 'Space / threats' ? [['spaceEnabled', 'Space and threat model', 'Score reachable support positions using visible attacks, teammate support and escape space. Ground routes protect objective movement.']] : [['spacingEnabled', 'Custom spacing', 'Off: use standard formation offsets, separation and threat boundaries. Roles remain active.']]).map(([key, label, description]) => <label className="block text-sm" key={key}><span className="flex items-center gap-2"><input type="checkbox" checked={Boolean(tuning[key as keyof TeamTactics])} onChange={e => edit({ [key]: e.target.checked })} />{label}</span><span className="block text-xs text-slate-400 mt-1">{description}</span></label>)}
                {(tab === 'Runner / escort' || tab === 'Tanking' || tab === 'Defense / passing') && (!tuning.enabled || !tuning.spaceEnabled) && <p className="text-xs text-amber-300">Inactive for this scope: enable Team coordination and Space / threats first.</p>}
                {tab === 'Defense / passing' && tuning.passSupportEnabled && (!tuning.defenseEnabled || !tuning.passingEnabled) && <p className="text-xs text-amber-300">Pass landing support is inactive: enable Coordinated defense and Pass and receive decisions.</p>}
                {tab === 'Defense / passing' && tuning.passRecoveryEnabled && !tuning.passingEnabled && <p className="text-xs text-amber-300">Adaptive pass recovery is inactive: enable Pass and receive decisions.</p>}
                {tab === 'Defense / passing' && <p className="text-xs text-slate-400">Defense protects one last defender and predicts carrier cuts. Passes target a scripted receiver at the ball's settled recovery point; in-flight catches remain unavailable. {lab.diagnostics?.snapshot?.passing?.allowed === false ? 'Throwing is currently disabled in match rules.' : ''}</p>}
                {tab === 'Styles' && <>
                  <p className="text-xs text-slate-400">Preferences persist across possession changes. Variation only breaks near ties; live emergencies still override commitments. Tactical difficulty follows the scripted roster: easier teams refresh less often and use shorter motion projections. Mechanics are unchanged.</p>
                  {!tuning.enabled && <p className="text-xs text-amber-300">Enable Team coordination to activate styles.</p>}
                  <div className="flex flex-wrap gap-2">{([
                    ['Balanced', 0.5, 0.5, 0.5, 0.5, 0.5], ['Patient support', 0.25, 0.85, 0.7, 0.25, 0.25], ['Aggressive pressure', 0.85, 0.25, 0.35, 0.7, 0.7],
                  ] as const).map(([label, styleAggression, stylePatience, styleWidth, styleSupportDistance, styleRunnerRisk]) => <button key={label} className={button} onClick={() => edit({ styleAggression, stylePatience, styleWidth, styleSupportDistance, styleRunnerRisk })}>{label}</button>)}</div>
                </>}
                {tab === 'Player agency' && <>
                  <GrifballPlayerStyleControls bots={(lab.diagnostics?.snapshot?.players ?? []).filter(p => p.scripted).sort((a, b) => a.id.localeCompare(b.id))}
                    styles={lab.config.botStyles} onChange={(id, style) => safe(() => grifballLab.setConfig({ ...lab.config, botStyles: { ...lab.config.botStyles, [id]: style } }))}/>
                  {(!tuning.enabled || !tuning.spaceEnabled) && <p className="text-xs text-amber-300">These controls require Team coordination and Space and threat model for this scope.</p>}
                  {!tuning.tankingEnabled && <p className="text-xs text-amber-300">Support initiative also requires Coordinated tanking.</p>}
                  {!tuning.tankingEnabled && <p className="text-xs text-amber-300">Double-team individuality and Engagement persistence individuality require Coordinated tanking under Tanking.</p>}
                  {!tuning.defenseEnabled && <p className="text-xs text-amber-300">Defensive marking individuality and Loose-ball support positioning individuality require Coordinated defense under Defense / passing.</p>}
                  {!tuning.runnerEnabled && <p className="text-xs text-amber-300">Runner individuality and Runner patience individuality require Runner routes and coordinated escort.</p>}
                  {(!tuning.runnerEnabled || !tuning.runnerClashEnabled) && <p className="text-xs text-amber-300">Counter individuality requires Runner routes and Runner punch-clash timing under Runner / escort.</p>}
                  {!tuning.defenseEnabled && <p className="text-xs text-amber-300">Defensive individuality also requires Coordinated defense.</p>}
                  {(!tuning.defenseEnabled || !tuning.swordGuardEnabled) && <p className="text-xs text-amber-300">Sword defense individuality requires Coordinated defense and Sword punch awareness under Defense / passing.</p>}
                  {(!tuning.defenseEnabled || !tuning.hammerDefenseEnabled) && <p className="text-xs text-amber-300">Hammer defense individuality requires Coordinated defense and Hammer pass defense under Defense / passing.</p>}
                  {!tuning.passingEnabled && <p className="text-xs text-amber-300">Passing individuality also requires Pass and receive decisions and throwing enabled in the match rules.</p>}
                  {!tuning.runnerEnabled && <p className="text-xs text-amber-300">Escort positioning individuality requires Runner routes and coordinated escort under Runner / escort.</p>}
                  {(!tuning.passingEnabled || !tuning.defenseEnabled || !tuning.passSupportEnabled) && <p className="text-xs text-amber-300">Pass landing support individuality requires Pass landing support, Coordinated defense and Pass and receive decisions under Defense / passing.</p>}
                  {(!tuning.passingEnabled || !tuning.passRecoveryEnabled) && <p className="text-xs text-amber-300">Pass recovery individuality requires Pass and receive decisions and Adaptive pass recovery under Defense / passing.</p>}
                  <p className="text-xs text-slate-400">Raise a strength to try that part of the player style. Zero preserves its team decisions. Runner preferences retain route eligibility and progress timeouts. Support choices preserve recovery cover and pass receivers. Defensive choices preserve the earliest cut, last defender and emergency response. Passing preferences preserve charging and receiver safety; deflection checks follow match mechanics at every strength. Counter preferences retain readiness, punch duration and actual contact. Sword defense preferences retain active action ownership, clear retreat routes and immediate goal defense. Team scope changes the strengths; each player's style is shared across scopes.</p>
                </>}
                {renderFields(false)}
                {(tab === 'Styles' || tab === 'Runner / escort' || tab === 'Tanking' || tab === 'Defense / passing') && <details><summary className="text-xs text-cyan-300 cursor-pointer">{tab === 'Styles' ? 'Advanced adaptation settings' : tab === 'Defense / passing' ? 'Advanced defense and pass settings' : tab === 'Tanking' ? 'Advanced engagement weights' : 'Advanced route weights'}</summary><div className="space-y-4 mt-3">{renderFields(true)}</div></details>}
                <div className="flex gap-2"><button className={button} onClick={resetModule}>Reset module</button><button className={button} onClick={() => safe(() => grifballLab.setConfig(defaultGrifballTactics()))}>Reset all teams</button></div>
              </fieldset>}
            </div>
          </section>
          <section aria-label="Scenario controls" className="space-y-2 border-t border-slate-700 pt-4">
            <h3 className="font-semibold">Repeat a play</h3>
            <select aria-label="Scenario" className={`${input} w-full`} value={scenario} onChange={e => setScenario(e.target.value as LabScenario)}>{Object.entries(scenarios).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <label className="flex justify-between items-center text-xs">Random seed<input className={`${input} w-36`} type="number" min={0} max={4294967295} value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
            <p className="text-xs text-slate-400">Load uses the current map, roster and mechanics. Observer is the default. Join runner is exploratory; comparisons use scripted bots. Seed and scenario changes require Load.</p>
            <div className="flex flex-wrap gap-2"><button className={button} disabled={!lab.connected || lab.comparing || lab.validating} onClick={() => grifballLab.command({ type: 'scenario', scenario, seed })}>Load scenario</button><button className={button} disabled={!lab.connected || lab.comparing || lab.validating} onClick={() => grifballLab.command({ type: 'capture' })}>Capture current play</button><button className={button} disabled={!lab.connected || lab.comparing || lab.validating} onClick={() => grifballLab.command({ type: 'join' })}>Join runner</button></div>
          </section>
          <section aria-label="AI inspector" className="space-y-2 border-t border-slate-700 pt-4">
            <h3 className="font-semibold">Inspect decisions</h3>
            <div className="flex gap-2"><select aria-label="Inspect team" className={input} value={lab.selectedTeam} onChange={e => grifballLab.update({ selectedTeam: e.target.value, selectedBot: '' })}><option value="all">Both teams</option><option value="blue">Blue</option><option value="red">Red</option></select><select aria-label="Inspect bot" className={`${input} flex-1`} value={lab.selectedBot} onChange={e => grifballLab.update({ selectedBot: e.target.value })}><option value="">All bots</option>{lab.diagnostics?.assignments.filter(a => lab.selectedTeam === 'all' || a.team === lab.selectedTeam).map(a => <option key={a.botId} value={a.botId}>{a.botId} · {a.role}</option>)}</select></div>
            <div className="flex flex-wrap gap-3 text-xs">{Object.entries(lab.overlays).map(([key, enabled]) => <label key={key}><input type="checkbox" checked={enabled} onChange={e => grifballLab.update({ overlays: { ...lab.overlays, [key]: e.target.checked } })} /> {key}</label>)}</div>
            {lab.diagnostics?.stylePlans.filter(style => selected ? style.team === selected.team : lab.selectedTeam === 'all' || style.team === lab.selectedTeam).map(style => <div key={style.team} aria-label={`${style.team} team style`} className="rounded bg-slate-800 p-3 text-xs space-y-1">
              <p className="font-semibold">{style.team} · {style.label}</p><p>{style.reason}</p>
              <p>Confidence {(style.confidence * 100).toFixed(0)}% · {style.observations}/24 recent observations · {style.adapting ? 'Adaptation active' : 'Base style'}</p>
              <p>Observed approach {(style.pressure * 100).toFixed(0)}% · Lane width {(style.opponentWidth * 100).toFixed(0)}%</p>
              <p>Effective preferences: aggression {style.preferences.aggression.toFixed(2)} · patience {style.preferences.patience.toFixed(2)} · width {style.preferences.width.toFixed(2)} · support distance {style.preferences.supportDistance.toFixed(2)} · runner risk {style.preferences.runnerRisk.toFixed(2)}</p>
              <p>Tactical refresh {seconds(style.refreshSeconds)} · Prediction {(style.predictionScale * 100).toFixed(0)}% · Near-tie window {style.variation.toFixed(2)} score</p>
            </div>)}
            {selected && <div className="rounded bg-slate-800 p-3 text-xs space-y-1"><p>{selected.botId} · {selected.team} · {selected.role}</p><p>Destination: {selected.destination.x.toFixed(1)}, {selected.destination.z.toFixed(1)} m</p><p>Threat: {lab.diagnostics?.threats[selected.botId] ?? 'None'}</p><p>{selected.reason}</p>{selected.defense && <div aria-label="Defense decision" className="border-t border-slate-600 pt-2 space-y-1"><p className="font-semibold">{selected.defense.mode} · {selected.defense.emergency ? 'Goal emergency' : 'Defensive coverage'}</p><p>Mark: {selected.defense.targetId ?? 'Ball recovery'} · Alive advantage: {selected.defense.advantage}</p><p>Intercept: {selected.defense.intercept.x.toFixed(1)}, {selected.defense.intercept.z.toFixed(1)} m · Attack arrival: {seconds(selected.defense.arrivalETA)}</p><p>Carrier projection: {seconds(selected.defense.carrierETA)} · Reinforcements: {seconds(selected.defense.reinforcementIn)}{selected.defense.transitioning ? ' · Turnover recovery' : ''}</p></div>}{selected.receive && <p>Receive at {selected.receive.point.x.toFixed(1)}, {selected.receive.point.z.toFixed(1)} m · Ball settles in {seconds(selected.receive.seconds)}</p>}{selected.tanking && <div aria-label="Tanking decision" className="border-t border-slate-600 pt-2 space-y-1"><p className="font-semibold">{selected.tanking.mode} · {selected.tanking.attack ? 'Combat allowed' : 'Hold coverage'}</p><p>{selected.tanking.reason}</p><p>Target: {selected.tanking.targetId ?? 'None'} · Partner: {selected.tanking.partnerId ?? 'None'} · Recovery: {selected.tanking.recoveryId ?? 'Solo'}</p>{selected.tanking.doubleCommit && <p className="text-orange-300">Two-player commit</p>}<details><summary className="cursor-pointer text-cyan-300">Engagement candidates</summary><ul className="space-y-2 mt-2">{selected.tanking.candidates.map(c => <li key={c.targetId}>{c.targetId}: {Number.isFinite(c.score) ? c.score.toFixed(2) : 'Unavailable'}<br />Protection {c.protection.toFixed(2)} · Opening {c.opening.toFixed(2)} · Delay {c.delay.toFixed(2)} · Trade {c.trade.toFixed(2)} · Coverage lost {c.coverageLost.toFixed(2)}</li>)}</ul></details><p className="text-slate-400">Higher engagement scores are better. Cover and delay may still defend against immediate attacks.</p></div>}{selected.escort && <p>{selected.escort.kind} · target {selected.escort.targetId ?? 'clear lane'} · interception point {selected.escort.destination.x.toFixed(1)}, {selected.escort.destination.z.toFixed(1)}</p>}{selected.space && <><p>Route: {selected.space.route.status} · {selected.space.route.points.length} waypoints</p>{selected.space.selected && <><p>Enemy attack: {Number.isFinite(selected.space.selected.enemyETA) ? `${selected.space.selected.enemyETA.toFixed(2)} s` : 'No reachable threat'} · Ally support: {Number.isFinite(selected.space.selected.supportETA) ? `${selected.space.selected.supportETA.toFixed(2)} s` : 'Unavailable'}</p><p>Shared exposures: {selected.space.selected.sharedExposure} · Escape directions: {selected.space.selected.escape}/8 · Score: {selected.space.selected.score.toFixed(2)} (lower is better)</p></>}<details><summary className="cursor-pointer text-cyan-300">Candidate positions</summary><ul>{selected.space.candidates.map((c, i) => <li key={i}>{c.point.x.toFixed(1)}, {c.point.z.toFixed(1)}: {c.route === 'blocked' ? 'Blocked' : `${c.score.toFixed(2)} · ${c.sharedExposure} shared · ${c.escape}/8 exits`}</li>)}</ul></details><p className="text-slate-400">Ground-route and attack-time estimates; airborne repositioning is not modeled.</p></>}</div>}
            {selected?.defense?.pickupSupport && <div aria-label="Loose-ball support positioning individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.defense.pickupSupport.style].label} · strength {selected.defense.pickupSupport.strength.toFixed(1)} · {selected.defense.pickupSupport.applied ? 'Personal support position' : 'Team support position retained'}</p>
              <p>Retriever: {selected.defense.pickupSupport.retrieverId} · {selected.defense.pickupSupport.reason}</p>
              <p>Team position {selected.defense.pickupSupport.teamPoint.x.toFixed(1)}, {selected.defense.pickupSupport.teamPoint.z.toFixed(1)} m · Preferred {selected.defense.pickupSupport.preferredPoint.x.toFixed(1)}, {selected.defense.pickupSupport.preferredPoint.z.toFixed(1)} m</p>
              <p>Arrival: team {seconds(selected.defense.pickupSupport.teamArrival)} · preferred {seconds(selected.defense.pickupSupport.preferredArrival)}</p>
              <p>Attack margin: team {seconds(selected.defense.pickupSupport.teamAttackMargin)} · preferred {seconds(selected.defense.pickupSupport.preferredAttackMargin)}</p>
              <p>Retriever route clearance: team {selected.defense.pickupSupport.teamClearance.toFixed(2)} m · preferred {selected.defense.pickupSupport.preferredClearance.toFixed(2)} m</p>
              <p className="text-slate-400">Estimates at the last refresh. The team keeps the retriever and last defender; moving contacts and combat can change the outcome.</p>
            </div>}
            {selected?.pickupAgency && <div aria-label="Loose-ball recovery individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">Loose-ball recovery · strength {selected.pickupAgency.strength.toFixed(1)}</p>
              <p>Team retriever: {selected.pickupAgency.teamRetrieverId} · Selected: {selected.pickupAgency.retrieverId}</p>
              <p>{selected.pickupAgency.reason}</p>
              <p>Opponent arrival: {seconds(selected.pickupAgency.enemyArrival)} · attack at ball: {seconds(selected.pickupAgency.enemyAttack)}</p>
              <details><summary className="cursor-pointer text-cyan-300">Pickup candidates</summary><ul className="mt-2 space-y-2">{selected.pickupAgency.candidates.map(c => <li key={c.botId}>
                {c.botId} · {GRIFBALL_PLAYER_STYLES[c.style].label} · {c.eligible ? 'Eligible' : 'Team rules take priority'}<br />
                Arrival {seconds(c.arrival)} · style adjustment {c.bonus.toFixed(2)} s · commitment {seconds(c.commitment)}<br />{c.reason}
              </li>)}</ul></details>
              <p className="text-slate-400">Route-arrival estimates at the last refresh. Positive style adjustments favor a claim; movement and pickup mechanics are unchanged.</p>
            </div>}
            {selected?.defense?.positioning && <div aria-label="Defensive marking individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.defense.positioning.style].label} · strength {selected.defense.positioning.strength.toFixed(1)} · {selected.defense.positioning.applied ? 'Personal mark' : 'Team mark retained'}</p>
              <p>Marked opponent: {selected.defense.targetId}</p><p>{selected.defense.positioning.reason}</p>
              <p>Team position {selected.defense.positioning.teamPoint.x.toFixed(1)}, {selected.defense.positioning.teamPoint.z.toFixed(1)} m · Preferred {selected.defense.positioning.preferredPoint.x.toFixed(1)}, {selected.defense.positioning.preferredPoint.z.toFixed(1)} m</p>
              <p>Arrival: team {seconds(selected.defense.positioning.teamArrival)} · preferred {seconds(selected.defense.positioning.preferredArrival)}</p>
              <p>Attack margin: team {seconds(selected.defense.positioning.teamAttackMargin)} · preferred {seconds(selected.defense.positioning.preferredAttackMargin)}</p>
              <p>Response from position: team {seconds(selected.defense.positioning.teamResponse)} · preferred {seconds(selected.defense.positioning.preferredResponse)}</p>
              <p className="text-slate-400">Estimates at the last tactical refresh; future movement and contacts can change coverage.</p>
            </div>}
            {selected?.runner?.patience && <div aria-label="Runner patience individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.runner.patience.style].label} · strength {selected.runner.patience.strength.toFixed(1)} · {selected.runner.selected.action}</p>
              <p>{selected.runner.patience.preference}</p><p>{selected.runner.reason}</p>
              <p>Wait / retreat allowance: team {seconds(selected.runner.patience.teamMaxWait)} · personal {seconds(selected.runner.patience.maxWait)}</p>
              <p>Remaining at last refresh: wait {seconds(selected.runner.patience.remainingWait)} · retreat {seconds(selected.runner.patience.remainingRetreat)}</p>
              <p>Escort rendezvous {seconds(selected.runner.patience.rendezvousETA)} · progress deadline in {seconds(selected.runner.patience.progressRemaining)}</p>
              <p className="text-slate-400">Waiting needs timely scripted support and acceptable exposure. Wait and retreat track separate cumulative allowances. Only real net progress replenishes them; style edits leave spent time intact.</p>
            </div>}
            {selected?.tanking?.persistence && <div aria-label="Engagement persistence individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.tanking.persistence.style].label} · strength {selected.tanking.persistence.strength.toFixed(1)}</p>
              <p>{selected.tanking.persistence.preference}</p><p>{selected.tanking.reason}</p>
              <p>New primary commitment: team {seconds(selected.tanking.persistence.teamCommitSeconds)} · personal {seconds(selected.tanking.persistence.commitSeconds)}</p>
              <p>New coverage break: team {seconds(selected.tanking.persistence.teamReleaseSeconds)} · personal {seconds(selected.tanking.persistence.releaseSeconds)}</p>
              <p>At last tactical refresh: commitment {seconds(selected.tanking.persistence.commitRemaining)} · coverage break {seconds(selected.tanking.persistence.releaseRemaining)}</p>
              <p className="text-slate-400">Commitment protects a useful primary assignment through small score changes. Recovery rotation and lost purpose can end it sooner. Coverage breaks also apply after separate initiatives; immediate self-defense remains available.</p>
            </div>}
            {selected?.tanking?.doubleTeam && <div aria-label="Double-team individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.tanking.doubleTeam.style].label} · strength {selected.tanking.doubleTeam.strength.toFixed(1)} · {selected.tanking.doubleCommit ? 'Join the tank' : 'Keep covering'}</p>
              <p>{selected.tanking.doubleTeam.preference}</p><p>{selected.tanking.reason}</p>
              <p>Value threshold: team {selected.tanking.doubleTeam.teamThreshold.toFixed(2)} · personal {selected.tanking.doubleTeam.threshold.toFixed(2)} · candidate {selected.tanking.doubleTeam.score.toFixed(2)}</p>
              <p>Recovery cushion: team {seconds(selected.tanking.doubleTeam.teamRecoveryMargin)} · personal {seconds(selected.tanking.doubleTeam.recoveryMargin)}</p>
              <p>Attack arrival {seconds(selected.tanking.doubleTeam.attackETA)} · opponent next attack {seconds(selected.tanking.doubleTeam.opponentAttackETA)}</p>
              <p className="text-slate-400">The supporting tank owns this preference. Recovery coverage, clear routes and hammer separation still gate joining; new attacks recheck the remaining recovery window.</p>
            </div>}
            {selected?.escortPosition && <div aria-label="Escort positioning individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.escortPosition.style].label} · strength {selected.escortPosition.strength.toFixed(1)} · {selected.escortPosition.applied ? 'Personal escort position' : 'Team position retained'}</p>
              <p>{selected.escortPosition.reason}</p>
              <p>Team position {selected.escortPosition.teamPoint.x.toFixed(1)}, {selected.escortPosition.teamPoint.z.toFixed(1)} m · Preferred {selected.escortPosition.preferredPoint.x.toFixed(1)}, {selected.escortPosition.preferredPoint.z.toFixed(1)} m</p>
              <p>Arrival: team {seconds(selected.escortPosition.teamArrival)} · preferred {seconds(selected.escortPosition.preferredArrival)}</p>
              <p className="text-slate-400">Pass receivers, rear coverage and engagement jobs retain priority. Estimates use the current runner route and visible threats.</p>
            </div>}
            {selected?.defense?.passSupport && <div aria-label="Pass landing support decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">Pass landing support · {selected.defense.mode}</p>
              <p>Receiver: {selected.defense.passSupport.receiverId}</p>
              {selected.defense.passSupport.individuality && <div aria-label="Pass landing support individuality decision" className="border-t border-slate-600 pt-2 space-y-1">
                <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.defense.passSupport.individuality.style].label} · strength {selected.defense.passSupport.individuality.strength.toFixed(1)} · {selected.defense.passSupport.individuality.applied ? 'Personal cover' : 'Team cover retained'}</p>
                <p>{selected.defense.passSupport.individuality.reason}</p>
                <p>Team position {selected.defense.passSupport.individuality.teamPoint.x.toFixed(1)}, {selected.defense.passSupport.individuality.teamPoint.z.toFixed(1)} m · Preferred {selected.defense.passSupport.individuality.preferredPoint.x.toFixed(1)}, {selected.defense.passSupport.individuality.preferredPoint.z.toFixed(1)} m</p>
                <p>Arrival: team {seconds(selected.defense.passSupport.individuality.teamArrival)} · preferred {seconds(selected.defense.passSupport.individuality.preferredArrival)}</p>
                <p className="text-slate-400">The receiver and last defender keep their jobs. Ground routing, cover timing, visible attacks and teammate spacing can retain the team position.</p>
              </div>}
              <p>Landing area {selected.defense.passSupport.point.x.toFixed(1)}, {selected.defense.passSupport.point.z.toFixed(1)} m · Ball settles in {seconds(selected.defense.passSupport.settleIn)}</p>
              <p>{selected.reason}</p>
              <p className="text-slate-400">Coverage updates on tactical refresh. Future body and weapon contacts can change the landing estimate.</p>
            </div>}
            {selected?.passRecovery && <div aria-label="Pass recovery decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">Adaptive pass recovery · {selected.passRecovery.action}</p>
              <p>{selected.passRecovery.reason}</p>
              <p>Receiver {selected.passRecovery.previousReceiverId} → {selected.passRecovery.receiverId ?? 'Ordinary recovery'}</p>
              <p>Recovery point {selected.passRecovery.point.x.toFixed(1)}, {selected.passRecovery.point.z.toFixed(1)} m · Ball settles in {seconds(selected.passRecovery.settleIn)}</p>
              <p>Required pickup advantage {seconds(selected.passRecovery.requiredAdvantage)}</p>
              {selected.passRecovery.individuality && <div aria-label="Pass recovery individuality decision" className="border-t border-slate-600 pt-2 space-y-1">
                <p className="font-semibold">Receiver {selected.passRecovery.previousReceiverId} · {GRIFBALL_PLAYER_STYLES[selected.passRecovery.individuality.style].label} · strength {selected.passRecovery.individuality.strength.toFixed(1)}</p>
                <p>{selected.passRecovery.individuality.reason}</p>
                <p>Handoff margin {seconds(selected.passRecovery.individuality.teamAdvantage)} → {seconds(selected.passRecovery.requiredAdvantage)}</p>
                <p>Unavailable receivers still yield. The replacement uses its own style at the next decision.</p>
              </div>}
              <ul>{selected.passRecovery.candidates.map(c => <li key={c.id}>{c.id}: arrive {seconds(c.arrivalETA)} · collect {seconds(c.pickupETA)} · {c.reason}</li>)}</ul>
              <p className="text-slate-400">Rechecked on tactical refresh. Future body and weapon contacts can change the estimate.</p>
            </div>}
            {selected?.defense?.individuality && <div aria-label="Defensive individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.defense.individuality.style].label} · strength {selected.defense.individuality.strength.toFixed(1)}</p>
              <p>{selected.defense.individuality.reason}</p>
              {selected.defense.individuality.marking && <p>Coverage cost {selected.defense.individuality.marking.baseCost.toFixed(2)} m · Style discount {selected.defense.individuality.marking.bonus.toFixed(2)} m{selected.defense.individuality.marking.recoveryOpening ? ' · Reachable recovery window' : ''}</p>}
              {selected.defense.individuality.pressureCandidates && <details><summary className="cursor-pointer text-cyan-300">Defensive pressure candidates</summary><ul className="mt-2 space-y-2">
                {selected.defense.individuality.pressureCandidates.map(c => <li key={c.botId}>{c.botId} · {GRIFBALL_PLAYER_STYLES[c.style].label}<br />Arrival {seconds(c.arrival)} · Style discount {c.bonus.toFixed(2)} s{c.recoveryOpening ? ' · Reachable recovery window' : ''}<br />{c.reason}</li>)}
              </ul><p className="mt-2 text-slate-400">Lowest adjusted cost wins among eligible defenders at the same earliest cut. Preferences do not change actual arrival times.</p></details>}
            </div>}
            {selected?.hammerDefense && <div aria-label="Hammer pass defense decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">Hammer pass defense · {selected.hammerDefense.action}</p><p>{selected.hammerDefense.reason}</p>
              <p>Observed throw age {seconds(selected.hammerDefense.throwAge)} · Reaction delay {seconds(selected.hammerDefense.reaction)}</p>
              {selected.hammerDefense.predictedBall && <p>Predicted strike in {seconds(selected.hammerDefense.impactIn)} · Ball height {selected.hammerDefense.predictedBall.y.toFixed(2)} m</p>}
              {selected.hammerDefense.individuality && <div aria-label="Hammer defense individuality decision" className="border-t border-slate-600 pt-2 space-y-1">
                <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.hammerDefense.individuality.style].label} · strength {selected.hammerDefense.individuality.strength.toFixed(1)}</p>
                <p>{selected.hammerDefense.individuality.reason}</p>
                <p>Team reaction {seconds(selected.hammerDefense.individuality.teamReaction)} → effective {seconds(selected.hammerDefense.reaction)}</p>
                <p>Contact margin {selected.hammerDefense.individuality.teamMargin.toFixed(2)} → {selected.hammerDefense.individuality.margin.toFixed(2)} m inside the blast boundary</p>
              </div>}
            </div>}
            {selected?.swordGuard && <div aria-label="Sword punch awareness decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">Sword defense · {selected.swordGuard.action}</p><p>{selected.swordGuard.reason}</p>
              <p>Runner: {selected.swordGuard.targetId} · Reaction delay {seconds(selected.swordGuard.reaction)}</p>
              <p>Observed punch age {seconds(selected.swordGuard.punchAge)} · Active time left {seconds(selected.swordGuard.punchRemaining)}</p>
              {selected.swordGuard.individuality && <div aria-label="Sword defense individuality decision" className="border-t border-slate-600 pt-2 space-y-1">
                <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.swordGuard.individuality.style].label} · strength {selected.swordGuard.individuality.strength.toFixed(1)}</p>
                <p>{selected.swordGuard.individuality.reason}</p>
                <p>Team reaction {seconds(selected.swordGuard.individuality.teamReaction)} → Effective {seconds(selected.swordGuard.reaction)}<br />Extra punch clearance {selected.swordGuard.individuality.teamClearance.toFixed(2)} m → {selected.swordGuard.individuality.clearance.toFixed(2)} m</p>
              </div>}
            </div>}
            {selected?.runnerClash && <div aria-label="Runner punch-clash decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">Punch clash · {selected.runnerClash.action}</p><p>{selected.runnerClash.reason}</p>
              <p>Target: {selected.runnerClash.targetId ?? 'None'} · Reaction delay {seconds(selected.runnerClash.reaction)} · Counter window {seconds(selected.runnerClash.window)}</p>
              {selected.runnerClash.individuality && <div aria-label="Counter individuality decision" className="border-t border-slate-600 pt-2 space-y-1">
                <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.runnerClash.individuality.style].label} · strength {selected.runnerClash.individuality.strength.toFixed(1)}</p>
                <p>{selected.runnerClash.individuality.reason}</p>
                <p>Team reaction {seconds(selected.runnerClash.individuality.teamReaction)} → Effective {seconds(selected.runnerClash.reaction)}<br />Team window {seconds(selected.runnerClash.individuality.teamWindow)} → Effective {seconds(selected.runnerClash.window)}</p>
                {selected.runnerClash.window < selected.runnerClash.individuality.preferredWindow && <p>Counter window limited by the current punch duration.</p>}
                <p className="text-slate-400">At full strength: Enforcer window +0.03 s, Opportunist window −0.03 s, Guardian reaction −0.02 s. Earlier commitment can be wasted; later counters leave less margin.</p>
              </div>}
              {selected.runnerClash.impactIn !== undefined && <p>Observed attack age {seconds(selected.runnerClash.attackAge!)} · Estimated contact {seconds(selected.runnerClash.impactIn)}</p>}
              <p className="text-slate-400">Last grounded decision. A timed punch still needs actual contact; facing, movement and other attacks can defeat the estimate.</p>
            </div>}
            {passPlay?.individuality && <div aria-label="Passing individuality decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[passPlay.individuality.style].label} · strength {passPlay.individuality.strength.toFixed(1)}</p><p>{passPlay.individuality.reason}</p>
              <p>Preferences adjust eligible pass scores by at most three points. Charging, pickup and receiver safety remain required. Hammer-deflection checks follow the match mechanics even when individuality is zero.</p>
            </div>}
            {passPlay && <div aria-label="Passing decision" className="rounded bg-slate-800 p-3 text-xs space-y-2"><p className="font-semibold">{passPlay.carrierId} · {passPlay.reason}</p>{passPlay.selected && <p>Receiver: {passPlay.selected.receiverId} · Speed: {passPlay.selected.speed.toFixed(1)} m/s · Charge: {seconds(passPlay.selected.chargeSeconds)} · Settle: {seconds(passPlay.selected.seconds)}</p>}<details><summary className="cursor-pointer text-cyan-300">Pass candidates ({passPlay.candidates.length})</summary><ul className="space-y-2 mt-2">{passPlay.candidates.map((c, i) => <li key={i}>{c.receiverId} · {c.speed.toFixed(1)} m/s · {c.reason}<br />Receiver {seconds(c.receiverETA)} · Opponent pickup {seconds(c.opponentETA)} · Attack {seconds(c.attackETA)} · Progress {c.progress.toFixed(1)} m{c.deflection && <span className="block text-amber-200">Possible deflection by {c.deflection.botId}: ball in {seconds(c.deflection.ballIn)}, attack ready in {seconds(c.deflection.attackIn)}</span>}{c.individuality && <span className="block text-slate-400">Team score {c.individuality.baseScore.toFixed(2)} · Style {c.individuality.bonus >= 0 ? '+' : ''}{c.individuality.bonus.toFixed(2)} · {c.viable ? 'Eligible' : 'Unavailable'}</span>}</li>)}</ul></details></div>}
            {runnerPlay && <div aria-label="Runner route decision" className="rounded bg-slate-800 p-3 text-xs space-y-2"><p className="font-semibold">Carrier {runnerPlay.carrierId}: {runnerPlay.selected.action}</p><p>{runnerPlay.reason}</p>{runnerPlay.individuality && <div aria-label="Runner individuality decision" className="border-t border-slate-600 pt-2 space-y-1"><p className="font-semibold">{GRIFBALL_PLAYER_STYLES[runnerPlay.individuality.style].label} · strength {runnerPlay.individuality.strength.toFixed(1)}</p><p>{runnerPlay.individuality.reason}</p><p>Preferences adjust eligible route scores by at most three points at full strength.</p></div>}<p>Wait used {runnerPlay.waitUsed.toFixed(1)} s · Without progress {runnerPlay.stalledSeconds.toFixed(1)} s{runnerPlay.forcedProgress ? ' · Progress timeout active' : ''}</p><details><summary className="cursor-pointer text-cyan-300">Runner candidate routes</summary><ul className="space-y-1 mt-2">{runnerPlay.candidates.map((c, i) => <li key={i}>{c.action}: {Number.isFinite(c.score) ? `${c.score.toFixed(2)} score · ${c.risk.toFixed(2)} risk · ${c.progress.toFixed(1)} m progress` : 'Unavailable'} · {c.route.status}{c.individuality && Number.isFinite(c.score) && <span className="block text-slate-400">Team score {c.individuality.baseScore.toFixed(2)} · Style {c.individuality.bonus >= 0 ? '+' : ''}{c.individuality.bonus.toFixed(2)} · Recovery opening {c.individuality.recoveryOpening.toFixed(2)}</span>}</li>)}</ul></details><p className="text-slate-400">Higher route scores are better. Estimates do not guarantee that a screen wins its fight.</p></div>}
            {selected?.agency && <div aria-label="Player agency decision" className="rounded bg-slate-800 p-3 text-xs space-y-2">
              <p className="font-semibold">{GRIFBALL_PLAYER_STYLES[selected.agency.style].label} · {selected.agency.choice}</p><p>{selected.agency.reason}</p>
              <details><summary className="cursor-pointer text-cyan-300">Engagement alternatives</summary><ul className="space-y-1 mt-2">{selected.agency.alternatives.map(option => <li key={option.targetId}>{option.targetId}: {Number.isFinite(option.score) ? option.score.toFixed(2) : 'Unavailable'} · {option.reason}</li>)}</ul></details>
            </div>}
            <details><summary className="cursor-pointer text-xs text-cyan-300">Recent decisions · last 100</summary><ol className="max-h-48 overflow-y-auto text-xs text-slate-400 space-y-2 mt-2">{lab.diagnostics?.history.filter(entry => !lab.selectedBot || entry.includes(`· ${lab.selectedBot} `)).slice().reverse().map((entry, i) => <li key={i}>{entry}</li>)}</ol></details>
          </section>
          <section aria-label="Compare configurations" className="space-y-2 border-t border-slate-700 pt-4">
            <h3 className="font-semibold">Compare baseline / candidate</h3>
            <button className={button} disabled={lab.comparing} onClick={() => grifballLab.pinBaseline()}>Pin current configuration as baseline</button>
            <p className="text-xs text-slate-400">{lab.baseline ? 'Baseline pinned. Editing the candidate leaves it unchanged.' : 'Pin a baseline, change settings, then run both against the same scenario.'}</p>
            {lab.baseline && <details><summary className="text-xs cursor-pointer text-cyan-300">Configuration differences</summary><pre className="text-xs whitespace-pre-wrap max-h-48 overflow-auto">{(['blue', 'red'] as const).flatMap(team => { const a = resolveTeamTactics(lab.baseline!, team); const b = resolveTeamTactics(lab.config, team); return (Object.keys(a) as (keyof TeamTactics)[]).filter(key => a[key] !== b[key]).map(key => `${team} ${key}: ${a[key]} → ${b[key]}`); }).concat([...new Set([...Object.keys(lab.baseline.botStyles), ...Object.keys(lab.config.botStyles)])].sort().flatMap(id => { const a = resolveGrifballPlayerStyle(lab.baseline!.botStyles, id), b = resolveGrifballPlayerStyle(lab.config.botStyles, id); return a === b ? [] : [id + ' player style: ' + a + ' → ' + b]; })).join('\n') || 'No differences'}</pre></details>}
            <label className="flex items-center justify-between text-xs">Seconds per run<input type="number" className={`${input} w-24`} min={1} max={120} value={duration} onChange={e => setDuration(Number(e.target.value))} /></label>
            <button className={button} disabled={!lab.connected || !lab.baseline || lab.comparing || lab.validating} onClick={() => grifballLab.command({ type: 'compare', seconds: duration, scenario, seed, baseline: lab.baseline!, candidate: lab.config })}>Run sequential A/B</button>
            {lab.results.length === 2 && <><p className="text-xs">{lab.results[0].setup.map} · {lab.results[0].setup.roster.length} bots · {scenarios[lab.results[0].scenario]} · seed {lab.results[0].seed} · {lab.results[0].metrics.seconds.toFixed(2)} s each</p><table className="w-full text-xs"><thead><tr><th className="text-left">Metric</th><th>Baseline</th><th>Candidate</th></tr></thead><tbody>{(['goals', 'possessionLosses', 'roleChanges', 'outsideSeconds', 'botSeconds', 'stuckSeconds', 'sharedExposureSeconds', 'blockedRouteSeconds', 'runnerWaitSeconds', 'runnerRouteChanges', 'tankingSeconds', 'doubleCommitSeconds', 'delaySeconds', 'engagementReleases', 'containmentSeconds', 'safetySeconds', 'passes', 'completedPasses', 'interceptedPasses', 'styleSeconds', 'adaptedSeconds'] as const).map(key => <tr key={key}><td className="py-1">{({ goals: 'Total goals', possessionLosses: 'Possession losses', roleChanges: 'Role changes', outsideSeconds: 'Outside coverage (bot·s)', botSeconds: 'Assigned alive (bot·s)', stuckSeconds: 'Stuck (bot·s)', sharedExposureSeconds: 'Shared exposure (bot·s)', blockedRouteSeconds: 'Blocked route (bot·s)', runnerWaitSeconds: 'Runner waiting (s)', runnerRouteChanges: 'Runner action changes', tankingSeconds: 'Tank commitment (bot·s)', doubleCommitSeconds: 'Double commitment (team·s)', delaySeconds: 'Defensive delay (bot·s)', engagementReleases: 'Engagement releases', containmentSeconds: 'Containment (bot·s)', safetySeconds: 'Last defender (bot·s)', passes: 'Scripted passes', completedPasses: 'Friendly pass recoveries', interceptedPasses: 'Opponent pass recoveries', styleSeconds: 'Active styles (team·s)', adaptedSeconds: 'Adapted styles (team·s)' })[key]}</td>{lab.results.map((result, i) => <td key={i} className="text-center">{result.metrics[key].toFixed(2)}</td>)}</tr>)}</tbody></table><details><summary className="text-xs cursor-pointer text-cyan-300">Retained A/B report · copy JSON</summary><textarea aria-label="A/B results JSON" readOnly className={`${input} w-full mt-2 font-mono text-xs`} rows={6} value={JSON.stringify(lab.results, null, 2)} /></details></>}
            <details><summary className="text-xs cursor-pointer text-cyan-300">Metric definitions</summary><p className="text-xs text-slate-400 mt-2">Goals: both teams combined. Possession losses: holder changes during live play, excluding scoring. Role changes: changes after initial assignment. Coverage: seconds outside the configured boundary, summed over alive assigned bots. Stuck: bot seconds after at least one second below 0.1 m/s while more than 2 m from destination. Assigned alive bot seconds is the denominator for coverage and stuck time. Shared exposure: assigned bot seconds whose selected position shares a predicted hammer blast; blocked route: assigned bot seconds with no reachable ground route. Runner waiting counts scripted carrier seconds assigned to wait. Runner action changes count action switches during the same possession, not endpoint refreshes. Tank commitment counts bot seconds assigned combat permission, including approach time. Double commitment counts team seconds with a two-player commit. Delay counts bot seconds assigned defensive delay. Releases count transitions from a commitment back toward coverage. Containment and last defender count bot seconds assigned those orders. Scripted passes count releases observed by the Lab; friendly and opponent pass recoveries count the next live pickup after each release. Active styles counts live team seconds with style-driven assignments; adapted styles is the subset that met the evidence and confidence thresholds. These are diagnostic indicators, not a win-rate ranking.</p></details>
          </section>
          <fieldset disabled={lab.validating}><GrifballEvaluationPanel scenario={scenario} seed={seed} /></fieldset>
        </div>
      </>}
    </div>
  </aside></>;
}
