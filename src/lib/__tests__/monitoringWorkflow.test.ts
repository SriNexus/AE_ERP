/**
 * monitoringWorkflow.test.ts — Unit tests for generation readings workflow
 *
 * Tests the immutable create + validation pattern.
 * Follows the same test patterns as amcWorkflow.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReading, validateReading } from '../monitoringWorkflow';
import * as firestore from '../firestore';
import * as workflowUtils from '../workflow';
import { useAppStore } from '../../store/useAppStore';

vi.mock('../firestore', () => ({
  createDocWithId: vi.fn(),
  getOne: vi.fn(async (_collection: string, id: string) => ({ id, currentStage: 'Service', stageHistory: [] })),
  updateDocById: vi.fn(),
  genId: {
    generic: vi.fn(() => 'GEN-test-id'),
    handover: vi.fn(() => 'HDO-test-id'),
  },
}));

vi.mock('../workflow', () => ({
  logActivity: vi.fn(() => Promise.resolve()),
  resolveWorkflowCompanyId: vi.fn(() => 'company-1'),
  text: (v: unknown) => (typeof v === 'string' ? v : ''),
  notifyUsers: vi.fn(),
}));

vi.mock('../notifications', () => ({
  getNotificationUsersByRoles: vi.fn(() => Promise.resolve([])),
  notifyUsersOnce: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      user: { id: 'user-1', name: 'Test User', companyId: 'company-1' },
      activeCompanyId: 'company-1',
      company: { id: 'company-1', currencySymbol: '₹' },
    })),
  },
}));

describe('validateReading', () => {
  it('returns valid for a complete reading', () => {
    const result = validateReading({
      projectId: 'proj-1',
      readingDate: '2026-07-15',
      readingKwh: 150,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing projectId', () => {
    const result = validateReading({
      readingDate: '2026-07-15',
      readingKwh: 150,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Project is required');
  });

  it('rejects missing readingDate', () => {
    const result = validateReading({
      projectId: 'proj-1',
      readingKwh: 150,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Reading date is required');
  });

  it('rejects negative kWh', () => {
    const result = validateReading({
      projectId: 'proj-1',
      readingDate: '2026-07-15',
      readingKwh: -10,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Generation (kWh) must be a non-negative number');
  });

  it('rejects unrealistically high kWh', () => {
    const result = validateReading({
      projectId: 'proj-1',
      readingDate: '2026-07-15',
      readingKwh: 1_000_000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Generation value is unrealistically high');
  });

  it('allows zero kWh reading', () => {
    const result = validateReading({
      projectId: 'proj-1',
      readingDate: '2026-07-15',
      readingKwh: 0,
    });
    expect(result.valid).toBe(true);
  });

  it('returns multiple errors when multiple fields are invalid', () => {
    const result = validateReading({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('createReading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a reading successfully', async () => {
    const result = await createReading({
      projectId: 'proj-1',
      projectName: 'Solar Project Alpha',
      readingDate: '2026-07-15',
      readingKwh: 150.5,
      notes: 'Routine AMC visit',
    });

    expect(result.error).toBeUndefined();
    expect(result.data).not.toBeNull();
    expect(result.data!.readingKwh).toBe(150.5);
    expect(result.data!.projectId).toBe('proj-1');
    expect(result.data!.statusHistory).toHaveLength(1);
    expect(result.data!.statusHistory![0].status).toBe('Recorded');
    expect(firestore.createDocWithId).toHaveBeenCalledTimes(1);
    expect(workflowUtils.logActivity).toHaveBeenCalledWith(
      'monitoring',
      'generation_reading_recorded',
      'GEN-test-id',
      expect.objectContaining({ projectId: 'proj-1', readingKwh: 150.5 }),
    );
  });

  it('returns error when validation fails', async () => {
    const result = await createReading({
      projectId: '',
      readingDate: '',
      readingKwh: -5,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(firestore.createDocWithId).not.toHaveBeenCalled();
  });

  it('creates reading with zero kWh', async () => {
    const result = await createReading({
      projectId: 'proj-2',
      readingDate: '2026-07-20',
      readingKwh: 0,
    });

    expect(result.error).toBeUndefined();
    expect(result.data).not.toBeNull();
    expect(result.data!.readingKwh).toBe(0);
  });

  it('handles create error gracefully', async () => {
    vi.mocked(firestore.createDocWithId).mockRejectedValueOnce(new Error('Firestore error'));

    const result = await createReading({
      projectId: 'proj-1',
      readingDate: '2026-07-15',
      readingKwh: 100,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });
});
