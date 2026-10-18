import React, { useState, useSyncExternalStore } from 'react';
import { MEDAL_CATALOG } from '../../game/medalCatalog';
import { STAT_DEFINITIONS, type StatCategory, type StatDefinition } from '../../stats/statDefinitions';
import { statTracker } from '../../stats/statTracker';
import { STAT_MODE_KEYS, STAT_MODE_LABELS, type StatModeKey } from '../../stats/statTypes';
import { renderMedalIcon } from '../HUD';
import { GameModelStage } from './GameModelStage';

interface ServiceRecordPanelProps {
  isSignedIn: boolean;
  playerHue?: number;
  active?: boolean;
  onOpenArmory?: () => void;
  onOpenProfile?: () => void;
  onFindMatch?: () => void;
}

type CareerCategory = 'overview' | StatCategory;
const CATEGORIES: { id: CareerCategory; label: string; description: string }[] = [
  { id: 'overview', label: 'Overview', description: 'Your time in the arena, at a glance.' },
  { id: 'combat', label: 'Combat', description: 'Every elimination and every close call.' },
  { id: 'matches', label: 'Matches', description: 'Results across your completed matches.' },
  { id: 'objective', label: 'Objective', description: 'Your team’s Grifball record.' },
  { id: 'records', label: 'Records', description: 'Your personal best performances.' },
  { id: 'medals', label: 'Medals', description: 'Moments worth remembering.' },
];
const MEDALS = Object.values(MEDAL_CATALOG);
const subscribe = (listener: () => void) => statTracker.subscribe(listener);
const getVersion = () => statTracker.getVersion();

