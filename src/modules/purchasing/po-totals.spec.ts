import { computePoTotals, round2 } from './po-totals';

describe('computePoTotals', () => {
  it('computes subtotal, tax, and total with discount', () => {
    const result = computePoTotals(
      [
        { qtyOrdered: 2, unitPrice: 100, taxRate: 14 },
        { qtyOrdered: 1, unitPrice: 50, taxRate: 14 },
      ],
      10,
    );
    expect(result.subtotal).toBe(250);
    expect(result.tax).toBe(35);
    expect(result.discount).toBe(10);
    expect(result.total).toBe(275);
  });

  it('round2 stabilizes floating point', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});
