import { describe, expect, it } from 'vitest';
import { normalizeQCRecord, type QCRecord } from '../qcWorkflow';

describe('normalizeQCRecord', () => {
  it('adapts deterministic Demo checklist records to the runtime QC schema', () => {
    const normalized = normalizeQCRecord({
      id: 'DEMO-V1-QC-001',
      checklist: [
        { key: 'earthing', label: 'Earthing continuity', status: 'passed' },
        { key: 'isolation', label: 'DC/AC isolation', status: 'failed' },
      ],
      remarks: 'Demo inspection',
    } as unknown as QCRecord & { checklist: Array<Record<string, unknown>> });
    expect(normalized.checklistItems).toEqual([
      { item: 'Earthing continuity', passed: true, notes: undefined },
      { item: 'DC/AC isolation', passed: false, notes: undefined },
    ]);
    expect(normalized).toMatchObject({ totalItems: 2, passedCount: 1, failedCount: 1, overallNotes: 'Demo inspection' });
  });
});
