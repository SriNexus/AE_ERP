import { describe, expect, it } from 'vitest';

import type { ProjectRecord } from '../../features/projects/types';
import { resolveProjectWorkspaceStages } from '../../hooks/useProjectStage';
import { filterMobileProjects } from '../../components/mobile/projects/MobileProjectList';

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'PRJ-001',
    projectId: 'PRJ-001',
    companyId: 'COMP-1',
    customerId: 'CUS-1',
    capacityKw: 10,
    siteAddress: {},
    currentStage: 'Dispatch',
    stageHistory: [],
    linkedQuotationIds: ['QUO-1'],
    linkedOrderIds: ['ORD-1'],
    linkedDispatchIds: ['DSP-1'],
    ...overrides,
  };
}

describe('P04-02 project workspace lifecycle', () => {
  // Vendor Lock GAP-04 remediation (independent audit, 2026-08-14): this
  // test was stale, not the implementation — the Registration
  // (SchemeRegistration) stage card was correctly added to LIFECYCLE ahead
  // of Survey per the Vendor Lock spec §20 ("new stage card Registration...
  // in useProjectStage.LIFECYCLE + stage registry"), making the workspace
  // journey 14 stages, not 13. The hardcoded expectation here was never
  // updated when that (correct, intentional) change landed.
  it('builds all 14 Blueprint lifecycle stages, including the Registration (SchemeRegistration) stage', () => {
    const stages = resolveProjectWorkspaceStages(project());
    expect(stages).toHaveLength(14);
    expect(stages.map((stage) => stage.projectStage)).toEqual([
      'SchemeRegistration', 'Survey', 'Engineering', 'Quotation', 'Order', 'Procurement', 'Dispatch',
      'Installation', 'QC', 'Commissioning', 'NetMetering', 'Subsidy', 'Handover', 'AMC',
    ]);
  });

  it('marks prior, current, and future stages correctly', () => {
    const stages = resolveProjectWorkspaceStages(project());
    expect(stages.find((stage) => stage.id === 'survey')?.status).toBe('completed');
    expect(stages.find((stage) => stage.id === 'dispatch')?.status).toBe('current');
    expect(stages.find((stage) => stage.id === 'installation')?.status).toBe('upcoming');
  });

  it('keeps net metering and subsidy visible as parallel work', () => {
    const stages = resolveProjectWorkspaceStages(project({ currentStage: 'NetMetering' }));
    expect(stages.find((stage) => stage.id === 'net-metering')?.status).toBe('current');
    expect(stages.find((stage) => stage.id === 'subsidy')?.status).toBe('attention');
  });

  it('deep-links existing records with project context', () => {
    const stages = resolveProjectWorkspaceStages(project());
    // Registration's (SchemeRegistration) workspace also lives inside the
    // Project Workspace (Phase 6), same as Quotation's, Order's,
    // Procurement's, Dispatch's, Installation's, QC's, Commissioning's, Net
    // Metering's, Subsidy's, Handover's and AMC's — their "Open in full
    // workspace" targets are all the Project itself.
    expect(stages.find((stage) => stage.id === 'registration')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'quotation')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'order')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'procurement')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'dispatch')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'installation')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'qc')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'commissioning')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'net-metering')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'subsidy')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'handover')?.href).toBe('/projects/PRJ-001');
    expect(stages.find((stage) => stage.id === 'amc')?.href).toBe('/projects/PRJ-001');
  });

  it('links the implemented Survey and Engineering workspaces', () => {
    const stages = resolveProjectWorkspaceStages(project());
    expect(stages.find((stage) => stage.id === 'survey')?.href).toBe('/surveys?projectId=PRJ-001');
    expect(stages.find((stage) => stage.id === 'survey')?.emptyMessage).toBeUndefined();
    expect(stages.find((stage) => stage.id === 'engineering')?.href).toBe('/engineering-designs?projectId=PRJ-001');
    expect(stages.find((stage) => stage.id === 'engineering')?.emptyMessage).toBeUndefined();
  });
});

describe('P04-04 mobile project list', () => {
  it('filters the already-visible project set by mobile search and stage', () => {
    const projects = [
      project({ id: 'PRJ-001', projectId: 'PRJ-001', currentStage: 'Survey', customerId: 'CUS-1' }),
      project({ id: 'PRJ-002', projectId: 'PRJ-002', currentStage: 'Dispatch', customerId: 'CUS-2' }),
    ];

    expect(filterMobileProjects(projects, 'CUS-1', 'Survey').map((entry) => entry.id)).toEqual(['PRJ-001']);
    expect(filterMobileProjects(projects, '', 'Dispatch').map((entry) => entry.id)).toEqual(['PRJ-002']);
  });
});