export function formatCareerDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
export function formatCareerStat(definition: StatDefinition, value: number): string {
  return definition.format === 'duration' ? formatCareerDuration(value) : Math.round(value).toLocaleString();
}
export function formatCareerRatio(numerator: number, denominator: number): string {
  if (denominator <= 0) return numerator > 0 ? numerator.toFixed(2) : '—';
  return (numerator / denominator).toFixed(2);
}
export function formatCareerPercent(part: number, whole: number): string {
  return whole <= 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

/** Reads the existing tracker; cloud sync and guest-history merging remain owned by useStatCloudSync. */
export function ServiceRecordPanel({ isSignedIn, playerHue = 200, active = true, onOpenArmory, onOpenProfile, onFindMatch }: ServiceRecordPanelProps) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const profile = statTracker.getProfile();
  const [scope, setScope] = useState<'lifetime' | StatModeKey>('lifetime');
  const [category, setCategory] = useState<CareerCategory>('overview');
  const [selectedMedal, setSelectedMedal] = useState(MEDALS[0].id);
  const playedModes = STAT_MODE_KEYS.filter(mode => Object.keys(profile.modes[mode] ?? {}).length > 0);
  const currentScope = scope === 'lifetime' || playedModes.includes(scope) ? scope : 'lifetime';
  const counters = currentScope === 'lifetime' ? profile.totals : profile.modes[currentScope] ?? {};
  const get = (id: string) => counters[id] ?? 0;
  const kills = get('combat.kills');
  const deaths = get('combat.deaths');
  const played = get('match.played');
  const wins = get('match.wins');
  const empty = !Object.values(counters).some(value => Number(value) > 0);
  const medal = MEDAL_CATALOG[selectedMedal] ?? MEDALS[0];
  const categoryInfo = CATEGORIES.find(item => item.id === category)!;
  const highlights = [...MEDALS].sort((left, right) => get(`medal.${right.id}`) - get(`medal.${left.id}`)).slice(0, 4);
  const statRow = (definition: StatDefinition) => <div key={definition.id} className="menu-career__stat" title={definition.description}><span>{definition.name}</span><strong>{formatCareerStat(definition, get(definition.id))}</strong></div>;

  return <div className="menu-career">
    <section className="menu-career__record" aria-label="Service record">
      <header className="menu-career__record-heading"><div><span className="menu-career__eyebrow">SERVICE RECORD</span><h2>{currentScope === 'lifetime' ? 'Lifetime' : STAT_MODE_LABELS[currentScope]}</h2></div><label>Match history<select aria-label="Match history" value={currentScope} onChange={event => setScope(event.target.value as typeof scope)}><option value="lifetime">Lifetime</option>{playedModes.map(mode => <option key={mode} value={mode}>{STAT_MODE_LABELS[mode]}</option>)}</select></label></header>
      <div className="menu-career__headlines">{[
        { label: 'K/D Ratio', value: formatCareerRatio(kills, deaths) },
        { label: 'Win Rate', value: formatCareerPercent(wins, played) },
        { label: 'Kills', value: Math.round(kills).toLocaleString() },
        { label: 'Matches', value: Math.round(played).toLocaleString() },
      ].map(item => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div>
      <div className="menu-career__tabs" role="tablist" aria-label="Stat categories" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = CATEGORIES.findIndex(item => item.id === category);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? CATEGORIES.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : CATEGORIES.length - 1)) % CATEGORIES.length;
        setCategory(CATEGORIES[next].id);
        event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus();
      }}>{CATEGORIES.map(item => <button type="button" role="tab" id={`career-tab-${item.id}`} aria-controls={`career-panel-${item.id}`} aria-selected={category === item.id} tabIndex={category === item.id ? 0 : -1} key={item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
      <div className="menu-career__content">
        <header className="menu-career__category-heading"><h3>{categoryInfo.label}</h3><p>{categoryInfo.description}</p></header>
        {CATEGORIES.map(item => <section role="tabpanel" key={item.id} id={`career-panel-${item.id}`} aria-labelledby={`career-tab-${item.id}`} tabIndex={0} hidden={category !== item.id}>
          {item.id === 'overview' ? <>
            {empty && <div className="menu-career__empty"><strong>Your story starts in the arena.</strong><p>Play a match to build your service record. Your stats and medals will appear here.</p>{onFindMatch && <button type="button" onClick={onFindMatch}>Find a match <span aria-hidden="true">→</span></button>}</div>}
            <div className="menu-career__overview-stats">{['match.wins', 'match.timePlayed', 'combat.medals', 'best.killsInMatch', 'best.killingSpree', 'best.winStreak'].map(id => statRow(STAT_DEFINITIONS.find(definition => definition.id === id)!))}</div>
            <div className="menu-career__highlight-heading"><h4>Medal highlights</h4><button type="button" onClick={() => setCategory('medals')}>View all medals <span aria-hidden="true">→</span></button></div><div className="menu-career__highlights">{highlights.map(entry => <button type="button" key={entry.id} onClick={() => { setSelectedMedal(entry.id); setCategory('medals'); }}><span className="menu-career__medal-icon" style={{ color: entry.color }}>{renderMedalIcon(entry.icon)}</span><strong>{entry.name}</strong><small>×{Math.round(get(`medal.${entry.id}`)).toLocaleString()}</small></button>)}</div>
          </> : item.id === 'medals' ? <div className="menu-career__medals"><div className="menu-career__medal-grid" aria-label="Medal collection">{MEDALS.map(entry => <button type="button" key={entry.id} aria-pressed={selectedMedal === entry.id} onClick={() => setSelectedMedal(entry.id)} className={get(`medal.${entry.id}`) > 0 ? '' : 'menu-career__medal--unearned'}><span className="menu-career__medal-icon" style={{ color: entry.color }}>{renderMedalIcon(entry.icon)}</span><strong>{entry.name}</strong><small>×{Math.round(get(`medal.${entry.id}`)).toLocaleString()}</small></button>)}</div><aside className="menu-career__medal-detail" aria-live="polite"><span className="menu-career__medal-icon" style={{ color: medal.color }}>{renderMedalIcon(medal.icon)}</span><span className="menu-career__eyebrow">MEDAL DETAILS</span><h4>{medal.name}</h4><p>{medal.description}</p><strong>{Math.round(get(`medal.${medal.id}`)).toLocaleString()} earned</strong><small>{Math.round(get('combat.medals')).toLocaleString()} total medals in this history</small></aside></div> : <div className="menu-career__stats">{STAT_DEFINITIONS.filter(definition => definition.category === item.id).map(statRow)}</div>}
        </section>)}
      </div>
    </section>
    <aside className="menu-career__profile" aria-label="Player and storage">
      <GameModelStage hue={playerHue} heldWeapon="sword" active={active} />
      {onOpenArmory && <button type="button" className="menu-career__armory-link" onClick={onOpenArmory}>Customize in Armory <span aria-hidden="true">→</span></button>}
      <div className="menu-career__storage"><strong><span aria-hidden="true" className={isSignedIn ? 'is-connected' : ''} />{isSignedIn ? 'Account connected' : 'Saved on this device'}</strong><p>{isSignedIn ? 'Your match history is saved locally and syncs with your account when connected.' : 'Your stats stay with this browser. Sign in to back them up and carry your history across devices.'}</p>{onOpenProfile && <button type="button" onClick={onOpenProfile}>{isSignedIn ? 'Manage account' : 'Sign in to sync'} <span aria-hidden="true">↗</span></button>}</div>
      {!isSignedIn && <p className="menu-career__footnote">Your local match history merges automatically when you sign in.</p>}
    </aside>
  </div>;
}
