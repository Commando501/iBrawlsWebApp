import { useEffect, useMemo, useState } from 'react';
import type { LiveConfig } from '../../services/liveConfig';
import { withDefaultGameplaySettings } from '../../settings/gameplaySettings';
import { BALANCEABLE_MAPS, balanceMap, getMapTraversal } from '../../game/mapBalancing';
import { DEFAULT_MAP_SCALE, MAP_SCALE_MAX, MAP_SCALE_MIN, STADIUM_SCALE_KEYS, getStadiumMapScale, normalizeMapScalePercent, type MapBalanceScale, type MapBalanceSettings } from '../../../shared/mapBalanceSettings';
import { MapBalancerPreview } from './MapBalancerPreview';

const axes = ['length', 'width', 'height'] as const;
const button = 'rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-40';
const seconds = (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(2)} s`;

function PercentageInput({ axis, value, onChange }: { axis: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);
  return <input aria-label={`${axis} percentage`} type="number" min={MAP_SCALE_MIN} max={MAP_SCALE_MAX} step="1" value={text}
    onFocus={() => setEditing(true)}
    onChange={event => {
      setText(event.target.value);
      const next = event.target.valueAsNumber;
      if (Number.isFinite(next) && next >= MAP_SCALE_MIN && next <= MAP_SCALE_MAX) onChange(next);
    }}
    onBlur={() => { if (text.trim()) onChange(normalizeMapScalePercent(Number(text))); setEditing(false); }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-xs text-cyan-200 focus:border-cyan-300 focus:outline-none" />;
}

export function MapBalancer({ settings, onSettingChange, multiplayerPreset, onPublish, isPublishing, publishStatus }: {
  settings: Record<string, unknown>;
  onSettingChange: (key: string, value: number | boolean) => void;
  multiplayerPreset: LiveConfig | null;
  onPublish: () => void;
  isPublishing: boolean;
  publishStatus: { ok: boolean; msg: string } | null;
}) {
  const [selectedMap, setSelectedMap] = useState(BALANCEABLE_MAPS[0].id);
  const [linked, setLinked] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [restartKey, setRestartKey] = useState(0);
  const base = BALANCEABLE_MAPS.find(map => map.id === selectedMap)!;
  const scale = getStadiumMapScale(settings as MapBalanceSettings);
  const publishedScale = getStadiumMapScale(multiplayerPreset?.settings ?? {});
  const map = useMemo(() => balanceMap(base, scale), [base, scale.length, scale.width, scale.height]);
  const movement = useMemo(() => withDefaultGameplaySettings(multiplayerPreset?.settings ?? {}), [multiplayerPreset]);
  const traversal = getMapTraversal(map, movement);
  const originalTraversal = getMapTraversal(base, movement);
  const dirty = axes.some(axis => scale[axis] !== publishedScale[axis]);
  const applyScale = (next: MapBalanceScale) => axes.forEach(axis => onSettingChange(STADIUM_SCALE_KEYS[axis], next[axis]));
  const updateAxis = (axis: keyof MapBalanceScale, value: number) => {
    const next = normalizeMapScalePercent(value);
    // Linked scaling preserves the current aspect ratio until an axis reaches a limit.
    const ratio = next / scale[axis];
    const boundedRatio = Math.max(...axes.map(key => MAP_SCALE_MIN / scale[key]), Math.min(ratio, ...axes.map(key => MAP_SCALE_MAX / scale[key])));
    applyScale(linked ? Object.fromEntries(axes.map(key => [key, normalizeMapScalePercent(scale[key] * boundedRatio)])) as unknown as MapBalanceScale : { ...scale, [axis]: next });
  };

  return <section aria-labelledby="map-balancer-title" className="rounded-2xl border border-cyan-500/20 bg-slate-950/70 p-4 sm:p-5 shadow-lg">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[10px] font-mono uppercase tracking-[.2em] text-cyan-400">Multiplayer / Arena tuning</p><h2 id="map-balancer-title" className="mt-1 text-2xl font-bold tracking-tight text-white">Map Balancer</h2><p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-400">Resize the playing field and its objects together. Preview travel times before publishing the next multiplayer court.</p></div>
      <span role="status" className={`rounded-full border px-3 py-1 text-[10px] font-mono ${dirty ? 'border-amber-400/30 text-amber-300' : 'border-emerald-400/30 text-emerald-300'}`}>{dirty ? 'Unpublished map changes' : multiplayerPreset ? 'Matches published size' : 'Authored size · no preset'}</span>
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <div><h3 className="mb-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">Grifball maps</h3>
          {BALANCEABLE_MAPS.map(item => <button key={item.id} type="button" onClick={() => setSelectedMap(item.id)} aria-pressed={selectedMap === item.id} className="w-full rounded-xl border border-cyan-400/30 bg-cyan-950/30 p-3 text-left focus-visible:outline-2 focus-visible:outline-cyan-300">
            <svg viewBox="0 0 160 54" className="mb-2 h-14 w-full" role="img" aria-label={`${item.name} map overview`}><rect x="12" y="6" width="136" height="42" rx="2" fill="#182c3e" stroke="#617a91" /><path d="M80 6 V48" stroke="#617a91" /><circle cx="21" cy="27" r="3" fill="#60a5fa" /><circle cx="139" cy="27" r="3" fill="#fb7185" /><circle cx="80" cy="27" r="8" fill="none" stroke="#617a91" /></svg>
            <strong className="text-xs text-white">{item.name}</strong><span className="mt-1 block text-[10px] text-slate-400">Authored Grifball court</span>
          </button>)}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200"><input type="checkbox" checked={linked} onChange={event => setLinked(event.target.checked)} className="h-4 w-4 accent-cyan-400" />Link all dimensions</label>
        <p className="-mt-2 text-[11px] leading-relaxed text-slate-500">{linked ? 'Move any slider to scale the whole map while preserving its proportions.' : 'Adjust length, width, and height independently.'}</p>
        {axes.map(axis => <div key={axis}>
          <div className="mb-2 flex items-center justify-between gap-2"><label htmlFor={`map-scale-${axis}`} className="text-xs capitalize text-slate-300">{axis} <span className="text-slate-600">{axis === 'length' ? '(X)' : axis === 'width' ? '(Z)' : '(Y)'}</span></label><div className="flex items-center gap-1"><PercentageInput axis={axis} value={scale[axis]} onChange={value => updateAxis(axis, value)} /><span className="text-xs text-slate-500">%</span></div></div>
          <input id={`map-scale-${axis}`} aria-label={`${axis} scale`} type="range" min={MAP_SCALE_MIN} max={MAP_SCALE_MAX} step="1" value={scale[axis]} onChange={event => updateAxis(axis, event.target.valueAsNumber)} className="w-full accent-cyan-400" />
        </div>)}
        <p className="text-[10px] text-slate-500">50–200% of authored size. Players stay the same size.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => applyScale(DEFAULT_MAP_SCALE)}>Reset to 100%</button><button type="button" className={button} disabled={!dirty} onClick={() => applyScale(publishedScale)}>Revert to published</button></div>
      </div>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-400">Movement: <strong className="text-cyan-200">{multiplayerPreset ? `Live preset v${multiplayerPreset.version}` : 'Defaults · no live preset'}</strong></p><div className="flex gap-2"><button type="button" className={button} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause runners' : 'Play runners'}</button><button type="button" className={button} onClick={() => setRestartKey(value => value + 1)}>Restart</button></div></div>
        <MapBalancerPreview base={base} map={map} traversal={traversal} playing={playing} restartKey={restartKey} />
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs"><caption className="sr-only">Wall-to-wall traversal at maximum forward speed</caption><thead className="bg-slate-900 text-[10px] uppercase text-slate-400"><tr><th className="p-3">Player travel</th><th className="p-3 text-cyan-300">Run · {traversal.run.toFixed(2)} m/s</th><th className="p-3 text-amber-300">{traversal.sprint === null ? 'Sprint disabled' : `Sprint · ${traversal.sprint.toFixed(2)} m/s`}</th></tr></thead><tbody className="text-slate-200">
            {(['length', 'width'] as const).map(axis => <tr key={axis} className="border-t border-slate-800"><th className="p-3 font-normal"><span className="capitalize">{axis}</span> · {traversal[axis].toFixed(2)} m</th><td className="p-3 font-mono" data-testid={`${axis}-run-time`}>{seconds(axis === 'length' ? traversal.lengthRun : traversal.widthRun)}<span className="mt-1 block text-[10px] text-slate-500">Original {seconds(axis === 'length' ? originalTraversal.lengthRun : originalTraversal.widthRun)}</span></td><td className="p-3 font-mono" data-testid={`${axis}-sprint-time`}>{seconds(axis === 'length' ? traversal.lengthSprint : traversal.widthSprint)}<span className="mt-1 block text-[10px] text-slate-500">Original {seconds(axis === 'length' ? originalTraversal.lengthSprint : originalTraversal.widthSprint)}</span></td></tr>)}
          </tbody></table>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Full forward input while facing each axis, without the ball. Travel accounts for the 0.6 m player-center inset at each wall. Markers are enlarged for visibility. No acceleration, jumps, slides, or dashes.</p>
      </div>
    </div>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-4"><div className="max-w-2xl"><p className="text-xs text-slate-300">Goals, spawn positions, lighting, field markings, and stadium structures move together.</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Publish includes all admin ruleset edits. New lobbies use the published size; existing lobbies and replays retain their court. The Map Maker and authored preset stay unchanged.</p></div><button type="button" onClick={onPublish} disabled={isPublishing} className="rounded-lg border border-cyan-300/40 bg-cyan-400/15 px-4 py-2.5 text-xs font-bold text-cyan-200 hover:bg-cyan-400/25 disabled:opacity-40">{isPublishing ? 'Publishing…' : 'Publish official preset'}</button></div>
    {publishStatus && <p role={publishStatus.ok ? 'status' : 'alert'} className={`mt-3 text-xs ${publishStatus.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{publishStatus.msg}</p>}
  </section>;
}
