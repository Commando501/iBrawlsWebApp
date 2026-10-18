import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CustomMapData, CharacterModelType } from '../../types';
import { AI_ARCHETYPE_OPTIONS, applyArchetypeToSettings, type AIArchetypeId } from '../../game/aiPersonalities';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { normalizeVisualModelPolicy, VISUAL_MODEL_POLICY_OPTIONS, getVisualModelPolicyLabel } from '../../model/modelSystem';
import type { BotSetupOverlayProps } from './BotSetupOverlay';
import { getArchetypeDescription, getPresetDescription } from './aiMenuContent';
import { TopDownMapPreview } from '../loading/TopDownMapPreview';

export interface TrainingScreenProps extends BotSetupOverlayProps {
  onOpenSettings?: () => void;
  onOpenAI?: () => void;
  active?: boolean;
}

const BOTS = [
  { id: 'main_ai', name: 'DoomBot', hue: 0 },
  { id: 'bot_2', name: 'DoomBot Green', hue: 120 },
  { id: 'bot_3', name: 'DoomBot Purple', hue: 280 },
  { id: 'bot_4', name: 'DoomBot Orange', hue: 45 },
  { id: 'bot_5', name: 'DoomBot Yellow', hue: 60 },
  { id: 'bot_6', name: 'DoomBot Magenta', hue: 320 },
  { id: 'bot_7', name: 'DoomBot Cyan', hue: 180 },
] as const;
const COLORS = [
  ['Red', 0], ['Orange', 28], ['Yellow', 55], ['Lime', 85], ['Green', 120],
  ['Teal', 168], ['Cyan', 190], ['Blue', 215], ['Purple', 275], ['Magenta', 310],
] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard', 'nightmare'] as const;
const TABS = ['arena', 'bots', 'rules'] as const;
const titleCase = (value: string) => value[0].toUpperCase() + value.slice(1);
const finiteVector = (value: unknown) => Boolean(value && typeof value === 'object' && ['x', 'y', 'z'].every(key => Number.isFinite((value as Record<string, unknown>)[key])));

/** Validate the shape used by the existing map renderer before replacing the last good map. */
export function parseTrainingMap(text: string): CustomMapData {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose a map exported from the Map Maker.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('The map must contain a name and an objects array.');
  const map = parsed as CustomMapData;
  if (typeof map.name !== 'string' || !map.name.trim() || !Array.isArray(map.objects)) throw new Error('The map must contain a name and an objects array.');
  if (map.objects.some(object => !object || !['box', 'cylinder', 'sphere'].includes(object.type) || !finiteVector(object.position) || !finiteVector(object.rotation) || !finiteVector(object.scale))) throw new Error('One or more map objects have an invalid shape or transform. Re-export the map from the Map Maker.');
  if (map.spawnPoints !== undefined && (!Array.isArray(map.spawnPoints) || map.spawnPoints.some(point => !finiteVector(point)))) throw new Error('The map contains invalid spawn points.');
  if (map.arenaRadius !== undefined && (!Number.isFinite(map.arenaRadius) || map.arenaRadius <= 0)) throw new Error('The map arena radius must be a positive number.');
  if (map.arenaHalfExtents && (![map.arenaHalfExtents.x, map.arenaHalfExtents.z].every(value => Number.isFinite(value) && value > 0))) throw new Error('The map arena dimensions must be positive numbers.');
  if ([map.author, map.description].some(value => value !== undefined && typeof value !== 'string')) throw new Error('Map author and description must be text.');
  if (map.objects.some(object => [object.name, object.color, object.emissive].some(value => value !== undefined && typeof value !== 'string'))) throw new Error('Map object names and colors must be text.');
  if (map.teamSpawns && Object.values(map.teamSpawns).some(spawns => !Array.isArray(spawns) || spawns.some(point => !finiteVector(point)))) throw new Error('The map contains invalid team spawn points.');
  return { ...map, arenaRadius: map.arenaRadius ?? 20, spawnPoints: map.spawnPoints ?? [] };
}

export function trainingDifficultyPreset(preset: 'normal' | 'nightmare' | 'graduated'): Record<string, string> {
  const graduated = ['easy', 'normal', 'normal', 'hard', 'hard', 'nightmare', 'nightmare'];
  return Object.fromEntries(BOTS.map((bot, index) => [bot.id, preset === 'graduated' ? graduated[index] : preset]));
}

