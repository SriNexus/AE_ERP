import { describe, expect, it } from 'vitest';
import { deriveRecentActivity } from '../CustomerRecentActivity';

describe('deriveRecentActivity', () => {
  it('sorts newest first from customer.activityLog[] — the real, existing field, no fabricated source', () => {
    const customer = {
      activityLog: [
        { id: 'a', date: '2026-01-01', type: 'Creation' },
        { id: 'c', date: '2026-03-01', type: 'Transfer' },
        { id: 'b', date: '2026-02-01', type: 'Note' },
      ],
    };
    const { entries } = deriveRecentActivity(customer);
    expect(entries.map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns an empty result (not a crash) for a customer with no activityLog', () => {
    const { entries, totalCount } = deriveRecentActivity({});
    expect(entries).toEqual([]);
    expect(totalCount).toBe(0);
  });

  it('caps entries at the given limit and reports the true total for the "+N more" indicator', () => {
    const activityLog = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`, type: 'Note' }));
    const { entries, totalCount } = deriveRecentActivity({ activityLog }, 8);
    expect(entries).toHaveLength(8);
    expect(totalCount).toBe(12);
  });

  it('does not filter out any entry type — unlike the Left Panel Activity context, this is a general unfiltered feed', () => {
    const customer = { activityLog: [{ id: 'note', date: '2026-01-01', type: 'Note' }, { id: 'transfer', date: '2026-01-02', type: 'Transfer' }] };
    const { entries } = deriveRecentActivity(customer);
    expect(entries.map((e) => e.id).sort()).toEqual(['note', 'transfer']);
  });

  it('defaults to a cap of 8 when none is given', () => {
    const activityLog = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}` }));
    const { entries } = deriveRecentActivity({ activityLog });
    expect(entries).toHaveLength(8);
  });
});
