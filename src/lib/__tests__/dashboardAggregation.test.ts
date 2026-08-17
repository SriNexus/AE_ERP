import { describe, expect, it } from 'vitest';
import { buildPipelineData, buildProjectsByStage, buildRevenueTrend, sortRecentRows } from '../dashboardAggregation';

describe('dashboardAggregation', () => {
  it('buildRevenueTrend buckets revenue and order counts across the requested window', () => {
    const now = new Date();
    const currentMonth = now.toLocaleString('default', { month: 'short' });
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('default', { month: 'short' });
    const rows = [
      { id: 'o-1', createdAt: now.toISOString(), total: 1250 },
      { id: 'o-2', createdAt: new Date(now.getFullYear(), now.getMonth() - 1, 12).toISOString(), total: 500 },
      { id: 'o-3', createdAt: new Date(now.getFullYear(), now.getMonth() - 1, 18).toISOString(), total: 250 },
    ];

    const trend = buildRevenueTrend(rows, 3);

    expect(trend).toHaveLength(3);
    expect(trend.find((bucket) => bucket.month === currentMonth)).toEqual(
      expect.objectContaining({ month: currentMonth, orders: 1, revenue: 1250 }),
    );
    expect(trend.find((bucket) => bucket.month === previousMonth)).toEqual(
      expect.objectContaining({ month: previousMonth, orders: 2, revenue: 750 }),
    );
  });

  it('buildPipelineData removes zero-count stages but preserves non-zero order', () => {
    expect(buildPipelineData([
      { status: 'New', count: 0 },
      { status: 'Qualified', count: 3 },
      { status: 'Converted', count: 1 },
    ])).toEqual([
      { status: 'Qualified', count: 3 },
      { status: 'Converted', count: 1 },
    ]);
  });

  it('sortRecentRows sorts rows newest-first without mutating the original array', () => {
    const rows = [
      { id: 'r-1', createdAt: '2026-07-01T09:00:00.000Z' },
      { id: 'r-2', createdAt: '2026-07-01T12:00:00.000Z' },
      { id: 'r-3', createdAt: '2026-07-01T11:00:00.000Z' },
    ];

    const sorted = sortRecentRows(rows, 2);

    expect(sorted).toEqual([
      { id: 'r-2', createdAt: '2026-07-01T12:00:00.000Z' },
      { id: 'r-3', createdAt: '2026-07-01T11:00:00.000Z' },
    ]);
    expect(rows[0].id).toBe('r-1');
  });

  it('aggregates visible projects in Blueprint stage order', () => {
    const result = buildProjectsByStage([
      { currentStage: 'Dispatch' },
      { currentStage: 'Survey' },
      { currentStage: 'Dispatch' },
      { currentStage: 'Archived', isDeleted: true },
    ]);

    expect(result.find((point) => point.stage === 'Survey')?.count).toBe(1);
    expect(result.find((point) => point.stage === 'Dispatch')?.count).toBe(2);
    expect(result.find((point) => point.stage === 'Archived')?.count).toBe(0);
    expect(result.findIndex((point) => point.stage === 'Survey')).toBeLessThan(result.findIndex((point) => point.stage === 'Dispatch'));
  });
});
