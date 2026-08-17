import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Activity, Archive, CheckCircle2, ClipboardCheck, Download, Edit2, FileText,
  LayoutDashboard, Plus, RefreshCw, Search, Wrench,
} from 'lucide-react';

import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal, ConfirmDialog } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../components/ui/Table';
import { Pagination } from '../components/ui/Pagination';
import { EmptyState, PermissionGate, RowViewAction } from '../components/shared';
import { WorkspaceHero, Card, CardHeader, PremiumKpi, Select as UiSelect, UniversalCheckbox } from '../components/ui';
import { COLLECTIONS } from '../lib/firebase';
import { getAll, genId } from '../lib/firestore';
import { isInDateRange, DATE_RANGE_OPTIONS } from '../lib/dateFilters';
import type { DateRange } from '../lib/dateFilters';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { resolveBusinessMode } from '../lib/companyBusinessMode';
import { filterCustomersForProjectCreation } from '../lib/customerClassification';
import { createCustomerProjection } from '../features/customers/hooks/useCustomers';
import type { ProjectRecord } from '../features/projects/types';
import { PROJECT_FORM_DEFAULT, type ProjectFormValues } from '../features/projects/types';
import { ProjectForm } from '../features/projects/components/ProjectForm';
import { ProjectDetailModal } from '../features/projects/components/ProjectDetailModal';
import { useArchiveProject, useProjects, useSaveProject } from '../features/projects/hooks/useProjects';
import {
  projectCapacityLabel,
  projectCustomerLabel,
  projectSiteAddressSummary,
  projectStageLabel,
  PROJECT_STAGE_OPTIONS,
} from '../features/projects/utils/projectDisplay';

const PER_PAGE = 10;

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-dropdown],[data-interactive]'));
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

function formatCreated(value: unknown) {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString('en-GB') : '—';
}

