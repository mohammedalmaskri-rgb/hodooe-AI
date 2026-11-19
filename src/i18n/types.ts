import type { ar } from './ar';

type Deep<T> = { [K in keyof T]: T[K] extends string ? string : Deep<T[K]> };
/** Arabic is the source of truth; English must provide every key (checked by the compiler and tests). */
export type Dict = Deep<typeof ar>;
export type Lang = 'ar' | 'en';
