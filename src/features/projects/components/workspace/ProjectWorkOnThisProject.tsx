/**
 * ProjectWorkOnThisProject — the Project Workspace's Center Panel primary
 * card (Project Workspace Stage Lifecycle mission). This is the operational
 * command center for the Project: all 12 stages of the real lifecycle
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
 * card already carries. If the project has moved past the tracked 12-stage
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, Search, Wrench, FileText, ShoppingCart, Truck, HardHat,
  ClipboardCheck, Zap, BarChart3, Landmark, Handshake, ArrowUpRight, Plus,
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

import installationIllustration from '../../../../assets/customer-workspace/installation.png';
import qcIllustration from '../../../../assets/customer-workspace/qc.png';
import netMeteringIllustration from '../../../../assets/customer-workspace/net-metering.png';
import handoverIllustration from '../../../../assets/customer-workspace/handover.png';

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
import { resolveStageCardVariant, type StageCardStatus } from '../../../../components/shared/StageCard';
import { Badge } from '../../../../components/ui/Badge';
import { useSurveys } from '../../../surveys/hooks/useSurveys';
import type { SurveyRecord } from '../../../surveys/types';
import { useEngineeringDesigns } from '../../../engineering/hooks/useEngineeringDesigns';
import type { EngineeringDesignRecord } from '../../../engineering/types';
import { useLoanApplications } from '../../../loan-applications/hooks/useLoanApplications';
import { useQuotations, useOrders } from '../../../sales/hooks/useSales';
import { isValidInstallation, stageLabel } from '../../../../lib/installationEngine';
import { normalizeQCRecord } from '../../../../lib/qcWorkflow';
import type { CommissioningRecord } from '../../../../lib/commissioningWorkflow';
import type { NetMeteringApplication } from '../../../../lib/netMeteringWorkflow';
import type { SubsidyApplication } from '../../../../lib/subsidyWorkflow';
import type { HandoverRecord } from '../../../../lib/projectHandoverWorkflow';
import type { SchemeRegistrationRecord } from '../../../scheme-registration/types';
import type { ProjectRecord, ProjectStage } from '../../types';
import ProjectStageCard, { type SummaryField } from './ProjectStageCard';
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
  dispatch: Truck,
  installation: HardHat,
  qc: ClipboardCheck,
  commissioning: Zap,
  'net-metering': BarChart3,
  subsidy: Landmark,
  handover: Handshake,
};

/** Every stage card has real illustration art, in the same
 * duotone-line-art + one colored circular badge visual language Customer
 * Workspace's own stage cards use. */
const STAGE_ILLUSTRATIONS: Partial<Record<string, string>> = {
  // Phase 6: Registration reuses the same document + govt building concept
  // art (registration.png) the Subsidy/Loan Application cards already use.
  registration: loanApplicationIllustration,
  survey: surveyIllustration,
  engineering: engineeringIllustration,
  quotation: quotationIllustration,
  'loan-application': loanApplicationIllustration,
  order: orderIllustration,
  dispatch: dispatchIllustration,
  installation: installationIllustration,
  qc: qcIllustration,
  commissioning: commissioningIllustration,
  'net-metering': netMeteringIllustration,
  subsidy: subsidyIllustration,
  handover: handoverIllustration,
};

interface Props {
  project: ProjectRecord;
  customer: any;
  users: any[];
  canEditProject: boolean;
  /**    * Mobile "continuous workspace" mode: instead of the full 12-card
   * accordion, render ONLY the project's current stage — a compact
   * position/percent header + that stage's real operational workspace (the
   * SAME STAGE_WORKSPACES component desktop mounts). When the stage's own
   * actions advance `project.currentStage`, this re-resolves and shows the
   * next stage — no navigation, no manual stage selection.
   */
  currentStageOnly?: boolean;
}

const STAGE_STATUS_LABEL: Record<StageCardStatus, string> = {
  completed: 'Completed',
  current: 'In Progress',
  upcoming: 'Upcoming',
  blocked: 'Blocked',
  attention: 'Needs Attention',
};

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

