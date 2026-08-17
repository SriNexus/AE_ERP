/**
 * PartnerProjects — Partner Portal Projects Workspace
 *
 * Partners view, search, and manage their OWN projects (partnerId = partner
 * DOC id via the Phase 3 ownership chain Lead → Customer → Project). Project
 * creation reuses the canonical useSaveProject → createProject path, which
 * inherits partnerId from the selected customer — so the partner can only
 * create projects from their own customers (Phase 3 §9.2/§9.3 + Phase 5).
 *
 * Reuses: useProjects, useSaveProject, ProjectForm, DataTable, FilterBar.
 * No duplicated project system — COLLECTIONS.PROJECTS is the source.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { FolderKanban, Plus, RefreshCw, Eye } from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Pagination } from '../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ProjectForm } from '../../features/projects/components/ProjectForm';
import { PROJECT_FORM_DEFAULT } from '../../features/projects/types';
import type { ProjectFormValues } from '../../features/projects/types';
import { useProjects, useSaveProject } from '../../features/projects/hooks/useProjects';
import { useCustomers } from '../../features/customers/hooks/useCustomers';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import { filterPartnerOwnedCustomers, filterPartnerOwnedProjects } from '../../lib/partnerOwnership';
import type { ChannelPartner } from '../../features/channel-partner/types';
import { useAppStore } from '../../store/useAppStore';
import { statusBadge } from '../../components/ui/Badge';
import { PartnerProjectDetailDrawer } from '../../components/partner/PartnerProjectDetailDrawer';

const PER_PAGE = 10;
const ALL = 'All';

function formatDate(value: any): string {
  if (!value) return '—';
  const date = typeof value === 'object' && typeof value.toDate === 'function'
    ? value.toDate()
    : typeof value === 'object' && value.seconds
      ? new Date(value.seconds * 1000)
      : new Date(value);
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
}

export default function PartnerProjects() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: pathProjectId } = useParams<{ id: string }>();

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Data ──────────────────────────────────────────────
  const { data: allProjects = [], isLoading: projectsLoading, refetch } = useProjects();
  const { data: allCustomers = [], isLoading: customersLoading } = useCustomers();

  const partnerProjects = useMemo(
    () => filterPartnerOwnedProjects(allProjects, partner?.id),
    [allProjects, partner?.id],
  );

  // Customer picker options are restricted to the partner's OWN customers —
  // createProject() then inherits partnerId from the selected customer, so a
  // partner can never create a project on another partner's customer.
  const partnerCustomers = useMemo(
    () => filterPartnerOwnedCustomers(allCustomers as any[], partner?.id) as any[],
    [allCustomers, partner?.id],
  );
  const customerOptions = useMemo(
    () => partnerCustomers.map((c: any) => ({ id: c.id, name: c.name || c.company || c.id, fullName: c.name, company: c.company })),
    [partnerCustomers],
  );

  // ── View state from URL params ────────────────────────
  const openParam = searchParams.get('view') || pathProjectId || '';
  const createParam = searchParams.get('create') || '';
  const preselectCustomer = searchParams.get('customer') || '';

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [typeF, setTypeF] = useState(() => searchParams.get('type') || ALL);
  const [stageF, setStageF] = useState(() => searchParams.get('stage') || ALL);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));

  // ── Create form state ─────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProjectFormValues>({ ...PROJECT_FORM_DEFAULT });

  const saveProject = useSaveProject(null, (project) => {
    setShowForm(false);
    setForm({ ...PROJECT_FORM_DEFAULT });
    setViewProject(project);
    const next = new URLSearchParams(searchParams);
    next.set('view', project.id);
    setSearchParams(next, { replace: true });
  });

  const [viewProject, setViewProject] = useState<any>(null);

  useEffect(() => {
    // The `/new` path segment OR `?create=1` opens the create form. When
    // arriving via "Create Project" from the customer drawer
    // (/partner/projects/new?customer=<id>), pre-select that customer so
    // ownership flows through the canonical createProject
    // customer-inheritance path.
    if (createParam === '1' || pathProjectId === 'new') {
      setForm((f) => preselectCustomer ? { ...f, customerId: preselectCustomer } : { ...PROJECT_FORM_DEFAULT });
      setShowForm(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createParam, pathProjectId]);

  useEffect(() => {
    if (openParam && partnerProjects.length > 0) {
      const target = partnerProjects.find((p: any) => p.id === openParam);
      if (target) setViewProject(target);
    }
  }, [openParam, partnerProjects]);

  function handleSubmitProject(e: React.FormEvent) {
    e.preventDefault();
    if (saveProject.isPending) return;
    const customer = partnerCustomers.find((c: any) => c.id === form.customerId);
    saveProject.mutate({ ...form, customerName: customer?.name || customer?.company || '' });
  }

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...partnerProjects];
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((p: any) =>
        [p.name, p.projectId, p.customerName, p.city, p.projectType]
          .some((v: any) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (typeF !== ALL) list = list.filter((p: any) => p.projectType === typeF);
    if (stageF !== ALL) list = list.filter((p: any) => p.currentStage === stageF);
    list.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return list;
  }, [partnerProjects, search, typeF, stageF]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── URL sync ──────────────────────────────────────────
  function syncParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== ALL && v !== 'all') next.set(k, v);
      else next.delete(k);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch('');
    setTypeF(ALL);
    setStageF(ALL);
    setPage(1);
    setSearchParams({}, { replace: true });
  }

  function handleRowClick(project: any) {
    setViewProject(project);
    syncParams({ view: project.id });
  }

  function handleCloseDetail() {
    setViewProject(null);
    const next = new URLSearchParams(searchParams);
    next.delete('view');
    setSearchParams(next, { replace: true });
  }

  function handleCloseForm() {
    setShowForm(false);
    setForm({ ...PROJECT_FORM_DEFAULT });
    const next = new URLSearchParams(searchParams);
    next.delete('create');
    next.delete('customer');
    setSearchParams(next, { replace: true });
  }

  // ── Stage options ─────────────────────────────────────
  const stageOptions = useMemo(() => {
    const stages = new Set(partnerProjects.map((p: any) => p.currentStage).filter(Boolean));
    return [ALL, ...Array.from(stages)];
  }, [partnerProjects]);

  // ── Stats ─────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: partnerProjects.length,
    active: partnerProjects.filter((p: any) => p.status !== 'Archived' && p.status !== 'Inactive').length,
    residential: partnerProjects.filter((p: any) => p.projectType === 'Residential').length,
    commercial: partnerProjects.filter((p: any) => p.projectType === 'Commercial').length,
  }), [partnerProjects]);

  const loading = partnersLoading || projectsLoading || customersLoading;
  const hasActiveFilters = Boolean(search || typeF !== ALL || stageF !== ALL);

  return (
    <PageShell
      title="My Projects"
      subtitle="Projects created from your customers"
      icon={<FolderKanban className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...PROJECT_FORM_DEFAULT }); setShowForm(true); }}>
            Create Project
          </Button>
        </div>
      }
    >
      {/* ── KPI row ───────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {[
          { label: 'TOTAL', value: stats.total, color: 'border-l-[var(--color-border-strong)]' },
          { label: 'ACTIVE', value: stats.active, color: 'border-l-blue-500' },
          { label: 'RESIDENTIAL', value: stats.residential, color: 'border-l-emerald-500' },
          { label: 'COMMERCIAL', value: stats.commercial, color: 'border-l-purple-500' },
        ].map((k) => (
          <div
            key={k.label}
            className={`bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-4 ${k.color} px-3 py-2.5 shadow-[var(--shadow-enterprise-kpi)]`}
          >
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">{k.label}</p>
            <p className="text-2xl font-extrabold text-[var(--color-text)] tabular-nums leading-tight">
              {loading ? '—' : k.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── FilterBar ─────────────────────────────────────── */}
      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); syncParams({ q: v, page: page > 1 ? String(page) : '' }); }}
        searchPlaceholder="Search project name, ID, customer, city..."
        filters={[
          {
            label: 'Type',
            value: typeF,
            onChange: (v) => { setTypeF(v); setPage(1); },
            options: [ALL, 'Residential', 'Commercial', 'Industrial'].map((s) => ({ label: s, value: s })),
          },
          {
            label: 'Stage',
            value: stageF,
            onChange: (v) => { setStageF(v); setPage(1); },
            options: stageOptions.map((s) => ({ label: s, value: s })),
          },
        ]}
        count={filtered.length}
        total={partnerProjects.length}
        label="projects"
        onClearAll={clearAll}
      />

      {/* ── Data Table ────────────────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
        <div className="min-h-0 overflow-x-auto">
          <Table>
            <Thead>
              <Th>PROJECT</Th>
              <Th>TYPE</Th>
              <Th>STAGE</Th>
              <Th className="hidden md:table-cell">CAPACITY</Th>
              <Th className="hidden sm:table-cell">CREATED</Th>
              <Th className="w-20">ACTIONS</Th>
            </Thead>
            <Tbody>
              {loading ? (
                <SkeletonRows cols={6} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {!partner ? (
                      <EmptyState
                        icon={<FolderKanban className="h-8 w-8" />}
                        title="No Partner Profile"
                        description="Your account isn't linked to a partner profile. Contact your administrator."
                      />
                    ) : hasActiveFilters ? (
                      <EmptyState
                        icon={<FolderKanban className="h-8 w-8" />}
                        title="No matching projects"
                        description="Try adjusting your search or filters."
                      />
                    ) : (
                      <EmptyState
                        icon={<FolderKanban className="h-8 w-8" />}
                        title="No Projects Yet"
                        description="Create a project from one of your customers to get started."
                        action={
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...PROJECT_FORM_DEFAULT }); setShowForm(true); }}>
                            Create Your First Project
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((project: any) => (
                  <Tr
                    key={project.id}
                    onClick={() => handleRowClick(project)}
                    className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)]"
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">
                          {(project.name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-[var(--color-text)] text-sm leading-tight">
                            {project.name || project.projectId}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">{project.projectId}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-xs text-[var(--color-text-muted)]">{project.projectType || '—'}</Td>
                    <Td>{statusBadge(project.currentStage || 'New')}</Td>
                    <Td className="hidden md:table-cell text-xs text-[var(--color-text-muted)]">
                      {project.capacityKw ? `${project.capacityKw} kW` : '—'}
                    </Td>
                    <Td className="hidden sm:table-cell text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {formatDate(project.createdAt)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end opacity-75 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRowClick(project); }}
                          className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-sm transition-all hover:-translate-y-0.5 hover:opacity-90"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>

        {filtered.length > PER_PAGE && (
          <Pagination
            page={page}
            total={filtered.length}
            perPage={PER_PAGE}
            onChange={(p) => { setPage(p); syncParams({ page: p > 1 ? String(p) : '' }); }}
          />
        )}
      </div>

      {/* ── Create Project Modal ──────────────────────────── */}
      <Modal open={showForm} onClose={handleCloseForm} size="2xl">
        <ProjectForm
          form={form}
          onChange={setForm}
          onSubmit={handleSubmitProject}
          onCancel={handleCloseForm}
          customers={customerOptions as any[]}
          loading={saveProject.isPending}
          isEdit={false}
          lockedCustomerLabel={
            preselectCustomer
              ? partnerCustomers.find((c: any) => c.id === preselectCustomer)?.name || preselectCustomer
              : undefined
          }
        />
      </Modal>

      {/* ── Project Detail Drawer ─────────────────────────── */}
      <PartnerProjectDetailDrawer
        project={viewProject}
        open={!!viewProject}
        onClose={handleCloseDetail}
      />
    </PageShell>
  );
}
