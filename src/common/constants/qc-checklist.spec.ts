import { DEFAULT_QC_CHECKLIST } from './qc-checklist';

describe('DEFAULT_QC_CHECKLIST', () => {
  it('matches frontend 7-point qcChecklist', () => {
    expect(DEFAULT_QC_CHECKLIST).toHaveLength(7);
    expect(DEFAULT_QC_CHECKLIST.map((i) => i.labelEn)).toEqual([
      'Repair quality',
      'Parts installation',
      'Test drive',
      'Vehicle cleanliness',
      'All requested work completed',
      'No warning lights',
      'Final inspection',
    ]);
  });
});
