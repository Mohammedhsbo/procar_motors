import { StockService } from './stock.service';

describe('StockService available math', () => {
  const stock = new StockService({} as never, {} as never);

  it('computes available = onHand - reserved', () => {
    expect(stock.available(24, 6)).toBe(18);
    expect(stock.available(8, 4)).toBe(4);
    expect(stock.available(0, 0)).toBe(0);
  });

  it('rejects inconsistent balances', () => {
    expect(() => stock.assertConsistent(-1, 0)).toThrow();
    expect(() => stock.assertConsistent(5, 6)).toThrow();
    expect(() => stock.assertConsistent(10, 3)).not.toThrow();
  });
});
