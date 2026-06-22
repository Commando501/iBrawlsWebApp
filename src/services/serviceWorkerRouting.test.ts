import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

type FetchListener = (event: {
  request: RequestLike;
  respondWith: (response: Promise<Response>) => void;
}) => void;

interface RequestLike {
  method: string;
  mode: string;
  url: string;
  destination?: string;
}

const createNavigationRequest = (path: string): RequestLike => ({
  method: 'GET',
  mode: 'navigate',
  url: `http://localhost${path}`,
  destination: 'document',
});

function loadServiceWorker(fetchImpl: (request: RequestLike) => Promise<Response>) {
  const fetchListeners: FetchListener[] = [];
  const cacheEntries = new Map<string, Response>();
  cacheEntries.set('/index.html', new Response('app shell'));

  const cache = {
    addAll: async () => undefined,
    put: async (request: RequestLike | string, response: Response) => {
      const key = typeof request === 'string' ? request : request.url;
      cacheEntries.set(key, response);
    },
    match: async (request: RequestLike | string) => {
      const key = typeof request === 'string' ? request : request.url;
      return cacheEntries.get(key);
    },
  };

  const context = {
    URL,
    Response,
    fetch: fetchImpl,
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: cache.match,
    },
    self: {
      location: { origin: 'http://localhost' },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
      addEventListener: (type: string, listener: FetchListener) => {
        if (type === 'fetch') fetchListeners.push(listener);
      },
    },
  };

  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), context);

  return {
    async fetch(request: RequestLike): Promise<Response> {
      let responsePromise: Promise<Response> | undefined;
      fetchListeners[0]({
        request,
        respondWith: (response) => {
          responsePromise = response;
        },
      });
      assert.ok(responsePromise, 'service worker did not handle fetch request');
      return responsePromise;
    },
  };
}

describe('service worker routing', () => {
  it('keeps app-shell offline fallback for the main app route', async () => {
    const serviceWorker = loadServiceWorker(async () => {
      throw new Error('network unavailable');
    });

    const response = await serviceWorker.fetch(createNavigationRequest('/'));

    assert.equal(await response.text(), 'app shell');
  });

  it('does not app-shell fallback standalone animation editor document routes', async () => {
    const serviceWorker = loadServiceWorker(async () => {
      throw new Error('network unavailable');
    });

    await assert.rejects(
      serviceWorker.fetch(createNavigationRequest('/v3-clean-animation-editor.html')),
      /network unavailable/
    );
    await assert.rejects(
      serviceWorker.fetch(createNavigationRequest('/v3-mesh2motion-rig-calibrator.html')),
      /network unavailable/
    );
  });
});
