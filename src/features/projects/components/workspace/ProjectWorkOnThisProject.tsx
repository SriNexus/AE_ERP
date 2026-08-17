/**
 * ProjectWorkOnThisProject — the Project Workspace's Center Panel primary
 * card (Project Workspace Stage Lifecycle mission). This is the operational
 * command center for the Project: all 14 stages of the real lifecycle
 * (resolveProjectWorkspaceStages(), src/hooks/useProjectStage.ts — the SAME
 * stage engine CustomerProjectTimelinePanel.tsx and projectHealth.ts already
 * use, not a reimplemented lifecycle) render as an accordion of stage
 * cards, with exactly one expanded at a time — selecting another stage
 * collapses whichever was open (toggleStage()), and clicking the currently
 * expanded card's own chevron collapses it too (ChevronDown when collapsed,
 * ChevronUp when expanded — see ProjectStageCard.tsx).
 *
 * Default expansion: the project's real CURRENT stage — never invented,
 * derived from the same resolveProjectWorkspaceStages() status each stage
 * card already carries. If the project has moved past the tracked 14-stage
 * window (e.g. currentStage is 'Service'/'Monitoring'/'New'/'Archived',
 * which aren't part of this list), falls back to the most recently
 * completed stage, then the first stage — still a real, derived choice,
 * never a hardcoded default.
 *
 * Survey, Engineering, Quotation and Order have full operational workspaces
 * (see stages/ProjectSurveyWorkspace.tsx, ProjectEngineeringWorkspace.tsx,
 * ProjectQuotationWorkspace.tsx, ProjectOrderWorkspace.tsx + stages/index.ts's
 * STAGE_WORKSPACES registry — Quotation's workspace replaced the retired
 * standalone Quotation popup, and Order's replaced the retired standalone
 * Order view popup; see the Quotation + Order Workspace Migration reports).
 * Every other stage — reachable (completed/current/attention) or not
 * (upcoming) — renders through GenericStageDetail below: real stageHistory
 * data plus a link to that stage's own existing ERP page (stage.href,
 * already computed by resolveProjectWorkspaceStages) — never an invented
 * workspace standing in for one that hasn't been built yet.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, Search, Wrench, FileText, ShoppingCart, Activity, Truck, HardHat,
  ClipboardCheck, Zap, BarChart3, Landmark, Handshake, ShieldCheck, ArrowUpRight, Plus,
  Banknote, BadgeCheck,
  type LucideIcon,
} from 'lucide-react';
import quotationIllustration from '../../../../assets/customer-workspace/quotation.png';
import orderIllustration from '../../../../assets/customer-workspace/order.png';
import dispatchIllustration from '../../../../assets/customer-workspace/dispatch.png';
import commissioningIllustration from '../../../../assets/customer-workspace/project.png';
import subsidyIllustration from '../../../../assets/customer-workspace/registration.png';
import surveyIllustration from '../../../../assets/customer-workspace/survey.png';
import engineeringIllustration from '../../../../assets/customer-workspace/engineering.png';
import procurementIllustration from '../../../../assets/customer-workspace/procurement.png';
import installationIllustration from '../../../../assets/customer-workspace/installation.png';
import qcIllustration from '../../../../assets/customer-workspace/qc.png';
import netMeteringIllustration from '../../../../assets/customer-workspace/net-metering.png';
import handoverIllustration from '../../../../assets/customer-workspace/handover.png';
import amcIllustration from '../../../../assets/customer-workspace/amc.png';
// The Loan Application card (bank financing) reuses the same registration.png
// asset the Subsidy card already reuses — document + government building +
// % badge — the loan application concept art, never a new asset.
import loanApplicationIllustration from '../../../../assets/customer-workspace/registration.png';
import { fmtCurrency, fmtDate, getAll } from '../../../../lib/firestore';
import { COLLECTIONS } from '../../../../lib/firebase';
import { queryKeys } from '../../../../lib/queryKeys';
import { useAppStore } from '../../../../store/useAppStore';
import { usePermissions } from '../../../../lib/permissions';
import { resolveProjectWorkspaceStages, type ProjectWorkspaceStage } from '../../../../hooks/useProjectStage';
import type { StageCardStatus } from '../../../../components/shared/StageCard';
import { useSurveys } from '../../../surveys/hooks/useSurveys';
import type { SurveyRecord } from '../../../surveys/types';
import { useEngineeringDesigns } from '../../../engineering/hooks/useEngineeringDesigns';
import type { EngineeringDesignRecord } from '../../../engineering/types';
import { useLoanApplications } from '../../../loan-applications/hooks/useLoanApplications';
import { useQuotations, useOrders } from '../../../sales/hooks/useSales';
import { usePurchaseOrders } from '../../../procurement/hooks/usePurchaseOrders';
import { isValidInstallation, stageLabel } from '../../../../lib/installationEngine';
import { normalizeQCRecord } from '../../../../lib/qcWorkflow';
import type { CommissioningRecord } from '../../../../lib/commissioningWorkflow';
import type { NetMeteringApplication } from '../../../../lib/netMeteringWorkflow';
import type { SubsidyApplication } from '../../../../lib/subsidyWorkflow';
import type { HandoverRecord } from '../../../../lib/projectHandoverWorkflow';
import type { AmcContractRecord } from '../../../../lib/amcWorkflow';
import type { SchemeRegistrationRecord } from '../../../scheme-registration/types';
import type { ProjectRecord, ProjectStage } from '../../types';
import ProjectStageCard from './ProjectStageCard';
import { STAGE_WORKSPACES } from './stages';

const STAGE_ICONS: Record<string, LucideIcon> = {
  // Phase 6: Registration (SchemeRegistration — Vendor Lock / Scheme
  // Registration), the canonical stage between New and Survey.
  registration: BadgeCheck,
  survey: Search,
  engineering: Wrench,
  quotation: FileText,
  // Loan Application is a separate bank-financing entity (registrations
  // collection), not a canonical ProjectStage — it still gets the same
  // icon/illustration treatment as every other card.
  'loan-application': Banknote,
  order: ShoppingCart,
  procurement: Activity,
  dispatch: Truck,
  installation: HardHat,
  qc: ClipboardCheck,
  commissioning: Zap,
  'net-metering': BarChart3,
  subsidy: Landmark,
  handover: Handshake,
  amc: ShieldCheck,
};

/** Every one of the 14 stages has real illustration art, in the same
 * duotone-line-art + one colored circular badge visual language Customer
 * Workspace's own stage cards use. Quotation/Order/Dispatch reuse Customer
 * Workspace's existing PNGs verbatim (same concept, same asset — never a
 * duplicate). Commissioning/Subsidy reuse Customer Workspace's own
 * project.png (solar panel + sun) / registration.png (document + govt
 * building + % badge) — both already fit those concepts exactly. The
 * remaining 8 got new PNGs added in the identical style (see
 * src/assets/customer-workspace/{survey,engineering,procurement,
 * installation,qc,net-metering,handover,amc}.png). */
