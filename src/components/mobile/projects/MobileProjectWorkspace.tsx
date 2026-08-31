/**
 * MobileProjectWorkspace — the mobile `/projects/:id` screen.
 *
 * Finalized to the Neozy workspace standard (Lead / Customer Details are the
 * visual + responsive source of truth): a true full-screen operating screen
 * — fixed header, ONE scrolling body, fixed footer — with MobileShell hiding
 * its own top bar / bottom nav for this route (isFullScreenRoute).
 *
 * Most important: this is NOT a 14-stage list. Mobile is a continuous
 * "complete the current stage → advance → complete the next → …" journey.
 * The body renders ONLY the project's CURRENT stage — its real operational
 * workspace, the exact same STAGE_WORKSPACES component desktop mounts, via
 * <ProjectWorkOnThisProject currentStageOnly /> — plus the shared Documents /
 * Activity / Notes / Linked Records sections. Completing a stage advances
 * the project through the existing stage engine and the next stage's
 * workspace appears automatically; the final stage resolves to the existing
 * "Project Completed" state. No mobile-only business logic, no stage picker.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Edit2, MapPin, MessageCircle, Phone } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { useProjects, useSaveProject, useArchiveProject } from '../../../features/projects/hooks/useProjects';
import { projectCapacityLabel, projectCustomerLabel, projectSiteAddressSummary, projectStageLabel } from '../../../features/projects/utils/projectDisplay';
import { useProjectStage } from '../../../hooks/useProjectStage';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, getOne } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { useContextResolver } from '../context/ContextResolver';
import { Badge, Button, Card, Modal, ConfirmDialog } from '../../ui';
import { cn } from '../../../utils/cn';
import { CollapsedRow } from '../../shared/WorkspaceSectionCards';
import ProjectWorkOnThisProject from '../../../features/projects/components/workspace/ProjectWorkOnThisProject';
import ProjectWorkspaceSections from '../../../features/projects/components/workspace/ProjectWorkspaceSections';
import { ProjectForm } from '../../../features/projects/components/ProjectForm';
import type { ProjectFormValues, ProjectRecord } from '../../../features/projects/types';
import { PROJECT_FORM_DEFAULT } from '../../../features/projects/types';

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

export function MobileProjectWorkspace() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const qc = useQueryClient();
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

  // Same 'users' query key the desktop Project Workspace + Customer editor use.
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    staleTime: 5 * 60_000,
  });
  const users = usersQuery.data || [];

  // Stage lifecycle
  const lifecycle = useProjectStage(project);

  // Permissions
  const permissions = usePermissions();

  // Edit / archive state
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormValues>({ ...PROJECT_FORM_DEFAULT });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [custInfoOpen, setCustInfoOpen] = useState(false);


  // Customer list for the edit form
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

  const customer = customerQuery.data as Record<string, unknown> | null | undefined;
  const customerName = customer ? projectCustomerLabel(customer) : (project?.customerId || '—');
  const phone = customerValue(customer, ['phone', 'mobile', 'businessPhone']);
  const whatsapp = phone.replace(/\D/g, '');

  // Customer information for the dedicated section
  const custPhone = customerValue(customer, ['phone', 'mobile', 'businessPhone']);
  const custEmail = customerValue(customer, ['email', 'businessEmail']);
  const custAddress = customerValue(customer, ['address']);
  const custCity = customerValue(customer, ['city']);
  const custState = customerValue(customer, ['state']);
  const custType = customerValue(customer, ['type']);
  const custCompany = customerValue(customer, ['company', 'companyName']);
  const custGst = customerValue(customer, ['gst']);

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
  if (isLoading) {
    return (
      <div className="h-full p-3">
        <div className="h-full animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
      </div>
    );
  }

  // Not found state
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Card className="rounded-xl p-6 text-center">
          <p className="text-sm font-semibold text-[var(--color-text)]">Project not found</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">It may be outside your assigned project scope.</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => navigate('/projects')}>Back to Projects</Button>
        </Card>
      </div>
    );
  }

  const isArchived = project.currentStage === 'Archived';
  const canEditProjects = permissions.canEdit('projects');
  const tabPermissions = {
    canView: true,
    canCreate: permissions.canCreate('projects'),
    canEdit: canEditProjects,
    canDelete: permissions.canDelete('projects'),
  };

  // Stage-engine numbers — all derived, never hard-coded.
  const totalStages = lifecycle.stages.length;
  const completedCount = lifecycle.completedCount;
  const allComplete = totalStages > 0 && completedCount >= totalStages;
  const curStageIdx = lifecycle.stages.findIndex((s) => s.status === 'current');
  const stagePosition = allComplete
    ? totalStages
    : (curStageIdx >= 0 ? curStageIdx + 1 : Math.min(completedCount + 1, totalStages || 1));
  const positionPct = totalStages ? Math.round((stagePosition / totalStages) * 100) : 0;
  const daysFromCreated = project.createdAt
    ? Math.floor((Date.now() - new Date(project.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const linkedCount = (project.linkedQuotationIds?.length || 0) + (project.linkedOrderIds?.length || 0) + (project.linkedDispatchIds?.length || 0);

  return (
    // Full-screen operating screen (matches the finalized Lead/Customer mobile
    // Details): fixed header, ONE scrolling body, fixed footer.
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)] p-2">
      {/* ── FIXED HEADER — base-less, matching Lead/Customer standard ── */}
      <header className="flex shrink-0 flex-col px-4 py-3">
        {/* Back arrow */}
        <button
          type="button"
          onClick={() => navigate('/projects')}
          className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          title="Back to Projects"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="text-[11px] font-semibold">Back</span>
        </button>

        {/* Identity row */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-sm font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)]">
            {(customerName || 'P')[0]?.toUpperCase() || 'P'}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="min-w-0 break-words text-base font-bold text-[var(--color-text)]">{customerName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="info">{projectStageLabel(project.currentStage)}</Badge>
              {isArchived && <Badge variant="default">Archived</Badge>}
              {project.leadId && <Badge variant="default">Lead Linked</Badge>}
            </div>
          </div>
        </div>
        {/* Actions row — Call button in its original position */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <a
            href={phone ? `tel:${phone}` : undefined}
            aria-disabled={!phone}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] shadow-sm',
              phone ? '' : 'pointer-events-none opacity-40',
            )}
          >
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
          <a
            href={whatsapp ? `https://wa.me/${whatsapp}` : undefined}
            target="_blank" rel="noreferrer"
            aria-disabled={!whatsapp}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] shadow-sm',
              whatsapp ? '' : 'pointer-events-none opacity-40',
            )}
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
          {canEditProjects && (
            <button
              type="button"
              onClick={openEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] shadow-sm"
            >
              <Edit2 className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
      </header>

      {/* ── ONE SCROLLING BODY ──────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1.5">
        {/* Project Information — collapsed by default. */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
          <CollapsedRow
            label="Project Information"
            icon={<MapPin className="h-3.5 w-3.5" />}
            open={infoOpen}
            onToggle={() => setInfoOpen((v) => !v)}
          >
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project ID</p>
                  <p className="mt-0.5 font-mono font-semibold text-[var(--color-text)]">{project.projectId || project.id}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Capacity</p>
                  <p className="mt-0.5 font-semibold text-[var(--color-text)]">{projectCapacityLabel(project.capacityKw)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project type</p>
                  <p className="mt-0.5 font-semibold text-[var(--color-text)]">{project.projectType || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Site</p>
                  <p className="mt-0.5 leading-relaxed text-[var(--color-text-secondary)]">{projectSiteAddressSummary(project.siteAddress)}</p>
                </div>
              </div>
              <div className="space-y-1.5 border-t border-[var(--color-border-subtle)] pt-2 text-[13px]">
                {([['Sales Owner', project.salesOwner], ['Surveyor', project.assignedSurveyor], ['Installer', project.assignedInstaller]] as const).map(([label, person]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-muted)]">{label}</span>
                    <span className="truncate font-semibold text-[var(--color-text)]">{person || 'Unassigned'}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Created {fmtDate(project.createdAt)}{project.updatedAt ? ` · Updated ${fmtDate(project.updatedAt)}` : ''} · {daysFromCreated}d active · {linkedCount} linked
              </p>
            </div>
          </CollapsedRow>
        </div>

        {/* Customer Information — collapsed by default. */}
        {customerName && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
            <CollapsedRow
              label="Customer Information"
              icon={<Phone className="h-3.5 w-3.5" />}
              open={custInfoOpen}
              onToggle={() => setCustInfoOpen((v) => !v)}
            >
              <div className="space-y-1.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--color-text-muted)]">Name</span>
                  <span className="truncate font-semibold text-[var(--color-text)]">{customerName}</span>
                </div>
                {custType && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-muted)]">Type</span>
                    <span className="truncate font-semibold text-[var(--color-text)]">{custType}</span>
                  </div>
                )}
                {custCompany && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-muted)]">Company</span>
                    <span className="truncate font-semibold text-[var(--color-text)]">{custCompany}</span>
                  </div>
                )}
                {custPhone && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-muted)]">Phone</span>
                    <span className="truncate font-semibold text-[var(--color-text)]">{custPhone}</span>
                  </div>
                )}
                {custEmail && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-muted)]">Email</span>
                    <span className="truncate font-semibold text-[var(--color-text)]">{custEmail}</span>
                  </div>
                )}
                {(custAddress || custCity) && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-muted)]">Address</span>
                    <span className="truncate font-semibold text-[var(--color-text)]">{[custAddress, [custCity, custState].filter(Boolean).join(', ')].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {custGst && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-text-muted)]">GST</span>
                    <span className="truncate font-semibold text-[var(--color-text)]">{custGst}</span>
                  </div>
                )}
              </div>
            </CollapsedRow>
          </div>
        )}

        {/* Work on This Project — current stage operational workspace. */}
        <ProjectWorkOnThisProject
          key={project.id}
          currentStageOnly
          project={project as ProjectRecord}
          customer={customer}
          users={users}
          canEditProject={canEditProjects}
        />

        {/* Shared Documents / Activity / Notes / Linked Records — the exact
            same ProjectWorkspaceSections desktop uses. */}
        <ProjectWorkspaceSections
          project={project as ProjectRecord}
          customer={customer}
          users={users}
          activeCompanyId={activeCompanyId}
          canEditProject={canEditProjects}
          permissions={tabPermissions}
          onDocsSaved={() => { void qc.invalidateQueries({ queryKey: keys.projectsRoot }); }}
        />

        {canEditProjects && !isArchived && (
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="mx-auto mt-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-danger-light)] hover:text-[var(--color-danger)]"
          >
            <Archive className="h-3.5 w-3.5" /> Archive Project
          </button>
        )}
      </div>

      {/* ── FIXED FOOTER ────────────────────────────────────────────── */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => navigate('/projects')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Projects
        </button>
        <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
          {stagePosition} / {totalStages} · {positionPct}%
        </span>
      </footer>

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
