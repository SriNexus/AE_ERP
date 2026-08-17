import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArrowLeft, ArrowRight, ChevronRight, Edit2, MapPin, MessageCircle, Phone, UserRound, Clock, Calendar, TrendingUp, Check, CreditCard, AlertCircle, Circle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { useProjects, useSaveProject, useArchiveProject } from '../../../features/projects/hooks/useProjects';
import { projectCapacityLabel, projectCustomerLabel, projectSiteAddressSummary, projectStageLabel } from '../../../features/projects/utils/projectDisplay';
import { useProjectStage } from '../../../hooks/useProjectStage';
import { MetricTile } from '../../projects/ProjectJourneyTimeline';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, getOne } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { useContextResolver } from '../context/ContextResolver';
import { StageTimeline } from '../../shared';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';
import { Badge, Button, Card, Modal, ConfirmDialog } from '../../ui';
import { cn } from '../../../utils/cn';
import { ProjectForm } from '../../../features/projects/components/ProjectForm';
import type { ProjectFormValues, ProjectRecord } from '../../../features/projects/types';
import { PROJECT_FORM_DEFAULT } from '../../../features/projects/types';
import {
  useSchemeRegistrations,
  useTransitionSchemeRegistration,
} from '../../../features/scheme-registration/hooks/useSchemeRegistrations';
import { isPartnerSideTransition, SCHEME_REGISTRATION_TRANSITIONS } from '../../../features/scheme-registration/types';
import type { SchemeRegistrationRecord, SchemeRegistrationStatus } from '../../../features/scheme-registration/types';
import {
  RegistrationRequiredDocuments,
  RegistrationTimeline,
  SchemeRegistrationStatusBadge,
  schemeRegistrationStatusLabel,
} from '../../../features/scheme-registration/components/registrationShared';