const STAGE_ILLUSTRATIONS: Partial<Record<string, string>> = {
  // Phase 6: Registration reuses the same document + govt building concept
  // art (registration.png) the Subsidy/Loan Application cards already use.
  registration: loanApplicationIllustration,
  survey: surveyIllustration,
  engineering: engineeringIllustration,
  quotation: quotationIllustration,
  'loan-application': loanApplicationIllustration,
  order: orderIllustration,
  procurement: procurementIllustration,
  dispatch: dispatchIllustration,
  installation: installationIllustration,
  qc: qcIllustration,
  commissioning: commissioningIllustration,
  'net-metering': netMeteringIllustration,
  subsidy: subsidyIllustration,
  handover: handoverIllustration,
  amc: amcIllustration,
};

interface Props {
  project: ProjectRecord;
  customer: any;
  users: any[];
  canEditProject: boolean;
}

function GenericStageDetail({ stage, project }: { stage: ProjectWorkspaceStage; project: ProjectRecord }) {
  const historyEntry = [...(project.stageHistory || [])].reverse().find((entry) => entry.stage === stage.projectStage);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-secondary)]">{stage.description}</p>
      {historyEntry && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          {stage.status === 'completed' ? 'Completed' : 'Last updated'} {new Date(historyEntry.changedAt).toLocaleDateString()}
          {historyEntry.note && <> — {historyEntry.note}</>}
        </div>
      )}
      {stage.href ? (
        <a
          href={stage.href}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors"
        >
          Open in full workspace <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      ) : (
        <p className="text-xs text-[var(--color-text-disabled)]">A dedicated operational workspace for this stage will be added here in a later phase.</p>
      )}
    </div>
  );
}

