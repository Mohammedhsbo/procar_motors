/**
 * Normalize Egyptian plate for uniqueness / search.
 * Matches seed convention: strip spaces, normalize alef variants.
 */
export function normalizePlate(plate: string): string {
  return plate
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .toUpperCase();
}