function customerValue(customer: Record<string, unknown> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = String(customer?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function toDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return (value as any).toDate();
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    return new Date(Number((value as any).seconds) * 1000);
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fmtDate(value: unknown) {
  const date = toDateValue(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(value: unknown) {
  const date = toDateValue(value);
  if (!date) return '—';
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type RelatedShortcut = {
  label: string;
  module: 'quotations' | 'orders' | 'dispatch' | 'purchase_orders' | 'qc' | 'commissioning' | 'net_metering' | 'subsidy' | 'handovers' | 'amc-contracts' | 'service_tickets' | 'monitoring';
  path: string;
  count: number;
};

export function MobileProjectWorkspace() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const { setEntityId } = useContextResolver();

  // Data queries
  const { data: projects = [], isLoading } = useProjects();
  const project = useMemo(() => projects.find((entry) => entry.id === id || entry.projectId === id) || null, [projects, id]);
  const customerQuery = useQuery({
    queryKey: [...keys.customersRoot, 'mobile-project', project?.customerId],
    queryFn: () => getOne<Record<string, unknown>>(COLLECTIONS.CUSTOMERS, project!.customerId),
    enabled: Boolean(project?.customerId),
    staleTime: 60_000,
  });

  // Stage lifecycle
  const lifecycle = useProjectStage(project);
  const mobileStages = lifecycle.stages.map((stage) => stage);

  // Permissions
  const permissions = usePermissions();

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormValues>({ ...PROJECT_FORM_DEFAULT });

  // Archive state
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Customer data for edit form
  const { data: customers = [] } = useQuery({
    queryKey: keys.customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  // Mutations
  const updateProject = useSaveProject(project?.id || null, () => {
    setEditOpen(false);
    setEditForm({ ...PROJECT_FORM_DEFAULT });
  });
  const archiveProject = useArchiveProject(() => {
    setArchiveOpen(false);
  });

  // Track entity in ContextResolver
  useEffect(() => {
    if (project) {
      setEntityId(project.id);
      return () => setEntityId(null);
    }
  }, [project, setEntityId]);

  const customer = customerQuery.data;
  const customerName = customer ? projectCustomerLabel(customer) : (project?.customerId || '—');
  const phone = customerValue(customer, ['phone', 'mobile', 'businessPhone']);
  const whatsapp = phone.replace(/\D/g, '');

  // Related shortcuts — expanded to match Desktop stage links
  const shortcuts: RelatedShortcut[] = useMemo(() => {
    if (!project) return [];
    return [
      { label: 'Quotations', module: 'quotations' as const,
        path: `/quotations?projectId=${encodeURIComponent(project.id)}${project.linkedQuotationIds?.[0] ? `&open=${encodeURIComponent(project.linkedQuotationIds[0])}` : ''}`,
        count: project.linkedQuotationIds?.length || 0 },
      { label: 'Orders', module: 'orders' as const,
        path: `/orders?projectId=${encodeURIComponent(project.id)}${project.linkedOrderIds?.[0] ? `&open=${encodeURIComponent(project.linkedOrderIds[0])}` : ''}`,
        count: project.linkedOrderIds?.length || 0 },
      { label: 'Dispatch', module: 'dispatch' as const,
        path: `/dispatch?projectId=${encodeURIComponent(project.id)}${project.linkedDispatchIds?.[0] ? `&open=${encodeURIComponent(project.linkedDispatchIds[0])}` : ''}`,
        count: project.linkedDispatchIds?.length || 0 },
    ].filter((s) => permissions.canView(s.module));
  }, [project, permissions]);

  // Timeline entries from stage history
  const timelineEntries = useMemo(() => {
    if (!project?.stageHistory) return [];
    return project.stageHistory.map((entry) => ({
      id: `${entry.stage}-${entry.changedAt}`,
      type: 'Stage Change' as const,
      description: `Stage changed to ${projectStageLabel(entry.stage)}`,
      date: entry.changedAt,
      userName: entry.changedBy || 'System',
    }));
  }, [project]);

  // Open edit form
  function openEdit() {
    if (!project) return;
    setEditForm({
      customerId: project.customerId || '',
      leadId: project.leadId || '',
      capacityKw: String(project.capacityKw ?? ''),
      projectType: project.projectType || '',
      salesOwner: project.salesOwner || '',
      assignedSurveyor: project.assignedSurveyor || '',
      assignedInstaller: project.assignedInstaller || '',
      notes: project.notes || '',
      siteAddress: {
        line1: project.siteAddress?.line1 || '',
        line2: project.siteAddress?.line2 || '',
        landmark: project.siteAddress?.landmark || '',
        city: project.siteAddress?.city || '',
        district: project.siteAddress?.district || '',
        state: project.siteAddress?.state || '',
        pincode: project.siteAddress?.pincode || '',
        country: project.siteAddress?.country || 'India',
      },
    });
    setEditOpen(true);
  }

  function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (updateProject.isPending) return;
    updateProject.mutate(editForm);
  }

  // Loading state
  if (isLoading) return <div className="h-80 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />;

  // Not found state
  if (!project) {
    return (
      <Card className="rounded-xl p-6 text-center">
        <p className="text-sm font-semibold text-[var(--color-text)]">Project not found</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">It may be outside your assigned project scope.</p>
        <Button className="mt-4" variant="outline" size="sm" onClick={() => navigate('/projects')}>Back to Projects</Button>
      </Card>
    );
  }

  const isArchived = project.currentStage === 'Archived';

  const totalStages = lifecycle.stages.length;
  const completedCount = lifecycle.completedCount;
  const progressPct = totalStages > 0 ? Math.round((completedCount / totalStages) * 100) : 0;
  const daysFromCreated = project.createdAt ? Math.floor((Date.now() - new Date(project.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0;
  const linkedCount = (project.linkedQuotationIds?.length || 0) + (project.linkedOrderIds?.length || 0) + (project.linkedDispatchIds?.length || 0);

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <header className="flex items-start gap-3">
        <button
          type="button"
          aria-label="Back to projects"
          onClick={() => navigate('/projects')}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-semibold text-[var(--color-text-muted)]">
            {project.projectId || project.id}
          </p>
          <h1 className="mt-1 truncate text-lg font-bold text-[var(--color-text)]">{customerName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="info">{projectStageLabel(project.currentStage)}</Badge>
            {project.leadId && <Badge variant="default">Lead Linked</Badge>}
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex shrink-0 gap-1">
          {permissions.canEdit('projects') && (
            <button
              type="button"
              onClick={openEdit}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
              aria-label="Edit project"
            >
              <Edit2 className="h-4 w-4" />
            </button>
          )}
          {permissions.canEdit('projects') && !isArchived && (
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]"
              aria-label="Archive project"
            >
              <Archive className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* KPI Row — mobile-optimized compact MetricTiles */}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile icon={TrendingUp} label="Progress" value={`${progressPct}%`} accent="info" />
        <MetricTile icon={Check} label="Stages Done" value={`${completedCount}/${totalStages}`} accent="success" />
        <MetricTile icon={Clock} label="Days Active" value={daysFromCreated} accent="muted" />
        <MetricTile icon={CreditCard} label="Linked Records" value={linkedCount} accent={linkedCount > 0 ? 'info' : 'muted'} />
      </div>

      {/* Info Card */}
      <Card className="rounded-xl p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Capacity</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{projectCapacityLabel(project.capacityKw)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Current stage</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{projectStageLabel(project.currentStage)}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project type</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{project.projectType || '—'}</p>
          </div>
        </div>
        <div className="mt-2 flex gap-4 text-[10px] text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Created {fmtDate(project.createdAt)}
          </span>
          {project.updatedAt && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Updated {fmtDate(project.updatedAt)}
            </span>
          )}
        </div>
        <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            <MapPin className="h-3 w-3" /> Site
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {projectSiteAddressSummary(project.siteAddress)}
          </p>
        </div>
      </Card>

      {/* Contact Actions */}
      <div className="grid grid-cols-2 gap-2">
        <a
          href={phone ? `tel:${phone}` : undefined}
          aria-disabled={!phone}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text)] ${phone ? '' : 'pointer-events-none opacity-50'}`}
        >
          <Phone className="h-4 w-4" />Call
        </a>
        <a
          href={whatsapp ? `https://wa.me/${whatsapp}` : undefined}
          target="_blank" rel="noreferrer"
          aria-disabled={!whatsapp}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text)] ${whatsapp ? '' : 'pointer-events-none opacity-50'}`}
        >
          <MessageCircle className="h-4 w-4" />WhatsApp
        </a>
      </div>

      {/* Assigned Personnel */}
      <Card className="rounded-xl p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
          <UserRound className="h-4 w-4" />Assigned personnel
        </h2>
        <div className="mt-3 space-y-2 text-sm">
          {[['Sales owner', project.salesOwner], ['Surveyor', project.assignedSurveyor], ['Installer', project.assignedInstaller]].map(([label, person]) => (
            <div key={label} className="flex justify-between gap-3">
              <span className="text-[var(--color-text-muted)]">{label}</span>
              <span className="truncate font-semibold text-[var(--color-text)]">{person || 'Unassigned'}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Stage Focus: Last, Current, Next ── */}
      {(() => {
        const journeyStages = lifecycle.stages;
        const currentIdx = journeyStages.findIndex((s: any) => s.status === 'current');
        const last = currentIdx > 0 ? journeyStages[currentIdx - 1] : null;
        const curr = currentIdx >= 0 ? journeyStages[currentIdx] : null;
        const next = currentIdx >= 0 && currentIdx < journeyStages.length - 1 ? journeyStages[currentIdx + 1] : null;

        return (
          <>
            {/* Last Stage */}
            <Card className="rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Last Stage</p>
                    <p className="text-xs font-bold text-[var(--color-text)]">{last ? last.title : '—'}</p>
                  </div>
                </div>
                {last && last.href && (
                  <button onClick={() => navigate(last.href!)} className="inline-flex items-center gap-0.5 rounded-lg bg-[var(--color-bg-sunken)] px-2 py-1 text-[9px] font-semibold text-[var(--color-primary)]">
                    Open <ChevronRight className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
              {!last && <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">First stage — no previous stage completed yet.</p>}
            </Card>

            {/* Current Stage (Highlight) */}
            <Card className={cn(
              'rounded-xl border-2 p-4',
              'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5',
            )}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="rounded-md bg-[var(--color-primary)]/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[var(--color-primary)]">Current Stage</span>
                  <h3 className="mt-1.5 text-base font-bold text-[var(--color-text)]">{curr?.title || project.currentStage}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-secondary)]">
                    {project.salesOwner && <span>{project.salesOwner}</span>}
                    <span>{progressPct}% complete</span>
                    <span>{totalStages} stages</span>
                  </div>
                  {/* Mini progress bar */}
                  <div className="mt-2 h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-[var(--color-bg-sunken)]">
                    <div className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-700" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
                {curr && curr.href && (
                  <button onClick={() => navigate(curr.href!)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--color-primary)] px-3 text-[11px] font-semibold text-white">
                    Open <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </Card>

            {/* Next Stage */}
            <Card className="rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--color-border)] bg-[var(--color-bg-sunken)]">
                    <Circle className="h-2.5 w-2.5 text-[var(--color-text-muted)]" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Next Stage</p>
                    <p className="text-xs font-bold text-[var(--color-text)]">{next ? next.title : '—'}</p>
                  </div>
                </div>
                {next?.status === 'blocked' && <AlertCircle className="h-4 w-4 text-red-500" />}
              </div>
              {next && (
                <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-text-secondary)]">{next.description}</p>
              )}
              {!next && <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">Final stage — no upcoming stages.</p>}
            </Card>
          </>
        );
      })()}

      {/* Unified Workflow — vertical timeline at bottom */}
      <section>
        <h2 className="mb-2 px-1 text-sm font-bold text-[var(--color-text)]">Project Journey</h2>
        <StageTimeline stages={mobileStages} activeStageId={lifecycle.activeStageId} orientation="vertical" />
      </section>

      {/* Registration (Vendor Lock / Scheme) — Phase 6/7. Reuses the SAME
          hooks/services/types as desktop — no mobile business logic. */}
      <RegistrationMobileCard project={project} />

      {/* Stage History — latest 2 entries */}
      {project.stageHistory && project.stageHistory.length > 0 && (
        <Card className="rounded-xl p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
            <Clock className="h-4 w-4" />Stage History
          </h2>
          <div className="mt-3 space-y-3">
            {project.stageHistory.slice(-2).reverse().map((entry, index) => (
              <div key={`${entry.stage}-${index}`} className="flex gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{projectStageLabel(entry.stage)}</p>
                    <time className="whitespace-nowrap text-[10px] text-[var(--color-text-muted)]">{fmtDateTime(entry.changedAt)}</time>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{entry.note || 'Stage change recorded'}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">{entry.changedBy || 'System'}</p>
                </div>
              </div>
            ))}
            {project.stageHistory.length > 2 && (
              <button
                type="button"
                className="w-full text-center text-xs font-medium text-[var(--color-primary)] hover:underline"
                onClick={() => {/* View all — future expansion */}}
              >
                View all {project.stageHistory.length} entries
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Timeline Preview */}
      {timelineEntries.length > 0 && (
        <Card className="rounded-xl p-4">
          <MobileTimelinePreview
            entries={timelineEntries.slice(0, 2)}
          />
        </Card>
      )}

      {/* Related Work */}
      {shortcuts.length > 0 && (
        <Card className="rounded-xl p-4">
          <h2 className="text-sm font-bold text-[var(--color-text)]">Related work</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                onClick={() => navigate(shortcut.path)}
                className="min-h-16 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-2 text-center"
              >
                <span className="block text-base font-bold text-[var(--color-text)]">{shortcut.count}</span>
                <span className="mt-1 block text-[10px] font-semibold text-[var(--color-text-muted)]">{shortcut.label}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Edit Modal */}
      {editOpen && (
        <Modal
          open={editOpen}
          onClose={() => { setEditOpen(false); setEditForm({ ...PROJECT_FORM_DEFAULT }); }}
          title="Edit Project"
          size="full"
        >
          <ProjectForm
            form={editForm}
            onChange={setEditForm}
            onSubmit={handleEditSubmit}
            onCancel={() => { setEditOpen(false); setEditForm({ ...PROJECT_FORM_DEFAULT }); }}
            customers={(customers as any[]).map((c) => ({ id: c.id, name: projectCustomerLabel(c) })).sort((a, b) => a.name.localeCompare(b.name))}
            loading={updateProject.isPending}
            isEdit={true}
          />
        </Modal>
      )}

      {/* Archive ConfirmDialog */}
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archiveProject.mutate({ projectId: project.id, reason: 'Archived from mobile workspace' })}
        loading={archiveProject.isPending}
        title="Archive Project"
        confirmLabel="Archive"
        message={`Archive ${project.projectId || project.id}? The project will move to the Archived stage.`}
      />
    </div>
  );
}

/** Mobile Registration (Vendor Lock / Scheme) stage card — reuses the SAME
 * hooks, service, types and validation as desktop (source of truth); only
 * the presentation is mobile-adapted. Shows status, portal fields, the
 * registration's own timeline, required documents (case-scoped upload) and
 * the partner-side status actions (submit / resubmit / retry / cancel).
 * Staff approval workflows stay on the desktop project workspace. */
function RegistrationMobileCard({ project }: { project: any }) {
  const { data: registrations = [] } = useSchemeRegistrations();
  const perms = usePermissions();
  const transitionMutation = useTransitionSchemeRegistration();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [applicationNumber, setApplicationNumber] = useState('');
  const [portalReference, setPortalReference] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');

  const record = useMemo(
    () => (registrations as SchemeRegistrationRecord[])
      .filter((r) => r.projectId === project?.id && !r.isDeleted)
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0],
    [registrations, project?.id],
  );

  if (!project || !record) return null;

  const nextStatuses = SCHEME_REGISTRATION_TRANSITIONS[record.status] || [];
  // Partner actions are filtered by the canonical transition PAIRS — a
  // partner can never cancel a Rejected/Failed record, only resubmit/retry.
  const partnerActions = nextStatuses.filter((s) => isPartnerSideTransition(record.status, s));
  const canEdit = perms.canEdit('scheme_registration');

  function act(next: SchemeRegistrationStatus, options: Record<string, unknown> = {}) {
    if (transitionMutation.isPending) return;
    transitionMutation.mutate({ id: record.id, status: next, options: options as any });
  }

  return (
    <section className="mt-3">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[var(--color-text)]">Registration</h2>
          <SchemeRegistrationStatusBadge status={record.status} />
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">#{record.registrationId}</p>

        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Vendor</p>
            <p className="truncate font-medium text-[var(--color-text)]">{record.vendorName || record.vendorId || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Portal Ref</p>
            <p className="truncate font-medium text-[var(--color-text)]">{record.applicationNumber || record.portalReference || '—'}</p>
          </div>
        </div>

        {record.rejectionReason && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-300">
            <p className="font-semibold">Rejected</p>
            <p>{record.rejectionReason}</p>
          </div>
        )}

        {/* Partner-side actions — same canonical transition service */}
        {partnerActions.length > 0 && canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            {partnerActions.map((next) => {
              if (next === 'Submitted') {
                return submitOpen ? (
                  <div key={next} className="w-full space-y-2">
                    <input
                      type="text"
                      value={applicationNumber}
                      onChange={(e) => setApplicationNumber(e.target.value)}
                      placeholder="Application number"
                      className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                    />
                    <input
                      type="text"
                      value={portalReference}
                      onChange={(e) => setPortalReference(e.target.value)}
                      placeholder="Portal reference"
                      className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        loading={transitionMutation.isPending}
                        onClick={() => { act('Submitted', { applicationNumber: applicationNumber.trim() || undefined, portalReference: portalReference.trim() || undefined }); setSubmitOpen(false); }}
                      >
                        Confirm Submit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button key={next} size="sm" onClick={() => setSubmitOpen(true)}>
                    {record.status === 'Rejected' ? 'Resubmit' : record.status === 'Failed' ? 'Retry & Submit' : 'Submit for Verification'}
                  </Button>
                );
              }
              if (next === 'Cancelled') {
                return cancelOpen ? (
                  <div key={next} className="w-full space-y-2">
                    <input
                      type="text"
                      value={cancelNote}
                      onChange={(e) => setCancelNote(e.target.value)}
                      placeholder="Cancellation note *"
                      className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-300 dark:border-red-700"
                        loading={transitionMutation.isPending}
                        onClick={() => { if (cancelNote.trim()) { act('Cancelled', { note: cancelNote.trim() }); setCancelOpen(false); setCancelNote(''); } }}
                      >
                        Confirm Cancel
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
                    </div>
                  </div>
                ) : (
                  <Button key={next} size="sm" variant="outline" onClick={() => setCancelOpen(true)}>Cancel Registration</Button>
                );
              }
              return (
                <Button key={next} size="sm" variant="secondary" loading={transitionMutation.isPending} onClick={() => act(next)}>
                  Retry (Fresh Draft)
                </Button>
              );
            })}
          </div>
        )}

        {/* Next action hint */}
        {record.status === 'Draft' && (
          <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">Next: submit the registration with the application number / portal reference and required documents.</p>
        )}
        {record.status === 'Rejected' && (
          <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">Next: correct the issues and resubmit.</p>
        )}
        {(record.status === 'VendorLocked' || record.status === 'Completed') && (
          <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400">Registration {schemeRegistrationStatusLabel(record.status).toLowerCase()} — a Survey can now be scheduled.</p>
        )}

        {/* Required documents — shared checklist + case-scoped upload */}
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Required Documents</p>
          <RegistrationRequiredDocuments registration={record} project={project} />
        </div>

        {/* Registration's own timeline */}
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status Timeline</p>
          <RegistrationTimeline history={record.statusHistory} />
        </div>
      </div>
    </section>
  );
}