function resolveDefaultStageId(stages: ProjectWorkspaceStage[]): string | undefined {
  return stages.find((s) => s.status === 'current')?.id
    ?? [...stages].reverse().find((s) => s.status === 'completed')?.id
    ?? stages[0]?.id;
}

/** Real-data state for the Survey card — both its collapsed-row completion
 * line ("Completed by <name> · <date>", never the full report) and whether
 * ANY survey already exists for this project (so the header's "Schedule
 * Survey" action — a real, project-scoped call into the exact same
 * scheduleSurvey business logic ProjectSurveyWorkspace's own inline form
 * uses — only appears while it's still the meaningful next step, mirroring
 * Customer Workspace's own active/inactive per-stage action pattern).
 * Sourced from the SAME useSurveys() data ProjectSurveyWorkspace itself
 * reads — not a second Survey query/computation. completedBy is the user
 * who actually submitted the report (distinct from approvedBy) — see
 * submitSurveyReport in features/surveys/services/surveyWorkflow.ts. */
function useSurveyCardState(projectId: string, users: any[]): { summary: string | undefined; hasSurvey: boolean } {
  const { data: surveys = [] } = useSurveys();
  return useMemo(() => {
    const projectSurveys = (surveys as SurveyRecord[]).filter((s) => s.projectId === projectId);
    const latestCompleted = projectSurveys
      .filter((s) => s.status === 'Completed')
      .sort((a, b) => new Date(b.completedDate || 0).getTime() - new Date(a.completedDate || 0).getTime())[0];

    let summary: string | undefined;
    if (latestCompleted) {
      const completedByName = users.find((u: any) => u.id === latestCompleted.completedBy)?.name;
      const dateLabel = latestCompleted.completedDate ? fmtDate(latestCompleted.completedDate) : undefined;
      summary = completedByName && dateLabel ? `Completed by ${completedByName} · ${dateLabel}` : dateLabel ? `Completed · ${dateLabel}` : 'Completed';
    }

    return { summary, hasSurvey: projectSurveys.length > 0 };
  }, [surveys, projectId, users]);
}

/** Real-data completion line for the Engineering card's collapsed row —
 * "Completed by <name> · <date>", mirroring useSurveyCardState above.
 * Sourced from the SAME useEngineeringDesigns() data
 * ProjectEngineeringWorkspace itself reads — not a second query. Engineering
 * has no "hasDesign" header action to compute (unlike Survey's Schedule
 * action): a design is auto-created on Survey approval, so there is no
 * legitimate manual "create" action to surface here — see
 * ProjectEngineeringWorkspace.tsx's own doc comment on why a second
 * creation path is deliberately not offered. */
function useEngineeringCardSummary(projectId: string, users: any[]): string | undefined {
  const { data: designs = [] } = useEngineeringDesigns();
  return useMemo(() => {
    const approved = (designs as EngineeringDesignRecord[])
      .filter((d) => d.projectId === projectId && d.status === 'Approved')
      .sort((a, b) => new Date(b.approvedAt || 0).getTime() - new Date(a.approvedAt || 0).getTime())[0];
    if (!approved) return undefined;
    const approvedByName = users.find((u: any) => u.id === approved.approvedBy)?.name;
    const dateLabel = approved.approvedAt ? fmtDate(approved.approvedAt) : undefined;
    return approvedByName && dateLabel ? `Completed by ${approvedByName} · ${dateLabel}` : dateLabel ? `Completed · ${dateLabel}` : 'Completed';
  }, [designs, projectId, users]);
}

