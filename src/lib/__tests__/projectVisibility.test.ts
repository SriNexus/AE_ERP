import { describe, expect, it } from 'vitest';
import { buildProjectVisibilityQueryPlan, canAccessProjectRecord, filterVisibleProjectRecords, getProjectVisibilityMode, isProjectScopedCollection } from '../projectVisibility';
import { getSystemRoleSeedDocuments } from '../roleBootstrap';
import { canDo } from '../permissions';
import { useAppStore } from '../../store/useAppStore';

describe('project visibility helpers', () => {
  const roleDocs = getSystemRoleSeedDocuments();
  const surveyorRole = roleDocs.find((role) => role.name === 'Surveyor');
  const adminRole = roleDocs.find((role) => role.name === 'Admin');
  const managerRole = roleDocs.find((role) => role.name === 'Manager');

  it('recognizes project scoped collections', () => {
    expect(isProjectScopedCollection('projects')).toBe(true);
    expect(isProjectScopedCollection('leads')).toBe(false);
  });

  it('keeps unrestricted roles fully visible', () => {
    expect(getProjectVisibilityMode('Admin', adminRole)).toBe('all');
    expect(canAccessProjectRecord({ assignedSurveyor: 'USR-1' }, 'USR-1', 'Admin', adminRole)).toBe(true);

    const plan = buildProjectVisibilityQueryPlan('COMP-1', 'USR-1', 'Admin', adminRole);
    expect(plan.mode).toBe('all');
    expect(plan.queries).toHaveLength(1);
  });

  it('Phase 2 (G7 fix + §8.2 matrix): Manager operates at TEAM scope, not org-wide', () => {
    // The authoritative Phase 2 contract scopes Manager/TL to their assigned
    // team (own + direct reports), matching the teamMemberIds the Phase 1
    // managerId relationship resolves — Manager is deliberately NOT 'all'.
    expect(getProjectVisibilityMode('Manager', managerRole)).toBe('assigned');
    expect(canAccessProjectRecord({ assignedSurveyor: 'MGR-1' }, 'MGR-1', 'Manager', managerRole, [])).toBe(true);
    expect(canAccessProjectRecord({ assignedSurveyor: 'REPORT-1' }, 'MGR-1', 'Manager', managerRole, ['REPORT-1'])).toBe(true);
    expect(canAccessProjectRecord({ assignedSurveyor: 'OUTSIDER-1' }, 'MGR-1', 'Manager', managerRole, ['REPORT-1'])).toBe(false);
  });

  it('narrows field roles to their assigned projects only', () => {
    expect(getProjectVisibilityMode('Surveyor', surveyorRole)).toBe('assigned');
    expect(canAccessProjectRecord({ assignedSurveyor: 'USR-1' }, 'USR-1', 'Surveyor', surveyorRole)).toBe(true);
    expect(canAccessProjectRecord({ assignedSurveyor: 'USR-2' }, 'USR-1', 'Surveyor', surveyorRole)).toBe(false);
    expect(canAccessProjectRecord({ salesOwner: 'USR-1' }, 'USR-1', 'Surveyor', surveyorRole)).toBe(true);
    expect(canAccessProjectRecord({ designerId: 'USR-1' }, 'USR-1', 'Engineer', roleDocs.find((role) => role.name === 'Engineer'))).toBe(true);

    const plan = buildProjectVisibilityQueryPlan('COMP-1', 'USR-1', 'Surveyor', surveyorRole);
    expect(plan.mode).toBe('assigned');
    // Phase 3 added `partnerId` to PROJECT_ASSIGNMENT_FIELDS (5 total:
    // assignedSurveyor/assignedInstaller/salesOwner/designerId/partnerId).
    expect(plan.queries).toHaveLength(5);
  });

  it('filters mixed project datasets to only visible rows', () => {
    const rows = [
      { id: 'p-1', assignedSurveyor: 'USR-1', companyId: 'COMP-1' },
      { id: 'p-2', assignedInstaller: 'USR-1', companyId: 'COMP-1' },
      { id: 'p-3', salesOwner: 'USR-1', companyId: 'COMP-1' },
      { id: 'p-6', designerId: 'USR-1', companyId: 'COMP-1' },
      { id: 'p-4', assignedSurveyor: 'USR-2', companyId: 'COMP-1' },
      { id: 'p-5', companyId: 'COMP-1' },
    ];

    const visible = filterVisibleProjectRecords(rows, 'USR-1', 'Surveyor', surveyorRole);
    expect(visible.map((row) => row.id)).toEqual(['p-1', 'p-2', 'p-3', 'p-6']);
  });

  it('Phase 13: "team" visibility includes the manager own records plus their direct reports, not just self', () => {
    const teamRole = { ...surveyorRole!, permissions: { ...surveyorRole!.permissions, projects: { ...surveyorRole!.permissions.projects, visibility: 'team' as const } } };

    // Manager's own record
    expect(canAccessProjectRecord({ assignedSurveyor: 'MGR-1' }, 'MGR-1', 'Manager', teamRole, [])).toBe(true);
    // A direct report's record — must now be visible (the confirmed Phase 13 gap)
    expect(canAccessProjectRecord({ assignedSurveyor: 'REPORT-1' }, 'MGR-1', 'Manager', teamRole, ['REPORT-1', 'REPORT-2'])).toBe(true);
    // Someone outside the team must still be excluded
    expect(canAccessProjectRecord({ assignedSurveyor: 'OUTSIDER-1' }, 'MGR-1', 'Manager', teamRole, ['REPORT-1', 'REPORT-2'])).toBe(false);

    const plan = buildProjectVisibilityQueryPlan('COMP-1', 'MGR-1', 'Manager', teamRole, ['REPORT-1', 'REPORT-2']);
    expect(plan.mode).toBe('assigned');
    // 5 assignment fields (Phase 3 added partnerId) x 1 id-chunk
    // (3 ids fits in one 'in' chunk)
    expect(plan.queries).toHaveLength(5);
  });

  it('Phase 13: "self" visibility (no explicit "team") ignores teamMemberIds — must not regress into team-wide access', () => {
    // Surveyor's system-seeded role has no explicit visibility value, resolving to 'self' via the role-name heuristic.
    expect(canAccessProjectRecord({ assignedSurveyor: 'REPORT-1' }, 'MGR-1', 'Surveyor', surveyorRole, ['REPORT-1'])).toBe(false);
  });

  it('Phase 13: filterVisibleProjectRecords includes team members\' rows only when visibility is "team"', () => {
    const teamRole = { ...surveyorRole!, permissions: { ...surveyorRole!.permissions, projects: { ...surveyorRole!.permissions.projects, visibility: 'team' as const } } };
    const rows = [
      { id: 'p-1', assignedSurveyor: 'MGR-1', companyId: 'COMP-1' },
      { id: 'p-2', assignedSurveyor: 'REPORT-1', companyId: 'COMP-1' },
      { id: 'p-3', assignedSurveyor: 'OUTSIDER-1', companyId: 'COMP-1' },
    ];
    const visible = filterVisibleProjectRecords(rows, 'MGR-1', 'Manager', teamRole, ['REPORT-1']);
    expect(visible.map((row) => row.id)).toEqual(['p-1', 'p-2']);
  });

  it('Phase 13: chunks team id sets larger than Firestore\'s 30-value "in" limit into multiple queries per field', () => {
    const teamRole = { ...surveyorRole!, permissions: { ...surveyorRole!.permissions, projects: { ...surveyorRole!.permissions.projects, visibility: 'team' as const } } };
    const bigTeam = Array.from({ length: 35 }, (_, i) => `REPORT-${i}`);
    const plan = buildProjectVisibilityQueryPlan('COMP-1', 'MGR-1', 'Manager', teamRole, bigTeam);
    // 36 total ids (self + 35 reports) -> 2 chunks (30 + 6) per field x 5
    // fields (Phase 3 added partnerId) = 10 queries
    expect(plan.queries).toHaveLength(10);
  });

  it('optionally applies project row visibility through canDo', () => {
    useAppStore.setState({
      user: { id: 'USR-1', name: 'Surveyor', email: 'surveyor@example.com', role: 'Surveyor', companyId: 'COMP-1' },
      permissionCache: {
        ready: true,
        roles: { surveyor: surveyorRole! },
        diagnostics: [],
      },
    });

    expect(canDo('view', 'projects', 'Surveyor', { record: { assignedSurveyor: 'USR-1' } })).toBe(true);
    expect(canDo('view', 'projects', 'Surveyor', { record: { assignedSurveyor: 'USR-2' } })).toBe(false);
  });
});
