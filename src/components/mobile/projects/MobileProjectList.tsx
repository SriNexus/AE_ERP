import { useEffect, useMemo, useState } from 'react';
import { FolderKanban, MapPin, Edit2, Archive } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import type { ProjectRecord, ProjectFormValues } from '../../../features/projects/types';
import { PROJECT_FORM_DEFAULT } from '../../../features/projects/types';
import { useProjects, useSaveProject, useArchiveProject } from '../../../features/projects/hooks/useProjects';
import { projectCapacityLabel, projectCustomerLabel, projectSiteAddressSummary, projectStageLabel } from '../../../features/projects/utils/projectDisplay';
import { Badge, Button, Card, Modal, Pagination, ConfirmDialog, Input } from '../../ui';
import { ProjectForm } from '../../../features/projects/components/ProjectForm';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, genId } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { filterCustomersForProjectCreation } from '../../../lib/customerClassification';
import { createCustomerProjection } from '../../../features/customers/hooks/useCustomers';

const PER_PAGE = 10;

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

export function filterMobileProjects(projects: ProjectRecord[], search: string, stage: string) {
  const term = search.trim().toLowerCase();
  return projects.filter((project) => {
    if (stage && stage !== 'All' && project.currentStage !== stage) return false;
    if (!term) return true;
    return [project.projectId, project.customerId, project.currentStage, project.salesOwner, project.assignedSurveyor, project.assignedInstaller, projectSiteAddressSummary(project.siteAddress)]
      .some((value) => String(value || '').toLowerCase().includes(term));
  });
}

