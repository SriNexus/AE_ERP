/**
 * projectWorkspaceEngineeringIntegration.test.ts — Engineering = Card 2
 * mission (Shared Documents Architecture + Engineering Card 2 + Survey →
 * Engineering Workflow Verification).
 *
 * Source-text analysis (this codebase's established convention). Covers:
 * Engineering's global page popup retirement (mirroring Survey's own,
 * already-verified fix), Card 2 registered in STAGE_WORKSPACES reusing the
 * EXISTING Engineering system verbatim, no duplicate Engineering
 * submission (Survey's own handoff creates the Draft — the Project
 * Workspace never offers a second creation path), the completion summary
 * pattern mirrored from Survey, and permission independence preserved.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const engineeringDesignsPage = read('../EngineeringDesigns.tsx');
const surveyWorkflow = read('../../features/surveys/services/surveyWorkflow.ts');
const engineeringWorkflow = read('../../features/engineering/services/engineeringWorkflow.ts');
const stageRegistry = read('../../features/projects/components/workspace/stages/index.ts');
const projectEngineeringWorkspace = read('../../features/projects/components/workspace/stages/ProjectEngineeringWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const engineeringDesignDetail = read('../../features/engineering/components/EngineeringDesignDetail.tsx');

describe('Engineering popup retirement — clicking a design opens the associated Project Workspace instead (mirrors Survey\'s own fix)', () => {
  it('EngineeringDesigns.tsx no longer opens a detail popup on row click / View / calendar click / ?open= deep link', () => {
    expect(engineeringDesignsPage).not.toContain('DETAIL MODAL');
    expect(engineeringDesignsPage).not.toContain('<EngineeringDesignDetail');
    expect(engineeringDesignsPage).not.toContain("import { EngineeringDesignDetail }");
  });

  it('row click, the "View" button, and calendar click all navigate via one shared openDesignWorkspace() function', () => {
    expect(engineeringDesignsPage).toContain('function openDesignWorkspace(design: EngineeringDesignRecord)');
    expect(engineeringDesignsPage).toContain('navigate(`/projects/${encodeURIComponent(design.projectId)}`)');
  });

  it('the retired ?open= deep link is fully removed — no param consumption and no stale popup link remains anywhere in production routing', () => {
    // The ?open= redirect effect was retired with the popup: the list page no
    // longer reads an `open` param (the search/notification resolvers now
    // deep link straight to the Project Workspace via the record's
    // projectId, so the redirect is dead code).
    expect(engineeringDesignsPage).not.toContain("params.get('open')");
    expect(engineeringDesignsPage).not.toContain('openDesignWorkspace(found)');
    expect(engineeringDesignsPage).not.toContain('engineering-designs?open=');
    const notificationRoutes = read('../../lib/notificationRoutes.ts');
    expect(notificationRoutes).toContain("if (type === 'engineering_design' || type === 'engineeringdesign' || type === 'engineering') return entityId && projectId ? `/projects/${encodeURIComponent(projectId)}` : '/engineering-designs';");
    const searchEngine = read('../../engines/WorkspaceSearchEngine.ts');
    expect(searchEngine).not.toContain('engineering-designs?open=');
    expect(searchEngine).toContain("link: doc.projectId ? `/projects/${encodeURIComponent(doc.projectId)}` : '/engineering-designs',");
  });

  it('the "Create design" manual entry point (for a survey with no auto-drafted design) is untouched — a legitimate global entry point, not the retired popup', () => {
    expect(engineeringDesignsPage).toContain('Create engineering design');
    expect(engineeringDesignsPage).toContain('actions.create.mutate(input');
  });
});

describe('Engineering Card 2 — registered as the second real stage workspace, reusing the existing system verbatim', () => {
  it('STAGE_WORKSPACES now registers both survey and engineering', () => {
    expect(stageRegistry).toContain('survey: ProjectSurveyWorkspace');
    expect(stageRegistry).toContain('engineering: ProjectEngineeringWorkspace');
  });

  it('ProjectEngineeringWorkspace reuses the EXACT existing hooks/components — no parallel Engineering system', () => {
    expect(projectEngineeringWorkspace).toContain("import { useEngineeringActions, useEngineeringDesigns } from '../../../../engineering/hooks/useEngineeringDesigns'");
    expect(projectEngineeringWorkspace).toContain("import { EngineeringDesignDetail } from '../../../../engineering/components/EngineeringDesignDetail'");
    expect(projectEngineeringWorkspace).toContain("import { EngineeringDesignForm } from '../../../../engineering/components/EngineeringDesignForm'");
  });

  it('every action (Submit/Approve/Revise/Update) is wrapped so a failure is surfaced via toast, never silently swallowed — the same fix already applied to Survey', () => {
    expect(projectEngineeringWorkspace).toContain("toast.error(e?.message || 'Failed to submit design')");
    expect(projectEngineeringWorkspace).toContain("toast.error(e?.message || 'Failed to approve design')");
    expect(projectEngineeringWorkspace).toContain("toast.error(e?.message || 'Failed to request revision')");
    expect(projectEngineeringWorkspace).toContain("toast.error(e?.message || 'Failed to update design')");
  });
});

describe('No duplicate Engineering submission — Survey\'s handoff creates the Draft exactly once; the Project Workspace never offers a second creation path', () => {
  it('approveSurvey() is what creates the Engineering draft (createEngineeringDraftFromSurvey), not any action inside ProjectSurveyWorkspace itself', () => {
    expect(surveyWorkflow).toContain('const draft = await createEngineeringDraftFromSurvey(survey, designerId);');
    const surveyWorkspace = read('../../features/projects/components/workspace/stages/ProjectSurveyWorkspace.tsx');
    expect(surveyWorkspace).not.toContain('createEngineeringDraftFromSurvey');
    expect(surveyWorkspace).not.toContain('createDesign');
  });

  it('createEngineeringDraftFromSurvey is idempotent — resubmitting/re-approving never creates a second design for the same survey', () => {
    expect(engineeringWorkflow).toContain("const existing = visibleDesigns.find((design) => design.surveyId === survey.id);");
    expect(engineeringWorkflow).toContain('if (existing) return existing;');
  });

  it('ProjectEngineeringWorkspace never offers a manual "create design" action — if no design exists yet, it says so instead of inventing a duplicate creation flow', () => {
    expect(projectEngineeringWorkspace).toContain('No engineering design yet. A design is created automatically once the linked Survey is approved.');
    expect(projectEngineeringWorkspace).not.toContain('actions.create.mutate');
  });

  it('the ONE submit action a design gets is "Submit for review" (Draft/Revised → InReview) — never re-triggered by anything on the Survey side', () => {
    expect(engineeringDesignDetail).toContain("['Draft','Revised'].includes(design.status) && perms.canEdit('engineering') && <Button onClick={onSubmit}");
  });
});

describe('Engineering completion summary — concise, real-data-only, mirroring Survey\'s own pattern', () => {
  it('resolves "Completed by <name> · <date>" from the real approved design (approvedBy/approvedAt), only for the engineering card', () => {
    expect(workOnThisProject).toContain('function useEngineeringCardSummary(');
    expect(workOnThisProject).toContain("d.status === 'Approved'");
    expect(workOnThisProject).toContain('users.find((u: any) => u.id === approved.approvedBy)?.name');
    // Vendor Lock GAP-04 remediation (independent audit, 2026-08-14/16): this
    // used to assert the ENTIRE per-stage summary ternary as one giant
    // literal string, keyed to a stale 'registrationSummary' variable name
    // and stage ordering from before the Registration (SchemeRegistration)
    // stage card was correctly inserted (Phase 6). The full-line match broke
    // on that unrelated, correct change even though the engineering branch
    // itself never changed. Replaced with a targeted check of the engineering
    // branch specifically (what this test actually claims to verify), plus a
    // structural check that Registration's own branch also exists — proving
    // both stages are wired into the same ternary without depending on their
    // relative order or every other stage's exact variable name.
    expect(workOnThisProject).toContain("stage.id === 'engineering' ? engineeringCardSummary");
    expect(workOnThisProject).toMatch(/stage\.id === 'registration' \? \w+/);
  });
});

describe('Permissions stay independent — surveys:* and engineering:* are never merged, even though both stages now live in the same Project Workspace', () => {
  it('Engineering business logic still gates on the "engineering" module specifically, distinct from "surveys"', () => {
    expect(engineeringWorkflow).toContain("canDo(action, 'engineering')");
    expect(surveyWorkflow).not.toContain("canDo(action, 'engineering')");
  });

  it('the Project Workspace does not bypass permission checks for either stage — ApprovalStepper\'s onApprove/onReject stay conditioned on the real canApprove/canEdit checks inside the reused Detail components', () => {
    expect(engineeringDesignDetail).toContain("perms.canApprove('engineering') && design.status === 'InReview'");
  });
});

describe('Demo Mode — Survey/Engineering seed data now matches the REAL data model fields (was previously a schema mismatch)', () => {
  it('demo surveys use the real SurveyRecord fields (roofAreaSqm/shadingNotes/structuralNotes/completedBy/location), not the old mismatched field names', () => {
    const businessGraph = read('../../../scripts/demo/datasets/businessGraph.ts');
    expect(businessGraph).toContain('roofAreaSqm');
    expect(businessGraph).toContain('shadingNotes');
    expect(businessGraph).toContain('structuralNotes');
    expect(businessGraph).toContain('completedBy:completed?id(\'USR\',2):\'\'');
    expect(businessGraph).not.toContain('usableAreaSqFt');
    expect(businessGraph).not.toContain('shadowObservation');
  });

  it('demo engineering designs carry a real surveySnapshot and approvedAt/approvedBy for Approved ones, so the new completion summary has real data to read', () => {
    const businessGraph = read('../../../scripts/demo/datasets/businessGraph.ts');
    expect(businessGraph).toContain('surveySnapshot:{roofType,roofAreaSqm,shadingNotes,structuralNotes,photos:[],capturedAt:demoDate(24+i)}');
    expect(businessGraph).toContain("approvedAt:approved?demoAt(33+i):''");
  });
});