/** Loan Application card status — derived ONLY from the real loan
 * application record (registrations collection, bank financing). Loan
 * Application is NOT a canonical ProjectStage (it is not in
 * PROJECT_STAGE_ORDER, can never be Project.currentStage, and never appears
 * in stageHistory — the advance patch only accepts canonical stages), so the
 * card cannot borrow the engine's current/completed/upcoming comparison.
 * Instead it maps the loan application's own real status field onto the
 * same StageCardStatus vocabulary the other 14 cards use: no record at all →
 * 'upcoming' (the standard visible-but-disabled not-started tone); Payment
 * Received / Closed → 'completed'; Rejected → 'blocked'; every in-flight
 * status (Draft → Approved) → 'attention' (active parallel work, the same
 * tone the engine already gives Net Metering/Subsidy). */
function resolveLoanApplicationStatus(reg: any): StageCardStatus {
  if (!reg) return 'upcoming';
  if (reg.status === 'Payment Received' || reg.status === 'Closed') return 'completed';
  if (reg.status === 'Rejected') return 'blocked';
  return 'attention';
}

/** Real-data state for the Loan Application card — the customer's most
 * recent loan application, sourced from the SAME useLoanApplications() hook
 * the /loan-applications module page uses (query-keyed, deduped — never a
 * second query). Scoped by customerId only: loan applications are created
 * against customers (the projectId back-reference is only written later by
 * createProjectFromLoanApplication, so it cannot be relied on as the
 * primary link). Returns a real collapsed-row summary ("<bank> ·
 * <status>") plus the derived StageCardStatus; both feed the card exactly
 * like Survey's / Engineering's summaries do. */
function useLoanApplicationCardState(customerId: string): { summary: string | undefined; status: StageCardStatus } {
  const { data: registrations = [] } = useLoanApplications();
  return useMemo(() => {
    const customerRegs = (registrations as any[])
      .filter((r) => r.customerId === customerId && !r.isDeleted)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = customerRegs[0];
    if (!latest) return { summary: undefined, status: 'upcoming' };
    const bank = latest.bankName || 'Bank';
    const summary = latest.status ? `${bank} · ${latest.status}` : bank;
    return { summary, status: resolveLoanApplicationStatus(latest) };
  }, [registrations, customerId]);
}

/** Real-data collapsed-row summary for the Registration card — "<vendor> ·
 * <status>" from the project's most recent scheme registration (Vendor Lock
 * / Scheme Registration), sourced from the SAME query key
 * (queryKeys.schemeRegistrationsAll) the Registration stage workspace itself
 * reads (query-keyed, deduped — never a second query). Registration IS a
 * canonical ProjectStage, so the card's completed/current/upcoming status
 * comes from the shared lifecycle engine — this hook only supplies the real
 * collapsed-row summary line. */
function useSchemeRegistrationCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: registrations = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).schemeRegistrationsAll,
    queryFn: () => getAll(COLLECTIONS.SCHEME_REGISTRATIONS),
    staleTime: 15_000,
  });
  return useMemo(() => {
    const projectRegs = (registrations as SchemeRegistrationRecord[])
      .filter((r) => r.projectId === projectId && !r.isDeleted)
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    const latest = projectRegs[0];
    if (!latest) return undefined;
    return [latest.vendorName, latest.status].filter(Boolean).join(' · ');
  }, [registrations, projectId]);
}

/** Real-data collapsed-row summary for the Quotation card — "<number> ·
 * <total> · <status>" from the customer's most recent project-linked
 * quotation, sourced from the SAME useQuotations() hook the Quotations list
 * page and ProjectQuotationWorkspace itself read (query-keyed, deduped —
 * never a second query). Mirrors the Survey/Engineering/Loan Application
 * card summaries: no summary while no quotation exists yet (the card then shows
 * the stage description in the collapsed row). */