export function TrainingScreen(props: TrainingScreenProps) {
  const { adminSettings, setAdminSettings, offlineBotCount, onOfflineBotCountChange, selectedMap, onSelectedMapChange, lobbyCustomMapData, onCustomMapDataChange, botDifficulties, setBotDifficulties, botArchetypes, setBotArchetypes, botColors, setBotColors, botModelTypes, setBotModelTypes, aiPresets, playerName, onInitializeSimulation, onApplyAndResume, isPlaying, onOpenSettings, onOpenAI, active = true } = props;
  const [tab, setTab] = useState<typeof TABS[number]>('arena');
  const [selectedBot, setSelectedBot] = useState('main_ai');
  const [mapError, setMapError] = useState('');
  const [importing, setImporting] = useState(false);
  const panelsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (panelsRef.current) panelsRef.current.scrollTop = 0; }, [tab]);
  const isGrifball = adminSettings.gameMode === 'grifball';
  const count = isGrifball ? 7 : Math.min(7, Math.max(1, offlineBotCount));
  const selectedIndex = BOTS.findIndex(bot => bot.id === selectedBot);
  const bot = BOTS[selectedIndex >= 0 && selectedIndex < count ? selectedIndex : 0];
  const difficulty = botDifficulties[bot.id] || 'normal';
  const archetype = botArchetypes[bot.id] || 'none';
  const stockDifficulty = (DIFFICULTIES as readonly string[]).includes(difficulty);
  const selectedPremade = PREMADE_MAPS.find(map => map.id === selectedMap);
  const mapName = selectedMap === 'hangar' ? 'Industrial Hangar' : selectedMap === 'circle' ? 'Circle Arena' : selectedMap === 'custom_file' ? lobbyCustomMapData?.name ?? 'Custom arena' : selectedPremade?.name ?? selectedMap;
  const mapDescription = selectedMap === 'hangar' ? 'Steel columns, hazard stripes, and warm amber lights in the original industrial arena.' : selectedMap === 'circle' ? 'An open dueling arena with quiet ceramic flooring, a suspended cyan perimeter ring, and reinforced Vanguard supports.' : selectedMap === 'custom_file' ? lobbyCustomMapData?.description ?? 'Import a map exported from the standalone Map Maker.' : selectedPremade?.description;
  const policy = normalizeVisualModelPolicy(adminSettings.visualModelPolicy);
  const activeDifficulties = BOTS.slice(0, count).map(entry => botDifficulties[entry.id] || 'normal');
  const difficultyLabel = (value: string) => aiPresets.find(preset => preset.id === value)?.name ?? titleCase(value);
  const rosterDifficulty = new Set(activeDifficulties).size === 1 ? difficultyLabel(activeDifficulties[0]) : 'Mixed difficulties';
  const needsMap = selectedMap === 'custom_file' && !lobbyCustomMapData;

  useEffect(() => {
    if (!active) return;
    if (Object.values(botModelTypes).some(model => model !== 'medium')) {
      setBotModelTypes(previous => Object.fromEntries(Object.keys(previous).map(id => [id, 'medium' as CharacterModelType])));
    }
    if (isGrifball && offlineBotCount !== 7) onOfflineBotCountChange(7);
  }, [active, botModelTypes, setBotModelTypes, isGrifball, offlineBotCount, onOfflineBotCountChange]);

  const changeMode = (mode: 'sandbox' | 'grifball') => {
    setAdminSettings(previous => ({ ...previous, gameMode: mode }));
    if (mode === 'grifball') {
      onOfflineBotCountChange(7);
      if (selectedPremade?.mapShape !== 'rectangular') onSelectedMapChange('championship_stadium');
    }
  };
  const changeArchetype = (id: AIArchetypeId) => {
    setBotArchetypes(previous => ({ ...previous, [bot.id]: id }));
    if (bot.id === 'main_ai') setAdminSettings(previous => id === 'none' ? { ...previous, aiArchetype: 'none' } : applyArchetypeToSettings(previous, id));
  };
  const importMap = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true); setMapError('');
    try { onCustomMapDataChange(parseTrainingMap(await file.text())); }
    catch (error) { setMapError(error instanceof Error ? error.message : 'Could not read this map file.'); }
    finally { setImporting(false); event.target.value = ''; }
  };

  return <div className="menu-training">
    <section className="menu-training__configuration" aria-label="Training configuration">
      <div className="menu-training__tabs" role="tablist" aria-label="Training setup sections" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = TABS.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        setTab(TABS[next]); event.currentTarget.querySelectorAll('[role=tab]')[next]?.focus();
      }}>{TABS.map(id => <button type="button" role="tab" key={id} id={`training-tab-${id}`} aria-controls={`training-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{id === 'arena' ? 'Arena' : id === 'bots' ? <>Bots <span>{count}</span></> : 'Advanced rules'}</button>)}</div>
      <div className="menu-training__panels" ref={panelsRef}>
        <section role="tabpanel" id="training-panel-arena" aria-labelledby="training-tab-arena" hidden={tab !== 'arena'}>
          <header><h2>Build your match</h2><p>Set the essentials, then jump in.</p></header>
          <fieldset className="menu-training__modes"><legend>Game mode</legend>{([{ id: 'sandbox', name: 'iBrawls', copy: 'Practice combat with 1–7 AI bots.' }, { id: 'grifball', name: 'Grifball · 4v4', copy: 'Fight for the ball. Score as a team.' }] as const).map(mode => <label key={mode.id}><input type="radio" name="training-game-mode" value={mode.id} checked={adminSettings.gameMode === mode.id} onChange={() => changeMode(mode.id)} /><span><strong>{mode.name}</strong><small>{mode.copy}</small></span></label>)}</fieldset>
          <div className="menu-training__field-row"><div><label htmlFor="training-map">Arena map</label><p>Choose where the match takes place.</p></div><select id="training-map" value={selectedMap} onChange={event => { onSelectedMapChange(event.target.value); setMapError(''); }}><option value="hangar">Industrial Hangar</option><option value="circle">Circle Arena</option>{PREMADE_MAPS.map(map => <option value={map.id} key={map.id}>{map.name}</option>)}<option value="custom_file">Import custom map…</option></select></div>
          {selectedMap === 'custom_file' && <div className="menu-training__import"><label htmlFor="training-map-file">Custom map JSON</label><input id="training-map-file" type="file" accept=".json,application/json" onChange={importMap} disabled={importing} />{lobbyCustomMapData ? <p>Loaded: <strong>{lobbyCustomMapData.name}</strong> · Author: {lobbyCustomMapData.author || 'Unknown'}<br />{lobbyCustomMapData.objects.length} objects · {lobbyCustomMapData.spawnPoints?.length ?? 0} spawns</p> : <p>Select a map exported from the Map Maker.</p>}{mapError && <p className="menu-training__error" role="alert">{mapError}</p>}{importing && <p role="status">Reading map…</p>}</div>}
          <div className="menu-training__field-row"><div><label htmlFor="training-count">AI combatants</label><p id="training-count-help">{isGrifball ? 'Grifball fills a 4v4 match: you and 7 bots.' : 'Set the number of opponents from 1 to 7.'}</p></div><div className="menu-training__count"><input id="training-count" aria-describedby="training-count-help" type="range" min="1" max="7" disabled={isGrifball} value={count} onChange={event => onOfflineBotCountChange(Number(event.target.value))} /><output htmlFor="training-count">{count}</output></div></div>
          <button type="button" className="menu-training__disclosure" onClick={() => setTab('bots')}><span><strong>Configure your opponents</strong><small>{count} bots · {rosterDifficulty}</small></span><span aria-hidden="true">→</span></button>
          <p className="menu-training__quiet">More control when you need it. Tune individual bots or adjust mechanics in Advanced rules.</p>
        </section>
        <section role="tabpanel" id="training-panel-bots" aria-labelledby="training-tab-bots" hidden={tab !== 'bots'}>
          <header><h2>Your AI roster</h2><p>Select a bot to adjust its difficulty and fighting style.</p></header>
          <div className="menu-training__presets"><span>Quick presets</span>{(['normal', 'nightmare', 'graduated'] as const).map(preset => <button type="button" key={preset} onClick={() => setBotDifficulties(trainingDifficultyPreset(preset))}>{preset === 'graduated' ? 'Graduated' : `All ${titleCase(preset)}`}</button>)}</div>
          <div className="menu-training__bots"><div className="menu-training__roster" aria-label="Select a bot"><div className="menu-training__player"><span style={{ background: `hsl(${adminSettings.playerHue ?? 200},65%,52%)` }} /><strong>{playerName}</strong><small>PLAYER</small></div>{BOTS.map((entry, index) => <button type="button" key={entry.id} aria-pressed={bot.id === entry.id} disabled={index >= count} onClick={() => setSelectedBot(entry.id)}><span className="menu-training__bot-color" style={{ background: `hsl(${botColors[entry.id] ?? entry.hue},65%,52%)` }} /><span><strong>{entry.name}</strong><small>{index >= count ? 'Inactive slot' : difficultyLabel(botDifficulties[entry.id] || 'normal')}</small></span><span className="menu-training__bot-index">{String(index + 1).padStart(2, '0')}</span></button>)}</div>
            <section className="menu-training__bot-inspector" aria-label={`${bot.name} settings`}><span className="menu-training__eyebrow">AI SLOT {String(BOTS.indexOf(bot) + 1).padStart(2, '0')}</span><h3>{bot.name}</h3><label htmlFor="training-bot-difficulty">Difficulty</label><select id="training-bot-difficulty" value={difficulty} onChange={event => setBotDifficulties(previous => ({ ...previous, [bot.id]: event.target.value }))}>{DIFFICULTIES.map(level => <option key={level} value={level}>{titleCase(level)}</option>)}{aiPresets.length > 0 && <optgroup label="Custom Presets">{aiPresets.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</optgroup>}</select><p>{getPresetDescription(difficulty, aiPresets)}</p>
              {stockDifficulty ? <><label htmlFor="training-bot-style">Fighting style</label><select id="training-bot-style" value={archetype} onChange={event => changeArchetype(event.target.value as AIArchetypeId)}>{AI_ARCHETYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p>{getArchetypeDescription(archetype)}</p></> : <p className="menu-training__custom-preset">This saved preset supplies the bot’s behavior. Choose a stock difficulty to apply a fighting style.</p>}
              <label>Personal color</label><div className="menu-training__colors" role="group" aria-label={`${bot.name} color`}>{COLORS.map(([name, hue]) => <button type="button" key={hue} title={name} aria-label={`${name} bot color`} aria-pressed={(botColors[bot.id] ?? bot.hue) === hue} onClick={() => setBotColors(previous => ({ ...previous, [bot.id]: hue }))} style={{ background: `hsl(${hue},75%,50%)` }} />)}</div><p>{isGrifball ? 'Team colors take priority in Grifball.' : 'Your bot’s personal armor color.'}</p><div className="menu-training__body"><span>Body type</span><button type="button" title="Medium Spartan body" onClick={() => setBotModelTypes(previous => ({ ...previous, [bot.id]: 'medium' }))}>Medium</button></div>
            </section>
          </div>
        </section>
        <section role="tabpanel" id="training-panel-rules" aria-labelledby="training-tab-rules" hidden={tab !== 'rules'}>
          <header><h2>Fine-tune your session</h2><p>Keep the quick setup simple. Make deeper changes here.</p></header>
          <div className="menu-training__field-row"><div><label htmlFor="training-model-policy">Character model set</label><p>Applies to you and every AI bot.</p></div><select id="training-model-policy" value={policy} onChange={event => setAdminSettings(previous => ({ ...previous, visualModelPolicy: normalizeVisualModelPolicy(event.target.value) }))}>{VISUAL_MODEL_POLICY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><p className="menu-training__quiet">{policy === 'v3' ? 'Iron Vanguard uses its shipping movement, hammer, sword, and ball animations.' : 'Your selected model set is used for this session. Appearance choices remain in Armory.'}</p>
          {onOpenSettings && <button type="button" className="menu-training__disclosure" onClick={onOpenSettings}><span><strong>Gameplay mechanics & controls</strong><small>Movement, health, weapons, runner, keyboard, and gamepad</small></span><span aria-hidden="true">↗</span></button>}
          {onOpenAI && <button type="button" className="menu-training__disclosure" onClick={onOpenAI}><span><strong>AI Behavior Editor</strong><small>Create and tune saved AI presets</small></span><span aria-hidden="true">↗</span></button>}
          <div className="menu-training__rule-note"><strong>Return to the same setup</strong><p>Your map, roster, and model choices stay here while you visit Settings.</p></div>
        </section>
      </div>
    </section>
    <aside className="menu-training__summary" aria-label="Your match"><div className="menu-training__map-preview">{selectedMap === 'championship_stadium' ? <><img src="/assets/menu/stadium-gameplay.png" alt="Actual V3 Grifball gameplay in Championship Stadium" /><span>IN-GAME CAPTURE · V3</span></> : active && !needsMap ? <><TopDownMapPreview selectedMap={selectedMap} customMap={lobbyCustomMapData} className="menu-training__blueprint" /><span>ARENA LAYOUT · GAME MAP DATA</span></> : <div className="menu-training__map-empty">{needsMap ? 'Import your arena to preview its layout.' : 'Arena preview paused'}</div>}</div><div className="menu-training__summary-body"><span className="menu-training__eyebrow">YOUR MATCH</span><h2>{mapName}</h2><p className="menu-training__map-description">{mapDescription}</p><dl><div><dt>Mode</dt><dd>{isGrifball ? 'Grifball · 4v4' : 'iBrawls'}</dd></div><div><dt>Roster</dt><dd>You + {count} AI {count === 1 ? 'bot' : 'bots'}</dd></div><div><dt>Difficulty</dt><dd>{rosterDifficulty}</dd></div><div><dt>Models</dt><dd>{getVisualModelPolicyLabel(policy)}</dd></div></dl><div className="menu-training__launch"><p role="status">{needsMap ? 'Import a custom map to continue.' : importing ? 'Reading your map…' : 'Your setup is ready.'}</p><button type="button" disabled={needsMap || importing} onClick={isPlaying ? onApplyAndResume : onInitializeSimulation}>{isPlaying ? 'Apply & Resume' : 'Start Training'} <span aria-hidden="true">→</span></button><small>Solo practice · No online lobby required</small></div></div></aside>
  </div>;
}