/** Real-data state for the Survey card — structured summary fields and
 * whether ANY survey already exists for this project (so the header's
 * "Schedule Survey" action appears while it's still the next step).
 * Sourced from the SAME useSurveys() data ProjectSurveyWorkspace itself reads. */
function useSurveyCardState(projectId: string, users: any[]): { fields: SummaryField[]; hasSurvey: boolean } {
  const { data: surveys = [] } = useSurveys();
  return useMemo(() => {
    const projectSurveys = (surveys as SurveyRecord[]).filter((s) => s.projectId === projectId);
    const latestCompleted = projectSurveys
      .filter((s) => s.status === 'Completed')
      .sort((a, b) => new Date(b.completedDate || 0).getTime() - new Date(a.completedDate || 0).getTime())[0];

    const rawFields: (SummaryField | false | undefined | null)[] = [];
    if (latestCompleted) {
      const completedByName = users.find((u: any) => u.id === latestCompleted.completedBy)?.name;
      rawFields.push(
        completedByName ? { label: 'Surveyor', value: completedByName } : undefined,
        latestCompleted.completedDate ? { label: 'Date', value: fmtDate(latestCompleted.completedDate) } : undefined,
        latestCompleted.roofType ? { label: 'Roof Type', value: latestCompleted.roofType } : undefined,
        latestCompleted.roofAreaSqm ? { label: 'Roof Area', value: `${latestCompleted.roofAreaSqm} sqm` } : undefined,
        { label: 'Status', value: 'Completed' },
      );
    }

    return { fields: rawFields.filter(Boolean) as SummaryField[], hasSurvey: projectSurveys.length > 0 };
  }, [surveys, projectId, users]);
}

/** Real-data summary fields for the Engineering card — structured fields
 * from the project's most recent approved design, sourced from the SAME
 * useEngineeringDesigns() data ProjectEngineeringWorkspace itself reads. */
