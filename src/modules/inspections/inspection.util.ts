import { InspectionResultState } from '@prisma/client';

/** Pure helpers for inspection → quotation seeding */
export function laborUnitPrice(
  estimatedMinutes: number | null | undefined,
  ratePerHour = 200,
): number {
  const minutes = estimatedMinutes ?? 60;
  const hours = minutes / 60;
  return Math.round(hours * ratePerHour * 100) / 100;
}

export function calcTaxTotals(
  subtotal: number,
  discount: number,
  taxRatePct: number,
) {
  const taxable = subtotal - discount;
  const tax = Math.round(taxable * (taxRatePct / 100) * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;
  return { tax, total };
}

export function isFailedOrWarning(state: InspectionResultState): boolean {
  return state === 'failed' || state === 'warning';
}
