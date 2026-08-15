import { QuotationCalculatorService } from './quotation-calculator.service';

describe('QuotationCalculatorService', () => {
  const calc = new QuotationCalculatorService();

  it('computes 14% VAT correctly', () => {
    const result = calc.calculate(
      [
        { qty: 1, unitPrice: 950 },
        { qty: 1, unitPrice: 900 },
        { qty: 1, unitPrice: 300 },
      ],
      { taxRatePct: 14 },
    );
    expect(result.subtotal).toBe(2150);
    expect(result.tax).toBe(301);
    expect(result.total).toBe(2451);
  });

  it('applies discount before tax', () => {
    const result = calc.calculate([{ qty: 1, unitPrice: 1000 }], {
      discount: 100,
      taxRatePct: 14,
    });
    expect(result.subtotal).toBe(1000);
    expect(result.discount).toBe(100);
    expect(result.tax).toBe(126);
    expect(result.total).toBe(1026);
  });

  it('rounds line totals to 2 decimals', () => {
    const result = calc.calculate([{ qty: 2, unitPrice: 10.125 }]);
    expect(result.lines[0].lineTotal).toBe(20.25);
    expect(result.subtotal).toBe(20.25);
  });
});
