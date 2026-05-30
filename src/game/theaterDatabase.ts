import { ReplayFile } from '../types';

/** Serialized IndexedDB payload size in bytes (UTF-8). */
export function getReplayStorageSizeBytes(replay: ReplayFile): number {
  return new TextEncoder().encode(JSON.stringify(replay)).length;
}

export function formatReplaySizeMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const DB_NAME = 'iBrawlsTheater';
const DB_VERSION = 1;
const SAVED_STORE = 'replays';
const CACHED_STORE = 'cached_replays';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVED_STORE)) {
        db.createObjectStore(SAVED_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CACHED_STORE)) {
        db.createObjectStore(CACHED_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Get all saved (permanent) replays
export async function getSavedReplays(): Promise<ReplayFile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SAVED_STORE, 'readonly');
    const store = transaction.objectStore(SAVED_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result as ReplayFile[];
      // Sort by date descending
      results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      resolve(results);
    };

    request.onerror = () => reject(request.error);
  });
}

// Get all cached (rolling auto-save) replays
export async function getCachedReplays(): Promise<ReplayFile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CACHED_STORE, 'readonly');
    const store = transaction.objectStore(CACHED_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result as ReplayFile[];
      // Sort by date descending
      results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      resolve(results);
    };

    request.onerror = () => reject(request.error);
  });
}

// Save a replay permanently
export async function saveReplay(replay: ReplayFile): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SAVED_STORE, 'readwrite');
    const store = transaction.objectStore(SAVED_STORE);
    replay.isAutoSaved = false;
    const request = store.put(replay);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Delete a replay from a specific store
export async function deleteReplay(id: string, isCached: boolean): Promise<void> {
  const db = await openDB();
  const storeName = isCached ? CACHED_STORE : SAVED_STORE;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Update name and description of a saved replay
export async function updateReplayMeta(id: string, name: string, description: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SAVED_STORE, 'readwrite');
    const store = transaction.objectStore(SAVED_STORE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const replay = getRequest.result as ReplayFile;
      if (!replay) {
        reject(new Error(`Replay with ID ${id} not found.`));
        return;
      }
      replay.name = name;
      replay.description = description;
      const putRequest = store.put(replay);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

// Push a replay to the auto-save cache, maintaining a strict limit of 5 matches
export async function cacheReplay(replay: ReplayFile): Promise<void> {
  const db = await openDB();
  
  // 1. Save the new replay into cached store
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(CACHED_STORE, 'readwrite');
    const store = transaction.objectStore(CACHED_STORE);
    replay.isAutoSaved = true;
    const request = store.put(replay);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // 2. Query all cached replays, sort, and evict the 6th-oldest or later
  const cachedList = await getCachedReplays();
  if (cachedList.length > 5) {
    const toEvict = cachedList.slice(5); // Everything beyond index 4
    for (const item of toEvict) {
      await deleteReplay(item.id, true);
      console.log(`Auto-evicted oldest cached replay: ${item.name} (${item.date})`);
    }
  }
}

// Save a cached replay permanently (clones from cache list to permanent list with custom meta details)
export async function saveCachedReplay(id: string, customName: string, customDescription: string): Promise<void> {
  const db = await openDB();
  
  // 1. Fetch from Cache
  const cachedReplay = await new Promise<ReplayFile | undefined>((resolve, reject) => {
    const transaction = db.transaction(CACHED_STORE, 'readonly');
    const store = transaction.objectStore(CACHED_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!cachedReplay) {
    throw new Error(`Replay with ID ${id} not found in auto-save cache.`);
  }

  // 2. Clone it, update details, and insert into Saved Store
  const permanentReplay: ReplayFile = {
    ...cachedReplay,
    name: customName,
    description: customDescription,
    isAutoSaved: false
  };

  await saveReplay(permanentReplay);
}
