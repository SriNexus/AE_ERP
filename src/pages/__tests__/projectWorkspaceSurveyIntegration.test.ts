/**
 * projectWorkspaceSurveyIntegration.test.ts — Survey Revision, Popup Removal
 * & Complete Operational Integration mission.
 *
 * Source-text analysis (this codebase's established convention — no
 * @testing-library/react). Covers: Surveys.tsx no longer opens a popup on
 * row click (navigates to the associated Project Workspace instead), the
 * Survey Report step now mounts in a Modal (matching the exact presentation
 * the retired popup used, so a photo grid + GPS capture has real room),
 * submitSurveyReport now records who actually completed the report
 * (completedBy, distinct from approvedBy) and mirrors captured GPS onto the
 * Project's own siteAddress fields, Project Information surfaces that GPS,
 * the Survey stage card shows a concise "Completed by X · date" line and a
 * reused Customer Workspace illustration is wired up for stages where one
 * already fits, and DocumentVault (shared by Survey photos and every
 * workspace's Documents section) no longer silently swallows upload errors.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const surveysPage = read('../Surveys.tsx');
const surveyWorkspace = read('../../features/projects/components/workspace/stages/ProjectSurveyWorkspace.tsx');
const workOnThisProject = read('../../features/projects/components/workspace/ProjectWorkOnThisProject.tsx');
const stageCard = read('../../features/projects/components/workspace/ProjectStageCard.tsx');
const surveyWorkflow = read('../../features/surveys/services/surveyWorkflow.ts');
const surveyTypes = read('../../features/surveys/types/index.ts');
const contextPanel = read('../../features/projects/components/workspace/ProjectContextPanel.tsx');
const detailModal = read('../../features/projects/components/ProjectDetailModal.tsx');
const documentVault = read('../../components/shared/DocumentVault.tsx');
const mobileSurveyWorkspace = read('../../components/mobile/surveys/MobileSurveyWorkspace.tsx');
const surveyReportForm = read('../../features/surveys/components/SurveyReportForm.tsx');
const surveyDetail = read('../../features/surveys/components/SurveyDetail.tsx');
const reverseGeocodeSrc = read('../../features/surveys/services/reverseGeocode.ts');
const projectWorkspaceDocsSection = read('../../features/projects/components/workspace/ProjectWorkspaceDocumentsSection.tsx');

describe('Survey popup retirement — clicking a survey opens the associated Project Workspace instead', () => {
  it('Surveys.tsx no longer imports/renders SurveyDetail or SurveyReportForm in a popup', () => {
    expect(surveysPage).not.toContain("from '../features/surveys/components/SurveyDetail'");
    expect(surveysPage).not.toContain("from '../features/surveys/components/SurveyReportForm'");
    expect(surveysPage).not.toContain('SURVEY DETAIL MODAL');
    expect(surveysPage).not.toContain('SURVEY REPORT MODAL');
  });

  it('row click, the "View" button, and calendar event click all navigate to the survey\'s linked Project Workspace via one shared function', () => {
    expect(surveysPage).toContain('function openSurveyWorkspace(survey: SurveyRecord)');
    expect(surveysPage).toContain('navigate(`/projects/${encodeURIComponent(survey.projectId)}`)');
    expect(surveysPage).toContain('onClick={(e) => handleRowClick(e, survey)}');
    expect(surveysPage).toContain('openSurveyWorkspace(survey);');
  });

  it('the "Schedule survey" entry point (project picker, for scheduling without navigating into a project first) is untouched', () => {
    expect(surveysPage).toContain('Schedule project survey');
    expect(surveysPage).toContain('actions.schedule.mutate(');
  });

  it('mobile Survey workspace is left untouched this phase — the mobile Project Workspace has no Survey accordion yet, so redirecting it would be a capability regression', () => {
    expect(mobileSurveyWorkspace).toContain('SurveyDetail');
    expect(mobileSurveyWorkspace).toContain('SurveyReportForm');
  });
});

describe('Survey Report — now genuinely submittable from the Project Workspace, using a Modal (the same screen real estate the retired popup gave it)', () => {
  it('the report form mounts inside a Modal, not a cramped inline accordion body', () => {
    expect(surveyWorkspace).toContain("<Modal open={reportOpen} onClose={() => setReportOpen(false)} title=\"Complete survey report\" size=\"xl\">");
  });

  it('Save vs Submit stay distinct — scheduling/starting a survey never marks it complete; only a valid submitted report does', () => {
    expect(surveyWorkspace).toContain('actions.start.mutate(latestSurvey.id,');
    expect(surveyWorkspace).toContain('actions.submit.mutate(');
    expect(surveyWorkflow).toContain("status: 'Completed'");
    expect(surveyWorkflow).toContain("if (!['Scheduled', 'InProgress', 'Rejected'].includes(survey.status)) throw new Error");
  });

  it('reuses the exact existing hooks/components — no parallel Survey system', () => {
    expect(surveyWorkspace).toContain("import { useSurveyActions, useSurveys } from '../../../../surveys/hooks/useSurveys'");
    expect(surveyWorkspace).toContain("import { SurveyDetail } from '../../../../surveys/components/SurveyDetail'");
    expect(surveyWorkspace).toContain("import { SurveyReportForm } from '../../../../surveys/components/SurveyReportForm'");
    expect(surveyWorkspace).toContain("import { uploadSurveyPhotos } from '../../../../surveys/services/surveyStorage'");
  });
});

describe('GPS — the existing SurveyLocation capture (SurveyReportForm\'s own captureLocation) is mirrored onto the Project\'s own existing siteAddress lat/lng fields, not a second GPS system', () => {
  it('submitSurveyReport propagates report.location onto the linked project\'s siteAddress via dot-path fields (leaves the rest of siteAddress untouched)', () => {
    expect(surveyWorkflow).toContain('if (report.location) {');
    expect(surveyWorkflow).toContain("'siteAddress.latitude': report.location.latitude");
    expect(surveyWorkflow).toContain("'siteAddress.longitude': report.location.longitude");
  });

  it('ProjectSiteAddress already had latitude/longitude fields (src/types/index.ts) before this mission — reused, not invented', () => {
    const sharedTypes = read('../../types/index.ts');
    expect(sharedTypes).toContain('latitude?: number;');
    expect(sharedTypes).toContain('longitude?: number;');
  });
});

describe('Project Information surfaces the captured GPS — never in the Header, which stays City-only', () => {
  it('Left Panel (ProjectContextPanel) shows a "Surveyed Location" row only when real coordinates exist', () => {
    expect(contextPanel).toContain('project.siteAddress?.latitude != null && project.siteAddress?.longitude != null');
    expect(contextPanel).toContain('Surveyed Location');
  });

  it('ProjectDetailModal\'s Site Address card links to the GPS coordinates when present, alongside the still-present full address summary', () => {
    expect(detailModal).toContain('projectSiteAddressSummary(project.siteAddress)');
    expect(detailModal).toContain('project.siteAddress?.latitude != null && project.siteAddress?.longitude != null');
  });

  it('the Header still resolves only city, never latitude/longitude', () => {
    const header = read('../../features/projects/components/workspace/ProjectWorkspaceHeader.tsx');
    expect(header).toContain('city: project.siteAddress?.city || undefined');
    expect(header).not.toContain('latitude');
    expect(header).not.toContain('longitude');
  });
});

describe('Survey card — concise completion line, never the full report, sourced from real completedBy/completedDate data', () => {
  it('submitSurveyReport records completedBy (who actually submitted), distinct from approvedBy (who reviews)', () => {
    expect(surveyTypes).toContain('completedBy?: string;');
    expect(surveyWorkflow).toContain('completedBy: userId,');
  });

  it('ProjectWorkOnThisProject resolves a real "Completed by <name> · <date>" summary for the Survey card only, via the existing users list and fmtDate — no invented text', () => {
    expect(workOnThisProject).toContain('function useSurveyCardState(');
    expect(workOnThisProject).toContain("s.status === 'Completed'");
    expect(workOnThisProject).toContain('users.find((u: any) => u.id === latestCompleted.completedBy)?.name');
    expect(workOnThisProject).toContain("`Completed by ${completedByName} · ${dateLabel}`");
    // Vendor Lock GAP-04 remediation (independent audit, 2026-08-14/16): see
    // the matching note in projectWorkspaceEngineeringIntegration.test.ts —
    // this was the same stale full-ternary-literal assertion (stale
    // 'registrationSummary' name/ordering from before the Registration stage
    // card was correctly inserted). Replaced with a targeted check of the
    // survey branch this test actually verifies, plus proof the Registration
    // branch also exists in the same ternary.
    expect(workOnThisProject).toContain("stage.id === 'survey' ? surveyCardSummary");
    expect(workOnThisProject).toMatch(/stage\.id === 'registration' \? \w+/);
  });

  it('ProjectStageCard shows the summary/description line only in the collapsed row, never inside an always-visible giant block', () => {
    expect(stageCard).toContain('summary?: ReactNode');
    expect(stageCard).toContain('expanded && !disabled ? (');
    expect(stageCard).toContain('children');
  });
});

describe('Schedule Survey — a real, project-scoped action in the Survey card\'s header action area (the popup\'s scheduling capability, surfaced here instead)', () => {
  it('the header action only appears while scheduling is still the meaningful next step (no survey yet for this project), gated on the real create permission', () => {
    expect(workOnThisProject).toContain('function ScheduleSurveyAction(');
    expect(workOnThisProject).toContain("hasSurvey: projectSurveys.length > 0");
    expect(workOnThisProject).toContain("stage.id === 'survey' && !hasSurvey");
    expect(workOnThisProject).toContain('active={perms.canCreate(\'surveys\')}');
  });

  it('clicking it is automatically scoped to THIS project (no project picker) — it opens the exact same inline schedule form/mutation ProjectSurveyWorkspace already has, not a second scheduling surface', () => {
    expect(workOnThisProject).toContain("onClick={() => setSelectedStageId('survey')}");
    expect(surveyWorkspace).toContain('actions.schedule.mutate(');
    expect(surveyWorkspace).toContain('projectId: project.id');
  });

  it('ProjectStageCard has a dedicated header action slot, always in the same top-right position next to the expand/collapse control — the reusable pattern future stage cards (Engineering/Quotation/Order/…) will plug their own project-scoped action into', () => {
    expect(stageCard).toContain('action?: ReactNode');
    expect(stageCard).toContain('{!disabled && action}');
  });
});

describe('GPS propagation is a non-fatal side effect — it must never make a genuinely successful Survey submission look like it failed', () => {
  it('the project siteAddress GPS mirror is wrapped so a failure there cannot reject submitSurveyReport\'s own promise after the Survey record has already been durably marked Completed', () => {
    const submitFnSrc = surveyWorkflow.slice(surveyWorkflow.indexOf('export async function submitSurveyReport'), surveyWorkflow.indexOf('export async function approveSurvey'));
    expect(submitFnSrc).toContain("status: 'Completed'");
    expect(submitFnSrc).toContain('try {');
    expect(submitFnSrc).toContain("catch (err) {");
    expect(submitFnSrc).toContain('console.warn(');
    const completedIdx = submitFnSrc.indexOf("status: 'Completed'");
    const tryIdx = submitFnSrc.indexOf('try {');
    expect(tryIdx).toBeGreaterThan(completedIdx);
  });
});

describe('Completed Survey stays part of the lifecycle — reviewable and expandable, not read-only unless business rules say so', () => {
  it('the Survey stage card is expandable for completed/current/attention status, only "upcoming" is disabled — same rule as every other stage', () => {
    expect(stageCard).toContain("const disabled = status === 'upcoming'");
  });

  it('ProjectSurveyWorkspace renders the full SurveyDetail (view/approve/reject/re-report) regardless of completion — no separate read-only branch invented for completed surveys', () => {
    expect(surveyWorkspace).not.toMatch(/if\s*\(\s*latestSurvey\.status\s*===\s*'Completed'/);
  });
});

describe('Illustrations — reuse Customer Workspace\'s existing stage art where the concept matches; new PNGs (identical visual language) added where none existed', () => {
  it('Quotation/Order/Dispatch reuse the exact existing Customer Workspace PNGs', () => {
    expect(workOnThisProject).toContain("import quotationIllustration from '../../../../assets/customer-workspace/quotation.png'");
    expect(workOnThisProject).toContain("import orderIllustration from '../../../../assets/customer-workspace/order.png'");
    expect(workOnThisProject).toContain("import dispatchIllustration from '../../../../assets/customer-workspace/dispatch.png'");
  });

  it('ProjectStageCard renders the illustration strip (same treatment as Customer Workspace), with an icon-tile fallback kept only for robustness', () => {
    expect(stageCard).toContain('illustration?: string');
    expect(stageCard).toContain('w-[13%] min-w-[52px] max-w-[76px] shrink-0 self-stretch p-0.5');
    expect(stageCard).toContain('illustration && !disabled');
  });
});

describe('Shared Documents infrastructure — Survey photos keep their own pre-existing DocumentVault/photos model; upload failures are no longer silently swallowed anywhere it is used', () => {
  it('DocumentVault surfaces onUpload failures via toast instead of swallowing them', () => {
    expect(documentVault).toContain("import toast from 'react-hot-toast'");
    expect(documentVault).toContain('} catch (err: any) {');
    expect(documentVault).toContain("toast.error(err?.message || 'Upload failed. Please try again.')");
  });
});

describe('Approve/Reject — real business logic, immediate visual feedback, no silent failure (Survey Final Production Fix mission)', () => {
  it('Approve/Reject are NOT removed — ApprovalStepper with onApprove/onReject still renders in SurveyDetail', () => {
    expect(surveyDetail).toContain('<ApprovalStepper');
    expect(surveyDetail).toContain('onApprove={perms.canApprove(\'surveys\')');
    expect(surveyDetail).toContain('onReject={perms.canApprove(\'surveys\')');
  });

  it('a failure from the real approveSurvey/rejectSurvey business logic (e.g. a permission mismatch on the linked engineering-draft creation) is now surfaced to the user, never silently swallowed', () => {
    expect(surveyWorkspace).toContain('try {\n            await actions.approve.mutateAsync');
    expect(surveyWorkspace).toContain('} catch (e: any) {\n            toast.error(e?.message || \'Failed to approve survey\')');
    expect(surveyWorkspace).toContain('} catch (e: any) {\n            toast.error(e?.message || \'Failed to reject survey\')');
  });

  it('Start also gets clear success/error feedback (same class of previously-silent async action)', () => {
    expect(surveyWorkspace).toContain("onSuccess: () => toast.success('Survey started')");
    expect(surveyWorkspace).toContain("onError: (e: any) => toast.error(e?.message || 'Failed to start survey')");
  });

  it('mobile Survey workspace gets the identical fix (same shared SurveyDetail/useSurveyActions, same bug class)', () => {
    expect(mobileSurveyWorkspace).toContain("import toast from 'react-hot-toast'");
    expect(mobileSurveyWorkspace).toContain('startLoading={actions.start.isPending}');
    expect(mobileSurveyWorkspace).toContain('approveRejectLoading={actions.approve.isPending || actions.reject.isPending}');
    expect(mobileSurveyWorkspace).toContain("toast.error(e?.message || 'Failed to approve survey')");
    expect(mobileSurveyWorkspace).toContain("toast.error(e?.message || 'Failed to reject survey')");
  });
});

describe('Capture GPS — explicit Ready/Capturing/Success/Error states, never a dead-looking button (Survey Final Production Fix mission)', () => {
  it('a dedicated capturing state disables the button, shows a spinner, and prevents duplicate capture attempts', () => {
    expect(surveyReportForm).toContain('const [capturingLocation, setCapturingLocation] = useState(false)');
    expect(surveyReportForm).toContain('if (capturingLocation) return');
    expect(surveyReportForm).toContain('disabled={capturingLocation}');
    expect(surveyReportForm).toContain('<Loader2 className="h-4 w-4 animate-spin" />');
  });

  it('distinct Ready/Capturing/Captured labels, and a specific error message per GeolocationPositionError code (not one generic failure string)', () => {
    expect(surveyReportForm).toContain("capturingLocation ? 'Capturing GPS…' : location ? 'GPS Captured' : 'Capture GPS'");
    expect(surveyReportForm).toContain('function describeGeolocationError(');
    expect(surveyReportForm).toContain('case err.PERMISSION_DENIED:');
    expect(surveyReportForm).toContain('case err.POSITION_UNAVAILABLE:');
    expect(surveyReportForm).toContain('case err.TIMEOUT:');
  });

  it('captured coordinates (and address, once resolved) are shown inline in the form itself, not just inferred from a relabeled button', () => {
    expect(surveyReportForm).toContain("location.address || 'Resolving address…'");
    expect(surveyReportForm).toContain('location.latitude.toFixed(5)');
  });
});

describe('Reverse geocoding — free (Nominatim), resolved once at capture time and persisted, never blocks Survey save/submit', () => {
  it('reverseGeocodeLatLng calls OpenStreetMap Nominatim, with a timeout, and never throws (always resolves, undefined on any failure)', () => {
    expect(reverseGeocodeSrc).toContain('nominatim.openstreetmap.org/reverse');
    expect(reverseGeocodeSrc).toContain('controller.abort()');
    expect(reverseGeocodeSrc).toContain('} catch {\n    return undefined;\n  }');
  });

  it('SurveyReportForm resolves the address once, right after capture, and merges it into the SAME location object — not a second GPS system, not called on every render', () => {
    expect(surveyReportForm).toContain('import { reverseGeocodeLatLng }');
    expect(surveyReportForm).toContain('void reverseGeocodeLatLng(captured.latitude, captured.longitude).then((address) => {');
  });

  it('the resolved address travels through the EXISTING report/submission pipeline (SurveyLocation.address) and is mirrored onto the project alongside lat/lng in the same already-guarded try/catch — never a separate write that could break submission', () => {
    expect(surveyTypes).toContain('address?: string;');
    const submitFnSrc = surveyWorkflow.slice(surveyWorkflow.indexOf('export async function submitSurveyReport'), surveyWorkflow.indexOf('export async function approveSurvey'));
    expect(submitFnSrc).toContain("if (report.location.address) gpsPatch['siteAddress.surveyedLocationLabel'] = report.location.address;");
    expect(submitFnSrc).toContain('try {');
  });

  it('ProjectSiteAddress gets a dedicated surveyedLocationLabel field — additive, never written into the Project\'s own registered address fields (city/district/state/pincode)', () => {
    const sharedTypes = read('../../types/index.ts');
    expect(sharedTypes).toContain('surveyedLocationLabel?: string;');
  });
});

describe('Project Information — complete registered Project address now shown, kept conceptually separate from Surveyed Location (Survey Final Production Fix mission)', () => {
  it('Left Panel has a dedicated "Address" cluster reusing projectSiteAddressSummary (the same formatter ProjectDetailModal already uses) — never fabricated', () => {
    expect(contextPanel).toContain('<Cluster label="Address">');
    expect(contextPanel).toContain("import { projectSiteAddressSummary } from '../../utils/projectDisplay'");
  });

  it('"Surveyed Location" shows the human-readable label (falling back to "Address unavailable", never blocking on the coordinates) plus the exact coordinates and a map link — a distinct cluster from "Address"', () => {
    expect(contextPanel).toContain("project.siteAddress.surveyedLocationLabel || 'Address unavailable'");
    expect(contextPanel).toContain('<Cluster label="Surveyed Location">');
    const addressIdx = contextPanel.indexOf('<Cluster label="Address">');
    const surveyedIdx = contextPanel.indexOf('<Cluster label="Surveyed Location">');
    expect(addressIdx).toBeGreaterThan(-1);
    expect(surveyedIdx).toBeGreaterThan(addressIdx);
  });

  it('the Header is unaffected — still city-only, full address and surveyed location live only in Project Information', () => {
    const header = read('../../features/projects/components/workspace/ProjectWorkspaceHeader.tsx');
    expect(header).toContain('city: project.siteAddress?.city || undefined');
    expect(header).not.toContain('projectSiteAddressSummary');
    expect(header).not.toContain('surveyedLocationLabel');
  });
});

describe('Stage card illustration hides once expanded — the workspace being worked in gets the full width, not just the collapsed row', () => {
  it('the illustration/icon strip only renders while collapsed', () => {
    expect(stageCard).toContain('{!expanded && (');
  });
});

describe('Survey Documents — submitted Survey photos flow into the ONE shared case Documents system (superseded the earlier per-entity-array mirror; see lib/__tests__/caseDocuments.test.ts for the full architecture coverage)', () => {
  it('submitSurveyReport creates shared documents via createCaseDocument, not per-entity array copies', () => {
    expect(surveyWorkflow).toContain("import { createCaseDocument } from '../../../lib/caseDocuments'");
    expect(surveyWorkflow).toContain('createCaseDocument({');
    expect(surveyWorkflow).toContain('id: photo.id');
    expect(surveyWorkflow).not.toContain('mergeNewDocuments');
    expect(surveyWorkflow).not.toContain('CustomerDomainService');
    expect(surveyWorkflow).not.toContain('LeadDomainService');
  });

  it('ProjectWorkspaceDocumentsSection is untouched as the Project Workspace\'s own Documents adapter — no new/duplicate Documents UI was created', () => {
    expect(projectWorkspaceDocsSection).toContain('normalizeProjectDocuments(project)');
    expect(projectWorkspaceDocsSection).toContain('<DocumentManager');
  });

  it('the survey mutation already invalidates the projects query on every success (schedule/start/submit/approve/reject), so the Project Workspace picks up new shared documents automatically — no extra plumbing needed', () => {
    const useSurveysSrc = read('../../features/surveys/hooks/useSurveys.ts');
    expect(useSurveysSrc).toContain('queryKeys.forCompany(companyId).projectsRoot');
  });
});
