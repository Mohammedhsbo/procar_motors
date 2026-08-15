/**
 * Purchase order money math — backend is source of truth.
 */
export function computePoTotals(
  items: Array<{ qtyOrdered: number; unitPrice: number; taxRate: number }>,
  discount = 0,
) {
  let subtotal = 0;
  let tax = 0;
  for (const item of items) {
    const line = Number(item.qtyOrdered) * Number(item.unitPrice);
    subtotal += line;
    tax += line * (Number(item.taxRate) / 100);
  }
  const disc = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, round2(subtotal) + round2(tax) - round2(disc));
  return {
    subtotal: round2(subtotal),
    tax: round2(tax),
    discount: round2(disc),
    total,
  };
}

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