function useQuotationCardSummary(projectId: string): string | undefined {
  const { data: quotations = [] } = useQuotations();
  return useMemo(() => {
    const projectQuotations = (quotations as any[])
      .filter((q) => q.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = projectQuotations[0];
    if (!latest) return undefined;
    const number = String(latest.quotationNumber || latest.quoteNumber || latest.refNo || latest.id);
    const total = latest.total != null ? fmtCurrency(latest.total) : undefined;
    const status = latest.status || '';
    return [number, total, status].filter(Boolean).join(' · ');
  }, [quotations, projectId]);
}

/** Real-data collapsed-row summary for the Order card — "<number> ·
 * <total> · <status>" from the project's most recent Order, sourced from
 * the SAME useOrders() hook the Orders list page and ProjectOrderWorkspace
 * itself read (query-keyed, deduped — never a second query). Mirrors the
 * Survey/Engineering/Quotation card summaries: no summary while no order
 * exists yet (the card then shows the stage description in the collapsed
 * row). */
function useOrderCardSummary(projectId: string): string | undefined {
  const { data: orders = [] } = useOrders();
  return useMemo(() => {
    const projectOrders = (orders as any[])
      .filter((o) => o.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = projectOrders[0];
    if (!latest) return undefined;
    const number = String(latest.orderNumber || latest.orderNo || latest.id);
    const total = latest.total != null ? fmtCurrency(latest.total) : undefined;
    const status = latest.status || '';
    return [number, total, status].filter(Boolean).join(' · ');
  }, [orders, projectId]);
}

/** Real-data collapsed-row summary for the Procurement card — "PO <id> ·
 * <vendor> · <status>" from the project's most recent purchase order,
 * sourced from the SAME usePurchaseOrders() hook the Purchase Orders list
 * page and ProjectProcurementWorkspace itself read (query-keyed, deduped —
 * never a second query). Mirrors the Survey/Engineering/Quotation/Order card
 * summaries: no summary while no purchase order exists yet (the card then
 * shows the stage description in the collapsed row). */
function useProcurementCardSummary(projectId: string): string | undefined {
  const { data: purchaseOrders = [] } = usePurchaseOrders();
  return useMemo(() => {
    const projectPOs = (purchaseOrders as any[])
      .filter((po) => po.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = projectPOs[0];
    if (!latest) return undefined;
    const id = String(latest.purchaseOrderId || latest.id);
    const status = latest.status || '';
    return [id, latest.vendorName, status].filter(Boolean).join(' · ');
  }, [purchaseOrders, projectId]);
}

/** Real-data collapsed-row summary for the Dispatch card — "<number> ·
 * <vehicle> · <status>" from the project's most recent dispatch, sourced from
 * the SAME query key (queryKeys.dispatchAll) the Dispatch list page and
 * ProjectDispatchWorkspace itself read (query-keyed, deduped — never a second
 * query). Mirrors the Survey/Engineering/Quotation/Order/Procurement card
 * summaries: no summary while no dispatch exists yet (the card then shows the
 * stage description in the collapsed row). */
function useDispatchCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: dispatches = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).dispatchAll,
    queryFn: () => getAll(COLLECTIONS.DISPATCH),
    staleTime: 30_000,
  });
  return useMemo(() => {
    const projectDispatches = (dispatches as any[])
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
    const latest = projectDispatches[0];
    if (!latest) return undefined;
    const id = String(latest.dispatchNumber || latest.dispatchNo || latest.id);
    const status = latest.status || '';
    return [id, latest.vehicleNo, status].filter(Boolean).join(' · ');
  }, [dispatches, projectId]);
}

/** Real-data collapsed-row summary for the Installation card — "<lead name>
 * · <stage label>" from the project's most recent installation lead, sourced
 * from the SAME query key (queryKeys.leadsAll) the Installations list page
 * and ProjectInstallationWorkspace itself read — installation records live on
 * LEADS (lead.installationStatus) via isValidInstallation (query-keyed,
 * deduped — never a second query). Mirrors the Dispatch/Order/Procurement
 * card summaries: no summary while no installation has started yet (the card
 * then shows the stage description in the collapsed row). */
function useInstallationCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: leads = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
  });
  return useMemo(() => {
    const projectInstallations = (leads as any[])
      .filter((l) => isValidInstallation(l) && String(l.projectId || '') === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = projectInstallations[0];
    if (!latest) return undefined;
    const name = latest.name || '';
    const status = latest.installationStatus ? stageLabel(latest.installationStatus) : '';
    return [name, status].filter(Boolean).join(' · ');
  }, [leads, projectId]);
}

