import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import type { AccountInfo } from '../../services/account';
import type { ChatMessage } from '../ChatOverlay';
import type { OnlineClient } from '../../network/onlineClients';
import {
  GlobalChatPanel,
  PilotIdentitySubframe,
  PlayerListSubframe,
} from './GlobalBroadcastPanel';
import { MainMenuBroadcastRail } from './MainMenuBroadcastRail';

const noop = () => {};
const accountNoop = (_account: AccountInfo) => {};

function directChildTypes(element: React.ReactNode): unknown[] {
  if (!React.isValidElement(element)) return [];
  const children = React.Children.toArray(element.props.children);
  const container = children.find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && child.type === 'div'
  );

  return container && React.isValidElement(container)
    ? React.Children.toArray(container.props.children)
        .filter(React.isValidElement)
        .map((child) => child.type)
    : [];
}

test('MainMenuBroadcastRail places pilot identity before player list and chat', () => {
  const element = MainMenuBroadcastRail({
    account: null,
    playerName: 'Spartan',
    playerHue: 200,
    onlineClients: [] as OnlineClient[],
    clientId: 'local',
    connectionStatus: 'idle',
    connectionMode: 'relay',
    menuSocket: null,
    hostIdCode: '',
    lobbyChatMessages: [] as ChatMessage[],
    onPlayerNameChange: noop,
    onRegistered: accountNoop,
    onLoggedIn: accountNoop,
    onLoggedOut: noop,
    onAccountChanged: accountNoop,
    onJoinGame: noop,
    setInviteNotifications: noop as React.Dispatch<React.SetStateAction<string[]>>,
    onSendLobbyChatMessage: noop,
  });

  const childTypes = directChildTypes(element);

  assert.equal(childTypes[1], PilotIdentitySubframe);
  assert.equal(childTypes[2], PlayerListSubframe);
  assert.equal(childTypes[3], GlobalChatPanel);
});
