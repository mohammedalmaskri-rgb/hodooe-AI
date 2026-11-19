import type { HodoorDB } from './db';
import { DataError } from './errors';
import type { StudentPhoto } from './types';

export const getPhoto = (db: HodoorDB, studentId: string) => db.get('photos', studentId);

export async function hasPhoto(db: HodoorDB, studentId: string): Promise<boolean> {
  return (await db.count('photos', studentId)) > 0;
}

/** Saves (or replaces) the reference photo. Requires explicit consent confirmation. */
export async function savePhoto(
  db: HodoorDB,
  studentId: string,
  image: { blob: Blob; width: number; height: number },
  consentConfirmed: boolean,
): Promise<StudentPhoto> {
  if (!consentConfirmed) throw new DataError('required');
  if (!(await db.get('students', studentId))) throw new DataError('studentNotFound');
  const now = Date.now();
  const p: StudentPhoto = {
    studentId,
    blob: image.blob,
    mimeType: image.blob.type || 'image/jpeg',
    width: image.width,
    height: image.height,
    consentAt: now,
    updatedAt: now,
  };
  await db.put('photos', p);
  return p;
}

export const deletePhoto = (db: HodoorDB, studentId: string) => db.delete('photos', studentId);