/** Real-data collapsed-row summary for the QC card — "<qc id> · <inspector> ·
 * <status>" from the project's most recent QC check, sourced from the SAME
 * query key (queryKeys.qcChecksAll) the Quality Checks list page and
 * ProjectQCWorkspace itself read (query-keyed, deduped — never a second
 * query). Mirrors the Installation/Dispatch/Order/Procurement card summaries:
 * no summary while no QC check exists yet (the card then shows the stage
 * description in the collapsed row). */
function useQCCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: qcData = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).qcChecksAll,
    queryFn: () => getAll(COLLECTIONS.QC_CHECKS),
    staleTime: 15_000,
  });
  return useMemo(() => {
    const projectQCs = (qcData as any[])
      .map((q) => normalizeQCRecord(q as any))
      .filter((q: any) => q.projectId === projectId && !q.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = projectQCs[0];
    if (!latest) return undefined;
    const id = String(latest.id || '').slice(-8);
    const status = latest.status || '';
    return [id, latest.inspectorName, status].filter(Boolean).join(' · ');
  }, [qcData, projectId]);
}

/** Real-data collapsed-row summary for the Commissioning card — "<id> ·
 * <generation> kWh · Completed" from the project's commissioning record,
 * sourced from the SAME query key (queryKeys.commissioningRecordsAll) the
 * Commissioning list page and ProjectCommissioningWorkspace itself read
 * (query-keyed, deduped — never a second query). Mirrors the QC/Installation/
 * Dispatch card summaries: no summary while no commissioning record exists
 * yet (the card then shows the stage description in the collapsed row). */
function useCommissioningCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: records = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).commissioningRecordsAll,
    queryFn: () => getAll(COLLECTIONS.COMMISSIONING_RECORDS),
    staleTime: 15_000,
  });
  return useMemo(() => {
    const projectRecords = (records as CommissioningRecord[])
      .filter((r) => r.projectId === projectId && !r.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = projectRecords[0];
    if (!latest) return undefined;
    const id = String(latest.id || '').slice(-8);
    return [id, `${latest.generationTestKwh} kWh`, 'Completed'].filter(Boolean).join(' · ');
  }, [records, projectId]);
}

/** Real-data collapsed-row summary for the Net Metering card — "<id> ·
 * <discom> · <applicationNo> · <status>" from the project's latest net
 * metering application, sourced from the SAME query key
 * (queryKeys.netMeteringAll) the Net Metering list page and
 * ProjectNetMeteringWorkspace itself read (query-keyed, deduped — never a
 * second query). Mirrors the Commissioning/QC/Installation/Dispatch card
 * summaries: no summary while no application exists yet (the card then
 * shows the stage description in the collapsed row). */
function useNetMeteringCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: applications = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).netMeteringAll,
    queryFn: () => getAll(COLLECTIONS.NET_METERING_APPLICATIONS),
    staleTime: 15_000,
  });
  return useMemo(() => {
    const projectApps = (applications as NetMeteringApplication[])
      .filter((app) => app.projectId === projectId && !app.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = projectApps[0];
    if (!latest) return undefined;
    const id = String(latest.id || '').slice(-8);
    return [id, latest.discomName, latest.applicationNumber, latest.status].filter(Boolean).join(' · ');
  }, [applications, projectId]);
}

/** Real-data collapsed-row summary for the Subsidy card — "<id> · <scheme> ·
 * <applicationNo> · <status>" from the project's latest subsidy application,
 * sourced from the SAME query key (queryKeys.subsidyAll) the Subsidy list
 * page and ProjectSubsidyWorkspace itself read (query-keyed, deduped — never
 * a second query). Mirrors the Net Metering/Commissioning/QC/Installation/
 * Dispatch card summaries: no summary while no application exists yet (the
 * card then shows the stage description in the collapsed row). */
function useSubsidyCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: applications = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).subsidyAll,
    queryFn: () => getAll(COLLECTIONS.SUBSIDY_APPLICATIONS),
    staleTime: 15_000,
  });
  return useMemo(() => {
    const projectApps = (applications as SubsidyApplication[])
      .filter((app) => app.projectId === projectId && !app.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = projectApps[0];
    if (!latest) return undefined;
    const id = String(latest.id || '').slice(-8);
    return [id, latest.schemeName, latest.applicationNumber, latest.status].filter(Boolean).join(' · ');
  }, [applications, projectId]);
}