export function MobileProjectList({ mode }: { mode: 'records' | 'create' }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const perms = usePermissions();
  const qc = useQueryClient();
  const user = useCurrentUser();

  // Filter + pagination state
  const [search, setSearch] = useState(() => params.get('q') || '');
  const [stageF, setStageF] = useState(() => params.get('stage') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Create/Edit state
  const createParam = params.get('create') || '';
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectFormValues>({ ...PROJECT_FORM_DEFAULT });
  const [formOpen, setFormOpen] = useState(false);
  // Phase 4: master creation flow — mirrors desktop Projects.tsx (see comment
  // there for the full rationale). New customers created here are always B2C.
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('existing');
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' });
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Archive state
  const [archiveTarget, setArchiveTarget] = useState<ProjectRecord | null>(null);

  // Data
  const { data: projects = [], isLoading, error } = useProjects();
  const { data: customers = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  // Phase 2: Projects are a B2C-exclusive workflow — mirrors the desktop
  // Projects.tsx fix, same helper, same rule (B2B customers never selectable here).
  const customerOptions = useMemo(() => {
    return filterCustomersForProjectCreation(customers as any[], businessMode)
      .map((customer) => ({
        id: customer.id,
        name: projectCustomerLabel(customer),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, businessMode]);

  // Mutations
  const createProject = useSaveProject(editId, (project) => {
    setFormOpen(false);
    setEditId(null);
    setForm({ ...PROJECT_FORM_DEFAULT });
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
    navigate(`/projects/${encodeURIComponent(project.id)}`, { replace: true });
  });

  const archiveProject = useArchiveProject((project) => {
    setArchiveTarget(null);
    const next = new URLSearchParams(params);
    navigate(`/projects/${encodeURIComponent(project.id)}`, { replace: true });
  });

  // Open create form on mount if mode=create or ?create=1
  useEffect(() => {
    if ((mode === 'create' || createParam === '1') && perms.canCreate('projects') && !formOpen && !editId) {
      setEditId(null);
      setForm({ ...PROJECT_FORM_DEFAULT });
      setFormOpen(true);
    }
  }, [mode, createParam, perms, formOpen, editId]);

  // Filter
  const filtered = useMemo(() => {
    return filterMobileProjects(projects, search || params.get('q') || '', stageF || params.get('stage') || '');
  }, [projects, search, stageF, params]);

  // Sort by modifiedAt DESC (P0 Section 16)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aTime = toDateValue(a.updatedAt)?.getTime() || toDateValue(a.createdAt)?.getTime() || 0;
      const bTime = toDateValue(b.updatedAt)?.getTime() || toDateValue(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
  }, [filtered]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set('q', search);
    if (stageF) next.set('stage', stageF);
    if (safePage > 1) next.set('page', String(safePage));
    setParams(next, { replace: true });
  }, [search, stageF, safePage, setParams]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [search, stageF]);

  // Handle search from TopBar
  useEffect(() => {
    const q = params.get('q') || '';
    const stage = params.get('stage') || '';
    if (q !== search) setSearch(q);
    if (stage !== stageF) setStageF(stage);
  }, [params, search, stageF]);

  function openEdit(project: ProjectRecord) {
    setEditId(project.id);
    setCustomerMode('existing');
    setNewCustomer({ name: '', phone: '', email: '' });
    setForm({
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
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditId(null);
    setForm({ ...PROJECT_FORM_DEFAULT });
    setCustomerMode('existing');
    setNewCustomer({ name: '', phone: '', email: '' });
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createProject.isPending || creatingCustomer) return;

    if (!editId && customerMode === 'new') {
      const name = newCustomer.name.trim();
      const phone = newCustomer.phone.trim();
      if (!name || !phone) {
        toast.error('Customer name and phone are required');
        return;
      }
      setCreatingCustomer(true);
      try {
        const customerId = genId.customer();
        await createCustomerProjection(customerId, {
          id: customerId,
          name,
          phone,
          email: newCustomer.email.trim() || undefined,
          type: 'B2C',
          createdBy: user.id,
          companyId: activeCompanyId,
        });
        void qc.invalidateQueries({ queryKey: queryKeys.forCompany(activeCompanyId).customersAll });
        createProject.mutate({ ...form, customerId, customerName: name });
      } catch (error: any) {
        toast.error(error?.message || 'Failed to create customer');
      } finally {
        setCreatingCustomer(false);
      }
      return;
    }

    const customer = (customers as any[]).find((c) => c.id === form.customerId);
    createProject.mutate({
      ...form,
      customerName: customer ? projectCustomerLabel(customer) : form.customerId,
    });
  }

  function customerModeToggle() {
    return (
      <div className="mb-4 flex gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-1">
        <button
          type="button"
          onClick={() => setCustomerMode('existing')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${customerMode === 'existing' ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)]'}`}
        >
          Existing Customer
        </button>
        <button
          type="button"
          onClick={() => setCustomerMode('new')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${customerMode === 'new' ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)]'}`}
        >
          New Customer
        </button>
      </div>
    );
  }

  function newCustomerFields() {
    if (customerMode !== 'new') return null;
    return (
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-3">
        <Input
          label="Customer Name"
          required
          value={newCustomer.name}
          onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })}
        />
        <Input
          label="Phone"
          required
          value={newCustomer.phone}
          onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })}
          placeholder="10-digit mobile"
        />
        <Input
          label="Email"
          value={newCustomer.email}
          onChange={(event) => setNewCustomer({ ...newCustomer, email: event.target.value })}
          placeholder="Optional"
        />
      </div>
    );
  }

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Render create mode
  if (mode === 'create' || (createParam === '1' && formOpen)) {
    return (
      <div className="space-y-4 pb-4">
        <header className="px-1">
          <h1 className="text-lg font-bold text-[var(--color-text)]">Create Project</h1>
        </header>
        {customerModeToggle()}
        {newCustomerFields()}
        <ProjectForm
          form={form}
          onChange={setForm}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          customers={customerOptions as any[]}
          loading={createProject.isPending || creatingCustomer}
          isEdit={false}
          lockedCustomerLabel={customerMode === 'new' ? (newCustomer.name.trim() || 'New customer (created on save)') : undefined}
        />
      </div>
    );
  }

  // Render records mode
  return (
    <div className="space-y-4 pb-4">
      <header className="px-1">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-[var(--color-primary)]" />
          <h1 data-tour="mobile-projects-header" className="text-lg font-bold text-[var(--color-text)]">Projects</h1>
          {selected.size > 0 && (
            <span className="ml-auto text-xs font-medium text-[var(--color-primary)]">
              {selected.size} selected
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {isLoading ? 'Loading projects…' : `${sorted.length} project${sorted.length === 1 ? '' : 's'}`}
        </p>
      </header>

      {isLoading ? (
        Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="h-28 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]">
            <span className="sr-only">Loading project</span>
          </Card>
        ))
      ) : error ? (
        <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-danger-text)]">
          Projects could not be loaded.
        </Card>
      ) : paginated.length === 0 ? (
        <Card className="rounded-xl p-8 text-center">
          <FolderKanban className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">
            {search || stageF ? 'No projects match your filters' : 'No projects yet'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {search || stageF ? 'Try adjusting your search or filters.' : 'Create your first project to begin tracking the EPC lifecycle.'}
          </p>
          {!search && !stageF && perms.canCreate('projects') && (
            <Button data-tour="projects-create" className="mt-4" size="sm" onClick={() => {
              setEditId(null);
              setForm({ ...PROJECT_FORM_DEFAULT });
              setCustomerMode('existing');
              setNewCustomer({ name: '', phone: '', email: '' });
              setFormOpen(true);
            }}>
              Create Project
            </Button>
          )}
        </Card>
      ) : (
        <>
          <div className="space-y-3" data-tour="projects-table">
            {paginated.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-action]')) return;
                  navigate(`/projects/${encodeURIComponent(project.id)}`);
                }}
                className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] rounded-xl"
              >
                <Card
                  data-tour="projects-row-view"
                  className={`rounded-xl p-4 transition-colors active:bg-[var(--color-surface-hover)] ${
                    selected.has(project.id) ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/5' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Selection checkbox */}
                      <div data-action onClick={(e) => { e.stopPropagation(); toggleSelection(project.id); }}>
                        <div
                          className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
                            selected.has(project.id)
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                              : 'border-[var(--color-border)]'
                          }`}
                        >
                          {selected.has(project.id) && (
                            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-bold text-[var(--color-text)]">
                          {project.projectId || project.id}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                          Customer {project.customerId}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="info">{projectStageLabel(project.currentStage)}</Badge>
                      {perms.canEdit('projects') && (
                        <span data-action>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEdit(project); }}
                            className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
                            aria-label="Edit project"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{projectSiteAddressSummary(project.siteAddress)}</span>
                    </span>
                    <span className="shrink-0 font-semibold">{projectCapacityLabel(project.capacityKw)}</span>
                  </div>
                </Card>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div data-tour="projects-pagination">
              <Pagination
                page={safePage}
                total={sorted.length}
                perPage={PER_PAGE}
                onChange={(nextPage) => setPage(nextPage)}
              />
            </div>
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      {formOpen && (
        <Modal
          open={formOpen}
          onClose={closeForm}
          title={editId ? 'Edit Project' : 'Create Project'}
          size="full"
        >
          {!editId && customerModeToggle()}
          {!editId && newCustomerFields()}
          <ProjectForm
            form={form}
            onChange={setForm}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            customers={customerOptions as any[]}
            loading={createProject.isPending || creatingCustomer}
            isEdit={!!editId}
            lockedCustomerLabel={!editId && customerMode === 'new' ? (newCustomer.name.trim() || 'New customer (created on save)') : undefined}
          />
        </Modal>
      )}

      {/* Archive ConfirmDialog */}
      {archiveTarget && (
        <ConfirmDialog
          open={!!archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onConfirm={() => archiveProject.mutate({ projectId: archiveTarget.id, reason: 'Archived from mobile' })}
          loading={archiveProject.isPending}
          title="Archive Project"
          confirmLabel="Archive"
          message={`Archive ${archiveTarget.projectId || archiveTarget.id}? The project will move to the Archived stage.`}
        />
      )}
    </div>
  );
}
