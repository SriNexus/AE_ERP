import { describe, expect, it } from 'vitest';
import { dispatchDisplayNumber } from './dispatchWorkspaceUtils';

describe('dispatchDisplayNumber', () => {
  it('uses the canonical display number when present', () => {
    expect(dispatchDisplayNumber({ id: 'DOC-1', dispatchNumber: 'DDSP-0001' })).toBe('DDSP-0001');
  });

  it('renders dispatches created before display fields were persisted', () => {
    expect(dispatchDisplayNumber({ id: 'DDSP-LEGACY-1' })).toBe('DDSP-LEGACY-1');
    expect(dispatchDisplayNumber({ dispatchId: 'DDSP-LEGACY-2' })).toBe('DDSP-LEGACY-2');
  });
});