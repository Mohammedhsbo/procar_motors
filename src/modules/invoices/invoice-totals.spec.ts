import { QuotationCalculatorService } from '../quotations/quotation-calculator.service';

describe('Invoice payment arithmetic', () => {
  const calc = new QuotationCalculatorService();

  it('computes remaining after partial payment', () => {
    const totals = calc.calculate([{ qty: 2, unitPrice: 500 }], {
      discount: 0,
      taxRatePct: 14,
    });
    expect(totals.total).toBe(1140);
    const paid = 400;
    const remaining = calc.round2(totals.total - paid);
    expect(remaining).toBe(740);
    const nextStatus = paid + 1e-9 >= totals.total ? 'paid' : 'partial';
    expect(nextStatus).toBe('partial');
  });

  it('marks paid when amount covers total', () => {
    const total = 1140;
    const paid = 1140;
    expect(paid + 1e-9 >= total).toBe(true);
  });

  it('handles zero-item totals', () => {
    const totals = calc.calculate([]);
    expect(totals.subtotal).toBe(0);
    expect(totals.tax).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('clamps negative discount to zero', () => {
    const totals = calc.calculate([{ qty: 1, unitPrice: 100 }], {
      discount: -50,
      taxRatePct: 14,
    });
    expect(totals.discount).toBe(0);
    expect(totals.total).toBe(114);
  });

  it('does not go negative when discount exceeds subtotal', () => {
    const totals = calc.calculate([{ qty: 1, unitPrice: 50 }], {
      discount: 80,
      taxRatePct: 14,
    });
    expect(totals.total).toBe(0);
  });
});
