import { describe, expect, it } from 'vitest';

import {
  buildProjectBackfillPlan,
  formatProjectBackfillSummary,
  PROJECT_BACKFILL_COLLECTIONS,
} from '../projectBackfill';

describe('project backfill planning', () => {
  const projects = [
    {
      id: 'proj-1',
      projectId: 'PRJ-0001',
      customerId: 'cust-1',
      companyId: 'company-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'proj-2',
      projectId: 'PRJ-0002',
      customerId: 'cust-1',
      companyId: 'company-1',
      createdAt: '2024-03-01T00:00:00.000Z',
    },
    {
      id: 'proj-other-company',
      projectId: 'PRJ-1001',
      customerId: 'cust-1',
      companyId: 'company-2',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
  ];

  it('assigns only records inside a single-project cluster', () => {
    const plan = buildProjectBackfillPlan({
      projects,
      orders: [
        { id: 'ord-1', companyId: 'company-1', customerId: 'cust-1', date: '2024-01-05T00:00:00.000Z' },
        { id: 'ord-2', companyId: 'company-1', customerId: 'cust-1', date: '2024-02-20T00:00:00.000Z' },
        { id: 'ord-3', companyId: 'company-1', customerId: 'cust-1', date: '2024-03-05T00:00:00.000Z' },
      ],
      quotations: [
        { id: 'quo-1', companyId: 'company-1', customerId: 'cust-1', date: '2024-01-08T00:00:00.000Z' },
      ],
      dispatch: [
        { id: 'dsp-1', companyId: 'company-1', customerId: 'cust-1', date: '2024-03-10T00:00:00.000Z' },
      ],
    }, { clusterGapDays: 30 });

    expect(plan.assignments).toHaveLength(5);
    expect(plan.assignments.find((item) => item.id === 'ord-1')?.projectId).toBe('PRJ-0001');
    expect(plan.assignments.find((item) => item.id === 'quo-1')?.projectId).toBe('PRJ-0001');
    expect(plan.assignments.find((item) => item.id === 'ord-2')?.projectId).toBe('PRJ-0002');
    expect(plan.assignments.find((item) => item.id === 'ord-3')?.projectId).toBe('PRJ-0002');
    expect(plan.assignments.find((item) => item.id === 'dsp-1')?.projectId).toBe('PRJ-0002');
    expect(plan.summary.assignmentCount).toBe(5);
    expect(plan.summary.skipped.ambiguousCluster).toBe(0);
  });

  it('skips ambiguous clusters and keeps existing projectId values untouched', () => {
    const plan = buildProjectBackfillPlan({
      projects: [
        ...projects,
        {
          id: 'proj-3',
          projectId: 'PRJ-0003',
          customerId: 'cust-2',
          companyId: 'company-1',
          createdAt: '2024-01-10T00:00:00.000Z',
        },
        {
          id: 'proj-4',
          projectId: 'PRJ-0004',
          customerId: 'cust-2',
          companyId: 'company-1',
          createdAt: '2024-01-20T00:00:00.000Z',
        },
      ],
      orders: [
        { id: 'ord-ambiguous', companyId: 'company-1', customerId: 'cust-2', date: '2024-01-15T00:00:00.000Z' },
        { id: 'ord-existing', companyId: 'company-1', customerId: 'cust-1', date: '2024-01-06T00:00:00.000Z', projectId: 'PRJ-KEEP' },
      ],
      quotations: [],
      dispatch: [],
    }, { clusterGapDays: 30 });

    expect(plan.assignments).toHaveLength(0);
    expect(plan.summary.skipped.ambiguousCluster).toBe(1);
    expect(plan.summary.skipped.existingProjectId).toBe(1);
  });

  it('formats a readable summary for console logging', () => {
    const plan = buildProjectBackfillPlan({
      projects: [],
      orders: [],
      quotations: [],
      dispatch: [],
    });

    const summary = formatProjectBackfillSummary(plan.summary);
    expect(summary).toContain('Projects scanned: 0');
    expect(summary).toContain('Assignments: 0');
    expect(summary).toContain('Skipped existing projectId: 0');
  });

  it('exports the approved collection names', () => {
    expect(PROJECT_BACKFILL_COLLECTIONS.PROJECTS).toBe('projects');
    expect(PROJECT_BACKFILL_COLLECTIONS.ORDERS).toBe('orders');
    expect(PROJECT_BACKFILL_COLLECTIONS.QUOTATIONS).toBe('quotations');
    expect(PROJECT_BACKFILL_COLLECTIONS.DISPATCH).toBe('dispatch');
  });
});
