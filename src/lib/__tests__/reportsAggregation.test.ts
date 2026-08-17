import { describe, it, expect } from 'vitest';
import type { ProjectRecord } from '../../features/projects/types';
import {
  buildStageDistribution,
  buildRevenuePipeline,
  buildCycleTimes,
  findStuckProjects,
  buildProjectKpis,
  reportToCsvRows,
  csvRowsToString,
} from '../reportsAggregation';

function makeProject(overrides: Partial<ProjectRecord>): ProjectRecord {
  const now = new Date().toISOString();
  return {
    projectId: 'p-default',
    id: 'p-default',
    companyId: 'test-co',
    createdBy: 'u1',
    updatedBy: 'u1',
    createdAt: overrides.createdAt || now,
    updatedAt: now,
    isDeleted: false,
    customerId: 'c1',
    capacityKw: 10,
    siteAddress: { line1: '123 St', city: 'City', state: 'St', pincode: '123456', country: 'IN' },
    currentStage: 'New',
    stageHistory: [],
    linkedQuotationIds: [],
    linkedOrderIds: [],
    linkedDispatchIds: [],
    ...overrides,
  } as ProjectRecord;
}

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

// Stage Distribution
describe('buildStageDistribution', () => {
  it('returns empty for no projects', () => {
    expect(buildStageDistribution([])).toEqual([]);
  });

  it('skips deleted projects', () => {
    const r = buildStageDistribution([makeProject({ id: 'p1', isDeleted: true })]);
    expect(r).toEqual([]);
  });

  it('distributes projects by currentStage', () => {
    const r = buildStageDistribution([
      makeProject({ id: 'p1', currentStage: 'New' }),
      makeProject({ id: 'p2', currentStage: 'Survey' }),
      makeProject({ id: 'p3', currentStage: 'Survey' }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.find((s) => s.stage === 'Survey')).toMatchObject({ count: 2, percentage: 67 });
  });

  it('calculates percentages correctly', () => {
    const r = buildStageDistribution([
      makeProject({ id: 'p1', currentStage: 'New' }),
      makeProject({ id: 'p2', currentStage: 'Archived' }),
    ]);
    expect(r.find((s) => s.stage === 'New')).toMatchObject({ count: 1, percentage: 50 });
  });

  it('sorts by count descending', () => {
    const r = buildStageDistribution([
      makeProject({ id: 'p1', currentStage: 'New' }),
      makeProject({ id: 'p2', currentStage: 'Survey' }),
      makeProject({ id: 'p3', currentStage: 'Survey' }),
    ]);
    expect(r[0].stage).toBe('Survey');
  });

  it('uses color map for known stages', () => {
    const r = buildStageDistribution([makeProject({ id: 'p1', currentStage: 'NetMetering' })]);
    expect(r[0].color).toBe('#ec4899');
  });

  it('uses default color for unknown stages', () => {
    const r = buildStageDistribution([makeProject({ id: 'p1', currentStage: 'Custom' as any })]);
    expect(r[0].color).toBe('#6366f1');
  });
});

// Revenue Pipeline
describe('buildRevenuePipeline', () => {
  it('returns empty for no active projects', () => {
    expect(buildRevenuePipeline([makeProject({ id: 'p1', isDeleted: true })], [])).toEqual([]);
  });

  it('aggregates revenue by project stage', () => {
    const r = buildRevenuePipeline(
      [
        makeProject({ id: 'p1', currentStage: 'Order', linkedOrderIds: ['o1'] }),
        makeProject({ id: 'p2', currentStage: 'Installation', linkedOrderIds: ['o2'] }),
      ],
      [
        { id: 'o1', total: 100000, isDeleted: false },
        { id: 'o2', total: 150000, isDeleted: false },
      ],
    );
    expect(r.find((x) => x.stage === 'Order')).toMatchObject({ revenue: 100000, projectCount: 1 });
    expect(r.find((x) => x.stage === 'Installation')).toMatchObject({ revenue: 150000, projectCount: 1 });
  });

  it('sorts by revenue descending', () => {
    const r = buildRevenuePipeline(
      [
        makeProject({ id: 'p1', currentStage: 'New', linkedOrderIds: ['o2'] }),
        makeProject({ id: 'p2', currentStage: 'Installation', linkedOrderIds: ['o1'] }),
      ],
      [
        { id: 'o1', total: 50000, isDeleted: false },
        { id: 'o2', total: 200000, isDeleted: false },
      ],
    );
    expect(r[0].stage).toBe('New');
  });

  it('handles projects with no linked orders', () => {
    const r = buildRevenuePipeline(
      [makeProject({ id: 'p1', currentStage: 'New', linkedOrderIds: [] })],
      [],
    );
    expect(r[0]).toMatchObject({ revenue: 0, projectCount: 1 });
  });

  it('skips deleted orders', () => {
    const r = buildRevenuePipeline(
      [makeProject({ id: 'p1', currentStage: 'Order', linkedOrderIds: ['o1'] })],
      [{ id: 'o1', total: 50000, isDeleted: true }],
    );
    expect(r[0].revenue).toBe(0);
  });
});

// Cycle Times
describe('buildCycleTimes', () => {
  it('returns empty for no history', () => {
    expect(buildCycleTimes([makeProject({ id: 'p1', stageHistory: [] })])).toEqual([]);
  });

  it('computes cycle times from stage history', () => {
    const r = buildCycleTimes([
      makeProject({
        id: 'p1',
        stageHistory: [
          { stage: 'New', changedAt: daysAgo(30), changedBy: 'u1' },
          { stage: 'Survey', changedAt: daysAgo(20), changedBy: 'u1' },
        ],
      }),
    ]);
    expect(r.find((c) => c.stage === 'New')).toMatchObject({ avgDays: 10, minDays: 10, maxDays: 10, projectCount: 1 });
  });

  it('aggregates across multiple projects', () => {
    const r = buildCycleTimes([
      makeProject({
        id: 'p1', projectId: 'p1',
        stageHistory: [
          { stage: 'New', changedAt: daysAgo(20), changedBy: 'u1' },
          { stage: 'Survey', changedAt: daysAgo(10), changedBy: 'u1' },
        ],
      }),
      makeProject({
        id: 'p2', projectId: 'p2',
        stageHistory: [
          { stage: 'New', changedAt: daysAgo(10), changedBy: 'u1' },
          { stage: 'Survey', changedAt: daysAgo(5), changedBy: 'u1' },
        ],
      }),
    ]);
    // (10 + 5) / 2 = 7.5 -> rounded to 8
    const newStage = r.find((c) => c.stage === 'New');
    expect(newStage).toBeDefined();
    expect(newStage!.avgDays).toBe(8);
    expect(newStage!.projectCount).toBe(2);
  });

  it('skips deleted projects', () => {
    expect(buildCycleTimes([
      makeProject({ id: 'p1', stageHistory: [{ stage: 'New', changedAt: daysAgo(10), changedBy: 'u1' }], isDeleted: true }),
    ])).toEqual([]);
  });
});

// Stuck Projects
describe('findStuckProjects', () => {
  it('returns empty for no stuck projects', () => {
    expect(findStuckProjects([makeProject({ id: 'p1', currentStage: 'New', createdAt: new Date().toISOString() })])).toEqual([]);
  });

  it('detects stuck projects', () => {
    const r = findStuckProjects([
      makeProject({
        id: 'p1', projectId: 'p1',
        currentStage: 'NetMetering',
        stageHistory: [
          { stage: 'New', changedAt: daysAgo(60), changedBy: 'u1' },
          { stage: 'NetMetering', changedAt: daysAgo(30), changedBy: 'u1' },
        ],
      }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].projectId).toBe('p1');
    expect(r[0].stuckDays).toBeGreaterThanOrEqual(30);
  });

  it('skips archived projects', () => {
    expect(findStuckProjects([
      makeProject({
        id: 'p1', currentStage: 'Archived',
        stageHistory: [{ stage: 'Archived', changedAt: daysAgo(30), changedBy: 'u1' }],
      }),
    ])).toEqual([]);
  });

  it('returns multiple sorted by severity', () => {
    const r = findStuckProjects([
      makeProject({
        id: 'p1', projectId: 'p1', currentStage: 'Survey',
        stageHistory: [{ stage: 'Survey', changedAt: daysAgo(20), changedBy: 'u1' }],
      }),
      makeProject({
        id: 'p2', projectId: 'p2', currentStage: 'NetMetering',
        stageHistory: [{ stage: 'NetMetering', changedAt: daysAgo(60), changedBy: 'u1' }],
      }),
    ]);
    expect(r[0].projectId).toBe('p2');
  });
});

// KPI Summary
describe('buildProjectKpis', () => {
  it('returns zeros for empty', () => {
    const r = buildProjectKpis([]);
    expect(r.totalProjects).toBe(0);
  });

  it('computes correct values', () => {
    const r = buildProjectKpis([
      makeProject({ id: 'p1', projectId: 'p1', currentStage: 'New', capacityKw: 10 }),
      makeProject({ id: 'p2', projectId: 'p2', currentStage: 'Survey', capacityKw: 5 }),
      makeProject({ id: 'p3', projectId: 'p3', currentStage: 'Archived', capacityKw: 15 }),
    ]);
    expect(r.totalProjects).toBe(3);
    expect(r.activeProjects).toBe(2);
    expect(r.archivedProjects).toBe(1);
    expect(r.totalCapacityKw).toBe(15);
    expect(r.averageCapacityKw).toBe(7.5);
    expect(r.projectsByStageCount).toBe(2); // New + Survey (Archived excluded)
  });

  it('excludes deleted', () => {
    const r = buildProjectKpis([
      makeProject({ id: 'p1', currentStage: 'New' }),
      makeProject({ id: 'p2', isDeleted: true, currentStage: 'New' }),
    ]);
    expect(r.totalProjects).toBe(1);
  });
});

// CSV Export
describe('reportToCsvRows', () => {
  it('generates sections from report', () => {
    const rows = reportToCsvRows({
      stageDistribution: [{ stage: 'New', count: 1, percentage: 100, color: '#6366f1' }],
      revenuePipeline: [{ stage: 'New', revenue: 50000, projectCount: 1, averageValue: 50000 }],
      cycleTimes: [{ stage: 'New', avgDays: 10, minDays: 5, maxDays: 15, projectCount: 1 }],
      stuckProjects: [],
      kpis: { totalProjects: 1, activeProjects: 1, archivedProjects: 0, totalCapacityKw: 10, averageCapacityKw: 10, projectsByStageCount: 1 },
      generatedAt: new Date().toISOString(),
    });
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => '_section' in r).length).toBeGreaterThanOrEqual(4);
  });
});

describe('csvRowsToString', () => {
  it('converts rows to CSV', () => {
    const csv = csvRowsToString([
      { _section: 'Section 1' },
      { Name: 'Test', Value: 100 },
    ]);
    expect(csv).toContain('Name,Value');
    expect(csv).toContain('# Section 1');
    expect(csv).toContain('Test,100');
  });

  it('returns empty for empty rows', () => {
    expect(csvRowsToString([])).toBe('');
  });

  it('escapes delimiters', () => {
    const csv = csvRowsToString([{ Name: 'Test, Inc.', Value: '100' }]);
    expect(csv).toContain('"Test, Inc."');
  });
});
