/* db.js - capa IndexedDB para Mi App
   Diseño: API basada en Promesas con utilidades de import/export e índices útiles.
*/

const DB_NAME = 'app-db';
const DB_VERSION = 1;
const STORE_ITEMS = 'items';

export async function initDB() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);

    open.onupgradeneeded = (event) => {
      const db = open.result;

      // Crea el store si no existe
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        // Índices para consultas comunes
        store.createIndex('byCreatedAt', 'createdAt', { unique: false });
        store.createIndex('byText', 'textNorm', { unique: false });
      } else if (event.oldVersion < 1) {
        // Migraciones futuras aquí (switch por version si crece)
      }
    };

    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () =>
      console.warn('[db] Actualización bloqueada; cierra otras pestañas.');
  });
}

// Utilidad transaccional
async function withStore(mode, fn) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ITEMS, mode);
    const store = tx.objectStore(STORE_ITEMS);

    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const fail = (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };

    tx.oncomplete = () => done(undefined);
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error || new Error('Transacción abortada'));

    Promise.resolve(fn(store, tx)).then(done, fail);
  });
}

// Normalización básica para índice de texto
function normalizeText(s) {
  return (s ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')                 // separa diacríticos
    .replace(/\p{Diacritic}/gu, '');  // quita diacríticos
}

// UUID v4 simple (no-crypto para compatibilidad amplia)
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = (c === 'x') ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ===== Operaciones CRUD ===== */

export async function addItem({ text, meta } = {}) {
  const now = Date.now();
  const item = {
    id: uuid(),
    text: text ?? '',
    textNorm: normalizeText(text ?? ''),
    meta: meta ?? {},
    createdAt: now,
    updatedAt: now,
  };

  await withStore('readwrite', (store) => store.add(item));
  return item;
}

export async function getItem(id) {
  return withStore('readonly', (store) => store.get(id));
}

export async function getAllItems({ sortBy = 'createdAt', direction = 'desc' } = {}) {
  // Lee por índice para ordenar por fecha
  return withStore('readonly', (store) =>
    new Promise((resolve, reject) => {
      const idxName = sortBy === 'createdAt' ? 'byCreatedAt' : null;
      const source = idxName ? store.index(idxName) : store;
      const dir = direction === 'asc' ? 'next' : 'prev';

      const results = [];
      const req = source.openCursor(null, dir);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    })
  );
}

export async function updateItem(id, patch = {}) {
  return withStore('readwrite', async (store) => {
    const existing = await new Promise((res, rej) => {
      const r = store.get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!existing) throw new Error(`Item ${id} no existe`);

    const next = {
      ...existing,
      ...patch,
      // Mantén el índice de texto actualizado
      ...(patch.text !== undefined ? { textNorm: normalizeText(patch.text) } : {}),
      updatedAt: Date.now(),
    };
    await new Promise((res, rej) => {
      const r = store.put(next);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
    return next;
  });
}

export async function deleteItem(id) {
  await withStore('readwrite', (store) => store.delete(id));
}

export async function clearItems() {
  await withStore('readwrite', (store) => store.clear());
}

export async function countItems() {
  return withStore('readonly', (store) =>
    new Promise((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

/* ===== Búsqueda por prefijo normalizado ===== */
export async function findByTextPrefix(prefix) {
  const p = normalizeText(prefix || '');
  if (!p) return [];

  return withStore('readonly', (store) =>
    new Promise((resolve, reject) => {
      const index = store.index('byText');
      // Rango de prefijo: [p, p + \uffff]
      const range = IDBKeyRange.bound(p, p + '\uffff');
      const results = [];
      const req = index.openCursor(range, 'next');

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    })
  );
}

/* ===== Export/Import ===== */

export async function exportItems() {
  const all = await getAllItems({ sortBy: 'createdAt', direction: 'asc' });
  return {
    exportedAt: new Date().toISOString(),
    version: DB_VERSION,
    items: all,
  };
}

export async function importItems(payload, { merge = true } = {}) {
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error('Formato de import no válido');
  }
  const incoming = payload.items;

  await withStore('readwrite', async (store) => {
    if (!merge) {
      await new Promise((res, rej) => {
        const r = store.clear();
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    }

    for (const raw of incoming) {
      const item = {
        id: raw.id || uuid(),
        text: raw.text ?? '',
        textNorm: normalizeText(raw.text ?? ''),
        meta: raw.meta ?? {},
        createdAt: raw.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      await new Promise((res, rej) => {
        const r = store.put(item);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    }
  });
}
