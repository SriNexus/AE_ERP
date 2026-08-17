/**
 * projectWorkspaceInstallationIntegration.test.ts — Installation Workspace
 * Migration (Stage 8 — Installation card gets a real operational workspace;
 * the read-only installation detail modal on the Installations list page is
 * retired; the workspace runs the existing lead-driven Installation workflow
 * through the canonical lib/installationEngine services and
 * updateInstallationStatus).
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: STAGE_WORKSPACES registers the
 * installation workspace, the workspace reuses the EXISTING installation
 * services (updateInstallationStatus is the canonical stage-advance service
 * and is never duplicated; installation performs NO inventory mutation —
 * dispatch's executeAndVerifyDispatch already issued the material), the
 * B2C serial rule preserves real captured values and explicitly marks
 * skipped tracking as pending (no fabricated values), the retired popup's
 * invocation paths are gone or rewired, the stage engine's "Open in full
 * workspace" target now points at the Project itself, and the workspace
 * carries no generic project context (Notes/Activity/Documents/Linked
 * Records stay at the Project Workspace level).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const installationWorkspace = read('../../features/projects/components/workspace/stages/ProjectInstallationWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageEngine = read('../../hooks/useProjectStage.ts');
const notificationRoutes = read('../../lib/notificationRoutes.ts');
const installationListPage = read('../Installations.tsx');
const installationEngineSrc = read('../../lib/installationEngine.ts');

describe('Installation stage — registered operational workspace (Stage 8)', () => {
  it('STAGE_WORKSPACES registers the installation workspace', () => {
    expect(stageRegistry).toContain('installation: ProjectInstallationWorkspace');
  });

  it('ProjectWorkOnThisProject mounts it through the shared ProjectStageCard shell and gives the card a real-data collapsed summary', () => {
    expect(workOnThisProject).toContain('const StageWorkspace = STAGE_WORKSPACES[stage.id]');
    expect(workOnThisProject).toContain("stage.id === 'installation' ? installationCardSummary : stage.id === 'qc' ? qcCardSummary : stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined");
    expect(workOnThisProject).toContain('function useInstallationCardSummary(projectId: string)');
    expect(workOnThisProject).toContain('queryKeys.forCompany(activeCompanyId).leadsAll');
    expect(workOnThisProject).toContain('isValidInstallation(l) && String(l.projectId || \'\') === projectId');
  });
});

describe('Installation workspace reuses the existing lead-driven Installation system verbatim (no parallel implementation)', () => {
  it('reads installation records with the SAME query key the Installations list page uses — installation lives on LEADS (lead.installationStatus), no second fetch or parallel entity', () => {
    expect(installationWorkspace).toContain('queryKey: keys.leadsAll');
    expect(installationWorkspace).toContain('getAll(COLLECTIONS.LEADS)');
    expect(installationWorkspace).toContain('isValidInstallation(l) && String(l.projectId || \'\') === project.id');
  });

  it('every state change goes through the canonical lib/installationEngine services and updateInstallationStatus — never a reimplementation', () => {
    expect(installationWorkspace).toContain("import { updateInstallationStatus } from '../../../../../lib/partnerLeadIntegration'");
    expect(installationWorkspace).toContain('await updateInstallationStatus(lead.id, selectedStage as any)');
    expect(installationWorkspace).toContain("import {\n  INSTALLATION_STAGES,\n  isValidInstallation,\n  stageBadgeColor,\n  stageLabel,\n  assignEngineer,\n  captureInstallationSerial,\n  removeCapturedSerial,\n  scheduleVisit,\n  toggleChecklistItem,\n  updateVisitStatus,\n  getLeadVisits,\n  type InstallationVisit,\n} from '../../../../../lib/installationEngine'");
    expect(installationWorkspace).toContain('await toggleChecklistItem(lead.id, index)');
    expect(installationWorkspace).toContain('await captureInstallationSerial(lead.id, serialInput.trim())');
    expect(installationWorkspace).toContain('await removeCapturedSerial(lead.id, index)');
    expect(installationWorkspace).toContain('await assignEngineer(lead.id, engineerId,');
    expect(installationWorkspace).toContain('await scheduleVisit(lead.id, visitDate,');
    expect(installationWorkspace).toContain('await updateVisitStatus(visit.id, status)');
    expect(installationWorkspace).toContain('getLeadVisits(lead.id)');
  });

  it('installation performs NO inventory mutation — dispatch already issued the material via executeAndVerifyDispatch; nothing is duplicated here', () => {
    expect(installationWorkspace).not.toContain('stockOut');
    expect(installationWorkspace).not.toContain('writeBatch');
    expect(installationWorkspace).not.toContain('increment(');
    // The workspace never issues stock itself — it only ever CALLS the
    // installation services (the dispatch STOCK_LEDGER OUT movement is
    // documented in the header comment, not performed here).
    expect(installationWorkspace).not.toMatch(/updateDoc\([^)]*STOCK/);
    expect(installationWorkspace).toContain('installation performs NO stock mutation');
  });
});

describe('B2C serial rule — real captured values preserved, skipped tracking explicitly pending for QC, nothing fabricated', () => {
  it('serial capture is optional and explicit about the QC handoff — the capture input says so and the empty state says so', () => {
    expect(installationWorkspace).toContain('B2C optional — QC captures later if skipped');
    expect(installationWorkspace).toContain('serial/barcode capture is optional at this stage and can be done during QC');
  });

  it('never fabricates serial numbers or barcodes', () => {
    expect(installationWorkspace).not.toContain('Math.random');
    expect(installationWorkspace).not.toContain("'SN-'");
    expect(installationWorkspace).not.toContain("barcode: '");
  });
});

describe('Generic project context stays at the Project Workspace level — the Installation stage workspace carries no Notes/Activity/Documents/Linked Records sections', () => {
  it('the embedded Installation workspace has no Activity / Activity Feed / ActivityTimeline section', () => {
    expect(installationWorkspace).not.toContain('ActivityTimeline');
    expect(installationWorkspace).not.toContain('Activity Feed');
    expect(installationWorkspace).not.toMatch(/<FormSection title="Activity"/);
  });

  it('the embedded Installation workspace has no generic Notes/Documents/Linked Records/History/Tasks FormSection — only Installation-specific operational sections', () => {
    expect(installationWorkspace).not.toMatch(/<FormSection title="(Notes|Documents|Activity|Linked Records|History|Tasks)"/);
    // The visit-scheduling notes input is a legitimate Installation-specific
    // form field, not a generic context section.
    expect(installationWorkspace).toContain('label="Notes (optional)"');
  });

  it('the Project Workspace still owns the single authoritative context layer — Documents/Activity/Linked Records via ProjectWorkspaceSections', () => {
    const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
    expect(sections).toContain('label="Documents"');
    expect(sections).toContain('title="Activity"');
    expect(sections).toContain('Linked Records');
  });
});

describe('Old standalone Installation detail modal — retired, invocation paths rewired', () => {
  it('the list page no longer mounts the read-only detail modal (no viewItem, no detail-modal query machinery)', () => {
    expect(installationListPage).not.toContain('viewItem');
    expect(installationListPage).not.toContain('Installation workspace');
    expect(installationListPage).not.toContain('DETAIL MODAL');
  });

  it('row click / ID / View navigate to the /installations/:id record workspace page', () => {
    expect(installationListPage).toContain("navigate(`/installations/${encodeURIComponent(installation?.id || '')}`)");
    expect(installationListPage).toContain('function openInstallation(installation: any)');
  });

  it('the list page keeps its full list functionality — search, filters, KPIs, pagination, bulk assign/export/delete all remain', () => {
    expect(installationListPage).toContain('bulkAssignMutation');
    expect(installationListPage).toContain('assignEngineer(id, userId, userName)');
    expect(installationListPage).toContain('deleteDocById(COLLECTIONS.LEADS, id)');
    expect(installationListPage).toContain('downloadInstallationsCsv');
    expect(installationListPage).toContain('KPI_TILES');
  });

  it('installation notifications and the stage engine open the record page / Project Workspace, not ?open=', () => {
    expect(notificationRoutes).toContain("`/installations/${encodeURIComponent(entityId)}`");
    expect(notificationRoutes).not.toContain("'/installations?open='");
    expect(stageEngine).toContain("if (stage === 'Installation') return `/projects/${projectId}`;");
  });

  it('the Installation stage href points at the Project (the workspace lives inside the Project Workspace), like Quotation/Order/Procurement/Dispatch', () => {
    expect(stageEngine).toContain("if (stage === 'Installation') return `/projects/${projectId}`;");
  });
});
