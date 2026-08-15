import { ConflictResolverService } from './conflict-resolver.service';
import { ErrorCodes } from '../../common/constants/error-codes';

describe('ConflictResolverService visit merge', () => {
  const resolver = new ConflictResolverService({} as never);

  const server = {
    id: 'visit-1',
    version: 2,
    complaint: 'Noise',
    mileageIn: 10000,
    fuelLevelPct: 40,
    updatedAt: new Date('2026-08-14T12:00:00Z'),
  };

  it('optimistic lock conflict when version mismatches', () => {
    const result = resolver.mergeVisitCapture({
      server,
      client: { version: 1, complaint: 'Rattle' },
      clientTimestamp: new Date('2026-08-14T11:00:00Z'),
    });
    expect(result.kind).toBe('conflict');
    if (result.kind === 'conflict') {
      expect(result.result.conflict?.code).toBe(ErrorCodes.OPTIMISTIC_LOCK);
    }
  });

  it('appends complaint when server is newer', () => {
    const result = resolver.mergeVisitCapture({
      server,
      client: { version: 2, complaint: 'Rattle' },
      clientTimestamp: new Date('2026-08-14T11:00:00Z'),
    });
    expect(result.kind).toBe('merge');
    if (result.kind === 'merge') {
      expect(result.data.complaint).toBe('Noise\nRattle');
    }
  });

  it('takes max mileage', () => {
    const result = resolver.mergeVisitCapture({
      server,
      client: { version: 2, mileage: 12000 },
      clientTimestamp: new Date('2026-08-14T13:00:00Z'),
    });
    expect(result.kind).toBe('merge');
    if (result.kind === 'merge') {
      expect(result.data.mileageIn).toBe(12000);
    }
  });
});
