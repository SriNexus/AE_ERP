/**
 * ProjectOverview — Project workspace Overview tab content
 *
 * Layout (3 equal-height columns + bottom workflow):
 * 1. KPI Row
 * 2. Three-column grid: Left (Details+Team) | Middle (animated Stage Carousel) | Right (Recent+Tasks)
 * 3. Enhanced Business Workflow (interactive scroll, glow effects, micro-interactions)
 *
 * Design: Premium, compact, Linear-inspired. Animated stage transitions.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  Phone,
  MessageCircle,
  Calendar,
  TrendingUp,
  UserRound,
  ListTodo,
} from 'lucide-react';

import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../utils/cn';
import { formatJourneyDate, STATUS_COLORS } from '../../../components/projects/ProjectJourneyTimeline.helpers';
import { MetricTile } from '../../../components/projects/ProjectJourneyTimeline';
import type { ProjectRecord } from '../types';
import type { StageTimelineItem } from '../../../components/shared/StageTimeline';

// ── Types ─────────────────────────────────────────────────────

interface StageGroupItem extends StageTimelineItem {
  shortLabel?: string;
  emptyMessage?: string;
}

interface StageGroupsData {
  completed: StageGroupItem[];
  current: StageGroupItem[];
  attention: StageGroupItem[];
  upcoming: StageGroupItem[];
}

interface KpiData {
  percent: number;
  currentStageName: string;
  completedCount: number;
  attentionCount: number;
  remainingCount: number;
  daysInStage: number;
  hasAttention: boolean;
  stages: any[];
}

interface LinkedData {
  quotations: any[];
  orders: any[];
  dispatches: any[];
  purchaseOrders: any[];
  goodsReceipts: any[];
  installations: any[];
  qcChecks: any[];
  commissioningRecords: any[];
  netMeteringApplications: any[];
  subsidyApplications: any[];
  taxInvoices: any[];
  payments: any[];
  handovers: any[];
  amcContracts: any[];
  serviceTickets: any[];
  generationReadings: any[];
  engineeringDesigns?: any[];
}

interface ProjectOverviewProps {
  project: ProjectRecord;
  customer?: Record<string, unknown> | null;
  linked: LinkedData;
  lifecycle: {
    stages: StageGroupItem[];
    activeStageId?: string;
    completedCount: number;
  };
  stageGroups: StageGroupsData | null;
  showAmc: boolean;
  kpiData: KpiData | null;
}

// ── Helpers ───────────────────────────────────────────────────

function customerValue(customer: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = String(customer?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function fmtDate(value: unknown) {
  if (!value) return '—';
  try {
    const date = new Date(String(value));
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}

/** Render a 2-column key-value grid cell */
function MetaRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      {typeof value === 'string' ? (
        <span className={cn('text-xs font-semibold text-[var(--color-text)] truncate', accent)}>{value}</span>
      ) : value}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────

