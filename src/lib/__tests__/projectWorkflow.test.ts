import { describe, expect, it } from 'vitest';

import { buildProjectArchivePayload, buildProjectCreatePayload, buildProjectUpdatePayload } from '../projectWorkflow';
import { PROJECT_FORM_DEFAULT } from '../../features/projects/types';

describe('project workflow payloads', () => {
  const form = {
    ...PROJECT_FORM_DEFAULT,
    customerId: 'CUST-1',
    capacityKw: '12.5',
    projectType: 'Residential',
    siteAddress: {
      ...PROJECT_FORM_DEFAULT.siteAddress,
      line1: 'Unit 12',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
    },
  };

  it('builds a valid create payload with stage history', () => {
    const payload = buildProjectCreatePayload(form, {
      projectId: 'PRJ-20260709-ABCD',
      companyId: 'COMP-1',
      userId: 'USR-1',
    });

    expect(payload.projectId).toBe('PRJ-20260709-ABCD');
    expect(payload.currentStage).toBe('New');
    expect(payload.capacityKw).toBe(12.5);
    expect(payload.stageHistory).toHaveLength(1);
    expect(payload.siteAddress.city).toBe('Pune');
    expect(payload.projectType).toBe('Residential');
  });

  it('Phase 4: rejects a create payload with no Project Type', () => {
    expect(() => buildProjectCreatePayload(
      { ...form, projectType: '' },
      { projectId: 'PRJ-20260709-ABCD', companyId: 'COMP-1', userId: 'USR-1' },
    )).toThrow('Project Type is required');
  });

  it('Phase 4: grandfathers existing Projects — the update payload does not re-enforce Project Type on legacy empty records', () => {
    const payload = buildProjectUpdatePayload({ ...form, projectType: '' });
    expect(payload.projectType).toBeUndefined();
  });

  it('normalizes update payloads without mutating structure', () => {
    const payload = buildProjectUpdatePayload(form);
    expect(payload.customerId).toBe('CUST-1');
    expect(payload.capacityKw).toBe(12.5);
    expect(payload.siteAddress.state).toBe('Maharashtra');
  });

  it('builds archive payloads with append-only stage history', () => {
    const payload = buildProjectArchivePayload({
      id: 'PRJ-20260709-ABCD',
      projectId: 'PRJ-20260709-ABCD',
      companyId: 'COMP-1',
      customerId: 'CUST-1',
      capacityKw: 5,
      siteAddress: form.siteAddress,
      currentStage: 'Installation',
      stageHistory: [{ stage: 'Installation', changedAt: '2026-07-09T10:00:00.000Z' }],
      linkedQuotationIds: [],
      linkedOrderIds: [],
      linkedDispatchIds: [],
      isDeleted: false,
    });

    expect(payload.currentStage).toBe('Archived');
    expect(payload.stageHistory).toHaveLength(2);
    expect(payload.archiveReason).toContain('Archived');
  });
});

