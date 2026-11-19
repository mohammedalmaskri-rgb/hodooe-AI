import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openHodoorDB, type HodoorDB } from '../src/db/db';
import {
  createClass,
  createSection,
  deleteClass,
  deleteSection,
  ensureTrialClass,
  listClasses,
  listSections,
  renameClass,
} from '../src/db/classes';
import { createStudent, deleteStudent, getStudent, listStudents, updateStudent } from '../src/db/students';
import { deletePhoto, getPhoto, hasPhoto, savePhoto } from '../src/db/photos';
import { hasPin, setPin, verifyPin } from '../src/db/settings';
import { buildExport, importData, parseExport } from '../src/db/exportImport';
import { DataError } from '../src/db/errors';

let db: HodoorDB;
let n = 0;
beforeEach(async () => {
  db = await openHodoorDB(`test-${++n}`); // fresh database per test
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof DataError ? e.code : `other:${String(e)}`;
  }
  return 'no-error';
};

async function trialStudent() {
  const { classRoom, section } = await ensureTrialClass(db);
  const s = await createStudent(db, {
    name: '  محمد – طالب تجريبي 001 ',
    studentNo: ' test-001 ',
    classId: classRoom.id,
    sectionId: section.id,
  });
  return { classRoom, section, s };
}

const fakeImage = () => ({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), width: 10, height: 8 });

describe('classes & sections', () => {
  it('ensureTrialClass creates تجريبي/تجريبية once (idempotent)', async () => {
    await ensureTrialClass(db);
    await ensureTrialClass(db);
    const classes = await listClasses(db);
    expect(classes.map((c) => c.name)).toEqual(['تجريبي']);
    expect((await listSections(db, classes[0].id)).map((s) => s.name)).toEqual(['تجريبية']);
  });

  it('rejects empty and duplicate names', async () => {
    await createClass(db, 'الصف 9');
    expect(await code(createClass(db, '   '))).toBe('required');
    expect(await code(createClass(db, 'الصف  9'))).toBe('duplicateName');
    const c2 = await createClass(db, 'الصف 10');
    expect(await code(renameClass(db, c2.id, 'الصف 9'))).toBe('duplicateName');
  });

  it('cannot delete a class or section that still has students', async () => {
    const { classRoom, section, s } = await trialStudent();
    expect(await code(deleteClass(db, classRoom.id))).toBe('classHasStudents');
    expect(await code(deleteSection(db, section.id))).toBe('sectionHasStudents');
    await deleteStudent(db, s.id);
    await deleteClass(db, classRoom.id);
    expect(await listClasses(db)).toEqual([]);
    expect(await listSections(db)).toEqual([]); // sections removed with the class
  });
});

describe('students', () => {
  it('creates the trial student with normalized fields', async () => {
    const { s } = await trialStudent();
    expect(s.name).toBe('محمد – طالب تجريبي 001');
    expect(s.studentNo).toBe('TEST-001');
    expect(await listStudents(db)).toHaveLength(1);
  });

  it('enforces unique student number', async () => {
    const { classRoom, section } = await trialStudent();
    const input = { name: 'آخر', studentNo: 'Test-001', classId: classRoom.id, sectionId: section.id };
    expect(await code(createStudent(db, input))).toBe('duplicateStudentNo');
  });

  it('validates required fields and class/section consistency', async () => {
    const { classRoom, section } = await trialStudent();
    const other = await createClass(db, 'آخر');
    const otherSec = await createSection(db, other.id, 'أ');
    expect(await code(createStudent(db, { name: '', studentNo: 'X', classId: classRoom.id, sectionId: section.id }))).toBe(
      'required',
    );
    expect(await code(createStudent(db, { name: 'س', studentNo: 'X', classId: classRoom.id, sectionId: otherSec.id }))).toBe(
      'sectionClassMismatch',
    );
  });

  it('updates a student (keeping its own number is allowed)', async () => {
    const { s, classRoom, section } = await trialStudent();
    const u = await updateStudent(db, s.id, {
      name: 'محمد',
      studentNo: 'TEST-001',
      classId: classRoom.id,
      sectionId: section.id,
      notes: 'ملاحظة',
    });
    expect(u.name).toBe('محمد');
    expect((await getStudent(db, s.id))?.notes).toBe('ملاحظة');
  });

  it('deleting a student also deletes the reference photo', async () => {
    const { s } = await trialStudent();
    await savePhoto(db, s.id, fakeImage(), true);
    await deleteStudent(db, s.id);
    expect(await getStudent(db, s.id)).toBeUndefined();
    expect(await getPhoto(db, s.id)).toBeUndefined();
  });
});

