import type { HodoorDB } from './db';
import type { PinRecord, SettingKey, SettingsMap } from './types';
import { hashPin, PIN_PATTERN, randomSalt } from '../lib/pin';

export async function getSetting<K extends SettingKey>(db: HodoorDB, key: K): Promise<SettingsMap[K] | undefined> {
  return (await db.get('settings', key))?.value as SettingsMap[K] | undefined;
}

export async function setSetting<K extends SettingKey>(db: HodoorDB, key: K, value: SettingsMap[K]): Promise<void> {
  await db.put('settings', { key, value });
}

export const hasPin = async (db: HodoorDB) => (await getSetting(db, 'pin')) !== undefined;

export async function setPin(db: HodoorDB, pin: string): Promise<void> {
  if (!PIN_PATTERN.test(pin)) throw new Error('invalidPin');
  const salt = randomSalt();
  const rec: PinRecord = { salt, hash: await hashPin(pin, salt) };
  await setSetting(db, 'pin', rec);
}

export async function verifyPin(db: HodoorDB, pin: string): Promise<boolean> {
  const rec = await getSetting(db, 'pin');
  if (!rec) return false;
  return (await hashPin(pin, rec.salt)) === rec.hash;
}
