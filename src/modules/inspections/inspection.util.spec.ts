import {
  calcTaxTotals,
  isFailedOrWarning,
  laborUnitPrice,
} from './inspection.util';

describe('inspection.util', () => {
  it('computes labor unit price from minutes', () => {
    expect(laborUnitPrice(90, 200)).toBe(300);
    expect(laborUnitPrice(45, 200)).toBe(150);
  });

  it('calculates 14% tax', () => {
    const { tax, total } = calcTaxTotals(1000, 0, 14);
    expect(tax).toBe(140);
    expect(total).toBe(1140);
  });

  it('flags warning/failed states', () => {
    expect(isFailedOrWarning('ok')).toBe(false);
    expect(isFailedOrWarning('warning')).toBe(true);
    expect(isFailedOrWarning('failed')).toBe(true);
  });
});