describe('reference photo', () => {
  it('requires consent, supports replace and delete', async () => {
    const { s } = await trialStudent();
    expect(await code(savePhoto(db, s.id, fakeImage(), false))).toBe('required');
    await savePhoto(db, s.id, fakeImage(), true);
    await savePhoto(db, s.id, { ...fakeImage(), width: 20 }, true); // replace
    expect((await getPhoto(db, s.id))?.width).toBe(20);
    expect(await db.count('photos')).toBe(1);
    await deletePhoto(db, s.id);
    expect(await hasPhoto(db, s.id)).toBe(false);
  });
});

describe('reference photo is trial-student only', () => {
  it('refuses photos for any other student, and keeps TEST-001 if it has a photo', async () => {
    const { s, classRoom, section } = await trialStudent();
    const other = await createStudent(db, { name: 'طالب', studentNo: 'S-002', classId: classRoom.id, sectionId: section.id });
    expect(await code(savePhoto(db, other.id, fakeImage(), true))).toBe('photoTrialOnly');
    await savePhoto(db, s.id, fakeImage(), true);
    const input = { name: s.name, studentNo: 'S-003', classId: classRoom.id, sectionId: section.id };
    expect(await code(updateStudent(db, s.id, input))).toBe('photoTrialOnly');
    await deletePhoto(db, s.id);
    expect((await updateStudent(db, s.id, input)).studentNo).toBe('S-003');
  });
});

describe('admin PIN', () => {
  it('stores only a salted hash and verifies', async () => {
    expect(await hasPin(db)).toBe(false);
    await setPin(db, '2468');
    const raw = JSON.stringify(await db.getAll('settings'));
    expect(raw).not.toContain('2468');
    expect(await verifyPin(db, '2468')).toBe(true);
    expect(await verifyPin(db, '1111')).toBe(false);
    await expect(setPin(db, '12')).rejects.toThrow();
  });
});

describe('export / import', () => {
  it('export excludes photos and PIN, and round-trips into an empty device', async () => {
    const { s } = await trialStudent();
    await savePhoto(db, s.id, fakeImage(), true);
    await setPin(db, '2468');
    const file = await buildExport(db);
    const json = JSON.stringify(file);
    expect(json).not.toContain('blob');
    expect(json).not.toContain('hash');
    expect(Object.keys(file)).not.toContain('photos');

    const phone = await openHodoorDB(`phone-${n}`);
    const summary = await importData(phone, parseExport(JSON.parse(json)));
    expect(summary).toEqual({ classes: 1, sections: 1, students: 1, testRuns: 0 });
    expect((await listStudents(phone))[0].studentNo).toBe('TEST-001');
    expect(await phone.count('photos')).toBe(0);
    // Importing the same file again is an idempotent merge.
    await importData(phone, parseExport(JSON.parse(json)));
    expect(await phone.count('students')).toBe(1);
  });

  it('rejects malformed files', () => {
    for (const bad of [null, [], { app: 'x' }, { app: 'hodoor-ai', schema: 99 }, { app: 'hodoor-ai', schema: 1, classes: [] }]) {
      expect(() => parseExport(bad)).toThrow(DataError);
    }
  });

  it('is all-or-nothing on student number conflicts', async () => {
    const { classRoom, section } = await trialStudent();
    const file = await buildExport(db);
    file.students[0] = { ...file.students[0], id: 'different-id' }; // same TEST-001, other id
    file.classes.push({ id: 'new-class', name: 'جديد', createdAt: 1 });
    expect(await code(importData(db, file))).toBe('duplicateStudentNo');
    expect((await listClasses(db)).map((c) => c.id)).toEqual([classRoom.id]); // nothing written
    expect(section).toBeTruthy();
  });
});
