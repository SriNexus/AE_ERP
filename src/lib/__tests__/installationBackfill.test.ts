/**
 * installationBackfill.test.ts — Phase 10 migration-logic tests.
 *
 * Pure-function coverage for the historical-data reconciliation plan: every
 * Lead with real installation progress compared against whether a matching
 * Project-scoped `installations` document already exists. Confirms the
 * three-way split (already migrated / needs creation / orphaned-never-
 * dropped) mirrors the established orderTypeBackfill.ts precedent.
 */
import { describe, it, expect } from 'vitest';
import { buildInstallationBackfillPlan, formatInstallationBackfillSummary } from '../installationBackfill';

describe('buildInstallationBackfillPlan', () => {
  it('plans creation for a Lead with real installation progress and a linked Project that has no installations doc yet', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [{ id: 'LEAD-1', companyId: 'C1', projectId: 'PRJ-1', installationStatus: 'installation_in_progress', assignedEngineerId: 'USR-1', assignedEngineerName: 'Ravi' }],
      installations: [],
    });
    expect(plan.creations).toEqual([
      {
        leadId: 'LEAD-1',
        projectId: 'PRJ-1',
        companyId: 'C1',
        installationStatus: 'installation_in_progress',
        checklist: [],
        capturedSerialNumbers: [],
        assignedEngineerId: 'USR-1',
        assignedEngineerName: 'Ravi',
        assignedEngineerPhone: '',
      },
    ]);
    expect(plan.orphaned).toEqual([]);
    expect(plan.summary).toMatchObject({ leadsScanned: 1, alreadyMigrated: 0, notInstallations: 0, toCreate: 1, orphaned: 0 });
  });

  it('leaves a Lead alone when a real installation doc already exists for its Project', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [{ id: 'LEAD-2', companyId: 'C1', projectId: 'PRJ-2', installationStatus: 'completed' }],
      installations: [{ id: 'INST-1', projectId: 'PRJ-2' }],
    });
    expect(plan.creations).toEqual([]);
    expect(plan.summary.alreadyMigrated).toBe(1);
  });

  it('skips a Lead that has not yet progressed past pending (not a real installation)', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [{ id: 'LEAD-3', companyId: 'C1', projectId: 'PRJ-3', installationStatus: 'pending' }],
      installations: [],
    });
    expect(plan.creations).toEqual([]);
    expect(plan.summary.notInstallations).toBe(1);
  });

  it('skips a Lead with no installationStatus at all', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [{ id: 'LEAD-4', companyId: 'C1', projectId: 'PRJ-4' }],
      installations: [],
    });
    expect(plan.creations).toEqual([]);
    expect(plan.summary.notInstallations).toBe(1);
  });

  it('never guesses: a Lead with real installation progress but no linked Project is reported orphaned, not created', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [{ id: 'LEAD-5', companyId: 'C1', installationStatus: 'installation_started' }],
      installations: [],
    });
    expect(plan.creations).toEqual([]);
    expect(plan.orphaned).toEqual([{ leadId: 'LEAD-5', companyId: 'C1', reason: 'missing_project_id' }]);
  });

  it('skips soft-deleted leads entirely (neither created nor counted as orphaned)', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [{ id: 'LEAD-6', companyId: 'C1', projectId: 'PRJ-6', installationStatus: 'completed', isDeleted: true }],
      installations: [],
    });
    expect(plan.summary.leadsScanned).toBe(0);
    expect(plan.creations).toEqual([]);
    expect(plan.orphaned).toEqual([]);
  });

  it('never plans two Installation docs for the same Project even if two Leads share it', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [
        { id: 'LEAD-7', companyId: 'C1', projectId: 'PRJ-7', installationStatus: 'installation_started' },
        { id: 'LEAD-8', companyId: 'C1', projectId: 'PRJ-7', installationStatus: 'installation_started' },
      ],
      installations: [],
    });
    expect(plan.creations).toHaveLength(1);
    expect(plan.creations[0].leadId).toBe('LEAD-7');
  });

  it('filters by companyId when provided', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [
        { id: 'LEAD-9', companyId: 'C1', projectId: 'PRJ-9', installationStatus: 'installation_started' },
        { id: 'LEAD-10', companyId: 'C2', projectId: 'PRJ-10', installationStatus: 'installation_started' },
      ],
      installations: [],
    }, { companyId: 'C1' });
    expect(plan.creations.map((c) => c.leadId)).toEqual(['LEAD-9']);
    expect(plan.summary.leadsScanned).toBe(1);
  });

  it('formatInstallationBackfillSummary produces a readable, complete report', () => {
    const plan = buildInstallationBackfillPlan({
      leads: [
        { id: 'LEAD-11', companyId: 'C1', projectId: 'PRJ-11', installationStatus: 'installation_started' },
        { id: 'LEAD-12', companyId: 'C1', installationStatus: 'installation_started' },
      ],
      installations: [],
    });
    const text = formatInstallationBackfillSummary(plan.summary);
    expect(text).toContain('Leads scanned: 2');
    expect(text).toContain('Installation docs to create: 1');
    expect(text).toContain('Orphaned (cannot safely migrate, left untouched): 1');
  });
});
