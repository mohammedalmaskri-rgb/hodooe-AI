import { describe, expect, it } from 'vitest';
import { ar } from '../src/i18n/ar';
import { en } from '../src/i18n/en';
import { dirOf, translate } from '../src/i18n/translate';

/** Collect every dotted key in a dictionary. */
function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('Arabic and English define exactly the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(ar).sort());
  });
  it('Arabic is RTL, English is LTR', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
  it('resolves nested keys and fills placeholders', () => {
    expect(translate('ar', 'home.comingIn', { n: 2 })).toBe('قيد التطوير – المرحلة 2');
    expect(translate('en', 'home.comingIn', { n: 3 })).toBe('In development – phase 3');
  });
  it('returns the key for unknown entries instead of crashing', () => {
    expect(translate('ar', 'does.not.exist')).toBe('does.not.exist');
  });
});
