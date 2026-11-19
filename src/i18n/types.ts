import type { ar } from './ar';

/** Arabic is the source of truth; English must provide every key. */
export type Dict = { [K in keyof typeof ar]: (typeof ar)[K] extends string ? string : { [P in keyof (typeof ar)[K]]: string } };
export type Lang = 'ar' | 'en';
