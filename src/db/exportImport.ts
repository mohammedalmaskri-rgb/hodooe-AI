import type { HodoorDB } from './db';
import { DataError } from './errors';
import type { ClassRoom, Section, Student, TestRun } from './types';

// Transfer file used to move experiment data between the iPad and the phone.
// It deliberately EXCLUDES reference photos and the admin PIN.

export const EXPORT_APP = 'hodoor-ai';
export const EXPORT_SCHEMA = 1;

export interface ExportFile {
  app: typeof EXPORT_APP;
  schema: typeof EXPORT_SCHEMA;
  exportedAt: string;
  classes: ClassRoom[];
  sections: Section[];
  students: Student[];
  testRuns: TestRun[];
}

export async function buildExport(db: HodoorDB): Promise<ExportFile> {
  const [classes, sections, students, testRuns] = await Promise.all([
    db.getAll('classes'),
    db.getAll('sections'),
    db.getAll('students'),
    db.getAll('testRuns'),
  ]);
  return { app: EXPORT_APP, schema: EXPORT_SCHEMA, exportedAt: new Date().toISOString(), classes, sections, students, testRuns };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasStrings = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof o[k] === 'string' && o[k] !== '');

/** Validates an untrusted parsed JSON value and returns it typed, or throws invalidImport. */
export function parseExport(raw: unknown): ExportFile {
  const bad = (why: string): never => {
    throw new DataError('invalidImport', why);
  };
  if (!isObj(raw)) bad('not an object');
  const r = raw as Record<string, unknown>;
  if (r.app !== EXPORT_APP) bad('wrong app');
  if (r.schema !== EXPORT_SCHEMA) bad('unsupported schema');
  for (const k of ['classes', 'sections', 'students', 'testRuns']) if (!Array.isArray(r[k])) bad(`${k} missing`);
  const arr = (k: string) => r[k] as unknown[];
  arr('classes').forEach((c) => (!isObj(c) || !hasStrings(c, ['id', 'name'])) && bad('bad class'));
  arr('sections').forEach((s) => (!isObj(s) || !hasStrings(s, ['id', 'classId', 'name'])) && bad('bad section'));
  arr('students').forEach(
    (s) => (!isObj(s) || !hasStrings(s, ['id', 'name', 'studentNo', 'classId', 'sectionId'])) && bad('bad student'),
  );
  arr('testRuns').forEach((t) => (!isObj(t) || typeof t.id !== 'string' || typeof t.startedAt !== 'number') && bad('bad run'));
  return r as unknown as ExportFile;
}

export interface ImportSummary {
  classes: number;
  sections: number;
  students: number;
  testRuns: number;
}

/**
 * Merges an export into this device (upsert by id) in ONE transaction:
 * if anything fails (e.g. a student number already used by another student) nothing is written.
 */
export async function importData(db: HodoorDB, file: ExportFile): Promise<ImportSummary> {
  const tx = db.transaction(['classes', 'sections', 'students', 'testRuns'], 'readwrite');
  // On failure the transaction aborts and tx.done rejects too; that rejection is
  // represented by the error caught below, so mark it handled.
  tx.done.catch(() => undefined);
  try {
    for (const c of file.classes) await tx.objectStore('classes').put(c);
    for (const s of file.sections) await tx.objectStore('sections').put(s);
    for (const s of file.students) await tx.objectStore('students').put(s);
    for (const t of file.testRuns) await tx.objectStore('testRuns').put(t);
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already aborted */
    }
    if (e instanceof DOMException && e.name === 'ConstraintError') throw new DataError('duplicateStudentNo');
    throw e;
  }
  return {
    classes: file.classes.length,
    sections: file.sections.length,
    students: file.students.length,
    testRuns: file.testRuns.length,
  };
}
