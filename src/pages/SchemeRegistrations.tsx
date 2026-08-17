/**
 * SchemeRegistrations — Registration (Vendor Lock / Scheme Registration)
 * standalone list workspace (VL-9 / VL-10).
 *
 * Audience (per the authoritative RBAC contract):
 *   - Manager / TL  → team-scoped Registration monitoring + approval/vendor-
 *     lock actions (the data layer resolves the team scope through the
 *     existing managerId / teamMemberIds machinery — see
 *     projectVisibility.ts PROJECT_EXTRA_ASSIGNMENT_FIELDS).
 *   - Director / Management → company-scoped, READ-ONLY (no create / submit /
 *     approve / reject — the service boundary enforces this).
 *   - Admin → company-scoped with full permitted controls + audited reopen.
 *   - Partner → uses the dedicated Partner Portal ("My Registration"); this
 *     page redirects partner-portal users to /partner/registration and the
 *     data layer always returns self records only.
 *
 * There is NO second Registration data model — every read goes through
 * useSchemeRegistrations() (getAll → applyAccessFilters) and every action
 * through the canonical schemeRegistrationWorkflow service. The user-facing
 * label is exactly "Registration" (never "Vendor Lock" / "Scheme
 * Registration" / "Portal Registration").
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ClipboardCheck, Plus, RefreshCw, Search, Eye, FileText, FolderKanban, Users,
  CheckCircle2, XCircle, Activity, Lock, ShieldAlert,
} from 'lucide-react';
import { useSearchParams, Navigate } from 'react-router-dom';

import { COLLECTIONS } from '../lib/firebase';
import { getAll } from '../lib/firestore';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { usePermissions, isPartnerPortalUser } from '../lib/permissions';
import { useSchemeRegistrations, useCreateSchemeRegistration } from '../features/scheme-registration/hooks/useSchemeRegistrations';
import { registrationNextActionHint, schemeRegistrationStatusLabel, SchemeRegistrationStatusBadge } from '../features/scheme-registration/components/registrationShared';
import { RegistrationDetailModal } from '../features/scheme-registration/components/RegistrationDetailModal';
import { type SchemeRegistrationRecord, type SchemeRegistrationStatus } from '../features/scheme-registration/types';
import {
  WorkspaceHero, PremiumKpi, Select as UiSelect, Pagination,
  Table, Thead, Th, Tbody, Tr, Td, SkeletonRows, EmptyState,
} from '../components/ui';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

const PER_PAGE = 10;

const STATUS_FILTERS: SchemeRegistrationStatus[] = [
  'Draft', 'Submitted', 'UnderVerification', 'VendorLocked', 'Completed', 'Rejected', 'Cancelled', 'Failed',
];

const FORM0 = {
  projectId: '', vendorName: '', schemeName: '', portalType: '' as SchemeRegistrationRecord['portalType'],
  discom: '', applicationNumber: '', portalReference: '', registrationDate: '',
  applicantName: '', applicantPhone: '', applicantEmail: '', notes: '',
};

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

export default function SchemeRegistrations() {
  const qcActive = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(qcActive);
  const perms = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  const registrationsQuery = useSchemeRegistrations();
  const createMutation = useCreateSchemeRegistration();
  const { data: projects = [] } = useQuery({
    queryKey: keys.projectsRoot,
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 60_000,
  });
  const { data: partners = [] } = useQuery({
    queryKey: keys.partnersAll,
    queryFn: () => getAll(COLLECTIONS.CHANNEL_PARTNERS),
    staleTime: 60_000,
  });

  const records = useMemo(() => (registrationsQuery.data || []) as SchemeRegistrationRecord[], [registrationsQuery.data]);
  const projectById = useMemo(() => new Map((projects as any[]).map((p) => [p.id, p])), [projects]);
  const partnerNameById = useMemo(() => new Map((partners as any[]).map((p) => [p.id, p.partnerName || p.name])), [partners]);

  // ── Filters ──
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || '');
  const [projectF, setProjectF] = useState(() => searchParams.get('project') || '');
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...FORM0 });
  const [detail, setDetail] = useState<SchemeRegistrationRecord | null>(null);

  // ── Stats ──
  const stats = useMemo(() => ({
    total: records.length,
    draft: records.filter((r) => r.status === 'Draft').length,
    submitted: records.filter((r) => r.status === 'Submitted').length,
    verification: records.filter((r) => r.status === 'UnderVerification').length,
    locked: records.filter((r) => r.status === 'VendorLocked').length,
    completed: records.filter((r) => r.status === 'Completed').length,
    rejected: records.filter((r) => r.status === 'Rejected').length,
  }), [records]);

  const filtered = useMemo(() => {
    let list = [...records];
    if (activeKpi) {
      if (activeKpi === 'verification') list = list.filter((r) => r.status === 'UnderVerification');
      else if (activeKpi !== 'total') list = list.filter((r) => r.status === activeKpi);
    }
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((r) => {
        const project = projectById.get(r.projectId) as any;
        return [
          r.registrationId, r.applicationNumber, r.portalReference, r.schemeName,
          r.partnerName, r.customerName, project?.projectId, project?.id,
        ].some((v) => String(v || '').toLowerCase().includes(q));
      });
    }
    if (statusF) list = list.filter((r) => r.status === statusF);
    if (projectF) list = list.filter((r) => r.projectId === projectF);
    list.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    return list;
  }, [records, activeKpi, search, statusF, projectF, projectById]);

  const paginated = useMemo(() => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filtered, page]);

  function syncQueueParams(next: Record<string, string | number>) {
    const sp = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => {
      if (v === '' || v === 1 || v === 'total') sp.delete(k);
      else sp.set(k, String(v));
    });
    setSearchParams(sp, { replace: true });
  }

  const activeFilterCount = [search ? 'search' : '', statusF, projectF, activeKpi && activeKpi !== 'total' ? activeKpi : ''].filter(Boolean).length;

  function clearAll() {
    setSearch(''); setStatusF(''); setProjectF(''); setActiveKpi(''); setPage(1);
    syncQueueParams({ q: '', status: '', project: '', kpi: '', page: 1 });
  }

  const isTotalDefault = !activeKpi && !search && !statusF && !projectF;
  const KPI_TILES = [
    { key: 'total', label: 'TOTAL', value: stats.total, icon: <ClipboardCheck className="h-4 w-4" />, desc: 'All registrations' },
    { key: 'Draft', label: 'DRAFT', value: stats.draft, icon: <FileText className="h-4 w-4" />, desc: 'Not yet submitted' },
    { key: 'Submitted', label: 'SUBMITTED', value: stats.submitted, icon: <Activity className="h-4 w-4" />, desc: 'Awaiting verification' },
    { key: 'verification', label: 'UNDER VERIFY', value: stats.verification, icon: <ShieldAlert className="h-4 w-4" />, desc: 'Verification in progress' },
    { key: 'VendorLocked', label: 'VENDOR LOCKED', value: stats.locked, icon: <Lock className="h-4 w-4" />, desc: 'Vendor selection locked' },
    { key: 'Completed', label: 'COMPLETED', value: stats.completed, icon: <CheckCircle2 className="h-4 w-4" />, desc: 'Survey gate open' },
    { key: 'Rejected', label: 'REJECTED', value: stats.rejected, icon: <XCircle className="h-4 w-4" />, desc: 'Returned to partner' },
  ];

  function openRecord(record: SchemeRegistrationRecord) {
    setDetail(record);
  }

  function handleCreateSubmit() {
    if (createMutation.isPending) return;
    if (!form.projectId) return toast.error('Please select a project');
    if (form.applicantPhone && !/^\d{10}$/.test(form.applicantPhone.trim())) return toast.error('A valid 10-digit mobile number is required');    createMutation.mutate(
      {
        projectId: form.projectId,
        vendorName: form.vendorName.trim() || undefined,
        schemeName: form.schemeName.trim() || undefined,
        portalType: form.portalType || undefined,
        discom: form.discom.trim() || undefined,
        applicationNumber: form.applicationNumber.trim() || undefined,
        portalReference: form.portalReference.trim() || undefined,
        registrationDate: form.registrationDate || undefined,
        applicantName: form.applicantName.trim() || undefined,
        applicantPhone: form.applicantPhone.trim() || undefined,
        applicantEmail: form.applicantEmail.trim() || undefined,
        notes: form.notes.trim() || undefined,
      },
      { onSuccess: () => { setShowForm(false); setForm({ ...FORM0 }); } },
    );
  }

  function toastError(message: string) {
    const { toast } = require('react-hot-toast') as typeof import('react-hot-toast');
    toast.error(message);
  }

  const projectOptions = [
    { label: 'All Projects', value: '' },
    ...(projects as any[])
      .filter((p: any) => ['New', 'SchemeRegistration'].includes(p.currentStage) || records.some((r) => r.projectId === p.id))
      .map((p: any) => ({ label: p.projectId || p.id, value: p.id })),
  ];

  // The open detail must reflect the freshest record from the live query data
  // (status transitions mutate the record; onChanged refetches) — never a stale
  // copy captured before the action.
  const freshDetail = detail ? (records.find((r) => r.id === detail.id) ?? detail) : null;

  // Partner-portal users belong on /partner/registration — this standalone
  // surface is for staff (Manager/TL, Management/Director, Admin). Rendered as
  // a <Navigate> AFTER all hooks (Rules of Hooks); the data layer is
  // authoritative regardless — a partner can never see another partner's
  // records here.
  const currentUser = useAppStore((s) => s.user);
  if (currentUser && isPartnerPortalUser(currentUser.role, currentUser.isSuperAdmin)) {
    return <Navigate to="/partner/registration" replace />;
  }

  if (registrationsQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
        <div className="h-10 w-72 rounded-xl bg-[var(--color-bg-sunken)] animate-pulse" />
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-7">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-[var(--color-bg-sunken)] animate-pulse" />
          ))}
        </div>
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
          <Table><thead><tr>{Array.from({ length: 8 }).map((_, i) => (
            <th key={i} className="px-4 py-2.5"><div className="skeleton h-4 w-20" /></th>
          ))}</tr></thead><SkeletonRows cols={8} rows={6} /></Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero className="gap-3" icon={<ClipboardCheck className="h-4 w-4" />}
        breadcrumbs={['Home', 'Channel Partners', 'Registrations']} title="Registration"
        statusText="Vendor Lock / Scheme Registration" statusDotColor="bg-[var(--color-primary)]"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => registrationsQuery.refetch()}>Refresh</Button>
            {perms.canCreate('scheme_registration') && (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }}>
                New Registration
              </Button>
            )}
          </>
        }
      />

      {/* KPI GRID */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-7">
        {KPI_TILES.map((k) => (
          <PremiumKpi key={k.key} label={k.label} value={k.value} icon={k.icon} description={k.desc}
            active={k.key === 'total' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
            onClick={() => {
              const nextKpi = activeKpi === k.key ? '' : k.key;
              if (k.key === 'total' && isTotalDefault) return;
              setActiveKpi(nextKpi); setPage(1);
              syncQueueParams({ kpi: nextKpi, page: 1 });
            }}
          />
        ))}
      </div>

      {/* MAIN CARD */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        <CardHeader className="flex flex-wrap items-center gap-2 px-6 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                placeholder="Search registration, application, project, partner..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); syncQueueParams({ q: e.target.value, page: 1 }); }}
              />
            </div>
            <UiSelect value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1); syncQueueParams({ status: e.target.value, page: 1 }); }}
              options={[{ label: 'All Statuses', value: '' }, ...STATUS_FILTERS.map((s) => ({ label: schemeRegistrationStatusLabel(s), value: s }))]}
              className="h-8 min-w-[130px] py-1" />
            <UiSelect value={projectF} onChange={(e) => { setProjectF(e.target.value); setPage(1); syncQueueParams({ project: e.target.value, page: 1 }); }}
              options={projectOptions} className="h-8 min-w-[140px] py-1" />
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="h-4 w-px bg-[var(--color-border)]" />
                <span className="text-xs text-[var(--color-text-muted)]">{activeFilterCount} active</span>
                <button onClick={clearAll} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">Clear All</button>
              </div>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />{filtered.length} registration{filtered.length !== 1 ? 's' : ''}
          </span>
        </CardHeader>

        <div className="flex min-h-0 flex-1 px-6 py-3">
          <div className="min-h-0 w-full overflow-auto rounded-lg border border-[var(--color-border-subtle)]">
            <Table>
              <Thead>
                <Th style={{ width: '15%', minWidth: 130 }}>Registration</Th>
                <Th style={{ width: '15%', minWidth: 130 }}>Application</Th>
                <Th style={{ width: '17%', minWidth: 150 }}>Project</Th>
                <Th style={{ width: '14%', minWidth: 130 }}>Partner</Th>
                <Th style={{ width: '12%', minWidth: 110 }}>Status</Th>
                <Th style={{ width: '14%', minWidth: 120 }}>Vendor</Th>
                <Th style={{ width: '18%', minWidth: 170 }}>Next Action</Th>
                <Th align="right" style={{ width: 90, minWidth: 90 }}>Actions</Th>
              </Thead>
              <Tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-14 text-center">
                      <EmptyState
                        icon={<ClipboardCheck className="h-9 w-9" />}
                        title={search || statusF || projectF || activeKpi ? 'No registrations match filters' : 'No registrations yet'}
                        description={search || statusF || projectF || activeKpi
                          ? undefined
                          : 'Registrations appear here once a Channel Partner (or staff) files them on a project.'}
                        action={!search && !statusF && !projectF && !activeKpi && perms.canCreate('scheme_registration') ? (
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...FORM0 }); setShowForm(true); }} className="mt-2">New Registration</Button>
                        ) : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((record) => {
                    const project = projectById.get(record.projectId) as any;
                    return (
                      <Tr key={record.id} data-record-id={record.id} role="button" tabIndex={0}
                        onClick={(e) => { if (isRowOpenIgnored(e.target)) return; openRecord(record); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecord(record); } }}
                        className="transition-colors duration-150"
                      >
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <ClipboardCheck className="h-3 w-3 text-[var(--color-text-muted)]" />
                            <span className="font-mono text-xs font-medium text-[var(--color-text)]">{record.registrationId}</span>
                          </div>
                        </Td>
                        <Td className="py-3">
                          <span className="font-mono text-xs text-[var(--color-text)]">{record.applicationNumber || record.portalReference || '—'}</span>
                        </Td>
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <FolderKanban className="h-3 w-3 text-[var(--color-text-muted)]" />
                            <span className="text-xs text-[var(--color-text)]">{project?.projectId || record.projectId}</span>
                          </div>
                        </Td>
                        <Td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <Users className="h-3 w-3 text-[var(--color-text-muted)]" />
                            <span className="text-xs text-[var(--color-text)]">{record.partnerName || partnerNameById.get(record.partnerId || '') || '—'}</span>
                          </div>
                        </Td>
                        <Td className="py-3"><SchemeRegistrationStatusBadge status={record.status} /></Td>
                        <Td className="py-3"><span className="text-xs text-[var(--color-text)]">{record.vendorName || '—'}</span></Td>
                        <Td className="py-3"><span className="text-xs text-[var(--color-text-muted)]">{registrationNextActionHint(record.status)}</span></Td>
                        <Td className="py-3" align="right">
                          <Button size="sm" variant="outline" icon={<Eye className="h-3 w-3" />}
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); openRecord(record); }}>View</Button>
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </Tbody>
            </Table>
          </div>
        </div>

        {filtered.length > PER_PAGE && (
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={PER_PAGE}
              onChange={(nextPage) => { setPage(nextPage); syncQueueParams({ page: nextPage }); }} />
          </div>
        )}
      </Card>

      {/* ── Create Form Modal (staff) ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--color-text)]">New Registration</h3>
              <button onClick={() => setShowForm(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Project *</label>
                <select value={form.projectId}
                  onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
                  <option value="">Select project</option>
                  {(projects as any[])
                    .filter((p: any) => ['New', 'SchemeRegistration'].includes(p.currentStage))
                    .map((p: any) => (
                      <option key={p.id} value={p.id}>{p.projectId || p.id} · {p.partnerName || p.customerName || ''}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Vendor</label>
                <input type="text" value={form.vendorName}
                  onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))}
                  placeholder="Locked vendor (finalized at vendor lock)" className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Scheme</label>
                  <input type="text" value={form.schemeName}
                    onChange={(e) => setForm((f) => ({ ...f, schemeName: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Portal</label>
                  <select value={form.portalType}
                    onChange={(e) => setForm((f) => ({ ...f, portalType: e.target.value as any }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
                    <option value="">Select</option>
                    <option value="pmsuryaghar">PM Surya Ghar</option>
                    <option value="discom">DISCOM</option>
                    <option value="vendor">Vendor</option>
                    <option value="state">State</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Application Number</label>
                <input type="text" value={form.applicationNumber}
                  onChange={(e) => setForm((f) => ({ ...f, applicationNumber: e.target.value }))}
                  placeholder="External portal application number" className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Portal Reference</label>
                <input type="text" value={form.portalReference}
                  onChange={(e) => setForm((f) => ({ ...f, portalReference: e.target.value }))}
                  placeholder="External portal reference / ID" className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Registration Date</label>
                  <input type="date" value={form.registrationDate}
                    onChange={(e) => setForm((f) => ({ ...f, registrationDate: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">DISCOM</label>
                  <input type="text" value={form.discom}
                    onChange={(e) => setForm((f) => ({ ...f, discom: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Applicant</label>
                  <input type="text" value={form.applicantName}
                    onChange={(e) => setForm((f) => ({ ...f, applicantName: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Phone (10 digits)</label>
                  <input type="tel" value={form.applicantPhone}
                    onChange={(e) => setForm((f) => ({ ...f, applicantPhone: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Notes</label>
                <textarea value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] resize-none" />
              </div>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-sunken)]">Cancel</button>
              <button onClick={handleCreateSubmit} disabled={createMutation.isPending}
                className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Create Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal (role-aware actions) ── */}
      {freshDetail && (
        <RegistrationDetailModal
          registration={freshDetail}
          project={projectById.get(freshDetail.projectId) as any}
          onClose={() => setDetail(null)}
          onChanged={() => registrationsQuery.refetch()}
        />
      )}
    </div>
  );
}
