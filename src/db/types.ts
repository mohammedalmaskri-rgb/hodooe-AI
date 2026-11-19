// Data model for the local (on-device) experiment database.

export interface ClassRoom {
  id: string;
  name: string;
  createdAt: number;
}

export interface Section {
  id: string;
  classId: string;
  name: string;
  createdAt: number;
}

export interface Student {
  id: string;
  name: string;
  /** Unique student number, e.g. TEST-001 (stored upper-cased and trimmed). */
  studentNo: string;
  classId: string;
  sectionId: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Reference photo, stored separately from the student record and only on this device.
 * It is a plain image – no face template / biometric embedding is ever derived from it.
 */
export interface StudentPhoto {
  studentId: string;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  /** When the owner confirmed the photo belongs to a consenting adult. */
  consentAt: number;
  updatedAt: number;
}

/** A recorded performance experiment (filled in phases 4–5). */
export interface TestRun {
  id: string;
  startedAt: number;
  [key: string]: unknown;
}

export interface PinRecord {
  salt: string;
  hash: string;
}

export interface SettingsMap {
  pin: PinRecord;
}

export type SettingKey = keyof SettingsMap;
