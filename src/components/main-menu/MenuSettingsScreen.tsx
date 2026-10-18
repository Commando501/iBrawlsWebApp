import React, { useState } from 'react';
import { MainMenuPrimaryPanel } from './MainMenuPrimaryPanel';
import { MechanicsSettingsGrid } from '../settings/MechanicsSettingsGrid';
import { LightingSettingsModal } from '../settings/LightingSettingsModal';
import { SaveCodesPanel } from './SaveCodesPanel';
import { SoundSettingsPanel } from '../settings/SoundSettingsPanel';
import type { MenuScreen, MenuSettingsSection } from './menuNavigation';

type Props = {
  section: MenuSettingsSection;
  onSection: (section: MenuSettingsSection) => void;
  onNavigate: (screen: MenuScreen) => void;
  game: React.ComponentProps<typeof MainMenuPrimaryPanel>;
  appVersion: string;
  forceMobileControls: boolean;
  onForceMobileControlsChange: (value: boolean) => void;
};
const sections: [MenuSettingsSection,string,string][] = [
  ['sound','Sound','Set the volume for your game.'],
  ['controls','Keyboard & mouse','Make every movement feel right.'],['gamepad','Gamepad','Every action within reach.'],['mechanics','Match rules','Tune the pace of your local match.'],['hud','HUD layout','Keep useful information in reach.'],['lighting','Lighting','Shape the arena’s light and atmosphere.'],['saves','Save data','Back up your setup or bring it with you.'],['connection','Connection','Manage your relay and local connection.'],['about','About','The arena and its tools.'],
];

export function MenuSettingsScreen({ section,onSection,onNavigate,game,appVersion,forceMobileControls,onForceMobileControlsChange }: Props) {
  const [collapsed,setCollapsed] = useState<Record<string,boolean>>({});
  const selected=sections.find(item=>item[0]===section)!;
  return <div className="menu-settings-grid"><nav className="menu-section-list" aria-label="Settings sections">{sections.map(([id,label])=><button key={id} aria-current={id===section?'page':undefined} onClick={()=>onSection(id)}>{label}<span aria-hidden>›</span></button>)}</nav><section className="menu-settings-content" aria-label={selected[1]}><div className="menu-section-heading"><h2>{selected[1]}</h2><p>{selected[2]}</p></div>
    {(section==='controls'||section==='gamepad')&&<MainMenuPrimaryPanel {...game} parent="customization" customizationChild={section==='gamepad'?'gamepad':'hotkeys'}/>}
    {section==='mechanics'&&<><p className="menu-note">These rules apply to your local match. Online matches use the host’s rules.</p><MechanicsSettingsGrid settings={game.adminSettings} setSettings={game.setAdminSettings} collapsedSections={collapsed} onToggleSection={id=>setCollapsed(previous=>({...previous,[id]:!previous[id]}))}/></>}
    {section==='sound'&&<SoundSettingsPanel/>}
    {section==='lighting'&&<div className="menu-inline-lighting"><LightingSettingsModal adminSettings={game.adminSettings} setAdminSettings={game.setAdminSettings} onClose={()=>onSection('controls')}/></div>}
    {section==='saves'&&<><SaveCodesPanel saveSystemStatus={game.saveSystemStatus} saveCodeImportInput={game.saveCodeImportInput} onExportSaveCode={game.onExportSaveCode} onResetAllSettings={game.onResetAllSettings} onSaveCodeImportInputChange={game.onSaveCodeImportInputChange} onImportSaveCode={game.onImportSaveCode}/><button className="menu-text-action" onClick={()=>onNavigate('profile')}>View account and sync →</button></>}
    {section==='hud'&&<div className="menu-settings-explanation"><h3>Your display, your layout.</h3><p>The live HUD editor is available from the pause menu during a match. Move, scale, lock, reset, and save your HUD while seeing it over the arena.</p><p>Desktop and mobile keep their own layouts.</p><label className="menu-setting-row"><span><strong>Always show touch controls</strong><small>Display the mobile controls during gameplay.</small></span><input type="checkbox" checked={forceMobileControls} onChange={event=>onForceMobileControlsChange(event.target.checked)}/></label><button className="menu-primary" onClick={()=>onNavigate('training')}>Set up training<span aria-hidden>→</span></button></div>}
    {section==='connection'&&<div className="menu-settings-explanation"><div className="menu-setting-row"><label htmlFor="menu-connection-mode">Connection mode</label><select id="menu-connection-mode" value={game.connectionMode} onChange={event=>game.onConnectionModeChange(event.target.value as 'relay'|'local')}><option value="relay">Internet relay</option><option value="local">LAN / Direct</option></select></div><dl className="menu-facts"><div><dt>Match connection</dt><dd>{game.connectionStatus}</dd></div><div><dt>Room code</dt><dd>{game.hostIdCode||'Not hosting'}</dd></div><div><dt>Public IP</dt><dd>{game.userIp||'Unavailable'}</dd></div><div><dt>LAN IP</dt><dd>{game.lanIp||'Unavailable'}</dd></div></dl>{game.connectionError&&<p role="status" className="menu-error">{game.connectionError}</p>}<label className="menu-stacked-field" htmlFor="menu-matchmaker">Custom matchmaker URL<input id="menu-matchmaker" value={game.customUrlInput} onChange={event=>game.onCustomUrlInputChange(event.target.value)} placeholder="wss://relay.example" autoComplete="off"/></label><div className="menu-actions"><button className="menu-primary" onClick={game.onApplyMatchmakerUrl}>Apply connection</button><button className="menu-secondary" onClick={game.onResetMatchmakerUrl}>Reset</button></div><p className="menu-note">Connection changes use your existing relay configuration. Return to Online Play to host or join a match.</p></div>}
    {section==='about'&&<div className="menu-settings-explanation"><span className="menu-eyebrow">IBRAWLS · {appVersion}</span><h3>Built for the arena.</h3><p>A browser arena game with local AI, tournaments, online matches, replay tools, and custom content editors.</p><p>The menu uses the game’s actual Iron Vanguard models and captured gameplay. Character and map upgrades remain part of the game’s asset pipeline.</p><button className="menu-secondary" onClick={()=>onNavigate('create')}>Explore creative tools →</button></div>}
  </section></div>;
}
