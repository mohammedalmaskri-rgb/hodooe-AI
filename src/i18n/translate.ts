import { ar } from './ar';
import { en } from './en';
import type { Dict, Lang } from './types';

export const dictionaries: Record<Lang, Dict> = { ar, en };
export const dirOf = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');

/** Resolve a dotted key ("home.adminTitle") and fill {placeholders}. Missing keys return the key itself. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let node: unknown = dictionaries[lang];
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (typeof node !== 'string') return key;
  return node.replace(/\{(\w+)\}/g, (m, name: string) => (vars && name in vars ? String(vars[name]) : m));
}
