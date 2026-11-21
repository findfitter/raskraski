// IndexedDB: кэш карт областей и прогресс раскрашивания.
const DB_NAME = 'raskraska';
const DB_VER = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('regions')) db.createObjectStore('regions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getRegions = (id) => tx('regions', 'readonly', (s) => s.get(id));
export const putRegions = (rec) => tx('regions', 'readwrite', (s) => s.put(rec));
export const delRegions = (id) => tx('regions', 'readwrite', (s) => s.delete(id));
export const getProgress = (id) => tx('progress', 'readonly', (s) => s.get(id));
export const putProgress = (rec) => tx('progress', 'readwrite', (s) => s.put(rec));
export const allProgress = () => tx('progress', 'readonly', (s) => s.getAll());
export const delProgress = (id) => tx('progress', 'readwrite', (s) => s.delete(id));
