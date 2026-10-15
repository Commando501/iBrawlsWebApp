interface WorkerReference {
  scriptURL: string;
}

interface AppWorkerRegistration {
  active: WorkerReference | null;
  installing: WorkerReference | null;
  waiting: WorkerReference | null;
  unregister: () => Promise<boolean>;
}

interface DevelopmentWorkerEnvironment {
  origin: string;
  serviceWorkers?: {
    controller: WorkerReference | null;
    getRegistrations: () => Promise<readonly AppWorkerRegistration[]>;
  };
  cacheStorage?: Pick<CacheStorage, 'keys' | 'delete'>;
}

/** Returns true only when this document needs a reload to release its old worker. */
export async function clearDevelopmentServiceWorker({
  origin,
  serviceWorkers,
  cacheStorage,
}: DevelopmentWorkerEnvironment): Promise<boolean> {
  const isAppWorker = (worker: WorkerReference | null): boolean => {
    if (!worker) return false;
    const script = new URL(worker.scriptURL);
    return script.origin === origin && script.pathname === '/sw.js';
  };
  const isAppRegistration = (registration: AppWorkerRegistration): boolean =>
    [registration.active, registration.installing, registration.waiting].some(isAppWorker);

  if (serviceWorkers) {
    const registrations = await serviceWorkers.getRegistrations();
    await Promise.all(registrations.filter(isAppRegistration).map((registration) => registration.unregister()));
  }
  if (cacheStorage) {
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((name) => name.startsWith('ibrawls-pwa-')).map((name) => cacheStorage.delete(name)));
  }

  if (!serviceWorkers || !isAppWorker(serviceWorkers.controller)) return false;
  // Unregister does not release an already controlled document. Verify that a
  // reload will be uncontrolled before requesting it, so failed cleanup cannot loop.
  const remaining = await serviceWorkers.getRegistrations();
  if (remaining.some(isAppRegistration)) {
    throw new Error('The development service worker is still registered; reload skipped.');
  }
  return true;
}
