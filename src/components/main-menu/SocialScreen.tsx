import React, { useEffect, useState } from 'react';
import type { MainMenuBroadcastRail } from './MainMenuBroadcastRail';
import { GlobalChatPanel, PlayerListSubframe } from './GlobalBroadcastPanel';

export type SocialScreenProps = React.ComponentProps<typeof MainMenuBroadcastRail> & {
  onBrowseLobbies?: () => void;
  onOpenProfile?: () => void;
};

export function SocialScreen({
  onlineClients, clientId, connectionStatus, connectionMode, menuSocket, hostIdCode,
  onJoinGame, setInviteNotifications, lobbyChatMessages, onSendLobbyChatMessage,
  playerName, onBrowseLobbies, onOpenProfile,
}: SocialScreenProps) {
  const [socketState, setSocketState] = useState(menuSocket?.readyState ?? 3);
  useEffect(() => {
    const update = () => setSocketState(menuSocket?.readyState ?? 3);
    update();
    menuSocket?.addEventListener('open', update);
    menuSocket?.addEventListener('close', update);
    menuSocket?.addEventListener('error', update);
    return () => {
      menuSocket?.removeEventListener('open', update);
      menuSocket?.removeEventListener('close', update);
      menuSocket?.removeEventListener('error', update);
    };
  }, [menuSocket]);
  const connected = socketState === 1;
  const connectionLabel = connected ? 'Connected' : socketState === 0 ? 'Connecting' : 'Disconnected';

  return (
    <div className="menu-social-screen">
      <section className="menu-social-directory" aria-labelledby="menu-social-players-title">
        <div className="menu-social-directory-heading"><div><span className="menu-ps-eyebrow">In the game</span><h2 id="menu-social-players-title">Online players <span>{onlineClients.length}</span></h2></div>{onBrowseLobbies && <button className="menu-ps-text-button" type="button" onClick={onBrowseLobbies}>Browse lobbies ↗</button>}</div>
        <PlayerListSubframe presentation="screen" onlineClients={onlineClients} clientId={clientId} connectionStatus={connectionStatus} connectionMode={connectionMode} menuSocket={menuSocket} hostIdCode={hostIdCode} onJoinGame={onJoinGame} setInviteNotifications={setInviteNotifications} />
        <div className="menu-social-directory-foot"><span>{playerName || 'Spartan'}{clientId ? ` · ID: ${clientId}` : ''}</span>{onOpenProfile && <button className="menu-ps-text-button" type="button" onClick={onOpenProfile}>Your profile →</button>}</div>
      </section>
      <aside className="menu-social-broadcast" aria-labelledby="menu-social-broadcast-title">
        <figure className="menu-social-art"><img src="/assets/menu/online-iron-vanguard.png" alt="Four V3 Iron Vanguard game models standing ready" /><figcaption>Iron Vanguard · Ready for the arena</figcaption></figure>
        <div className="menu-social-broadcast-heading"><div><span className="menu-ps-eyebrow">Global channel</span><h2 id="menu-social-broadcast-title">Broadcast</h2></div><span className="menu-social-connection" data-connected={connected} role="status"><i aria-hidden="true" />{connectionLabel}</span></div>
        <GlobalChatPanel presentation="screen" messages={lobbyChatMessages} onSendMessage={onSendLobbyChatMessage} disabled={!connected} />
      </aside>
    </div>
  );
}