/** Real-data collapsed-row summary for the Handover card — "<id> ·
 * <customer> · <status>" from the project's most recent handover record,
 * sourced from the SAME query key (queryKeys.projectHandovers) the Project
 * Handover list page and ProjectHandoverWorkspace itself read (query-keyed,
 * deduped — never a second query). Mirrors the Subsidy/Net Metering/
 * Commissioning/QC card summaries: no summary while no handover record
 * exists yet (the card then shows the stage description in the collapsed
 * row). */
function useHandoverCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: handovers = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).projectHandovers,
    queryFn: () => getAll(COLLECTIONS.PROJECT_HANDOVERS),
    staleTime: 15_000,
  });
  return useMemo(() => {
    const projectHandovers = (handovers as HandoverRecord[])
      .filter((h) => h.projectId === projectId && !h.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = projectHandovers[0];
    if (!latest) return undefined;
    const id = String(latest.handoverNumber || latest.id || '').slice(-8);
    return [id, latest.customerName, latest.status].filter(Boolean).join(' · ');
  }, [handovers, projectId]);
}

/** Real-data collapsed-row summary for the AMC card — "<contractNo> ·
 * <value> · <status>" from the project's most recent AMC contract, sourced
 * from the SAME query key (queryKeys.amcContracts) the AMC Contracts list
 * page and ProjectAmcWorkspace itself read (query-keyed, deduped — never a
 * second query). Mirrors the Handover/Subsidy/Net Metering card summaries:
 * no summary while no contract exists yet (the card then shows the stage
 * description in the collapsed row). */
function useAmcCardSummary(projectId: string): string | undefined {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const { data: contracts = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).amcContracts,
    queryFn: () => getAll(COLLECTIONS.AMC_CONTRACTS),
    staleTime: 15_000,
  });
  return useMemo(() => {
    const projectContracts = (contracts as AmcContractRecord[])
      .filter((c) => c.projectId === projectId && !c.isDeleted)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = projectContracts[0];
    if (!latest) return undefined;
    const id = String(latest.contractNumber || latest.id || '').slice(-8);
    return [id, fmtCurrency(latest.contractValue), latest.status].filter(Boolean).join(' · ');
  }, [contracts, projectId]);
}

/** The one real header action Survey's card offers right now — same
 * top-right slot / visual language as Customer Workspace's own
 * CreateActionButton, adapted: clicking it opens THIS project's Survey
 * stage (revealing the real inline Schedule Survey form
 * ProjectSurveyWorkspace already has — the exact scheduleSurvey mutation,
 * not a second scheduling surface), pre-scoped to this project so the user
 * is never asked to pick a project again. */
function ScheduleSurveyAction({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!active}
      title={active ? 'Schedule Survey' : 'You do not have permission to schedule surveys'}
      className={[
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
        active
          ? 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] text-[var(--color-primary-text)] hover:bg-[var(--color-primary-muted)]'
          : 'cursor-not-allowed border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] text-[var(--color-text-disabled)]',
      ].join(' ')}
    >
      <Plus className="h-3 w-3" />Schedule Survey
    </button>
  );
}

