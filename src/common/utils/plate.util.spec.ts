import { normalizePlate } from './plate.util';

describe('normalizePlate', () => {
  it('strips spaces and normalizes Arabic alef', () => {
    expect(normalizePlate('أ ب ج 4521')).toBe('ابج4521');
  });

  it('is stable for already-normalized plates', () => {
    expect(normalizePlate('ابج4521')).toBe('ابج4521');
  });

  it('uppercases latin segments', () => {
    expect(normalizePlate('abc 123')).toBe('ABC123');
  });
});
