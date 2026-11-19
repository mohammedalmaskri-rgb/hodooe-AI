import type { HodoorDB } from './db';
import { DataError } from './errors';
import type { ClassRoom, Section } from './types';
import { newId } from '../lib/id';

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

export async function listClasses(db: HodoorDB): Promise<ClassRoom[]> {
  return (await db.getAll('classes')).sort((a, b) => a.createdAt - b.createdAt);
}

export async function listSections(db: HodoorDB, classId?: string): Promise<Section[]> {
  const all = classId ? await db.getAllFromIndex('sections', 'byClass', classId) : await db.getAll('sections');
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createClass(db: HodoorDB, name: string): Promise<ClassRoom> {
  const n = clean(name);
  if (!n) throw new DataError('required');
  const existing = await db.getAll('classes');
  if (existing.some((c) => c.name === n)) throw new DataError('duplicateName');
  const c: ClassRoom = { id: newId(), name: n, createdAt: Date.now() };
  await db.add('classes', c);
  return c;
}

export async function renameClass(db: HodoorDB, id: string, name: string): Promise<void> {
  const n = clean(name);
  if (!n) throw new DataError('required');
  const c = await db.get('classes', id);
  if (!c) throw new DataError('classNotFound');
  const existing = await db.getAll('classes');
  if (existing.some((x) => x.name === n && x.id !== id)) throw new DataError('duplicateName');
  await db.put('classes', { ...c, name: n });
}

/** Deletes a class and its sections. Refused while any student belongs to it. */
export async function deleteClass(db: HodoorDB, id: string): Promise<void> {
  const tx = db.transaction(['classes', 'sections', 'students'], 'readwrite');
  if ((await tx.objectStore('students').index('byClass').count(id)) > 0) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new DataError('classHasStudents');
  }
  const sectionKeys = await tx.objectStore('sections').index('byClass').getAllKeys(id);
  await Promise.all(sectionKeys.map((k) => tx.objectStore('sections').delete(k)));
  await tx.objectStore('classes').delete(id);
  await tx.done;
}

export async function createSection(db: HodoorDB, classId: string, name: string): Promise<Section> {
  const n = clean(name);
  if (!n) throw new DataError('required');
  if (!(await db.get('classes', classId))) throw new DataError('classNotFound');
  const siblings = await db.getAllFromIndex('sections', 'byClass', classId);
  if (siblings.some((s) => s.name === n)) throw new DataError('duplicateName');
  const s: Section = { id: newId(), classId, name: n, createdAt: Date.now() };
  await db.add('sections', s);
  return s;
}

export async function renameSection(db: HodoorDB, id: string, name: string): Promise<void> {
  const n = clean(name);
  if (!n) throw new DataError('required');
  const s = await db.get('sections', id);
  if (!s) throw new DataError('sectionNotFound');
  const siblings = await db.getAllFromIndex('sections', 'byClass', s.classId);
  if (siblings.some((x) => x.name === n && x.id !== id)) throw new DataError('duplicateName');
  await db.put('sections', { ...s, name: n });
}

export async function deleteSection(db: HodoorDB, id: string): Promise<void> {
  if ((await db.countFromIndex('students', 'bySection', id)) > 0) throw new DataError('sectionHasStudents');
  await db.delete('sections', id);
}

export const TRIAL_CLASS_NAME = 'تجريبي';
export const TRIAL_SECTION_NAME = 'تجريبية';

/** Creates (or reuses) the trial class "تجريبي" and section "تجريبية". Idempotent. */
export async function ensureTrialClass(db: HodoorDB): Promise<{ classRoom: ClassRoom; section: Section }> {
  const classRoom =
    (await listClasses(db)).find((c) => c.name === TRIAL_CLASS_NAME) ?? (await createClass(db, TRIAL_CLASS_NAME));
  const section =
    (await listSections(db, classRoom.id)).find((s) => s.name === TRIAL_SECTION_NAME) ??
    (await createSection(db, classRoom.id, TRIAL_SECTION_NAME));
  return { classRoom, section };
}