function projectCustomerSearchText(customer?: Record<string, unknown> | null) {
  if (!customer) return '';
  return [
    customer.name,
    customer.fullName,
    customer.contactPerson,
    customer.company,
    customer.companyName,
    customer.phone,
    customer.mobile,
    customer.email,
    customer.customerId,
    customer.id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function projectSearchText(project: ProjectRecord, customer?: Record<string, unknown> | null) {
  return [
    project.projectId,
    project.customerId,
    project.leadId,
    project.currentStage,
    project.salesOwner,
    project.assignedSurveyor,
    project.assignedInstaller,
    project.capacityKw,
    projectSiteAddressSummary(project.siteAddress),
    projectCustomerLabel(customer),
    projectCustomerSearchText(customer),
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
}

function projectStageBadgeVariant(stage: string) {
  if (stage === 'Archived') return 'gray';
  if (stage === 'New') return 'info';
  if (stage === 'Commissioning' || stage === 'Handover') return 'success';
  return 'default';
}

export default function Projects() {
  const navigate = useNavigate();
  const perms = usePermissions();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get('open') || '';

  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [stageF, setStageF] = useState(() => searchParams.get('stage') || '');
  const [customerF, setCustomerF] = useState(() => searchParams.get('customer') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [dateRange, setDateRange] = useState<DateRange>((searchParams.get('date') as DateRange) || 'all');
  const [createdByF, setCreatedByF] = useState(() => searchParams.get('createdBy') || '');
  const [managerF, setManagerF] = useState(() => searchParams.get('manager') || '');
  const [ownerF, setOwnerF] = useState(() => searchParams.get('owner') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [sortKey, setSortKey] = useState<'projectId' | 'customer' | 'stage' | 'capacityKw' | 'createdAt' | 'manager' | 'owner'>('createdAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectFormValues>({ ...PROJECT_FORM_DEFAULT });
  // Phase 4: "Single Customer + Project master creation flow" — direct Project
  // creation can either pick an existing (already B2C-filtered) customer, or
  // create a brand-new one inline. New customers created here are always B2C
  // (Projects are a B2C-exclusive workflow per Phase 2's filterCustomersForProjectCreation) —
  // never user-selectable as B2B, matching the business rule Projects can never belong
  // to a B2B customer.
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('existing');
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' });
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewItem, setViewItem] = useState<ProjectRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ProjectRecord | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const { data: projects = [], isLoading, refetch } = useProjects();
  const { data: customers = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).customersAll,
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });
  const { data: payments = [] } = useQuery({
    queryKey: queryKeys.forCompany(activeCompanyId).payments as any,
    queryFn: () => getAll(COLLECTIONS.PAYMENTS),
    staleTime: 60_000,
  });

  const customerById = useMemo(() => new Map((customers as any[]).map((customer) => [customer.id, customer])), [customers]);
  // Phase 2: Projects are a B2C-exclusive workflow — a B2B (material-distribution)
  // customer must never be selectable here, regardless of Company Business Mode.
  const customerOptions = useMemo(() => {
    return filterCustomersForProjectCreation(customers as any[], businessMode)
      .map((customer) => ({
        id: customer.id,
        name: projectCustomerLabel(customer),
        raw: customer,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, businessMode]);

  const createProject = useSaveProject(editId, (project) => {
    setShowForm(false);
    setEditId(null);
    setForm({ ...PROJECT_FORM_DEFAULT });
    setViewItem(project);
    const next = new URLSearchParams(searchParams);
    next.set('open', project.id);
    setSearchParams(next, { replace: true });
  });

  const archiveProject = useArchiveProject((project) => {
    setArchiveTarget(null);
    setViewItem(project);
    const next = new URLSearchParams(searchParams);
    next.set('open', project.id);
    setSearchParams(next, { replace: true });
  });

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set('q', search);
    if (stageF) next.set('stage', stageF);
    if (customerF) next.set('customer', customerF);
    if (page > 1) next.set('page', String(page));
    if (perPage !== PER_PAGE) next.set('perPage', String(perPage));
    if (openParam) next.set('open', openParam);
    setSearchParams(next, { replace: !showForm && !archiveTarget });
  }, [archiveTarget, customerF, openParam, page, perPage, search, setSearchParams, showForm, stageF]);

  useEffect(() => {
    if (!openParam) return;
    const found = (projects as ProjectRecord[]).find((project) => project.id === openParam);
    if (found) {
      setViewItem(found);
    }
  }, [openParam, projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (projects as ProjectRecord[]).filter((project) => {
      const customer = customerById.get(project.customerId) as Record<string, unknown> | undefined;
      const searchText = projectSearchText(project, customer);
      const matchesSearch = !q || searchText.includes(q);
      const matchesStage = !stageF || project.currentStage === stageF;
      const matchesCustomer = !customerF || project.customerId === customerF;
      const matchesDate = isInDateRange(project.createdAt, dateRange);
      const matchesOwner = !ownerF || (project.salesOwner || '').toLowerCase().includes(ownerF.toLowerCase());
      const matchesManager = !managerF || (project.assignedSurveyor || '').toLowerCase().includes(managerF.toLowerCase());
      const matchesCreatedBy = !createdByF || project.createdBy === createdByF;
      const matchesStatus = !statusF || project.currentStage === statusF;
      const kpiMatch =
        !activeKpi ||
        activeKpi === 'total' ||
        (activeKpi === 'active' && !['Archived', 'Handover'].includes(project.currentStage)) ||
        (activeKpi === 'installation' && project.currentStage === 'Installation') ||
        (activeKpi === 'pendingQc' && project.currentStage === 'QC') ||
        (activeKpi === 'pendingSubsidy' && project.currentStage === 'Subsidy') ||
        (activeKpi === 'handover' && ['Handover', 'AMC', 'Service', 'Monitoring'].includes(project.currentStage));
      return matchesSearch && matchesStage && matchesCustomer && matchesDate && matchesOwner
        && matchesManager && matchesCreatedBy && matchesStatus && kpiMatch;
    });
  }, [customerById, customerF, projects, search, stageF, dateRange, ownerF, managerF, createdByF, statusF, activeKpi]);

  // ── Compute payments data per project ──
  const paymentsByCustomer = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    (payments as any[]).forEach((payment: any) => {
      const customerId = payment.customerId || payment.customer || '';
      if (!customerId) return;
      const existing = map.get(customerId) || { total: 0, count: 0 };
      existing.total += Number(payment.amount || payment.total || payment.paidAmount || 0);
      existing.count += 1;
      map.set(customerId, existing);
    });
    return map;
  }, [payments]);

  function paymentDisplay(project: ProjectRecord, projectCustomerId: string) {
    const data = paymentsByCustomer.get(projectCustomerId || project.customerId);
    if (!data || data.total === 0) return '—';
    return `₹${Number(data.total).toLocaleString('en-IN')}`;
  }

  const sorted = useMemo(() => {
    const list = [...filtered];
    const rank = (stage: string) => PROJECT_STAGE_OPTIONS.findIndex((option) => option.value === stage);
    list.sort((a, b) => {
      const customerA = projectCustomerLabel(customerById.get(a.customerId) as Record<string, unknown> | undefined);
      const customerB = projectCustomerLabel(customerById.get(b.customerId) as Record<string, unknown> | undefined);
      const compareValue = (valueA: unknown, valueB: unknown) => String(valueA ?? '').localeCompare(String(valueB ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      let cmp = 0;
      if (sortKey === 'customer') cmp = compareValue(customerA, customerB);
      else if (sortKey === 'stage') cmp = rank(a.currentStage) - rank(b.currentStage);
      else if (sortKey === 'capacityKw') cmp = Number(a.capacityKw || 0) - Number(b.capacityKw || 0);
      else if (sortKey === 'createdAt') cmp = (toDateValue(a.createdAt)?.getTime() || 0) - (toDateValue(b.createdAt)?.getTime() || 0);
      else if (sortKey === 'manager') cmp = compareValue(a.assignedSurveyor, b.assignedSurveyor);
      else if (sortKey === 'owner') cmp = compareValue(a.salesOwner, b.salesOwner);
      else cmp = compareValue(a.projectId, b.projectId);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [customerById, filtered, sortDesc, sortKey]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(sorted.length / perPage));
    if (page > maxPage) setPage(maxPage);
  }, [page, perPage, sorted.length]);

  const paginated = sorted.slice((page - 1) * perPage, page * perPage);

  // ── Bulk action helpers ──
  const selectedRows = useMemo(() => paginated.filter((p) => selected.has(p.id)), [paginated, selected]);
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allSelected = paginated.every((p) => prev.has(p.id));
      if (allSelected) {
        const next = new Set(prev);
        paginated.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      paginated.forEach((p) => next.add(p.id));
      return next;
    });
  }, [paginated]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const stats = useMemo(() => {
    const all = projects as ProjectRecord[];
    const installationStages = ['Installation'];
    const pendingQcStages = ['QC'];
    const pendingSubsidyStages = ['Subsidy'];
    const handoverStages = ['Handover', 'AMC', 'Service', 'Monitoring'];
    return {
      total: all.length,
      active: all.filter((p) => !['Archived', 'Handover'].includes(p.currentStage)).length,
      installation: all.filter((p) => installationStages.includes(p.currentStage)).length,
      pendingQc: all.filter((p) => pendingQcStages.includes(p.currentStage)).length,
      pendingSubsidy: all.filter((p) => pendingSubsidyStages.includes(p.currentStage)).length,
      handover: all.filter((p) => handoverStages.includes(p.currentStage)).length,
    };
  }, [projects]);

  function syncQueueParams(nextState: {
    q?: string;
    stage?: string;
    customer?: string;
    kpi?: string;
    date?: string;
    owner?: string;
    manager?: string;
    status?: string;
    createdBy?: string;
    page?: number;
    perPage?: number;
    open?: string;
  }) {
    const next = new URLSearchParams(searchParams);
    const q = nextState.q ?? search;
    const stage = nextState.stage ?? stageF;
    const customer = nextState.customer ?? customerF;
    const kpi = nextState.kpi ?? activeKpi;
    const date = nextState.date ?? dateRange;
    const owner = nextState.owner ?? ownerF;
    const manager = nextState.manager ?? managerF;
    const status = nextState.status ?? statusF;
    const createdBy = nextState.createdBy ?? createdByF;
    const nextPage = nextState.page ?? page;
    const nextPerPage = nextState.perPage ?? perPage;
    const open = nextState.open ?? openParam;

    if (q) next.set('q', q); else next.delete('q');
    if (stage) next.set('stage', stage); else next.delete('stage');
    if (customer) next.set('customer', customer); else next.delete('customer');
    if (kpi) next.set('kpi', kpi); else next.delete('kpi');
    if (date && date !== 'all') next.set('date', date); else next.delete('date');
    if (owner) next.set('owner', owner); else next.delete('owner');
    if (manager) next.set('manager', manager); else next.delete('manager');
    if (status) next.set('status', status); else next.delete('status');
    if (createdBy) next.set('createdBy', createdBy); else next.delete('createdBy');
    if (nextPage > 1) next.set('page', String(nextPage)); else next.delete('page');
    if (nextPerPage !== PER_PAGE) next.set('perPage', String(nextPerPage)); else next.delete('perPage');
    if (open) next.set('open', open); else next.delete('open');

    setSearchParams(next, { replace: !Object.prototype.hasOwnProperty.call(nextState, 'open') });
  }

  function openCreate() {
    setEditId(null);
    setForm({ ...PROJECT_FORM_DEFAULT });
    setCustomerMode('existing');
    setNewCustomer({ name: '', phone: '', email: '' });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm({ ...PROJECT_FORM_DEFAULT });
    setCustomerMode('existing');
    setNewCustomer({ name: '', phone: '', email: '' });
  }

  function openEdit(project: ProjectRecord) {
    setViewItem(null);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
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
    setShowForm(true);
  }

  function closeProjectDetails() {
    setViewItem(null);
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }

  function openProject(project: ProjectRecord) {
    navigate(`/projects/${encodeURIComponent(project.id)}`);
  }

  function handleRowClick(event: React.MouseEvent<HTMLTableRowElement>, project: ProjectRecord) {
    if (window.getSelection()?.toString()) return;
    if (isRowOpenIgnored(event.target)) return;
    openProject(project);
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, project: ProjectRecord) {
    if (isRowOpenIgnored(event.target)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openProject(project);
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
          // Projects are B2C-exclusive (Phase 2) — a customer created from this
          // flow must always be B2C, never left to the caller/user to pick.
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

    createProject.mutate({
      ...form,
      customerName: projectCustomerLabel(customerById.get(form.customerId) as Record<string, unknown> | undefined),
    });
  }

  function clearFilters() {
    setSearch('');
    setStageF('');
    setCustomerF('');
    setActiveKpi('');
    setDateRange('all');
    setCreatedByF('');
    setManagerF('');
    setOwnerF('');
    setStatusF('');
    setPage(1);
    syncQueueParams({ q: '', stage: '', customer: '', kpi: '', date: 'all', owner: '', manager: '', status: '', createdBy: '', page: 1 });
  }

  function clearQueryOpen() {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  }

  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && !stageF && !customerF && !ownerF && !managerF && !createdByF && !statusF && dateRange === 'all';
  }, [activeKpi, search, stageF, customerF, ownerF, managerF, createdByF, statusF, dateRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (stageF) count++;
    if (customerF) count++;
    if (ownerF) count++;
    if (managerF) count++;
    if (createdByF) count++;
    if (statusF) count++;
    if (dateRange !== 'all') count++;
    if (activeKpi) count++;
    return count;
  }, [search, stageF, customerF, ownerF, managerF, createdByF, statusF, dateRange, activeKpi]);

  const KPI_TILES = useMemo(() => [
    { key: 'total', label: 'TOTAL', value: stats.total, icon: <LayoutDashboard className="h-4 w-4" />, desc: `${stats.active} active projects` },
    { key: 'active', label: 'ACTIVE', value: stats.active, icon: <Activity className="h-4 w-4" />, desc: 'In progress' },
    { key: 'installation', label: 'INSTALLATION', value: stats.installation, icon: <Wrench className="h-4 w-4" />, desc: 'Currently installing' },
    { key: 'pendingQc', label: 'PENDING QC', value: stats.pendingQc, icon: <ClipboardCheck className="h-4 w-4" />, desc: 'Awaiting quality check' },
    { key: 'pendingSubsidy', label: 'PENDING SUBSIDY', value: stats.pendingSubsidy, icon: <FileText className="h-4 w-4" />, desc: 'Subsidy processing' },
    { key: 'handover', label: 'HANDOVER', value: stats.handover, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Completed stages' },
  ], [stats]);

  const customerFilterOptions = useMemo(() => [
    { label: 'All Customers', value: '' },
    ...customerOptions.map((c) => ({ label: c.name, value: c.id })),
  ], [customerOptions]);

  const sortedCount = sorted.length;
  const totalCount = projects.length;

  const showCustomDate = dateRange === 'custom';

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      {/* WORKSPACE HERO */}
      <WorkspaceHero
        className="gap-3"
        icon={<LayoutDashboard className="h-4 w-4" />}
        breadcrumbs={['Home', 'Projects']}
        title="Projects"
        statusText="Projects Status"
        statusDotColor="bg-[var(--color-success)]"
        actions={
          <>
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()} title="Refresh">Refresh</Button>
            <PermissionGate module="projects" action="create">
              <Button size="sm" data-tour="projects-create" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>New Project</Button>
            </PermissionGate>
          </>
        }
      />

      {/* KPI GRID */}
      <div data-tour="projects-kpi" className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map((k) => (
          <PremiumKpi
            key={k.key}
            label={k.label}
            value={k.value}
            icon={k.icon}
            description={k.desc}
            active={k.key === 'total' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : (k.key === 'total' && isTotalDefault ? '' : k.key);
              setActiveKpi(nextKpi);
              setPage(1);
              syncQueueParams({ kpi: nextKpi, page: 1 });
            }}
          />
        ))}
      </div>

      {/* TABLE CARD */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        {/* CARD HEADER — SEARCH + FILTERS */}
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          <div data-tour="projects-filters" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                data-tour="projects-search"
                className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                placeholder="Search projects..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              />
            </div>

            {/* Stage filter */}
            <UiSelect
              value={stageF}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const v = e.target.value; setStageF(v); setPage(1); syncQueueParams({ stage: v, page: 1 }); }}
              options={[...PROJECT_STAGE_OPTIONS]}
              className="h-8 min-w-[120px]"
            />

            {/* Customer filter */}
            <UiSelect
              value={customerF}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const v = e.target.value; setCustomerF(v); setPage(1); syncQueueParams({ customer: v, page: 1 }); }}
              options={customerFilterOptions}
              className="h-8 min-w-[140px]"
            />

            {/* Owner filter */}
            <UiSelect
              value={ownerF}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const v = e.target.value; setOwnerF(v); setPage(1); syncQueueParams({ owner: v, page: 1 }); }}
              options={[{ label: 'All Owners', value: '' }]}
              className="h-8 min-w-[120px]"
            />

            {/* Manager filter */}
            <UiSelect
              value={managerF}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const v = e.target.value; setManagerF(v); setPage(1); syncQueueParams({ manager: v, page: 1 }); }}
              options={[{ label: 'All Managers', value: '' }]}
              className="h-8 min-w-[120px]"
            />

            {/* Created By filter */}
            <UiSelect
              value={createdByF}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const v = e.target.value; setCreatedByF(v); setPage(1); syncQueueParams({ createdBy: v, page: 1 }); }}
              options={[{ label: 'All Created By', value: '' }]}
              className="h-8 min-w-[120px]"
            />

            {/* Status filter */}
            <UiSelect
              value={statusF}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const v = e.target.value; setStatusF(v); setPage(1); syncQueueParams({ status: v, page: 1 }); }}
              options={[{ label: 'All Status', value: '' }, { label: 'Active', value: 'Active' }, { label: 'Archived', value: 'Archived' }]}
              className="h-8 min-w-[110px]"
            />

            {/* Date range filter */}
            <UiSelect
              value={dateRange}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const next = e.target.value as DateRange;
                setDateRange(next);
                setPage(1);
                if (next === 'custom') {
                  setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set('date', 'custom'); return p; }, { replace: true });
                } else {
                  syncQueueParams({ date: next, page: 1 });
                }
              }}
              options={[...DATE_RANGE_OPTIONS]}
              className="h-8 min-w-[120px]"
            />

            {/* Custom date inputs */}
            {showCustomDate && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-[var(--color-text-muted)]">From:</span>
                <input
                  type="date"
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  value={searchParams.get('customFrom') || ''}
                  onChange={(e) => {
                    const next = new URLSearchParams(searchParams);
                    if (e.target.value) next.set('customFrom', e.target.value); else next.delete('customFrom');
                    setSearchParams(next, { replace: true });
                    setPage(1);
                    syncQueueParams({ date: 'custom', page: 1 });
                  }}
                />
                <span className="text-xs text-[var(--color-text-muted)]">to</span>
                <input
                  type="date"
                  className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  value={searchParams.get('customTo') || ''}
                  onChange={(e) => {
                    const next = new URLSearchParams(searchParams);
                    if (e.target.value) next.set('customTo', e.target.value); else next.delete('customTo');
                    setSearchParams(next, { replace: true });
                    setPage(1);
                    syncQueueParams({ date: 'custom', page: 1 });
                  }}
                />
              </div>
            )}

            {/* Clear All */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button
                  onClick={() => { clearFilters(); }}
                  className="text-xs font-medium text-[var(--color-primary-text)] hover:underline"
                >
                  Clear All
                </button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            {sortedCount} item{sortedCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* BULK ACTION BAR */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-2.5">
            <span className="text-sm font-medium text-[var(--color-text)]">{selected.size} selected</span>
            <span className="h-4 w-px bg-[var(--color-border)]" />
            <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => {
              const csv = [['Project ID','Customer','Stage','Capacity','Owner','Manager','Site','Created'].join(',')].concat(
                selectedRows.map((p) => [
                  p.projectId,
                  `"${projectCustomerLabel(customerById.get(p.customerId) as Record<string, unknown> | undefined)}"`,
                  p.currentStage,
                  p.capacityKw || '',
                  p.salesOwner || '',
                  p.assignedSurveyor || '',
                  `"${projectSiteAddressSummary(p.siteAddress)}"`,
                  p.createdAt || '',
                ].join(','))
              ).join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = 'projects_export.csv'; a.click();
              URL.revokeObjectURL(url);
            }} className="text-xs">
              Export CSV
            </Button>
            <Button size="sm" variant="outline" icon={<Archive className="h-3.5 w-3.5" />} onClick={() => setBulkArchiveOpen(true)} className="text-xs">
              Archive
            </Button>
            <div className="ml-auto">
              <Button size="sm" variant="ghost" onClick={clearSelection} className="text-xs">Clear</Button>
            </div>
          </div>
        )}

        {/* TABLE CONTAINER */}
        <div className="flex min-h-0 flex-1 flex-col px-6">
          <div data-tour="projects-table" className="flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th className="w-8">
                  <UniversalCheckbox
                    checked={paginated.length > 0 && paginated.every((p) => selected.has(p.id))}
                    indeterminate={paginated.some((p) => selected.has(p.id)) && !paginated.every((p) => selected.has(p.id))}
                    onChange={toggleAll}
                    aria-label="Select all projects"
                  />
                </Th>
                <Th onSort={() => setSortKey('projectId')} sortable sorted={sortKey === 'projectId'} desc={sortDesc}>PROJECT ID</Th>
                <Th onSort={() => setSortKey('customer')} sortable sorted={sortKey === 'customer'} desc={sortDesc}>CUSTOMER</Th>
                <Th onSort={() => setSortKey('stage')} sortable sorted={sortKey === 'stage'} desc={sortDesc}>STAGE</Th>
                <Th onSort={() => setSortKey('capacityKw')} sortable sorted={sortKey === 'capacityKw'} desc={sortDesc}>CAPACITY</Th>
                <Th>OWNER</Th>
                <Th>MANAGER</Th>
                <Th>SITE</Th>
                <Th>PAYMENTS</Th>
                <Th onSort={() => setSortKey('createdAt')} sortable sorted={sortKey === 'createdAt'} desc={sortDesc}>CREATED</Th>
                <Th>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? (
                  <SkeletonRows cols={11} />
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={11}>
                      <EmptyState
                        title="No projects found"
                        description={search || stageF || customerF ? 'Try adjusting your search or filters' : 'Create your first project to begin tracking the EPC lifecycle.'}
                        action={!search && !stageF && !customerF ? (
                          <PermissionGate module="projects" action="create">
                            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>New Project</Button>
                          </PermissionGate>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((project) => {
                    const customer = customerById.get(project.customerId) as Record<string, unknown> | undefined;
                    return (
                      <Tr
                        key={project.id}
                        data-record-id={project.id}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => handleRowClick(event, project)}
                        onKeyDown={(event) => handleRowKeyDown(event, project)}
                        className="group cursor-pointer transition-all duration-150 ease-out hover:bg-[var(--color-surface-hover)]"
                      >
                        <Td className="w-8" data-action onClick={(e) => e.stopPropagation()}>
                          <UniversalCheckbox
                            checked={selected.has(project.id)}
                            onChange={() => toggleSelect(project.id)}
                            aria-label={`Select project ${project.projectId}`}
                          />
                        </Td>
                        <Td className="font-mono text-[13px] font-semibold text-[var(--color-primary-text)]">{project.projectId}</Td>
                        <Td>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-[11px] font-bold text-[var(--color-primary-text)]">
                              {(projectCustomerLabel(customer) || '?')[0]?.toUpperCase() || '?'}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--color-text)]">{projectCustomerLabel(customer)}</p>
                              <p className="truncate text-xs text-[var(--color-text-muted)]">{String(customer?.company || customer?.companyName || customer?.phone || customer?.email || project.customerId || '—')}</p>
                            </div>
                          </div>
                        </Td>
                        <Td><Badge variant={projectStageBadgeVariant(project.currentStage)}>{projectStageLabel(project.currentStage)}</Badge></Td>
                        <Td className="text-sm font-semibold text-[var(--color-text)]">{projectCapacityLabel(project.capacityKw)}</Td>
                        <Td className="max-w-[120px] truncate text-xs text-[var(--color-text-secondary)]">{project.salesOwner || '—'}</Td>
                        <Td className="max-w-[120px] truncate text-xs text-[var(--color-text-secondary)]">{project.assignedSurveyor || '—'}</Td>
                        <Td className="max-w-[140px] truncate text-xs text-[var(--color-text-secondary)]">{projectSiteAddressSummary(project.siteAddress)}</Td>
                        <Td className="text-xs font-semibold text-[var(--color-text)]">{paymentDisplay(project, project.customerId)}</Td>
                        <Td className="text-xs text-[var(--color-text-muted)]">{formatCreated(project.createdAt)}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1.5" data-action>
                            {perms.canEdit('projects') && (
                              <Button size="xs" variant="outline" icon={<Edit2 className="h-3 w-3" />} onClick={() => openEdit(project)}>
                                Edit
                              </Button>
                            )}
                            <RowViewAction dataTour="projects-row-view" onView={() => openProject(project)} />
                          </div>
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </Table>
          </div>
        </div>

        {/* PAGINATION */}
        <div data-tour="projects-pagination" className="shrink-0 border-t border-[var(--color-border-subtle)]">
          <Pagination
            page={page}
            total={sorted.length}
            perPage={perPage}
            onChange={(nextPage) => {
              setPage(nextPage);
              syncQueueParams({ page: nextPage });
            }}
            onPerPageChange={(nextPerPage) => {
              setPerPage(nextPerPage);
              setPage(1);
              syncQueueParams({ perPage: nextPerPage, page: 1 });
            }}
          />
        </div>
      </Card>

      {/* FORM MODAL */}
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Project' : 'Create Project'} size="lg">
        {!editId && (
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
        )}
        {!editId && customerMode === 'new' && (
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-[var(--color-border)] p-3 sm:grid-cols-3">
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
        )}
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

      {/* DETAIL MODAL */}
      <ProjectDetailModal
        open={!!viewItem}
        project={viewItem}
        customer={viewItem ? customerById.get(viewItem.customerId) : null}
        canEdit={perms.canEdit('projects')}
        canArchive={perms.canEdit('projects')}
        onClose={closeProjectDetails}
        onEdit={() => { if (viewItem) openEdit(viewItem); }}
        onArchive={() => {
          if (viewItem) {
            setArchiveTarget(viewItem);
          }
        }}
      />

      {/* ARCHIVE CONFIRM */}
      <ConfirmDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (!archiveTarget) return;
          archiveProject.mutate({ projectId: archiveTarget.id, reason: 'Archived from Projects page' });
        }}
        loading={archiveProject.isPending}
        title="Archive Project"
        confirmLabel="Archive"
        message={archiveTarget ? `Archive ${archiveTarget.projectId || archiveTarget.id}? The project will move to the Archived stage.` : 'Archive project?'}
      />

      {/* BULK ARCHIVE CONFIRM */}
      <ConfirmDialog
        open={bulkArchiveOpen}
        onClose={() => setBulkArchiveOpen(false)}
        onConfirm={() => {
          selected.forEach((id) => {
            const project = (projects as ProjectRecord[]).find((p) => p.id === id);
            if (project) {
              archiveProject.mutate({ projectId: id, reason: 'Bulk archived from Projects page' });
            }
          });
          setBulkArchiveOpen(false);
          clearSelection();
        }}
        loading={archiveProject.isPending}
        title="Archive Selected Projects"
        confirmLabel="Archive"
        message={`Archive ${selected.size} selected project${selected.size === 1 ? '' : 's'}? They will move to the Archived stage.`}
      />

      {/* HIDDEN CLEAR QUERY TRIGGER */}
      {openParam && !viewItem && (
        <button type="button" className="hidden" onClick={clearQueryOpen}>Clear project details query</button>
      )}
    </div>
  );
}
