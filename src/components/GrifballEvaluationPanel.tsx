import { useState, useSyncExternalStore } from 'react';
import { grifballLab, type LabScenario } from '../game/grifballLabStore';
import { EVALUATION_METRICS, EVALUATION_STYLES, summarizeEvaluation, type EvaluationMetric, type EvaluationStyle } from '../game/grifballEvaluation';

const button = 'rounded border border-slate-600 bg-slate-800 px-3 py-2 text-xs hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm min-w-0 w-20';
const number = (value: number | null) => value === null ? 'Insufficient data' : value.toFixed(3);

export function GrifballEvaluationPanel({ scenario, seed }: { scenario: LabScenario; seed: number }) {
  const lab = useSyncExternalStore(grifballLab.subscribe, grifballLab.getSnapshot);
  const [seeds, setSeeds] = useState(3);
  const [seconds, setSeconds] = useState(5);
  const [mirrored, setMirrored] = useState(true);
  const [opponents, setOpponents] = useState<EvaluationStyle[]>([...EVALUATION_STYLES]);
  const runs = seeds * opponents.length * (mirrored ? 4 : 2);
  const active = lab.evaluationReports[0]?.status === 'running';
  return <section aria-label="Batch evaluation" className="space-y-3 border-t border-slate-700 pt-3">
    <h3 className="font-semibold text-sm">Batch evaluation</h3>
    <p className="text-xs text-slate-400">Uses the scenario and first seed selected above on the current arena. Pin a baseline in Compare configurations, then edit the candidate. Only the resolved Blue team settings are compared; they follow Blue’s original bots onto Red for mirrored trials. Opponents use frozen Lab styles.</p>
    <fieldset disabled={lab.comparing} className="space-y-3">
      <label className="flex justify-between items-center text-xs">Batch seed count<input className={input} type="number" min={1} max={20} value={seeds} onChange={e => setSeeds(Number(e.target.value))} /></label>
      <label className="flex justify-between items-center text-xs">Batch seconds per run<input className={input} type="number" min={1} max={120} value={seconds} onChange={e => setSeconds(Number(e.target.value))} /></label>
      <label className="flex gap-2 items-center text-xs"><input type="checkbox" checked={mirrored} onChange={e => setMirrored(e.target.checked)} />Mirror teams and starting positions</label>
      <div role="group" aria-label="Batch opponents" className="flex flex-wrap gap-3">{EVALUATION_STYLES.map(style => <label key={style} className="flex gap-2 items-center text-xs"><input type="checkbox" checked={opponents.includes(style)} onChange={e => setOpponents(e.target.checked ? EVALUATION_STYLES.filter(s => opponents.includes(s) || s === style) : opponents.filter(s => s !== style))} />{style}</label>)}</div>
      <p className="text-xs text-slate-400">{scenario} · seeds {seed}–{seed + seeds - 1} · {runs} runs · {(runs * seconds / 60).toFixed(1)} simulation minutes</p>
      <button className={button} disabled={!lab.connected || !lab.baseline || !opponents.length} onClick={() => grifballLab.command({ type: 'batch', request: { scenario, seed, seeds, seconds, opponents, mirrored, baseline: lab.baseline!, candidate: lab.config } })}>Run evaluation batch</button>
    </fieldset>
    {active && <div className="space-y-2"><p role="status" className="text-xs">{lab.running ? 'Running' : 'Paused'} · {lab.evaluationReports[0].runs.length}/{lab.evaluationReports[0].totalRuns} runs complete. Use the Lab’s Pause / Run controls.</p><button className={button} onClick={() => grifballLab.command({ type: 'cancelBatch' })}>Cancel batch and restore</button></div>}
    <p className="text-xs text-slate-400">Completion or cancellation restores the starting session. The last three reports remain here across arena changes until reload. Repeat on other maps and export each report; maps are not pooled automatically.</p>
    {lab.evaluationReports.map((report, index) => <details key={index} open={index === 0} className="rounded border border-slate-700 p-2 space-y-2">
      <summary className="cursor-pointer text-xs">{report.mapName} · {report.request.scenario} · {report.status} · {report.runs.length}/{report.totalRuns}</summary>
      <p className="text-xs text-slate-400">Candidate minus baseline. Exploratory 95% paired t intervals use seed averages across all selected sides and opponents. At least two complete seed groups are required. No interval is a general win-rate or improvement claim.</p>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="text-left">Metric</th><th>Difference</th><th>95% interval</th><th>Seeds</th></tr></thead><tbody>{(Object.keys(EVALUATION_METRICS) as EvaluationMetric[]).map(key => {
        const result = summarizeEvaluation(report, key);
        return <tr key={key}><td className="py-1 pr-2">{EVALUATION_METRICS[key]}</td><td>{number(result.mean)}</td><td>{result.low === null ? 'Insufficient data' : `${number(result.low)} to ${number(result.high)}`}</td><td className="text-center">{result.seeds}</td></tr>;
      })}</tbody></table></div>
      <details><summary className="text-xs cursor-pointer text-cyan-300">Batch report · copy JSON</summary><textarea aria-label={`Batch report ${index + 1} JSON`} readOnly rows={5} className="w-full rounded bg-slate-950 p-2 font-mono text-xs" value={JSON.stringify(report, null, 2)} /></details>
    </details>)}
    <details><summary className="text-xs cursor-pointer text-cyan-300">Batch metric definitions and limits</summary><p className="text-xs text-slate-400 mt-2">A possession continues through a same-team pass or a loose ball until an opposing pickup or a goal. Unfinished possessions are retained but excluded from completed-possession ratios. Goal prevention means observed opponent possessions ending without a goal, not proof that a defender caused the stop. Carrier coverage is evaluated only when a visible opponent could reach an attack within two seconds; support requires a living teammate within eight metres and a clear ground segment. Shared exposure uses actual positions of threatened bots within a plausible common hammer blast, not planned destinations. Stuck time counts assigned bots moving below 0.1 m/s for at least one second while over two metres from their destination. Reports include raw counts and denominators, frozen settings, roster positions, map, seeds, styles and whole simulation tick cost. Cost varies by machine and is not isolated planner time. Short scenarios, simplified threat estimates and asymmetrical arenas limit interpretation. Full-match batches, execution parity, broader map validation and human playtests are still required before neural integration.</p></details>
  </section>;
}
