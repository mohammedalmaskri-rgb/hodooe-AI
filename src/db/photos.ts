import type { HodoorDB } from './db';
import { DataError } from './errors';
import type { StudentPhoto } from './types';

/**
 * Reference photos are allowed ONLY for the trial student (adult account owner, with consent),
 * to prepare a later, separate identity-matching phase. Real students get no photos.
 */
export const TRIAL_STUDENT_NO = 'TEST-001';

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
  const student = await db.get('students', studentId);
  if (!student) throw new DataError('studentNotFound');
  if (student.studentNo !== TRIAL_STUDENT_NO) throw new DataError('photoTrialOnly');
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