export function ProjectOverview({
  project,
  customer,
  linked,
  lifecycle,
  stageGroups: _stageGroups,
  showAmc: _showAmc,
  kpiData,
}: ProjectOverviewProps) {
  const navigate = useNavigate();

  // ── Stage focus state ──
  const workflowRef = useRef<HTMLDivElement>(null);
  const [focusedStageIdx, setFocusedStageIdx] = useState<number>(-1);
  const [carouselRevealed, setCarouselRevealed] = useState(false);

  // ── Stage data (must be above keyboard callbacks) ──
  const allJourneyStages = kpiData?.stages || [];

  // ── Keyboard navigation ──
  const goToPrevStage = useCallback(() => {
    setFocusedStageIdx((p) => Math.max(0, p - 1));
  }, []);

  const goToNextStage = useCallback(() => {
    setFocusedStageIdx((p) => Math.min(allJourneyStages.length - 1, p + 1));
  }, [allJourneyStages.length]);

  useEffect(() => {
    const idx = allJourneyStages.findIndex((s: any) => s.status === 'current');
    setFocusedStageIdx(idx >= 0 ? idx : 0);
    const frame = requestAnimationFrame(() => {
      setCarouselRevealed(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [kpiData?.stages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard listener — navigate stages with ← → arrow keys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrevStage(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goToNextStage(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goToPrevStage, goToNextStage]);

  // Auto-scroll workflow to active stage on load
  useEffect(() => {
    const container = workflowRef.current;
    if (!container) return;
    const activeItem = container.querySelector<HTMLElement>('[data-active="true"]');
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [kpiData?.stages]);

  // ── Derived financials ──
  const totalPayments = linked.payments.reduce((sum: number, p: any) =>
    sum + Number(p.amount || p.total || p.paidAmount || 0), 0);
  const projectValue = linked.orders.length > 0
    ? linked.orders.reduce((sum: number, o: any) =>
        sum + Number(o.total || o.amount || 0), 0)
    : 0;
  const outstandingAmount = Math.max(0, projectValue - totalPayments);

  const phone = customerValue(customer, ['phone', 'mobile', 'businessPhone']);
  const whatsapp = phone.replace(/\D/g, '');

  // ── Attention items ──
  const attentionItems: { label: string; href: string }[] = [];
  if (!project.stageHistory?.some((h) => h.stage === 'NetMetering') && project.currentStage !== 'Handover') {
    attentionItems.push({ label: 'Net Metering pending', href: '/net-metering' });
  }
  if (!project.stageHistory?.some((h) => h.stage === 'Subsidy') && project.currentStage !== 'Handover') {
    attentionItems.push({ label: 'Subsidy pending', href: '/subsidy' });
  }
  if (kpiData?.hasAttention) {
    attentionItems.push({ label: `${kpiData.attentionCount} stage(s) need attention`, href: '#' });
  }

  const hasAttention = attentionItems.length > 0;

  // ── Workflow scroll controls ──
  const scrollWorkflow = (dir: 'left' | 'right') => {
    const el = workflowRef.current;
    if (!el) return;
    const amount = 180;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col gap-5 pt-0 px-4 pb-4 sm:pt-0 sm:px-5 sm:pb-5 w-full box-border">

      {/* ═══════════════════════════════════════ */}
      {/* ROW 1 — KPI METRIC TILES              */}
      {/* ═══════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile icon={TrendingUp} label="Progress" value={`${kpiData?.percent ?? 0}%`} accent="info" />
        <MetricTile icon={Check} label="Stages Completed" value={kpiData?.completedCount ?? 0} accent="success" />
        {kpiData?.hasAttention ? (
          <MetricTile icon={AlertCircle} label="Attention Required" value={kpiData.attentionCount} accent="danger" />
        ) : (
          <MetricTile icon={Check} label="Attention Required" value={0} accent="muted" />
        )}
        <MetricTile icon={Clock} label="Days in Stage" value={kpiData?.daysInStage ?? 0} accent="muted" />
        <MetricTile
          icon={DollarSign}
          label="Outstanding"
          value={projectValue > 0 ? `₹${outstandingAmount.toLocaleString('en-IN')}` : '—'}
          accent={outstandingAmount > 0 ? 'danger' : 'success'}
        />
        <MetricTile
          icon={CreditCard}
          label="Payments"
          value={totalPayments > 0 ? `₹${totalPayments.toLocaleString('en-IN')}` : '—'}
          accent={totalPayments > 0 ? 'success' : 'muted'}
        />
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* ROW 2 — 3-COLUMN EQUAL-HEIGHT GRID           */}
      {/* ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_3fr_1fr] gap-4">

        {/* ── COLUMN 1: Project Details + Team ── */}
        <div className="flex flex-col gap-4">

          {/* Project Details */}
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3.5 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              Project Details
            </h3>
            <div className="mt-2.5 space-y-2">
              {[
                ['Customer',
                  <button
                    key="customer"
                    onClick={() => navigate(`/customers/${encodeURIComponent(project.customerId)}`)}
                    className="text-xs font-semibold text-[var(--color-primary-text)] hover:underline text-right truncate max-w-[140px]"
                  >
                    {customerValue(customer, ['name', 'fullName', 'company', 'companyName']) || project.customerId}
                  </button>
                ],
                ['Capacity', `${project.capacityKw ? `${project.capacityKw} kW` : '—'}`],
                ['Location', [project.siteAddress?.city, project.siteAddress?.state].filter(Boolean).join(', ') || '—'],
                ['Value', projectValue > 0 ? `₹${projectValue.toLocaleString('en-IN')}` : '—'],
                ['Created', fmtDate(project.createdAt)],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[var(--color-text-muted)]">{String(label)}</span>
                  {typeof value === 'string' ? (
                    <span className="max-w-[140px] truncate text-right text-xs font-medium text-[var(--color-text)]">{value}</span>
                  ) : value}
                </div>
              ))}
            </div>
          </div>

          {/* Team + Contact Actions */}
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3.5 shadow-sm">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              <UserRound className="h-3 w-3" />Team
            </h3>
            <div className="mt-2.5 space-y-1.5">
              {[
                ['Sales Owner', project.salesOwner],
                ['Project Manager', project.assignedSurveyor],
                ['Installer', project.assignedInstaller],
              ].filter(([, person]) => person).map(([label, person]) => (
                <div key={String(label)} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-bg-sunken)] px-2.5 py-1.5">
                  <span className="text-xs text-[var(--color-text-muted)]">{String(label)}</span>
                  <span className="text-xs font-semibold text-[var(--color-text)]">{person}</span>
                </div>
              ))}
              {(!project.salesOwner && !project.assignedSurveyor && !project.assignedInstaller) && (
                <p className="text-xs text-[var(--color-text-muted)]">No team assigned yet.</p>
              )}
            </div>
            <div className="mt-3 flex gap-1.5">
              <a
                href={phone ? `tel:${phone}` : undefined}
                className={cn(
                  'inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)]',
                  !phone && 'pointer-events-none opacity-40',
                )}
              >
                <Phone className="h-3 w-3" />Call
              </a>
              <a
                href={whatsapp ? `https://wa.me/${whatsapp}` : undefined}
                target="_blank" rel="noreferrer"
                className={cn(
                  'inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)]',
                  !whatsapp && 'pointer-events-none opacity-40',
                )}
              >
                <MessageCircle className="h-3 w-3" />WhatsApp
              </a>
              <button
                type="button"
                disabled
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-40"
              >
                <Calendar className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {/* ── COLUMN 2: Single Stage Focus Card ── */}
        <div className="flex flex-col min-h-0">
          {(() => {
            const stage = allJourneyStages[focusedStageIdx];
            if (!stage) {
              return (
                <div className="rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-6 text-center">
                  <p className="text-xs text-[var(--color-text-muted)]">No stage data available.</p>
                </div>
              );
            }

            const StageIcon = stage.icon;
            const isCurrent = stage.status === 'current';
            const isCompleted = stage.status === 'completed';
            const colors = STATUS_COLORS[stage.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.upcoming;
            const hasPrev = focusedStageIdx > 0;
            const hasNext = focusedStageIdx < allJourneyStages.length - 1;

            // Days in this specific stage
            const stageDays = project.stageHistory && stage.projectStage
              ? (() => {
                  const entry = [...project.stageHistory].reverse().find((h) => h.stage === stage.projectStage);
                  if (entry?.changedAt) {
                    const d = new Date(entry.changedAt);
                    return Math.floor((Date.now() - d.getTime()) / 86400000);
                  }
                  return 0;
                })()
              : 0;

            // ── Stage-specific 2-column metadata grid ──
            const stageMeta = (() => {
              const id = stage.id;

              // Survey / Engineering
              if (['survey', 'engineering'].includes(id)) {
                return (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <MetaRow label="System Capacity" value={project.capacityKw ? `${project.capacityKw} kW` : '—'} />
                    <MetaRow label="Assigned Engineer" value={project.assignedSurveyor || '—'} />
                    <MetaRow label="Design Status" value={isCompleted ? 'Completed' : isCurrent ? 'In Progress' : 'Pending'} />
                    <MetaRow label="Linked Designs" value={String(linked.engineeringDesigns?.length || 0)} />
                  </div>
                );
              }

              // Quotation / Order
              if (['quotation', 'order'].includes(id)) {
                const order = linked.orders[0] as any;
                return (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <MetaRow label="Project Value" value={projectValue > 0 ? `₹${projectValue.toLocaleString('en-IN')}` : '—'} />
                    <MetaRow
                      label="Outstanding"
                      value={outstandingAmount > 0 ? `₹${outstandingAmount.toLocaleString('en-IN')}` : '₹0'}
                      accent={outstandingAmount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}
                    />
                    {order && (
                      <MetaRow label="Order ID" value={<span className="text-xs font-mono font-semibold text-[var(--color-text)] truncate">{order.id || '—'}</span>} />
                    )}
                    <MetaRow label="Quotations" value={String(linked.quotations.length)} />
                  </div>
                );
              }

              // Net-Metering / Subsidy
              if (['net-metering', 'subsidy'].includes(id)) {
                const apps = id === 'net-metering' ? linked.netMeteringApplications : linked.subsidyApplications;
                const app = apps[0] as any;
                return (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <MetaRow label="Applications" value={String(apps.length)} />
                    {app ? (
                      <>
                        <MetaRow
                          label="Status"
                          value={
                            <Badge variant={app.status === 'Approved' ? 'success' : app.status === 'Pending' ? 'warning' : 'default'} className="text-[9px] px-1.5">
                              {app.status || 'N/A'}
                            </Badge>
                          }
                        />
                        <MetaRow label="App. Date" value={fmtDate(app.createdAt || app.applicationDate)} />
                        {id === 'net-metering' && app.consumerNumber && (
                          <MetaRow label="Consumer No." value={app.consumerNumber} />
                        )}
                        {id === 'subsidy' && app.schemeType && (
                          <MetaRow label="Scheme Type" value={app.schemeType} />
                        )}
                      </>
                    ) : (
                      <MetaRow label="Status" value="Not started" />
                    )}
                  </div>
                );
              }

              // Dispatch / Procurement
              if (['dispatch', 'procurement'].includes(id)) {
                const items = id === 'dispatch' ? linked.dispatches : linked.purchaseOrders;
                return (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <MetaRow label="Total Records" value={String(items.length)} />
                    <MetaRow label="Latest" value={items.length > 0 ? fmtDate((items[0] as any)?.createdAt) : '—'} />
                    {items.length > 0 && (
                      <>
                        <MetaRow label="Status" value={(items[0] as any)?.status || 'In Progress'} />
                        <MetaRow
                          label="Open"
                          value={
                            <button
                              type="button"
                              onClick={() => navigate(id === 'dispatch' ? '/dispatch' : '/purchase-orders')}
                              className="text-xs font-semibold text-[var(--color-primary-text)] hover:underline text-left"
                            >
                              View all &rarr;
                            </button>
                          }
                        />
                      </>
                    )}
                  </div>
                );
              }

              // Installation / QC / Commissioning
              if (['installation', 'qc', 'commissioning'].includes(id)) {
                const records = id === 'installation' ? linked.installations
                  : id === 'qc' ? linked.qcChecks
                  : linked.commissioningRecords;
                const completed = records.filter((r: any) => r.status === 'completed' || r.status === 'passed');
                return (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    <MetaRow label="Total" value={String(records.length)} />
                    <MetaRow label="Completed" value={String(completed.length)} />
                    {records.length > 0 && (
                      <MetaRow label="Latest" value={fmtDate((records[records.length - 1] as any)?.createdAt)} />
                    )}
                    <MetaRow
                      label="Open"
                      value={
                        <button
                          type="button"
                          onClick={() => navigate(id === 'installation' ? '/installations' : id === 'qc' ? '/qc' : '/commissioning')}
                          className="text-xs font-semibold text-[var(--color-primary-text)] hover:underline text-left"
                        >
                          View &rarr;
                        </button>
                      }
                    />
                  </div>
                );
              }

              // Default: progress + capacity + date
              return (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <MetaRow label="Progress" value={`${kpiData?.percent ?? 0}%`} />
                  <MetaRow label="Capacity" value={project.capacityKw ? `${project.capacityKw} kW` : '—'} />
                  {stage.date && <MetaRow label="Stage Date" value={formatJourneyDate(stage.date)} />}
                  <MetaRow label="Status" value={isCurrent ? 'Active' : isCompleted ? 'Completed' : 'Pending'} />
                </div>
              );
            })();

            // Attention items specific to this stage
            const stageAttentionItems = isCurrent ? attentionItems : [];

            return (
              <div
                className={cn(
                  'relative flex flex-col rounded-xl border-2 shadow-sm transition-all duration-500',
                  carouselRevealed ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
                  isCurrent && hasAttention
                    ? 'border-amber-300/60 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/10'
                    : isCurrent
                      ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5'
                      : isCompleted
                        ? 'border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/30'
                        : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
                )}
              >
                {/* ── Accent bar ── */}
                <div className={cn(
                  'absolute left-0 right-0 top-0 h-1 rounded-t-xl',
                  isCurrent && hasAttention ? 'bg-amber-500' :
                  isCurrent ? 'bg-[var(--color-primary)]' :
                  isCompleted ? 'bg-emerald-400' :
                  'bg-[var(--color-border)]',
                )} />

                {/* ── Header bar: Stage name + Status + Time ── */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', colors.bg)}>
                      {StageIcon && <StageIcon className="h-3 w-3 text-white" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--color-text)] truncate">{stage.title}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">Stage {focusedStageIdx + 1} of {allJourneyStages.length}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isCurrent && kpiData && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">{kpiData.daysInStage}d in stage</span>
                    )}
                    {!isCurrent && stageDays > 0 && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">{stageDays}d</span>
                    )}
                    <Badge variant={
                      isCurrent ? 'info' :
                      isCompleted ? 'success' :
                      stage.status === 'attention' ? 'warning' :
                      stage.status === 'blocked' ? 'danger' : 'default'
                    } className="text-[9px] px-1.5">
                      {isCurrent ? 'Active' :
                       isCompleted ? 'Completed' :
                       stage.status === 'attention' ? 'Attention' :
                       stage.status === 'blocked' ? 'Blocked' :
                       'Pending'}
                    </Badge>
                  </div>
                </div>

                {/* ── Stage-specific rich content ── */}
                <div className="p-4 space-y-3">
                  <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    {stage.description}
                  </p>

                  {/* 2-column metadata grid */}
                  <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3">
                    {stageMeta}
                  </div>

                  {/* Current stage progress bar */}
                  {isCurrent && (
                    <div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
                        <div
                          className={cn('h-full rounded-full transition-all duration-700', (kpiData?.percent ?? 0) === 100 ? 'bg-emerald-500' : 'bg-[var(--color-primary)]')}
                          style={{ width: `${kpiData?.percent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Attention items for current stage */}
                  {stageAttentionItems.length > 0 && (
                    <div className="space-y-1">
                      {stageAttentionItems.map((item) => (
                        <button key={item.label} onClick={() => navigate(item.href)}
                          className="flex w-full items-center justify-between rounded-lg bg-amber-50/80 px-2.5 py-1.5 text-left text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-950/40">
                          <span className="flex items-center gap-1.5"><AlertCircle className="h-3 w-3" />{item.label}</span>
                          <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Bottom navigation: Prev | Open | Next ── */}
                <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] px-4 py-2.5">
                  <button
                    type="button"
                    onClick={goToPrevStage}
                    disabled={!hasPrev}
                    className={cn(
                      'inline-flex items-center gap-1 text-xs font-semibold transition-colors',
                      hasPrev
                        ? 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)]'
                        : 'text-[var(--color-border)] cursor-not-allowed',
                    )}
                  >
                    <ChevronLeft className="h-3 w-3" /> Previous
                  </button>

                  {stage.href && (
                    <button
                      type="button"
                      onClick={() => navigate(stage.href)}
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 text-xs font-semibold text-white transition-all hover:bg-[var(--color-primary)]/90 hover:shadow-md"
                    >
                      Open Workspace <ArrowRight className="h-3 w-3" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={goToNextStage}
                    disabled={!hasNext}
                    className={cn(
                      'inline-flex items-center gap-1 text-xs font-semibold transition-colors',
                      hasNext
                        ? 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)]'
                        : 'text-[var(--color-border)] cursor-not-allowed',
                    )}
                  >
                    Next <ChevronRight className="h-3 w-3" />
                  </button>
                </div>

                {/* ── Keyboard hint ── */}
                <div className="flex items-center justify-center border-t border-dashed border-[var(--color-border-subtle)] px-4 py-1.5">
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    Use <kbd className="mx-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-1 py-0.5 font-mono text-[9px]">←</kbd>{' '}
                    <kbd className="mx-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-1 py-0.5 font-mono text-[9px]">→</kbd>{' '}
                    arrow keys to navigate stages
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── COLUMN 3: Recent Activity + Tasks (stretched to match column height) ── */}
        <div className="flex flex-col gap-3 h-full">

          {/* Recent Activity */}
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3.5 shadow-sm flex-1">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              <Clock className="h-3 w-3" />Recent Activity
            </h3>
            <div className="mt-2.5 space-y-2">
              {(project.stageHistory || []).slice(-2).reverse().map((entry, i) => (
                <div key={`${entry.stage}-${i}`} className="flex items-start gap-2">
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[var(--color-text)]">{entry.stage}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {entry.changedBy || 'System'} · {fmtDate(entry.changedAt)}
                    </p>
                  </div>
                </div>
              ))}
              {(!project.stageHistory || project.stageHistory.length === 0) && (
                <p className="text-xs text-[var(--color-text-muted)]">No recent activity.</p>
              )}
            </div>
          </div>

          {/* Tasks Overview */}
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3.5 shadow-sm flex-1">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              <ListTodo className="h-3 w-3" />Tasks Overview
            </h3>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Track project tasks, assignees, and deadlines.
            </p>
            <button
              type="button"
              onClick={() => {
                const base = window.location.pathname;
                navigate(`${base}?tab=tasks`);
              }}
              className="mt-2 inline-flex h-7 items-center gap-1 rounded-lg bg-[var(--color-primary)]/10 px-2.5 text-xs font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20"
            >
              View Tasks <ChevronRight className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════ */}
      {/* ROW 3 — PREMIUM BUSINESS WORKFLOW (full-width)     */}
      {/* Unified dots + cards, glassmorphism, active glow   */}
      {/* ════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-sm w-full box-border overflow-hidden group/workflow">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]/80 backdrop-blur-sm px-4 py-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
            Project Lifecycle
          </h3>
          <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
            {kpiData ? `${kpiData.completedCount}/${kpiData.completedCount + kpiData.remainingCount + allJourneyStages.filter((s: any) => s.status === 'current').length} · ${kpiData.percent}%` : ''}
          </span>
        </div>

        <div className="relative p-4 sm:p-5">
          {/* Scroll container — both dots + cards scroll together */}
          <div className="relative">
            {/* Scroll gradient masks */}
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[var(--color-surface)] via-[var(--color-surface)]/90 to-transparent opacity-0 transition-opacity group-hover/workflow:opacity-100" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[var(--color-surface)] via-[var(--color-surface)]/90 to-transparent opacity-0 transition-opacity group-hover/workflow:opacity-100" />

            {/* Inline scroll button — left */}
            <button
              type="button"
              onClick={() => scrollWorkflow('left')}
              className="absolute left-0 top-[40%] z-20 -translate-x-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-text-muted)] shadow-md backdrop-blur-sm opacity-0 transition-all duration-200 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] hover:shadow-lg group-hover/workflow:opacity-100"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {/* Single scrollable track */}
            <div
              ref={workflowRef}
              className="flex items-stretch gap-3 overflow-x-auto pb-1 scroll-smooth"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {allJourneyStages.map((stage: any, idx: number) => {
                const isLast = idx === allJourneyStages.length - 1;
                const colors = STATUS_COLORS[stage.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.upcoming;
                const StageIcon = stage.icon;
                const isCurrent = stage.status === 'current';

                return (
                  <div key={stage.id} className="flex flex-col items-center shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    {/* Dots + connector */}
                    <div className="flex items-center mb-2">
                      <button
                        type="button"
                        onClick={() => setFocusedStageIdx(idx)}
                        data-active={isCurrent ? 'true' : 'false'}
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-500',
                          stage.status === 'completed' && colors.bg,
                          isCurrent && cn(colors.bg, 'h-8 w-8 ring-[3px] ring-[var(--color-primary)]/25 shadow-lg shadow-[var(--color-primary)]/10 motion-safe:animate-pulse'),
                          stage.status === 'upcoming' && 'border-2 border-[var(--color-border)] bg-[var(--color-bg-sunken)]',
                          (stage.status === 'attention' || stage.status === 'blocked') && colors.bg,
                          focusedStageIdx === idx && 'ring-2 ring-[var(--color-primary)]/40',
                          focusedStageIdx !== idx && 'hover:scale-110 cursor-pointer',
                        )}
                        title={`${stage.title}: ${stage.status}`}
                        aria-label={`View ${stage.title} stage`}
                      >
                        {stage.status === 'completed' && <Check className="h-3 w-3 text-white" />}
                        {isCurrent && <div className="h-2.5 w-2.5 rounded-full bg-white" />}
                      </button>
                      {!isLast && (
                        <div className={cn(
                          'h-0.5 w-10 sm:w-14 transition-all duration-500',
                          stage.status === 'completed' ? 'bg-emerald-400' :
                          isCurrent ? 'bg-gradient-to-r from-emerald-400/80 to-[var(--color-border)]' :
                          'bg-[var(--color-border)]',
                        )} />
                      )}
                    </div>

                    {/* Mini stage card */}
                    <div
                      className={cn(
                        'flex w-[148px] shrink-0 flex-col gap-2 rounded-xl border p-3 motion-safe:transition-all motion-safe:duration-300',
                        focusedStageIdx === idx
                          ? 'border-[var(--color-primary)]/30 bg-gradient-to-b from-[var(--color-primary)]/[0.07] to-[var(--color-primary)]/[0.03] shadow-md shadow-[var(--color-primary)]/5 backdrop-blur-sm'
                          : stage.status === 'completed'
                            ? 'border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-900/30 dark:bg-emerald-950/10'
                            : stage.status === 'attention'
                              ? 'border-amber-200/80 bg-amber-50/60'
                              : stage.status === 'blocked'
                                ? 'border-red-200/80 bg-red-50/60'
                                : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]/80',
                        'hover:-translate-y-1 hover:shadow-lg cursor-pointer',
                      )}
                      onClick={() => setFocusedStageIdx(idx)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-center justify-between">
                        <div className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full transition-all',
                          isCurrent && 'motion-safe:animate-pulse ring-2 ring-[var(--color-primary)]/20',
                          colors.bg,
                        )}>
                          {StageIcon && <StageIcon className="h-3.5 w-3.5 text-white" />}
                        </div>
                        <Badge variant={
                        focusedStageIdx === idx ? 'info' :
                        stage.status === 'completed' ? 'success' :
                        stage.status === 'current' ? 'info' :
                        stage.status === 'attention' ? 'warning' :
                        stage.status === 'blocked' ? 'danger' : 'default'
                      } className="text-[9px] px-1.5 py-0">
                        {focusedStageIdx === idx ? 'Viewing' :
                         stage.status === 'completed' ? 'Done' :
                         isCurrent ? 'Now' :
                         stage.status === 'attention' ? '!' :
                         stage.status === 'blocked' ? '!' :
                         ''}
                      </Badge>
                      </div>
                      <div className="min-w-0">
                        <p className={cn(
                          'text-xs font-bold truncate',
                          stage.status === 'upcoming' ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]',
                        )}>
                          {stage.title}
                        </p>
                        {stage.date && (
                          <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                            {formatJourneyDate(stage.date)}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inline scroll button — right */}
            <button
              type="button"
              onClick={() => scrollWorkflow('right')}
              className="absolute right-0 top-[40%] z-20 translate-x-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-text-muted)] shadow-md backdrop-blur-sm opacity-0 transition-all duration-200 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] hover:shadow-lg group-hover/workflow:opacity-100"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectOverview;