export default function ProjectWorkOnThisProject({ project, customer, users, canEditProject }: Props) {
  const perms = usePermissions();
  const stages = resolveProjectWorkspaceStages(project);
  // Loan Application (bank financing) is a separate entity, not a canonical
  // ProjectStage — insert its card locally, immediately after Quotation
  // (the B2C spine position), rendered through the SAME ProjectStageCard
  // shell with real loan application data. The shared engine is untouched,
  // so this card appears ONLY in the Project Workspace, never in the
  // Customer Workspace timeline or anywhere else
  // resolveProjectWorkspaceStages() is consumed.
  const { summary: loanApplicationSummary, status: loanApplicationStatus } = useLoanApplicationCardState(project.customerId);
  const displayStages = (() => {
    const list = [...stages];
    const quotationIdx = list.findIndex((s) => s.id === 'quotation');
    if (quotationIdx >= 0) {
      list.splice(quotationIdx + 1, 0, {
        id: 'loan-application',
        // Display-only value — 'Loan Application' is intentionally NOT a
        // member of the ProjectStage union (it is not in PROJECT_STAGE_ORDER),
        // so it needs a scoped cast to satisfy the shared type; the engine
        // itself never sees this value.
        projectStage: 'Loan Application' as unknown as ProjectStage,
        title: 'Loan Application',
        shortLabel: 'Loan Application',
        description: 'Bank financing application',
        status: loanApplicationStatus,
        href: '/loan-applications',
      });
    }
    return list;
  })();

  const [selectedStageId, setSelectedStageId] = useState<string | undefined>(() => resolveDefaultStageId(stages));
  const schemeRegistrationCardSummary = useSchemeRegistrationCardSummary(project.id);
  const { summary: surveyCardSummary, hasSurvey } = useSurveyCardState(project.id, users);
  const engineeringCardSummary = useEngineeringCardSummary(project.id, users);
  const quotationCardSummary = useQuotationCardSummary(project.id);
  const orderCardSummary = useOrderCardSummary(project.id);
  const procurementCardSummary = useProcurementCardSummary(project.id);
  const dispatchCardSummary = useDispatchCardSummary(project.id);
  const installationCardSummary = useInstallationCardSummary(project.id);
  const qcCardSummary = useQCCardSummary(project.id);
  const commissioningCardSummary = useCommissioningCardSummary(project.id);
  const netMeteringCardSummary = useNetMeteringCardSummary(project.id);
  const subsidyCardSummary = useSubsidyCardSummary(project.id);
  const handoverCardSummary = useHandoverCardSummary(project.id);
  const amcCardSummary = useAmcCardSummary(project.id);

  function toggleStage(stageId: string) {
    setSelectedStageId((prev) => (prev === stageId ? undefined : stageId));
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between mb-3.5 pb-3 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)]">
            <Building2 className="h-3.5 w-3.5 text-[var(--color-primary-text)]" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Work on This Project</h3>
        </div>
      </div>

      <div>
        {displayStages.map((stage, index) => {
          const StageWorkspace = STAGE_WORKSPACES[stage.id];
          const expanded = selectedStageId === stage.id && stage.status !== 'upcoming';
          const action = stage.id === 'survey' && !hasSurvey
            ? <ScheduleSurveyAction active={perms.canCreate('surveys')} onClick={() => setSelectedStageId('survey')} />
            : undefined;

          return (
            <ProjectStageCard
              key={stage.id}
              index={index + 1}
              title={stage.title}
              description={stage.description}
              summary={stage.id === 'registration' ? schemeRegistrationCardSummary : stage.id === 'survey' ? surveyCardSummary : stage.id === 'engineering' ? engineeringCardSummary : stage.id === 'loan-application' ? loanApplicationSummary : stage.id === 'quotation' ? quotationCardSummary : stage.id === 'order' ? orderCardSummary : stage.id === 'procurement' ? procurementCardSummary : stage.id === 'dispatch' ? dispatchCardSummary : stage.id === 'installation' ? installationCardSummary : stage.id === 'qc' ? qcCardSummary : stage.id === 'commissioning' ? commissioningCardSummary : stage.id === 'net-metering' ? netMeteringCardSummary : stage.id === 'subsidy' ? subsidyCardSummary : stage.id === 'handover' ? handoverCardSummary : stage.id === 'amc' ? amcCardSummary : undefined}
              status={stage.status ?? 'upcoming'}
              icon={STAGE_ICONS[stage.id] || Building2}
              illustration={STAGE_ILLUSTRATIONS[stage.id]}
              action={action}
              expanded={expanded}
              onToggle={() => toggleStage(stage.id)}
              last={index === displayStages.length - 1}
            >
              {StageWorkspace
                ? <StageWorkspace project={project} customer={customer} users={users} canEdit={canEditProject} />
                : <GenericStageDetail stage={stage} project={project} />}
            </ProjectStageCard>
          );
        })}
      </div>
    </div>
  );
}
