import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ClassRoom, Section, SettingKey, SettingsMap, Student, StudentPhoto, TestRun } from './types';

export const DB_NAME = 'hodoor-ai';
export const DB_VERSION = 1;

export interface HodoorSchema extends DBSchema {
  classes: { key: string; value: ClassRoom };
  sections: { key: string; value: Section; indexes: { byClass: string } };
  students: {
    key: string;
    value: Student;
    indexes: { byStudentNo: string; byClass: string; bySection: string };
  };
  photos: { key: string; value: StudentPhoto };
  testRuns: { key: string; value: TestRun; indexes: { byStartedAt: number } };
  settings: { key: SettingKey; value: { key: SettingKey; value: SettingsMap[SettingKey] } };
}

export type HodoorDB = IDBPDatabase<HodoorSchema>;

export function openHodoorDB(name = DB_NAME): Promise<HodoorDB> {
  return openDB<HodoorSchema>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('classes', { keyPath: 'id' });
      const sections = db.createObjectStore('sections', { keyPath: 'id' });
      sections.createIndex('byClass', 'classId');
      const students = db.createObjectStore('students', { keyPath: 'id' });
      students.createIndex('byStudentNo', 'studentNo', { unique: true });
      students.createIndex('byClass', 'classId');
      students.createIndex('bySection', 'sectionId');
      db.createObjectStore('photos', { keyPath: 'studentId' });
      const runs = db.createObjectStore('testRuns', { keyPath: 'id' });
      runs.createIndex('byStartedAt', 'startedAt');
      db.createObjectStore('settings', { keyPath: 'key' });
    },
    // Another tab upgraded/deleted the DB: close so it is not blocked.
    blocking(_cur, _next, event) {
      (event.target as IDBDatabase).close();
    },
  });
}

let dbPromise: Promise<HodoorDB> | null = null;

/** App-wide shared connection. */
export function getDB(): Promise<HodoorDB> {
  dbPromise ??= openHodoorDB();
  return dbPromise;
}

/** Close the shared connection (used before deleting the database). */
export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}
