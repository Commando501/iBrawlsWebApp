import { retainedReports, type LabRun } from './labReport';
const DATABASE = 'ibrawls-grifball-validation';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Report storage unavailable'));
    request.onblocked = () => reject(new Error('Report storage is blocked by another tab. Close it and retry.'));
  });
}
export async function listLabRuns(): Promise<LabRun[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly'); const request = tx.objectStore('reports').getAll();
    tx.oncomplete = () => resolve((request.result as LabRun[]).sort((a, b) => b.createdAt - a.createdAt));
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function saveLabRun(run: LabRun): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite'), store = tx.objectStore('reports'), request = store.getAll();
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const keep = retainedReports(request.result, run);
        for (const old of request.result as LabRun[]) if (!keep.some(r => r.id === old.id)) store.delete(old.id);
        store.put(run);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure ?? tx.error); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Report checkpoint failed'));
  }); } finally { db.close(); }
}
export async function deleteLabRun(id: string): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite'); tx.objectStore('reports').delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
