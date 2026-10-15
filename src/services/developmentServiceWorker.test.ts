import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDevelopmentServiceWorker } from './developmentServiceWorker';

const origin = 'http://localhost:3000';
const worker = (path: string) => ({ scriptURL: new URL(path, origin).href });

function environment() {
  const registrations: Array<{
    active: ReturnType<typeof worker> | null;
    installing: ReturnType<typeof worker> | null;
    waiting: ReturnType<typeof worker> | null;
    unregister: () => Promise<boolean>;
  }> = [];
  const removed: string[] = [];
  const cacheNames = new Set(['ibrawls-pwa-v1-shell', 'ibrawls-pwa-v2-runtime', 'unrelated-cache']);
  const serviceWorkers = {
    controller: worker('/sw.js') as ReturnType<typeof worker> | null,
    getRegistrations: async () => [...registrations],
  };
  const cacheStorage = {
    keys: async () => [...cacheNames],
    delete: async (name: string) => cacheNames.delete(name),
  };
  const add = (path: string, slot: 'active' | 'installing' | 'waiting' = 'active') => {
    const registration = {
      active: null as ReturnType<typeof worker> | null,
      installing: null as ReturnType<typeof worker> | null,
      waiting: null as ReturnType<typeof worker> | null,
      unregister: async () => {
        removed.push(path);
        registrations.splice(registrations.indexOf(registration), 1);
        return true;
      },
    };
    registration[slot] = worker(path);
    registrations.push(registration);
    return registration;
  };
  return { origin, serviceWorkers, cacheStorage, registrations, removed, cacheNames, add };
}

test('development cleanup removes only this origin /sw.js registrations and iBrawls caches', async () => {
  const env = environment();
  env.add('/sw.js');
  env.add('/sw.js?v=2', 'waiting');
  env.add('/sw.js?v=3', 'installing');
  env.add('/other-app/sw.js');
  env.add('https://other.example/sw.js');

  assert.equal(await clearDevelopmentServiceWorker(env), true);
  assert.deepEqual(env.removed, ['/sw.js', '/sw.js?v=2', '/sw.js?v=3']);
  assert.equal(env.registrations.length, 2);
  assert.deepEqual([...env.cacheNames], ['unrelated-cache']);
});

test('the subsequent uncontrolled load does not request another reload', async () => {
  const env = environment();
  env.add('/sw.js');
  assert.equal(await clearDevelopmentServiceWorker(env), true);
  env.serviceWorkers.controller = null;
  assert.equal(await clearDevelopmentServiceWorker(env), false);
});

test('unrelated controlling workers do not cause reloads', async () => {
  const env = environment();
  env.serviceWorkers.controller = worker('/other-app/sw.js');
  env.add('/other-app/sw.js');
  assert.equal(await clearDevelopmentServiceWorker(env), false);
  assert.deepEqual(env.removed, []);
});

test('failed unregistration cannot trigger a reload loop', async () => {
  const env = environment();
  const registration = env.add('/sw.js');
  registration.unregister = async () => false;
  await assert.rejects(clearDevelopmentServiceWorker(env), /still registered; reload skipped/);
});

test('cache cleanup also works without service-worker support', async () => {
  const env = environment();
  assert.equal(await clearDevelopmentServiceWorker({ origin, cacheStorage: env.cacheStorage }), false);
  assert.deepEqual([...env.cacheNames], ['unrelated-cache']);
});
