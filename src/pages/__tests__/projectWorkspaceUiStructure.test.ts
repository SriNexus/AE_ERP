/**
 * projectWorkspaceUiStructure.test.ts — Project Workspace UI Structure +
 * Phase 2 Completion & Structure Fix + Left/Center Panel feedback missions.
 *
 * Source-text analysis, matching this codebase's established convention (no
 * @testing-library/react). Covers: the old generic WorkspaceShell +
 * PROJECT_TABS architecture stays retired, "Work on This Project" is
 * unchanged, Documents/Activity/Notes/Linked Records are consolidated into
 * ProjectWorkspaceSections.tsx using the SAME shared PeekCard/CollapsedRow
 * shell Customer/Lead Workspace's own secondary sections now use (extracted
 * to components/shared/WorkspaceSectionCards.tsx), the Header shows only
 * the city (not a full address), Edit is an inline panel swap (not a
 * modal) with Select-based team assignment (so the Team call button
 * resolves against a real user), and no Project business logic/data
 * model/routes were touched beyond the additive notes/documents fields.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const projectWorkspacePage = read('../ProjectWorkspace.tsx');
const header = read('../../features/projects/components/workspace/ProjectWorkspaceHeader.tsx');
const leftPanel = read('../../features/projects/components/workspace/ProjectWorkspaceLeftPanel.tsx');
const contextPanel = read('../../features/projects/components/workspace/ProjectContextPanel.tsx');
const editor = read('../../features/projects/components/workspace/ProjectWorkspaceEditor.tsx');
const sections = read('../../features/projects/components/workspace/ProjectWorkspaceSections.tsx');
const rightPanel = read('../../features/projects/components/workspace/ProjectWorkspaceRightPanel.tsx');
const docsSection = read('../../features/projects/components/workspace/ProjectWorkspaceDocumentsSection.tsx');
const customerDocsSection = read('../../features/customers/components/workspace/CustomerWorkspaceDocumentsSection.tsx');
const leadDocsSection = read('../../features/leads/components/workspace/LeadWorkspaceDocumentsSection.tsx');
const sharedCards = read('../../components/shared/WorkspaceSectionCards.tsx');
const customerSections = read('../../features/customers/components/workspace/CustomerWorkspaceSections.tsx');
const leadSections = read('../../features/leads/components/workspace/LeadWorkspaceSections.tsx');
const customerLinkedRecordsTabContent = read('../../features/customers/components/workspace/CustomerLinkedRecordsTabContent.tsx');
const projectHealthCard = read('../../features/projects/components/workspace/rightPanel/ProjectHealthCard.tsx');
const projectHealthSrc = read('../../features/projects/services/projectHealth.ts');
const customerLinkedRecords = read('../../features/customers/components/workspace/rightPanel/CustomerLinkedRecords.tsx');
const projectsListPage = read('../Projects.tsx');
const customerWorkspacePage = read('../CustomerWorkspace.tsx');
const leadWorkspacePage = read('../LeadWorkspace.tsx');
const routesSrc = read('../../app/router/routes.tsx');
const projectTypes = read('../../features/projects/types/index.ts');
const projectForm = read('../../features/projects/components/ProjectForm.tsx');
const projectDetailModal = read('../../features/projects/components/ProjectDetailModal.tsx');
const projectWorkflow = read('../../lib/projectWorkflow.ts');
const mobileProjectList = read('../../components/mobile/projects/MobileProjectList.tsx');
const mobileProjectWorkspace = read('../../components/mobile/projects/MobileProjectWorkspace.tsx');
const loanApplicationWorkflow = read('../../features/loan-applications/services/loanApplicationWorkflow.ts');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageCard = read('../../features/projects/components/workspace/ProjectStageCard.tsx');
const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const surveyWorkspace = read('../../features/projects/components/workspace/stages/ProjectSurveyWorkspace.tsx');
const surveyDetail = read('../../features/surveys/components/SurveyDetail.tsx');
const useProjectStageSrc2 = read('../../hooks/useProjectStage.ts');

describe('Old generic WorkspaceShell/PROJECT_TABS architecture stays retired from this page', () => {
  it('ProjectWorkspace.tsx still does not import or render WorkspaceShell, PROJECT_TABS, or the generic tab-synced useWorkspace hook', () => {
    expect(projectWorkspacePage).not.toContain('WorkspaceShell');
    expect(projectWorkspacePage).not.toContain('PROJECT_TABS');
    expect(projectWorkspacePage).not.toContain("useWorkspace('projects'");
    expect(projectWorkspacePage).not.toContain('<ProjectOverview');
  });

  it('routes.tsx still points /projects/:id at ProjectWorkspace, unchanged — no route was touched', () => {
    expect(routesSrc).toMatch(/path="\/projects\/:id"\s+element=\{<RoleRoute module="projects"><SafePage><ProjectWorkspace \/><\/SafePage><\/RoleRoute>\}/);
  });
});

describe('Surface/spacing/panel-sizing language still matches Customer/Leads Workspace', () => {
  it('same outer wrapper and height compensation as Customer and Leads Workspace', () => {
    for (const page of [customerWorkspacePage, leadWorkspacePage, projectWorkspacePage]) {
      expect(page).toMatch(/-m-5 p-2 flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-\[var\(--color-bg\)\]/);
      expect(page).toContain("style={{ height: 'calc(100% + 2.5rem)' }}");
    }
  });

  it('Left Panel is 25% and Right Panel is 19% — the two established source-of-truth reference widths', () => {
    expect(projectWorkspacePage).toContain('w-[25%]');
    expect(projectWorkspacePage).toContain('w-[19%]');
  });
});

describe('"Work on This Project" — now the real 13-stage operational command center, with ProjectWorkspaceSections mounted below it', () => {
  it('ProjectWorkspace.tsx mounts ProjectWorkOnThisProject (remounted per project via key) with ProjectWorkspaceSections directly below it', () => {
    expect(projectWorkspacePage).toContain('<ProjectWorkOnThisProject');
    expect(projectWorkspacePage).toContain('key={project.id}');
    const workIdx = projectWorkspacePage.indexOf('<ProjectWorkOnThisProject');
    const sectionsIdx = projectWorkspacePage.indexOf('<ProjectWorkspaceSections');
    expect(sectionsIdx).toBeGreaterThan(workIdx);
  });
});

describe('The 13-stage lifecycle itself is the existing, real source of truth (src/hooks/useProjectStage.ts) — not invented for this mission', () => {
  it('LIFECYCLE has exactly the 13 real stages in the established order: Survey → Engineering → Quotation → Order → Procurement → Dispatch → Installation → QC → Commissioning → NetMetering → Subsidy → Handover → AMC', () => {
    const order = [
      'survey', 'engineering', 'quotation', 'order', 'procurement', 'dispatch',
      'installation', 'qc', 'commissioning', 'net-metering', 'subsidy', 'handover', 'amc',
    ];
    const idxs = order.map((id) => useProjectStageSrc2.indexOf(`id: '${id}'`));
    expect(idxs.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
  });
});

describe('Work on This Project — 13-stage lifecycle, sourced from the real stage engine, not reimplemented', () => {
  it('ProjectWorkOnThisProject renders its own "Work on This Project" header, and derives all stages from resolveProjectWorkspaceStages() (the same engine CustomerProjectTimelinePanel/projectHealth already use)', () => {
    expect(workOnThisProject).toContain('Work on This Project');
    expect(workOnThisProject).toContain("import { resolveProjectWorkspaceStages, type ProjectWorkspaceStage } from '../../../../hooks/useProjectStage'");
    expect(workOnThisProject).toContain('resolveProjectWorkspaceStages(project)');
  });

  it('exactly one stage is expanded at a time, defaulting to the real current stage (falling back to the most recently completed, then the first)', () => {
    expect(workOnThisProject).toContain("stages.find((s) => s.status === 'current')?.id");
    expect(workOnThisProject).toContain("reverse().find((s) => s.status === 'completed')?.id");
    expect(workOnThisProject).toContain('const [selectedStageId, setSelectedStageId] = useState');
    expect(workOnThisProject).toContain("const expanded = selectedStageId === stage.id && stage.status !== 'upcoming'");
  });

  it('opening a stage collapses whichever was open — clicking the same expanded stage again collapses it too (accordion, not independent toggles)', () => {
    expect(workOnThisProject).toContain('function toggleStage(stageId: string)');
    expect(workOnThisProject).toContain("setSelectedStageId((prev) => (prev === stageId ? undefined : stageId))");
    expect(workOnThisProject).toContain('onToggle={() => toggleStage(stage.id)}');
  });

  it('every stage renders through the shared ProjectStageCard — upcoming stages stay visible but disabled ("not available yet"), current gets the strongest visual hierarchy', () => {
    expect(stageCard).toContain("const disabled = status === 'upcoming'");
    expect(stageCard).toContain("title={disabled ? 'This stage is not available yet' : expanded ? 'Collapse' : 'Expand'}");
    expect(stageCard).toContain("status === 'current' ? 'ring-1 ring-[var(--color-primary)]'");
  });

  it('the expand/collapse control shows a down arrow when collapsed and an up arrow when expanded (distinct icons, not just a CSS rotation)', () => {
    expect(stageCard).toContain("import { ChevronDown, ChevronUp, Lock } from 'lucide-react'");
    expect(stageCard).toContain('{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}');
  });

  it('card shell dimensions/spacing match Customer Workspace\'s own stage card exactly (padding, rounding, accent, title typography) — not estimated', () => {
    const customerPipeline = read('../../features/customers/components/workspace/CustomerB2BWorkflowPipeline.tsx');
    expect(stageCard).toContain('min-w-0 flex-1 p-4');
    expect(stageCard).toContain("text-[13px] font-bold text-[var(--color-text)]");
    expect(customerPipeline).toContain("text-[13px] font-bold text-[var(--color-text)]");
    expect(stageCard).toContain('rounded-xl border border-l-[3px]');
  });

  it('the illustration strip matches Customer Workspace\'s own stage card exactly (w-[13%], min 52px/max 76px, self-stretch, p-0.5) — same footprint for every one of the 13 cards regardless of Left/Right panel proportions', () => {
    expect(stageCard).toContain('w-[13%] min-w-[52px] max-w-[76px] shrink-0 self-stretch p-0.5');
    expect(projectWorkspacePage).toContain('w-[25%]');
    expect(projectWorkspacePage).toContain('w-[19%]');
    const customerPipeline = read('../../features/customers/components/workspace/CustomerB2BWorkflowPipeline.tsx');
    expect(customerPipeline).toContain("w-[13%] min-w-[52px] max-w-[76px] shrink-0 self-stretch p-0.5");
  });

  it('all 13 stages have real illustration art wired in STAGE_ILLUSTRATIONS — reused Customer Workspace PNGs where the concept matches, new PNGs (same visual language) for the rest — never a fabricated/placeholder image', () => {
    const entries = [
      'survey: surveyIllustration', 'engineering: engineeringIllustration', 'quotation: quotationIllustration',
      'order: orderIllustration', 'procurement: procurementIllustration', 'dispatch: dispatchIllustration',
      'installation: installationIllustration', 'qc: qcIllustration', 'commissioning: commissioningIllustration',
      "'net-metering': netMeteringIllustration", 'subsidy: subsidyIllustration', 'handover: handoverIllustration', 'amc: amcIllustration',
    ];
    for (const entry of entries) expect(workOnThisProject).toContain(entry);
    expect(workOnThisProject).toContain("import commissioningIllustration from '../../../../assets/customer-workspace/project.png'");
    expect(workOnThisProject).toContain("import subsidyIllustration from '../../../../assets/customer-workspace/registration.png'");
  });

  it('a connector rail (state-tinted dot + link line) connects all 13 cards, same visual language as the Customer Workspace pipeline', () => {
    expect(stageCard).toContain("h-2.5 w-2.5 shrink-0 rounded-full transition-colors");
    expect(stageCard).toContain('{!last && <span className="mt-1 w-px flex-1 bg-[var(--color-border)]" />}');
  });

  it('a stage with no registered workspace falls back to a generic, real-data-only detail (stageHistory entry + existing ERP page link) — never a fake workspace', () => {
    expect(workOnThisProject).toContain('function GenericStageDetail');
    expect(workOnThisProject).toContain('project.stageHistory');
    expect(workOnThisProject).toContain('Open in full workspace');
    expect(workOnThisProject).not.toContain('fake');
  });
});

describe('Survey, Engineering, Quotation, Order, Procurement and Dispatch — Cards 1/2/3/5/6/6, the stages with complete operational workspaces so far; reuse their existing systems verbatim', () => {
  it('STAGE_WORKSPACES registers ALL 14 operational workspaces — survey through amc; every stage now has a registered entry', () => {
    expect(stageRegistry).toContain("survey: ProjectSurveyWorkspace");
    expect(stageRegistry).toContain('engineering: ProjectEngineeringWorkspace');
    expect(stageRegistry).toContain('quotation: ProjectQuotationWorkspace');
    expect(stageRegistry).toContain('order: ProjectOrderWorkspace');
    expect(stageRegistry).toContain('procurement: ProjectProcurementWorkspace');
    expect(stageRegistry).toContain('dispatch: ProjectDispatchWorkspace');
    expect(stageRegistry).toContain('installation: ProjectInstallationWorkspace');
    expect(stageRegistry).toContain('qc: ProjectQCWorkspace');
    expect(stageRegistry).toContain('commissioning: ProjectCommissioningWorkspace');
    expect(stageRegistry).toContain("'net-metering': ProjectNetMeteringWorkspace");
    expect(stageRegistry).toContain('subsidy: ProjectSubsidyWorkspace');
    expect(stageRegistry).toContain('handover: ProjectHandoverWorkspace');
    expect(stageRegistry).toContain('amc: ProjectAmcWorkspace');
  });

  it('reuses the EXACT existing Survey hooks/components (useSurveys/useSurveyActions, SurveyDetail, SurveyReportForm, uploadSurveyPhotos) — no parallel Survey business logic', () => {
    expect(surveyWorkspace).toContain("import { useSurveyActions, useSurveys } from '../../../../surveys/hooks/useSurveys'");
    expect(surveyWorkspace).toContain("import { SurveyDetail } from '../../../../surveys/components/SurveyDetail'");
    expect(surveyWorkspace).toContain("import { SurveyReportForm } from '../../../../surveys/components/SurveyReportForm'");
    expect(surveyWorkspace).toContain("import { uploadSurveyPhotos } from '../../../../surveys/services/surveyStorage'");
  });

  it('scopes surveys to THIS project (survey.projectId === project.id) and shows the most recent one', () => {
    expect(surveyWorkspace).toContain("s.projectId === project.id");
  });

  it('when no survey exists yet, offers a real Schedule Survey action (the same scheduleSurvey mutation), gated on the real surveys create permission', () => {
    expect(surveyWorkspace).toContain('actions.schedule.mutate(');
    expect(surveyWorkspace).toContain("perms.canCreate('surveys')");
  });

  it('real actions — Start/Complete report/Approve/Reject — are performed directly here via SurveyDetail, not merely displayed as status', () => {
    expect(surveyWorkspace).toContain('onStart={() => actions.start.mutate(latestSurvey.id,');
    expect(surveyWorkspace).toContain('onReport={() => setReportOpen(true)}');
    expect(surveyWorkspace).toContain('actions.approve.mutateAsync(');
    expect(surveyWorkspace).toContain('actions.reject.mutateAsync(');
  });

  it('Approve/Reject failures are surfaced (toast), never silently swallowed — a permission/business-rule error must never look like "nothing happened"', () => {
    expect(surveyWorkspace).toContain("toast.error(e?.message || 'Failed to approve survey')");
    expect(surveyWorkspace).toContain("toast.error(e?.message || 'Failed to reject survey')");
    expect(surveyWorkspace).toContain("toast.success('Survey approved — engineering draft created')");
  });

  it('Start/Approve/Reject loading states are scoped per action (not one shared flag for every button)', () => {
    expect(surveyDetail).toContain('startLoading?: boolean;');
    expect(surveyDetail).toContain('approveRejectLoading?: boolean;');
    expect(surveyWorkspace).toContain('startLoading={actions.start.isPending}');
    expect(surveyWorkspace).toContain('approveRejectLoading={actions.approve.isPending || actions.reject.isPending}');
  });
});

describe('Header — shows only the city, not a full address; still Project-specific identity', () => {
  it('exports a pure resolveProjectHeaderFields() exposing city (not a full address summary)', () => {
    expect(header).toContain('export function resolveProjectHeaderFields');
    expect(header).toContain('city: project.siteAddress?.city || undefined');
    expect(header).not.toContain('projectSiteAddressSummary');
  });

  it('titles on projectId, not a copied customer name — customer name is a secondary line only', () => {
    expect(header).toMatch(/<h1[^>]*>\{projectId\}<\/h1>/);
    expect(header).not.toContain('Work on This Customer');
  });
});

describe('Edit — inline panel swap (same interaction as Lead/Customer Workspace), not a popup modal', () => {
  it('ProjectWorkspace.tsx no longer opens a Modal for editing — isEditingProject/editForm state drives an inline swap instead', () => {
    expect(projectWorkspacePage).not.toContain('<Modal');
    expect(projectWorkspacePage).toContain('isEditingProject');
    expect(projectWorkspacePage).toContain('saveEditProject');
  });

  it('still persists via the EXISTING useSaveProject/updateProject mutation — the same one Projects.tsx\'s list page already uses, not a new save path', () => {
    expect(projectWorkspacePage).toContain('useSaveProject(project?.id || null');
    expect(projectsListPage).toContain('useSaveProject(');
  });

  it('Left Panel wrapper swaps between ProjectContextPanel (view) and ProjectWorkspaceEditor (edit) inline, with Save/Cancel buttons while editing — the same pattern Lead Workspace\'s own Left Panel uses', () => {
    expect(leftPanel).toContain('<ProjectWorkspaceEditor');
    expect(leftPanel).toContain('<ProjectContextPanel');
    expect(leftPanel).toMatch(/isEditing \?/);
    expect(leftPanel).toContain('Save');
    expect(leftPanel).toContain('Cancel');
  });

  it('Team assignment fields are real Select dropdowns populated from the users collection (not free text) — so a selected name always matches a real user, and the Team call button has something genuine to resolve', () => {
    expect(editor).toContain('<Select label="Sales Owner"');
    expect(editor).toContain('<Select label="Assigned Surveyor"');
    expect(editor).toContain('<Select label="Assigned Installer"');
    expect(editor).not.toMatch(/<Input label="Sales Owner"|<Input label="Assigned Surveyor"|<Input label="Assigned Installer"/);
  });
});

describe('Left Panel — Team call button resolves against the real users list', () => {
  it('Team section shows Name/Role/clickable phone (tel: link, same pattern as the workspace Call action), resolved against the real users list — never a fabricated number', () => {
    expect(contextPanel).toContain('href={`tel:${phone}`}');
    expect(contextPanel).toContain('function resolvePhone(');
  });

  it('no longer shows Capacity in the Left Panel — it already lives in the Header', () => {
    expect(contextPanel).not.toContain('projectCapacityLabel');
  });

  it('Survey Final Production Fix mission: the Left Panel now DOES show the complete registered Project address (reusing projectSiteAddressSummary, not reinventing it), separate from the Surveyed Location cluster', () => {
    expect(contextPanel).toContain("import { projectSiteAddressSummary } from '../../utils/projectDisplay'");
    expect(contextPanel).toContain('<Cluster label="Address">');
    expect(contextPanel).toContain('projectSiteAddressSummary(project.siteAddress)');
    expect(contextPanel).toContain('<Cluster label="Surveyed Location">');
  });
});

describe('Documents/Activity/Notes/Linked Records — consolidated into ProjectWorkspaceSections using the SAME shared card shell Customer/Lead Workspace use', () => {
  it('PeekCard/CollapsedRow are now a genuinely shared component (components/shared/WorkspaceSectionCards.tsx), not three near-identical local copies', () => {
    expect(sharedCards).toContain('export function PeekCard');
    expect(sharedCards).toContain('export function CollapsedRow');
    expect(customerSections).toContain("import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards'");
    expect(leadSections).toContain("import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards'");
    expect(sections).toContain("import { PeekCard, CollapsedRow } from '../../../../components/shared/WorkspaceSectionCards'");
    expect(customerSections).not.toMatch(/^function PeekCard/m);
    expect(leadSections).not.toMatch(/^function PeekCard/m);
  });

  it('Documents is a CollapsedRow wrapping the real ProjectWorkspaceDocumentsSection adapter (the same shared DocumentManager Customer/Lead already wrap)', () => {
    expect(sections).toContain('<ProjectWorkspaceDocumentsSection');
    expect(docsSection).toContain("from '../../../../components/shared/DocumentManager'");
    expect(customerDocsSection).toContain("from '../../../../components/shared/DocumentManager'");
    expect(leadDocsSection).toContain("from '../../../../components/shared/DocumentManager'");
  });

  it('Activity is a PeekCard showing only 2 recent entries by default, with a "Show full log" expansion to the complete stageHistory-derived list', () => {
    expect(sections).toContain('activityRecent = activityAll.slice(0, 2)');
    expect(sections).toContain('expandLabel="Show full log"');
  });

  it('Notes shows the real project.notes field', () => {
    expect(sections).toContain('project.notes');
  });

  it('Linked Records reuses CustomerLinkedRecordsTabContent verbatim, scoped to this project\'s own linked customerId — the same customer relationship, not a parallel system', () => {
    expect(sections).toContain("import CustomerLinkedRecordsTabContent from '../../../customers/components/workspace/CustomerLinkedRecordsTabContent'");
    expect(sections).toContain('entityId={project.customerId}');
    expect(customerLinkedRecordsTabContent).toContain("content('linked_records'");
  });

  it('Documents/Activity/Notes/Linked Records ordering matches the explicit feedback — Documents first, Activity directly below it', () => {
    const docsIdx = sections.indexOf('label="Documents"');
    const activityIdx = sections.indexOf('title="Activity"');
    expect(activityIdx).toBeGreaterThan(docsIdx);
  });
});

describe('Right Panel — Project Health/Quick Actions/Statistics/Linked Records; Recent Activity moved to Center (no duplication)', () => {
  it('no longer mounts its own Recent Activity widget — matches Customer Workspace\'s own precedent of removing the duplicate once the Center gained an equivalent peek', () => {
    expect(rightPanel).not.toContain('ProjectRecentActivity');
  });

  it('Project Health uses a real, documented 3-tier calculation (calculateProjectHealth) — not a fabricated score', () => {
    expect(rightPanel).toContain('<ProjectHealthCard');
    expect(projectHealthCard).toContain('calculateProjectHealth');
    expect(projectHealthSrc).toContain('export function calculateProjectHealth');
  });

  it('Project Statistics no longer repeats Capacity or Site Address — only genuinely Project-specific, non-duplicated numbers', () => {
    expect(rightPanel).toContain('Project Statistics');
    expect(rightPanel).not.toContain('projectCapacityLabel');
    expect(rightPanel).not.toContain('projectSiteAddressSummary');
  });

  it('Linked Records (compact) reuses CustomerLinkedRecords verbatim, scoped to this project\'s own linked customerId', () => {
    expect(rightPanel).toContain('<CustomerLinkedRecords customerId={project.customerId} companyId={companyId} />');
    expect(customerLinkedRecords).toContain("getLinkedRecords(customerId, 'customers', companyId)");
  });

  it('offers pure navigation Quick Actions only (View Customer / View Source Lead) — no Create/Generate/Record actions invented for Projects yet', () => {
    expect(rightPanel).toContain('View Customer');
    expect(rightPanel).toContain('View Source Lead');
    expect(rightPanel).not.toMatch(/label="(Create|Generate|Record) /);
  });
});

describe('Project Address — full address preserved everywhere it belongs, city-only stays a Header-only exception', () => {
  it('the inline Left Panel editor has the full site address field set (line1/line2/landmark/city/district/state/pincode/country), not a truncated subset', () => {
    expect(editor).toContain("onAddressFieldChange('line1'");
    expect(editor).toContain("onAddressFieldChange('line2'");
    expect(editor).toContain("onAddressFieldChange('landmark'");
    expect(editor).toContain("onAddressFieldChange('city'");
    expect(editor).toContain("onAddressFieldChange('district'");
    expect(editor).toContain("onAddressFieldChange('state'");
    expect(editor).toContain("onAddressFieldChange('pincode'");
    expect(editor).toContain("onAddressFieldChange('country'");
  });

  it('onAddressFieldChange is typed against every ProjectSiteAddress key, not a narrow city/state/pincode union', () => {
    expect(editor).toContain('onAddressFieldChange: (field: keyof ProjectSiteAddress, value: string) => void');
    expect(projectWorkspacePage).toContain('function editAddressField(field: keyof ProjectSiteAddress, value: string)');
  });

  it('ProjectForm.tsx (the list-page/CustomerProjectForm shared form) still has its own full Site Address section, untouched', () => {
    expect(projectForm).toContain('Address Line 1');
    expect(projectForm).toContain('Address Line 2');
    expect(projectForm).toContain('Landmark');
    expect(projectForm).toContain('Country');
  });
});

describe('Project Type — a real dedicated field on the Project record (Residential/Commercial/Industrial), not derived from the Customer', () => {
  it('PROJECT_TYPES is a 3-value vocabulary distinct from Customer\'s own 4-value property-type list', () => {
    expect(projectTypes).toContain("export const PROJECT_TYPES = ['Residential', 'Commercial', 'Industrial'] as const");
    expect(projectTypes).toContain('projectType: string;');
    expect(projectTypes).toContain('projectType?: string;');
  });

  it('both create/update payload builders persist projectType', () => {
    expect(projectWorkflow).toContain('projectType: form.projectType?.trim() || undefined,');
  });

  it('ProjectForm.tsx and the inline ProjectWorkspaceEditor both expose a Project Type Select using PROJECT_TYPES', () => {
    expect(projectForm).toContain('PROJECT_TYPES');
    expect(projectForm).toContain('label="Project Type"');
    expect(editor).toContain('PROJECT_TYPES');
    expect(editor).toContain('label="Project Type"');
  });

  it('the Workspace page sources the displayed Project Type directly from project.projectType, not from the linked customer', () => {
    expect(projectWorkspacePage).toContain('project?.projectType || undefined');
    expect(projectWorkspacePage).not.toContain('customer.projectType || customer.propertyType');
  });

  it('the Header shows a Project Type chip alongside the Capacity chip', () => {
    expect(header).toContain('projectType: project.projectType || undefined');
    expect(header).toMatch(/\{projectType && \(/);
  });

  it('ProjectDetailModal (the standalone Projects.tsx view) shows Project Type in its Project Information card', () => {
    expect(projectDetailModal).toContain('label="Project Type"');
  });

  it('all 5 places that manually seed a ProjectFormValues object include projectType, mirroring how notes was added at the same sites', () => {
    expect(projectWorkspacePage).toContain("projectType: p.projectType || ''");
    expect(projectsListPage).toContain("projectType: project.projectType || ''");
    expect(mobileProjectList).toContain("projectType: project.projectType || ''");
    expect(mobileProjectWorkspace).toContain("projectType: project.projectType || ''");
    // Phase 4 (Blueprint's Neozy ERP Master Business Workflow correction) fixed
    // a real bug here: this path used to hardcode projectType to '', silently
    // discarding whatever the caller's form actually collected. It's now a
    // required parameter of createProjectFromLoanApplication(), passed straight
    // through instead of a literal empty string.
    expect(loanApplicationWorkflow).toContain('projectType,');
    expect(loanApplicationWorkflow).not.toContain("projectType: '',");
  });
});
