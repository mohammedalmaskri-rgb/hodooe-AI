import { closeDB, DB_NAME } from './db';

/** Permanently deletes ALL experiment data on this device (database + local preferences). */
export async function wipeAllData(): Promise<void> {
  await closeDB();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // deletion completes once other tabs close
  });
  for (const store of [localStorage, sessionStorage]) {
    try {
      Object.keys(store)
        .filter((k) => k.startsWith('hodoor.'))
        .forEach((k) => store.removeItem(k));
    } catch {
      /* storage unavailable */
    }
  }
}
