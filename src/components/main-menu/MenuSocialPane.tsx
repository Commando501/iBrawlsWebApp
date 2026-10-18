import React, { useEffect, useState } from 'react';
import SpartanIdentityAccount from '../SpartanIdentityAccount';
import { GlobalChatPanel } from './GlobalBroadcastPanel';
import type { MainMenuBroadcastRail } from './MainMenuBroadcastRail';

type Props = React.ComponentProps<typeof MainMenuBroadcastRail> & {
  onOpenProfile: () => void;
  onOpenSocial: () => void;
};

/** Stays mounted across menu destinations so chat and sign-in drafts survive. */
export function MenuSocialPane({ account, playerName, playerHue, menuSocket, onlineClients,
  lobbyChatMessages, onSendLobbyChatMessage, onRegistered, onLoggedIn, onLoggedOut,
  onAccountChanged, onOpenProfile, onOpenSocial }: Props) {
  const [socketState, setSocketState] = useState(menuSocket?.readyState ?? 3);
  useEffect(() => {
    const update = () => setSocketState(menuSocket?.readyState ?? 3);
    update();
    for (const event of ['open', 'close', 'error']) menuSocket?.addEventListener(event, update);
    return () => { for (const event of ['open', 'close', 'error']) menuSocket?.removeEventListener(event, update); };
  }, [menuSocket]);
  const connected = socketState === 1;
  return <aside className="menu-social-pane" aria-label="Social and account">
    <div className="menu-social-pane-header"><h2>Social</h2><button type="button" onClick={onOpenSocial}>Players · {onlineClients.length} ↗</button></div>
    <div className="menu-social-identity">
      <button type="button" className="menu-social-profile" onClick={onOpenProfile}>
        <i aria-hidden="true" style={{ background: `hsl(${playerHue ?? 200},65%,52%)` }} />
        <span><strong>{playerName || 'Spartan'}</strong><small>{account ? `Signed in as @${account.username}` : 'Guest · Not signed in'}</small></span>
      </button>
      <SpartanIdentityAccount presentation="social" account={account} playerName={playerName}
        onRegistered={onRegistered} onLoggedIn={onLoggedIn} onLoggedOut={onLoggedOut} onAccountChanged={onAccountChanged} />
    </div>
    <div className="menu-social-channel"><strong>Global chat</strong><span role="status"><i className="menu-status-dot" data-connected={connected} />{connected ? 'Connected' : socketState === 0 ? 'Connecting' : 'Disconnected'}</span></div>
    <GlobalChatPanel messages={lobbyChatMessages} onSendMessage={onSendLobbyChatMessage} disabled={!connected} />
  </aside>;
}
