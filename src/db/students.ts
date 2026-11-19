import type { HodoorDB } from './db';
import { DataError } from './errors';
import type { Student } from './types';
import { newId } from '../lib/id';

export interface StudentInput {
  name: string;
  studentNo: string;
  classId: string;
  sectionId: string;
  notes?: string;
}

export const normalizeStudentNo = (no: string) => no.trim().toUpperCase().replace(/\s+/g, '');

async function validate(db: HodoorDB, input: StudentInput, selfId?: string): Promise<StudentInput> {
  const v: StudentInput = {
    name: input.name.trim().replace(/\s+/g, ' '),
    studentNo: normalizeStudentNo(input.studentNo),
    classId: input.classId,
    sectionId: input.sectionId,
    notes: input.notes?.trim() || undefined,
  };
  if (!v.name || !v.studentNo || !v.classId || !v.sectionId) throw new DataError('required');
  if (!(await db.get('classes', v.classId))) throw new DataError('classNotFound');
  const section = await db.get('sections', v.sectionId);
  if (!section) throw new DataError('sectionNotFound');
  if (section.classId !== v.classId) throw new DataError('sectionClassMismatch');
  const clash = await db.getFromIndex('students', 'byStudentNo', v.studentNo);
  if (clash && clash.id !== selfId) throw new DataError('duplicateStudentNo');
  return v;
}

export async function listStudents(db: HodoorDB): Promise<Student[]> {
  return (await db.getAll('students')).sort((a, b) => a.createdAt - b.createdAt);
}

export const getStudent = (db: HodoorDB, id: string) => db.get('students', id);

export async function createStudent(db: HodoorDB, input: StudentInput): Promise<Student> {
  const v = await validate(db, input);
  const now = Date.now();
  const s: Student = { id: newId(), ...v, createdAt: now, updatedAt: now };
  await db.add('students', s);
  return s;
}

export async function updateStudent(db: HodoorDB, id: string, input: StudentInput): Promise<Student> {
  const current = await db.get('students', id);
  if (!current) throw new DataError('studentNotFound');
  const v = await validate(db, input, id);
  const s: Student = { ...current, ...v, updatedAt: Date.now() };
  await db.put('students', s);
  return s;
}

/** Deletes the student record and its reference photo in one transaction. */
export async function deleteStudent(db: HodoorDB, id: string): Promise<void> {
  const tx = db.transaction(['students', 'photos'], 'readwrite');
  await Promise.all([tx.objectStore('students').delete(id), tx.objectStore('photos').delete(id)]);
  await tx.done;
}
