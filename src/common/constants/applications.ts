/**
 * The four business applications served by this backend.
 * Codes are stable identifiers — they appear in JWTs, permission keys,
 * `finance.invoices.source_app`, and the `core.applications` registry.
 */
export const APP_CODES = ['promotors', 'uxb', 'tirezone', 'dailycup'] as const;

export type AppCode = (typeof APP_CODES)[number];

export const APPLICATIONS: {
  code: AppCode;
  nameEn: string;
  nameAr: string;
  description: string;
  color: string;
  sortOrder: number;
}[] = [
  {
    code: 'promotors',
    nameEn: 'Pro Motors',
    nameAr: 'برو موتورز',
    description: 'Vehicle service management — reception to delivery',
    color: '#12556b',
    sortOrder: 1,
  },
  {
    code: 'uxb',
    nameEn: 'UXB',
    nameAr: 'يو إكس بي',
    description: 'Car care, PPF, window film and polishing',
    color: '#1f2933',
    sortOrder: 2,
  },
  {
    code: 'tirezone',
    nameEn: 'Tire Zone',
    nameAr: 'تاير زون',
    description: 'Tire retail, fitting services and point of sale',
    color: '#b4641a',
    sortOrder: 3,
  },
  {
    code: 'dailycup',
    nameEn: 'Daily Cup',
    nameAr: 'ديلي كب',
    description: 'Coffee shop operations, recipe costing and point of sale',
    color: '#7a4b2a',
    sortOrder: 4,
  },
];

export function isAppCode(value: string): value is AppCode {
  return (APP_CODES as readonly string[]).includes(value);
}
