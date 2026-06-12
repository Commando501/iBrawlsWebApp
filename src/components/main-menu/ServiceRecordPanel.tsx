import { useMemo, useSyncExternalStore } from 'react';
import { useState } from 'react';
import { MEDAL_CATALOG } from '../../game/medalCatalog';
import { STAT_DEFINITIONS, type StatCategory, type StatDefinition } from '../../stats/statDefinitions';
import { statTracker } from '../../stats/statTracker';
import {
  STAT_MODE_KEYS,
  STAT_MODE_LABELS,
  type StatCounterMap,
  type StatModeKey,
} from '../../stats/statTypes';
import { renderMedalIcon } from '../HUD';

/**
 * Service Record — lifetime stats and medal chest. Reads straight from the
 * stat tracker (local profile, kept in step with the account's cloud stats by
 * useStatCloudSync) and re-renders whenever new stats commit.
 */

type ScopeKey = 'lifetime' | StatModeKey;

interface ServiceRecordPanelProps {
  isSignedIn: boolean;
}

const CATEGORY_ORDER: { id: Exclude<StatCategory, 'medals'>; label: string }[] = [
  { id: 'matches', label: 'Matches' },
  { id: 'combat', label: 'Combat' },
  { id: 'objective', label: 'Objective' },
  { id: 'records', label: 'Personal Records' },
];

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatStatValue(definition: StatDefinition, value: number): string {
  if (definition.format === 'duration') return formatDuration(value);
  return Math.round(value).toLocaleString();
}

function formatRatio(numerator: number, denominator: number): string {
  if (denominator <= 0) return numerator > 0 ? numerator.toFixed(2) : '—';
  return (numerator / denominator).toFixed(2);
}

function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

export function ServiceRecordPanel({ isSignedIn }: ServiceRecordPanelProps) {
  // The tracker mutates its profile in place; the version counter is the
  // stable snapshot that tells React when to re-read it.
  const version = useSyncExternalStore(
    (listener) => statTracker.subscribe(listener),
    () => statTracker.getVersion()
  );
  const profile = statTracker.getProfile();
  const [scope, setScope] = useState<ScopeKey>('lifetime');

  const counters: StatCounterMap = useMemo(() => {
    if (scope === 'lifetime') return profile.totals;
    return profile.modes[scope] ?? {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, scope, version]);

  const get = (statId: string) => counters[statId] ?? 0;

  const playedModes = STAT_MODE_KEYS.filter(
    (mode) => Object.keys(profile.modes[mode] ?? {}).length > 0
  );

  const kills = get('combat.kills');
  const deaths = get('combat.deaths');
  const wins = get('match.wins');
  const played = get('match.played');

  const medalEntries = Object.values(MEDAL_CATALOG).map((medal) => ({
    medal,
    count: get(`medal.${medal.id}`),
  }));
  const totalMedals = get('combat.medals');

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-1 gap-4 max-w-3xl">
      {/* ── Header / scope selector ── */}
      <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-2.5">
        <div className="flex justify-between items-center border-b border-white/5 pb-2">
          <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">
            Service Record
          </span>
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1.5 shrink-0 select-none ${
              isSignedIn
                ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20'
                : 'text-amber-300 bg-amber-950/40 border-amber-500/20'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${isSignedIn ? 'bg-emerald-400' : 'bg-amber-300'}`} />
            {isSignedIn ? 'CLOUD_SYNC_ACTIVE' : 'LOCAL_ONLY'}
          </span>
        </div>

        {!isSignedIn && (
          <p className="text-xs text-white/50 leading-normal">
            Stats are saved on this device. Sign in to your Spartan account to back them up and
            carry them across devices — your local history merges in automatically.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setScope('lifetime')}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-all border ${
              scope === 'lifetime'
                ? 'bg-[#38bdf8]/20 border-[#38bdf8]/50 text-[#38bdf8]'
                : 'bg-black/30 border-white/10 text-white/40 hover:text-white/70'
            }`}
          >
            Lifetime
          </button>
          {playedModes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setScope(mode)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-all border ${
                scope === mode
                  ? 'bg-[#38bdf8]/20 border-[#38bdf8]/50 text-[#38bdf8]'
                  : 'bg-black/30 border-white/10 text-white/40 hover:text-white/70'
              }`}
            >
              {STAT_MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        {/* ── Headline derived stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {[
            { label: 'K/D Ratio', value: formatRatio(kills, deaths) },
            { label: 'Win Rate', value: formatPercent(wins, played) },
            { label: 'Kills', value: Math.round(kills).toLocaleString() },
            { label: 'Matches', value: Math.round(played).toLocaleString() },
          ].map((item) => (
            <div key={item.label} className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-center">
              <div className="text-xl font-black font-display text-white">{item.value}</div>
              <div className="text-[10px] text-white/40 uppercase tracking-widest font-mono mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Stat categories ── */}
      {CATEGORY_ORDER.map(({ id, label }) => {
        const definitions = STAT_DEFINITIONS.filter((definition) => definition.category === id);
        if (definitions.length === 0) return null;
        return (
          <div key={id} className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-2">
            <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider border-b border-white/5 pb-2">
              {label}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {definitions.map((definition) => (
                <div
                  key={definition.id}
                  className="flex justify-between items-baseline gap-3 py-1 border-b border-white/5 last:border-b-0"
                  title={definition.description}
                >
                  <span className="text-xs text-white/60">{definition.name}</span>
                  <span className="text-sm font-bold font-mono text-white">
                    {formatStatValue(definition, get(definition.id))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* ── Medal chest ── */}
      <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-2.5">
        <div className="flex justify-between items-center border-b border-white/5 pb-2">
          <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">Medal Chest</span>
          <span className="text-[10px] font-mono text-white/40">
            {Math.round(totalMedals).toLocaleString()} TOTAL
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {medalEntries.map(({ medal, count }) => (
            <div
              key={medal.id}
              title={`${medal.name} — ${medal.description}`}
              className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 transition-all ${
                count > 0
                  ? 'bg-black/40 border-white/15'
                  : 'bg-black/20 border-white/5 opacity-40 grayscale'
              }`}
            >
              <div className="w-9 h-9" style={{ color: medal.color }}>
                {renderMedalIcon(medal.icon)}
              </div>
              <span className="text-[10px] font-bold text-white/80 text-center leading-tight">{medal.name}</span>
              <span className="text-xs font-mono font-bold" style={{ color: count > 0 ? medal.color : undefined }}>
                ×{Math.round(count).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