function useEngineeringCardSummary(projectId: string, users: any[]): SummaryField[] {
  const { data: designs = [] } = useEngineeringDesigns();
  return useMemo(() => {
    const approved = (designs as EngineeringDesignRecord[])
      .filter((d) => d.projectId === projectId && d.status === 'Approved')
      .sort((a, b) => new Date(b.approvedAt || 0).getTime() - new Date(a.approvedAt || 0).getTime())[0];
    if (!approved) return [];
    const approvedByName = users.find((u: any) => u.id === approved.approvedBy)?.name;
    return [
      approved.designId && { label: 'Design No.', value: approved.designId },
      approvedByName && { label: 'Engineer', value: approvedByName },
      approved.approvedAt && { label: 'Date', value: fmtDate(approved.approvedAt) },
      approved.panelCount && { label: 'Panels', value: `${approved.panelCount} × ${approved.panelWattage}W` },
      approved.systemCapacityKw && { label: 'Capacity', value: `${approved.systemCapacityKw} kW` },
      { label: 'Status', value: 'Approved' },
    ].filter(Boolean) as SummaryField[];
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
 * primary link). Returns structured summary fields plus the derived
 * StageCardStatus; both feed the card exactly like Survey's / Engineering's
 * summaries do. */
function useLoanApplicationCardState(customerId: string): { fields: SummaryField[]; status: StageCardStatus } {
  const { data: registrations = [] } = useLoanApplications();
  return useMemo(() => {
    const customerRegs = (registrations as any[])
      .filter((r) => r.customerId === customerId && !r.isDeleted)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = customerRegs[0];
    if (!latest) return { fields: [], status: 'upcoming' };
    const fields: SummaryField[] = [
      latest.bankName && { label: 'Bank', value: latest.bankName },
      latest.loanAmount != null && { label: 'Amount', value: fmtCurrency(latest.loanAmount) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
    return { fields, status: resolveLoanApplicationStatus(latest) };
  }, [registrations, customerId]);
}

/** Real-data collapsed-row summary for the Registration card — structured
 * fields from the project's most recent scheme registration (Vendor Lock /
 * Scheme Registration), sourced from the SAME query key the Registration
 * stage workspace itself reads (query-keyed, deduped — never a second query). */
function useSchemeRegistrationCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    return [
      latest.vendorName && { label: 'Vendor', value: latest.vendorName },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [registrations, projectId]);
}

/** Real-data summary fields for the Quotation card — structured fields
 * from the project's most recent quotation, sourced from the SAME
 * useQuotations() hook the Quotations list page and ProjectQuotationWorkspace
 * itself read (query-keyed, deduped — never a second query). */
function useQuotationCardSummary(projectId: string): SummaryField[] {
  const { data: quotations = [] } = useQuotations();
  return useMemo(() => {
    const projectQuotations = (quotations as any[])
      .filter((q) => q.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = projectQuotations[0];
    if (!latest) return [];
    const number = String(latest.quotationNumber || latest.quoteNumber || latest.refNo || latest.id);
    return [
      number && { label: 'Quote No.', value: number },
      latest.date && { label: 'Date', value: fmtDate(latest.date) },
      latest.validUntil && { label: 'Valid Until', value: fmtDate(latest.validUntil) },
      latest.items?.length && { label: 'Items', value: `${latest.items.length} item${latest.items.length > 1 ? 's' : ''}` },
      latest.total != null && { label: 'Amount', value: fmtCurrency(latest.total) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [quotations, projectId]);
}

/** Real-data summary fields for the Order card — structured fields from
 * the project's most recent Order, sourced from the SAME useOrders() hook
 * the Orders list page and ProjectOrderWorkspace itself read (query-keyed,
 * deduped — never a second query). */
function useOrderCardSummary(projectId: string): SummaryField[] {
  const { data: orders = [] } = useOrders();
  return useMemo(() => {
    const projectOrders = (orders as any[])
      .filter((o) => o.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latest = projectOrders[0];
    if (!latest) return [];
    const number = String(latest.orderNumber || latest.orderNo || latest.id);
    return [
      number && { label: 'Order No.', value: number },
      latest.date && { label: 'Date', value: fmtDate(latest.date) },
      latest.deliveryDate && { label: 'Delivery', value: fmtDate(latest.deliveryDate) },
      latest.items?.length && { label: 'Items', value: `${latest.items.length} item${latest.items.length > 1 ? 's' : ''}` },
      latest.total != null && { label: 'Amount', value: fmtCurrency(latest.total) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [orders, projectId]);
}

/** Real-data summary fields for the Dispatch card — structured fields
 * from the project's most recent dispatch, sourced from the SAME query key
 * (queryKeys.dispatchAll) the Dispatch list page and ProjectDispatchWorkspace
 * itself read (query-keyed, deduped — never a second query). */
function useDispatchCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    const id = String(latest.dispatchNumber || latest.dispatchNo || latest.id);
    return [
      id && { label: 'Dispatch No.', value: id },
      latest.date && { label: 'Date', value: fmtDate(latest.date) },
      latest.vehicleNo && { label: 'Vehicle', value: latest.vehicleNo },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [dispatches, projectId]);
}

/** Real-data summary fields for the Installation card — structured fields
 * from the project's most recent installation lead, sourced from the SAME
 * query key (queryKeys.leadsAll) the Installations list page and
 * ProjectInstallationWorkspace itself read (query-keyed, deduped — never a
 * second query). */
function useInstallationCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    return [
      latest.installationStatus && { label: 'Stage', value: stageLabel(latest.installationStatus) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [leads, projectId]);
}

/** Real-data summary fields for the QC card — structured fields from the
 * project's most recent QC check, sourced from the SAME query key
 * (queryKeys.qcChecksAll) the Quality Checks list page and
 * ProjectQCWorkspace itself read (query-keyed, deduped — never a second query). */
function useQCCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    return [
      latest.inspectorName && { label: 'Inspector', value: latest.inspectorName },
      (latest.submittedAt || latest.completedAt) && { label: 'Date', value: fmtDate(latest.submittedAt || latest.completedAt) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [qcData, projectId]);
}

/** Real-data summary fields for the Commissioning card — structured fields
 * from the project's commissioning record, sourced from the SAME query key
 * (queryKeys.commissioningRecordsAll) the Commissioning list page and
 * ProjectCommissioningWorkspace itself read (query-keyed, deduped — never a
 * second query). */
function useCommissioningCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    return [
      latest.commissionedDate && { label: 'Date', value: fmtDate(latest.commissionedDate) },
      latest.generationTestKwh != null && { label: 'Generation', value: `${latest.generationTestKwh} kWh` },
      { label: 'Status', value: 'Completed' },
    ].filter(Boolean) as SummaryField[];
  }, [records, projectId]);
}

/** Real-data summary fields for the Net Metering card — structured fields
 * from the project's latest net metering application, sourced from the SAME
 * query key (queryKeys.netMeteringAll) the Net Metering list page and
 * ProjectNetMeteringWorkspace itself read (query-keyed, deduped — never a
 * second query). */
function useNetMeteringCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    return [
      latest.discomName && { label: 'Discom', value: latest.discomName },
      latest.applicationNumber && { label: 'App No.', value: latest.applicationNumber },
      latest.submittedDate && { label: 'Date', value: fmtDate(latest.submittedDate) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [applications, projectId]);
}

/** Real-data summary fields for the Subsidy card — structured fields from
 * the project's latest subsidy application, sourced from the SAME query key
 * (queryKeys.subsidyAll) the Subsidy list page and
 * ProjectSubsidyWorkspace itself read (query-keyed, deduped — never a second
 * query). */
function useSubsidyCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    return [
      latest.schemeName && { label: 'Scheme', value: latest.schemeName },
      latest.applicationNumber && { label: 'App No.', value: latest.applicationNumber },
      latest.applicationDate && { label: 'Date', value: fmtDate(latest.applicationDate) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [applications, projectId]);
}

/** Real-data summary fields for the Handover card — structured fields from
 * the project's most recent handover record, sourced from the SAME query key
 * (queryKeys.projectHandovers) the Project Handover list page and
 * ProjectHandoverWorkspace itself read (query-keyed, deduped — never a second
 * query). */
function useHandoverCardSummary(projectId: string): SummaryField[] {
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
    if (!latest) return [];
    return [
      latest.handoverNumber && { label: 'Handover No.', value: latest.handoverNumber },
      latest.handoverDate && { label: 'Date', value: fmtDate(latest.handoverDate) },
      latest.status && { label: 'Status', value: latest.status },
    ].filter(Boolean) as SummaryField[];
  }, [handovers, projectId]);
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

export default function ProjectWorkOnThisProject({ project, customer, users, canEditProject, currentStageOnly = false }: Props) {
  const perms = usePermissions();
  const stages = resolveProjectWorkspaceStages(project);
  // Loan Application (bank financing) is a separate entity, not a canonical
  // ProjectStage — insert its card locally, immediately after Quotation
  // (the B2C spine position), rendered through the SAME ProjectStageCard
  // shell with real loan application data. The shared engine is untouched,
  // so this card appears ONLY in the Project Workspace, never in the
  // Customer Workspace timeline or anywhere else
  // resolveProjectWorkspaceStages() is consumed.
  const { fields: loanApplicationFields, status: loanApplicationStatus } = useLoanApplicationCardState(project.customerId);
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
  const schemeRegistrationFields = useSchemeRegistrationCardSummary(project.id);
  const { fields: surveyFields, hasSurvey } = useSurveyCardState(project.id, users);
  const engineeringFields = useEngineeringCardSummary(project.id, users);
  const quotationFields = useQuotationCardSummary(project.id);
  const orderFields = useOrderCardSummary(project.id);
  const dispatchFields = useDispatchCardSummary(project.id);
  const installationFields = useInstallationCardSummary(project.id);
  const qcFields = useQCCardSummary(project.id);
  const commissioningFields = useCommissioningCardSummary(project.id);
  const netMeteringFields = useNetMeteringCardSummary(project.id);
  const subsidyFields = useSubsidyCardSummary(project.id);
  const handoverFields = useHandoverCardSummary(project.id);

  function toggleStage(stageId: string) {
    setSelectedStageId((prev) => (prev === stageId ? undefined : stageId));
  }

  // Auto-scroll to the current stage on mount
  const stageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    const currentId = resolveDefaultStageId(stages);
    if (currentId) {
      const el = stageRefs.current.get(currentId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mobile "continuous workspace" — current stage only ──────────────────
  if (currentStageOnly) {
    const total = stages.length;
    const completedCount = stages.filter((s) => s.status === 'completed').length;
    const allComplete = total > 0 && completedCount >= total;
    const curIdx = stages.findIndex((s) => s.id === resolveDefaultStageId(stages));
    const current = curIdx >= 0 ? stages[curIdx] : null;
    const position = allComplete ? total : (curIdx >= 0 ? curIdx + 1 : Math.min(completedCount + 1, total || 1));
    const pct = total ? Math.round((position / total) * 100) : 0;
    const st = (current?.status as StageCardStatus) || 'upcoming';
    const StageWorkspace = current ? STAGE_WORKSPACES[current.id] : undefined;

    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="mb-3 flex items-center gap-2.5 border-b border-[var(--color-border-subtle)] pb-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)]">
            <Building2 className="h-3.5 w-3.5 text-[var(--color-primary-text)]" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Work on This Project</h3>
        </div>

        {allComplete ? (
          <div className="rounded-xl border border-[var(--color-success)] bg-[var(--color-success-light)] p-4 text-center">
            <p className="text-sm font-bold text-[var(--color-success-text)]">Project Completed</p>
            <p className="mt-1 text-xs text-[var(--color-success-text)]">{total} / {total} stages · 100%</p>
          </div>
        ) : current ? (
          <>
            <div className="mb-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold">
                <span className="shrink-0 text-[var(--color-text)]">{position}<span className="text-[var(--color-text-muted)]"> / {total}</span></span>
                <span className="text-[var(--color-text-disabled)]">·</span>
                <span className="shrink-0 text-[var(--color-text-secondary)]">{pct}%</span>
                <span className="ml-0.5 h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
                  <span className="block h-full rounded-full bg-[var(--color-primary)] transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h4 className="min-w-0 break-words text-sm font-bold text-[var(--color-text)]">{current.title}</h4>
                <Badge variant={resolveStageCardVariant(st)}>{STAGE_STATUS_LABEL[st]}</Badge>
              </div>
              {current.description && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{current.description}</p>}
            </div>

            {/* The current stage's real operational workspace — the exact same
                component desktop mounts (STAGE_WORKSPACES registry), so the
                existing forms / actions / validations / completion rules all
                apply. Completing the stage advances project.currentStage and
                this section re-resolves to the next stage. */}
            <div className="border-t border-[var(--color-border-subtle)] pt-3">
              {StageWorkspace
                ? <StageWorkspace project={project} customer={customer} users={users} canEdit={canEditProject} />
                : <GenericStageDetail stage={current} project={project} />}
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">No active stage.</p>
        )}
      </div>
    );
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
            <div key={stage.id} ref={(el) => { if (el) stageRefs.current.set(stage.id, el); }}>
            <ProjectStageCard
              index={index + 1}
              title={stage.title}
              description={stage.description}
              summaryFields={(() => {
                switch (stage.id) {
                  case 'registration': return schemeRegistrationFields;
                  case 'survey': return surveyFields;
                  case 'engineering': return engineeringFields;
                  case 'loan-application': return loanApplicationFields;
                  case 'quotation': return quotationFields;
                  case 'order': return orderFields;
                  case 'dispatch': return dispatchFields;
                  case 'installation': return installationFields;
                  case 'qc': return qcFields;
                  case 'commissioning': return commissioningFields;
                  case 'net-metering': return netMeteringFields;
                  case 'subsidy': return subsidyFields;
                  case 'handover': return handoverFields;
                  default: return [];
                }
              })()}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
