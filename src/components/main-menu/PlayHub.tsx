import React, { useState } from 'react';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import type { MenuScreen } from './menuNavigation';
import type { MainMenuPrimaryPanel } from './MainMenuPrimaryPanel';
import { TopDownMapPreview } from '../loading/TopDownMapPreview';

type Props = { game: React.ComponentProps<typeof MainMenuPrimaryPanel>; onNavigate: (screen: MenuScreen) => void };
const modes = [
  { id: 'training', title: 'Training', description: 'Practice against configurable AI.', image: 'training', summary: 'Your arena. Your rules. Build a match at your own pace.', action: 'Set up training' },
  { id: 'tournament', title: 'Tournament', description: 'Fight through an elimination bracket.', image: 'tournament', summary: 'Set your challenge and work your way through the bracket.', action: 'Set up tournament' },
  { id: 'online', title: 'Online Play', description: 'Find a match or play with friends.', image: 'online', summary: 'Find an open match, host your own, or join friends.', action: 'Explore online play' },
] as const;

export function PlayHub({ game, onNavigate }: Props) {
  const [selected, setSelected] = useState(0);
  const mode = modes[selected];
  const tournamentRounds = game.tournamentState?.roundCount ?? game.tournamentRoundCount;
  const tournamentKills = game.tournamentState?.killsToWin ?? game.tournamentKillsToWin;
  const mapName = game.selectedMap === 'hangar' ? 'Industrial Hangar' : game.selectedMap === 'circle' ? 'Circle Arena' : game.selectedMap === 'custom_file' ? game.lobbyCustomMapData?.name || 'Custom map' : PREMADE_MAPS.find(map => map.id === game.selectedMap)?.name || 'Arena';
  const continuing = mode.id === 'tournament' ? Boolean(game.tournamentState) : mode.id === 'online' && Boolean(game.matchLobbyConfig && game.multiplayerRole);
  return <div className="menu-play-grid">
    <div className="menu-mode-list" role="radiogroup" aria-label="Game mode">
      {modes.map((item,index) => <button key={item.id} role="radio" aria-checked={index === selected} tabIndex={index === selected ? 0 : -1} className="menu-mode-card" onClick={() => setSelected(index)} onKeyDown={event => {
        if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (['ArrowDown','ArrowRight'].includes(event.key) ? 1 : 2)) % 3;
          setSelected(next); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
        } else if(event.key === 'Enter') { event.preventDefault(); onNavigate(item.id); }
      }}><img src={`/assets/menu/${item.image}-iron-vanguard.png`} alt=""/><span className="menu-mode-copy"><strong>{item.title}</strong><span>{item.description}</span></span><span className="menu-selected-label">Selected</span></button>)}
    </div>
    <aside className="menu-play-detail">
      <div className="menu-arena-preview">{mode.id === 'training' && game.selectedMap !== 'championship_stadium' ? <TopDownMapPreview selectedMap={game.selectedMap} customMap={game.lobbyCustomMapData} /> : <img src="/assets/menu/stadium-gameplay.png" alt="Actual V3 Iron Vanguard gameplay on Championship Stadium"/>}<span>{mode.id === 'training' && game.selectedMap !== 'championship_stadium' ? `${mapName} · Arena preview` : 'Championship Stadium · Gameplay capture'}</span></div>
      <div className="menu-play-copy"><h2>{mode.title}</h2><p>{mode.summary}</p>
        <dl className="menu-facts">{mode.id === 'training' ? <><div><dt>Map</dt><dd>{mapName}</dd></div><div><dt>Mode</dt><dd>{game.adminSettings.gameMode === 'grifball' ? 'Grifball · 4v4' : 'Combat sandbox'}</dd></div></> : mode.id === 'tournament' ? <><div><dt>Format</dt><dd>Elimination bracket</dd></div><div><dt>Setup</dt><dd>{tournamentRounds} rounds · First to {tournamentKills}</dd></div></> : <><div><dt>Play</dt><dd>Quick Play or browse lobbies</dd></div><div><dt>Custom</dt><dd>Host a match or join by code</dd></div></>}</dl>
        <button className="menu-primary" onClick={() => onNavigate(mode.id)}>{continuing ? mode.id === 'tournament' ? 'Continue tournament' : 'Return to lobby' : mode.action}<span aria-hidden>→</span></button>
        <small>{mode.id === 'training' ? 'Choose your map, roster, and rules.' : mode.id === 'tournament' ? 'Configure the bracket before your next match.' : 'Matchmaking and lobbies live on the next screen.'}</small>
      </div>
    </aside>
  </div>;
}
