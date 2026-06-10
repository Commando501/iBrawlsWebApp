import assert from 'node:assert/strict';
import test from 'node:test';
import { getOnlineClientDisplayName, type OnlineClient } from './onlineClients';

test('online client display prefers canonical public display name without truncating suffix', () => {
  const client: OnlineClient = {
    id: 'guest-1',
    name: 'ASpence501',
    publicDisplayName: 'ASpence501#1001',
    state: 'menu',
  };

  assert.equal(getOnlineClientDisplayName(client), 'ASpence501#1001');
});
