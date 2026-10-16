import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';

// The Worker has its own compiler/types. Keep its Cloudflare globals out of the
// browser app's TypeScript graph while executing the actual Worker in this test.
const workerModuleUrl = new URL('../../worker/src/index.ts', import.meta.url).href;
const { GameLobby } = await import(workerModuleUrl);

type Message = Record<string, any>;
interface Client {
  messages: Message[];
  send(message: Message): Promise<void>;
  wait(type: string | string[]): Promise<Message>;
  close(): Promise<void>;
}

class WorkerSocket {
  readyState: number = WebSocket.OPEN;
  messages: Message[] = [];
  listeners = new Map<string, ((event: any) => unknown)[]>();
  accept() {}
  send(raw: string) { this.messages.push(JSON.parse(raw)); }
  addEventListener(type: string, listener: (event: any) => unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  async receive(message: Message) {
    for (const listener of this.listeners.get('message') ?? []) await listener({ data: JSON.stringify(message) });
  }
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    for (const listener of this.listeners.get('close') ?? []) listener({});
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForMessage(messages: Message[], type: string | string[]) {
  const types = Array.isArray(type) ? type : [type];
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const message = messages.find((entry) => types.includes(entry.type));
    if (message) return message;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${type}; received ${messages.map((entry) => entry.type).join(', ')}`);
}

async function makeLocalRelay(t: TestContext) {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill(); });
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local relay startup timed out')), 10000);
    child.once('error', reject);
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Local relay exited before startup')); });
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`Server running on http://localhost:${port}`)) { clearTimeout(timeout); resolve(); }
    });
    child.stderr.resume();
  });
  return async (): Promise<Client> => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?type=gameplay`);
    const messages: Message[] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const close = async () => {
      if (socket.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => socket.terminate(), 500);
        socket.once('close', () => { clearTimeout(timer); resolve(); });
        socket.close();
      });
    };
    t.after(close);
    return { messages, send: async (message) => { socket.send(JSON.stringify(message)); }, wait: (type) => waitForMessage(messages, type), close };
  };
}

for (const relayType of ['Worker', 'Node'] as const) {
  test(`${relayType} relay joins only requested registered rooms`, { timeout: 20000 }, async (t) => {
    const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
    Object.defineProperty(globalThis, 'WebSocket', { value: WebSocket, configurable: true });
    t.after(() => {
      if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket);
      else Reflect.deleteProperty(globalThis, 'WebSocket');
    });
    const lobby = new GameLobby({} as any, {} as any);
    const connect = relayType === 'Node' ? await makeLocalRelay(t) : async (): Promise<Client> => {
      const socket = new WorkerSocket();
      await lobby.handleSession(socket as any, 'gameplay', null);
      t.after(() => socket.close());
      return {
        messages: socket.messages,
        send: (message) => socket.receive(message),
        wait: (type) => waitForMessage(socket.messages, type),
        close: async () => socket.close(),
      };
    };
    const host = await connect();
    await host.send({ type: 'host', customId: 'QP_123456', ip: '203.0.113.17', lanIp: '192.168.1.17',
      lobbyConfig: { access: 'open', maxPlayers: 8, allowObservers: true, visualModelPolicy: 'v3' } });
    const hosted = await host.wait('hosted');

    await t.test('unknown code, address and empty target are rejected with another room active', async () => {
      for (const targetIpOrId of ['654321', 'QP_654321', '192.168.1.99', '']) {
        const guest = await connect();
        await guest.send({ type: 'join', targetIpOrId });
        const response = await guest.wait(['error', 'connected']);
        assert.equal(response.type, 'error', `Unknown target ${targetIpOrId} must not enter the first active room`);
        assert.match(response.message, /match not found/i);
        await guest.close();
      }
    });

    await t.test('normalized code and exact registered public/LAN addresses preserve direct join', async () => {
      for (const targetIpOrId of [' qp_123456 ', '203.0.113.17', '192.168.1.17']) {
        const guest = await connect();
        await guest.send({ type: 'join', targetIpOrId });
        const joined = await guest.wait('connected');
        assert.equal(joined.hostClientId, hosted.clientId);
        assert.equal(joined.role, 'client');
        assert.equal(joined.lobbyConfig.visualModelPolicy, 'v3');
        await guest.close();
      }
    });

    await t.test('registered six-digit room code joins its own host', async () => {
      const secondHost = await connect();
      await secondHost.send({ type: 'host', customId: '765432', lobbyConfig: { access: 'open' } });
      const secondHosted = await secondHost.wait('hosted');
      const guest = await connect();
      await guest.send({ type: 'join', targetIpOrId: '765432' });
      assert.equal((await guest.wait('connected')).hostClientId, secondHosted.clientId);
      await guest.close();
      await secondHost.close();
    });
    await t.test('closed room code cannot join the remaining active room', async () => {
      const guest = await connect();
      await guest.send({ type: 'join', targetIpOrId: '765432' });
      const response = await guest.wait(['error', 'connected']);
      assert.equal(response.type, 'error');
      assert.match(response.message, /match not found/i);
      await guest.close();
    });
    await host.close();
  });
}
