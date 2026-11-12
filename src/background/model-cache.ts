// Model file cache backed by IndexedDB. Transformers.js accepts any object with the Cache API's
// match/put, and IndexedDB is dependable inside extension pages (with unlimitedStorage), which
// the Cache API historically has not been in Firefox-based browsers.

const DB_NAME = 'grammaid-models';
const STORE = 'files';

interface Entry {
  url: string;
  blob: Blob;
  size: number;
  type: string;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'url' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the model cache.'));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error ?? new Error('Model cache transaction aborted.'));
      }),
  );
}

export const modelCache = {
  async match(url: string): Promise<Response | undefined> {
    const entry = (await request('readonly', (s) => s.get(url))) as Entry | undefined;
    if (!entry) return undefined;
    return new Response(entry.blob, {
      status: 200,
      headers: { 'content-length': String(entry.size), 'content-type': entry.type || 'application/octet-stream' },
    });
  },

  async put(url: string, response: Response): Promise<void> {
    const blob = await response.blob();
    const entry: Entry = {
      url,
      blob,
      size: blob.size,
      type: response.headers.get('content-type') ?? '',
      savedAt: Date.now(),
    };
    await request('readwrite', (s) => s.put(entry));
  },

  async delete(url: string): Promise<boolean> {
    await request('readwrite', (s) => s.delete(url));
    return true;
  },
};

/** Total bytes of cached model files. */
export async function cacheSize(): Promise<number> {
  const db = await open();
  return new Promise<number>((resolve, reject) => {
    let total = 0;
    const cursor = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve(total);
      total += (c.value as Entry).size ?? 0;
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

export async function clearCache(): Promise<void> {
  await request('readwrite', (s) => s.clear());
}
