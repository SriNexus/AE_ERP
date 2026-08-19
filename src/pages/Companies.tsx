/**
 * Companies — Companies & Branding workspace (Desktop Gold Standard)
 *
 * Preserves all existing business logic: multi-company support,
 * set default company, image upload, document template preview,
 * form with 3 tabs (Info & Tax, Bank Details, Logo/QR/Sign),
 * detail modal with 4 tabs (Overview, Financial, Branding, Audit).
 * Visually identical to Leads. Only business data changes.
 */

import { useState, useMemo, useCallback, useEffect, useDeferredValue, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getAll, createDocWithId, updateDocById, deleteDocById, genId, fmtDate } from '../lib/firestore';
import { logCreate, logUpdate, logDelete } from '../lib/auditLogger';
import { COLLECTIONS } from '../lib/firebase';
import { createCompanyInGroup, updateCompanyInGroup } from '../lib/groupAdmin';
import { INDIAN_STATES, type CompanyConfig } from '../config/company';
import { COMPANY_BUSINESS_MODES, DEFAULT_BUSINESS_MODE, resolveBusinessMode, type CompanyBusinessMode } from '../lib/companyBusinessMode';
import { statusBadge } from '../components/ui/Badge';
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, Pagination,
  PremiumKpi, Select, SkeletonRows, Table, Tbody, Td, Th, Thead, Tr,
  UniversalCheckbox, WorkspaceHero } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { Input, Select as InputSelect, Textarea, FormRow, FormSection } from '../components/ui/Input';
import { Plus, Trash2, Edit2, Building2, RefreshCw, UploadCloud, X, Image as ImageIcon, Eye,
  Users, CheckCircle2, Clock, FileText, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { compressImageBase64 } from '../lib/imageUtils';
import { DocumentTemplateResolver } from '../templates/documents/resolver';

const STATE_OPTS = [{label:'Select State',value:''},...INDIAN_STATES.map(s=>({label:s,value:s}))];
const FORM0: any = { name:'', shortName:'', companyCode:'', tagline:'', address:'', city:'', state:'', pincode:'', phone:'', email:'', website:'', gst:'', pan:'', cin:'', bankName:'', bankAccount:'', bankIfsc:'', bankBranch:'', currency:'INR', currencySymbol:'₹', status:'Active', primaryColor:'#4f46e5', accentColor:'#10b981', logo:'', iconLogo:'', qrCode:'', signature:'', isDefault: false, businessMode: DEFAULT_BUSINESS_MODE };

const BUSINESS_MODE_INFO: Record<CompanyBusinessMode, { label: string; hint: string }> = {
  B2B: { label: 'B2B — Material Distribution', hint: 'This company sells solar materials to business/EPC buyers, who install them at their own customer’s site. No Projects, Surveys, Engineering, Installations, or QC — only Leads, Customers, Quotations, Orders, Invoices, Payments, and Dispatch.' },
  B2C: { label: 'B2C — Direct Installation', hint: 'This company performs the solar installation itself (Residential, Commercial, or Industrial). Full Project lifecycle available: Survey, Engineering, Installation, QC, Commissioning, Net Metering, Subsidy, Handover, AMC.' },
  Both: { label: 'Both', hint: 'This company runs both workflows side by side. B2B and B2C customers and data remain fully segregated — marking a project “Commercial” or “Industrial” never makes it B2B.' },
};

const TABS = ['Info & Tax', 'Bank Details', 'Logo / QR / Sign'] as const;
type Tab = typeof TABS[number];

/* ── Helpers ─────────────────────────────────────────────────────────── */
function MutedValue({ children = 'Not available' }: { children?: React.ReactNode }) {
  return <span className="text-[var(--color-text-muted)]">{children}</span>;
}

function LeadField({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{children ?? value ?? <MutedValue />}</div>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function isRowOpenIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button,a,input,select,textarea,[data-action],[data-interactive]'));
}

const PER_PAGE = 15;
const KPI_CONFIGS = [
  { key: '',    label: 'TOTAL COMPANIES',  icon: Building2,    color: 'text-gray-400' },
  { key: 'active', label: 'ACTIVE',         icon: CheckCircle2, color: 'text-emerald-500' },
  { key: 'gst',    label: 'GST CONFIGURED', icon: FileText,     color: 'text-purple-500' },
  { key: 'inactive', label: 'INACTIVE',     icon: Ban,          color: 'text-red-500' },
  { key: 'new',     label: 'NEW THIS MONTH',icon: Clock,        color: 'text-blue-500' },
  { key: 'employees', label: 'TOTAL EMPLOYEES', icon: Users,    color: 'text-amber-500', noClick: true },
];

export default function Companies() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const { setCompany, activeCompanyId } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch]     = useState(() => searchParams.get('q') || '');
  const [page, setPage]         = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [perPage, setPerPage]   = useState(() => Math.max(1, Number(searchParams.get('perPage')) || PER_PAGE));
  const [activeKpi, setActiveKpi] = useState(() => searchParams.get('kpi') || '');
  const [sortKey, setSortKey]   = useState('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState<string|null>(null);
  const [form, setForm]         = useState({...FORM0});
  const [statusF, setStatusF]     = useState(() => searchParams.get('statusF') || '');
  const [activeTab, setActiveTab] = useState<Tab>('Info & Tax');
  const [viewItem, setViewItem] = useState<any>(null);
  const [delId, setDelId]       = useState<string|null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'financial' | 'branding' | 'audit'>('overview');
  const openParam = searchParams.get('open') || '';
  const createParam = searchParams.get('create') || '';
  const deferredSearch = useDeferredValue(search);
  const lastClosedParamRef = useRef<string | null>(null);

  const { data: companies=[], isLoading, isError, refetch } = useQuery({ queryKey:['companies'], queryFn:()=>getAll(COLLECTIONS.COMPANIES), staleTime:30000 });

  const save = useMutation({
    mutationFn: async (d:any) => {
      // Phase 5 (§7.3): a Group Admin creates/edits companies through the
      // group-scoped write path — the generic helpers strip groupId for
      // companies, but the companies create/update rules REQUIRE the request
      // to carry groupId == the actor's authoritative Group (never a form
      // field; rules reject any other value). Other actors keep the existing
      // path exactly.
      if (user?.role === 'GroupAdmin') {
        if (editId) {
          await updateCompanyInGroup(editId, d);
          if (editId === activeCompanyId) setCompany(d);
        } else {
          await createCompanyInGroup(d);
        }
        return;
      }
      if (editId) {
        // F-16 (Phase 0): audit company edits (previously unlogged).
        const existing = companies.find((c:any) => c.id === editId);
        await updateDocById(COLLECTIONS.COMPANIES, editId, d);
        if (editId === activeCompanyId) setCompany(d);
        await logUpdate('company', editId, existing ? { ...existing } : {}, { ...d }, 'companies');
      } else {
        const id=genId.generic('CO');
        await createDocWithId(COLLECTIONS.COMPANIES, id, {...d, id, createdBy:user.id});
        // F-16 (Phase 0): audit company creation.
        await logCreate('company', id, {...d, id}, 'companies');
      }
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['companies']}); qc.invalidateQueries({queryKey:['companies_default']}); toast.success(editId?'Updated':'Company added'); closeForm(); },
    onError: (e:any) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id:string) => {
      const all = companies as any[];
      for (const c of all) {
        if (c.isDefault && c.id !== id) {
          await updateDocById(COLLECTIONS.COMPANIES, c.id, { isDefault: false });
        }
      }
      await updateDocById(COLLECTIONS.COMPANIES, id, { isDefault: true });
      const target = all.find((c:any) => c.id === id);
      if (target) setCompany({ ...target, isDefault: true } as any);
    },
    onSuccess: () => { qc.invalidateQueries({queryKey:['companies']}); qc.invalidateQueries({queryKey:['companies_default']}); toast.success('Default company updated'); },
    onError: (e:any) => toast.error(e.message),
  });

  const del = useMutation({ mutationFn:async (id:string)=>{ await deleteDocById(COLLECTIONS.COMPANIES,id); await logDelete('company', id, undefined, 'companies'); }, onSuccess:()=>{qc.invalidateQueries({queryKey:['companies']});toast.success('Deleted');setDelId(null);} });

  // ── URL sync ──────────────────────────────────────────────────────
  function syncQueueParams(overrides: Record<string, string | number>) {
    const next = new URLSearchParams(searchParams);
    const entries: Record<string, string | number> = { q: deferredSearch, kpi: activeKpi, statusF, page, ...overrides };
    Object.entries(entries).forEach(([k, v]) => {
      const val = String(v);
      if (val && val !== '' && val !== '1') next.set(k, val); else next.delete(k);
    });
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    syncQueueParams({ q: deferredSearch, kpi: activeKpi, page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredSearch, activeKpi, statusF, page, sortKey, sortDesc]);

  // ── Open param effect ─────────────────────────────────────────────
  useEffect(() => {
    if (lastClosedParamRef.current === openParam) { lastClosedParamRef.current = null; return; }
    if (createParam === '1') { setForm({...FORM0}); setEditId(null); setShowForm(true); return; }
    if (!openParam || isLoading) return;
    const found = (companies as any[]).find(c => c.id === openParam);
    if (found) { setDetailTab('overview'); setViewItem(found); }
  }, [openParam, createParam, companies, isLoading]);

  function closeForm() { setShowForm(false); setEditId(null); setForm({...FORM0}); setActiveTab('Info & Tax'); }
  function openEdit(c:any) { setForm({...FORM0, ...c}); setEditId(c.id); setShowForm(true); setActiveTab('Info & Tax'); }
  function handleSubmit(e:React.FormEvent) { e.preventDefault(); if(!form.name) return toast.error('Company name required'); save.mutate(form); }

  // ── KPI stats ─────────────────────────────────────────────────────
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const stats = useMemo(() => ({
    total: companies.length,
    active: (companies as any[]).filter((c:any) => c.status === 'Active').length,
    gst: (companies as any[]).filter((c:any) => c.gst).length,
    inactive: (companies as any[]).filter((c:any) => c.status !== 'Active').length,
    newThisMonth: (companies as any[]).filter((c:any) => c.createdAt && c.createdAt >= thirtyDaysAgo).length,
    totalEmployees: 0,
  }), [companies]);


  // ── Filtering & Sorting ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...(companies as any[])];
    if (activeKpi === 'active') list = list.filter(c => c.status === 'Active');
    else if (activeKpi === 'gst') list = list.filter(c => c.gst);
    else if (activeKpi === 'inactive') list = list.filter(c => c.status !== 'Active');
    else if (activeKpi === 'new') list = list.filter(c => c.createdAt && c.createdAt >= thirtyDaysAgo);
    if (statusF) list = list.filter(c => c.status === statusF);
    const q = deferredSearch.toLowerCase();
    if (q) list = list.filter(c=>[c.name,c.shortName,c.city,c.gst,c.email,c.companyCode].some((v:any)=>String(v||'').toLowerCase().includes(q)));
    list.sort((a:any, b:any) => {
      const va = String(a[sortKey] || ''), vb = String(b[sortKey] || '');
      return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
    });
    return list;
  }, [companies, deferredSearch, activeKpi, statusF, sortKey, sortDesc, thirtyDaysAgo]);

  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── TDZ-safe: toggleAll & allSel defined AFTER paginated ──────────
  const toggleAll = () => setSelected(s => s.size === paginated.length ? new Set() : new Set(paginated.map((c: any) => c.id)));
  const allSel = selected.size === paginated.length && paginated.length > 0;

  const toggleSelect = useCallback((id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);

  function sort(k: string) { if (sortKey === k) setSortDesc(d => !d); else { setSortKey(k); setSortDesc(true); } }

  function clearAll() {
    setSearch(''); setActiveKpi(''); setStatusF(''); setPage(1); setSelected(new Set());
    syncQueueParams({ q: '', kpi: '', statusF: '', page: 1 });
  }

  // ── Image Upload Handler ──────────────────────────────────────────
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, field: 'logo'|'iconLogo'|'qrCode'|'signature') {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error('File size must be under 2MB');
    const toastId = toast.loading(`Processing ${field}...`);
    try { const base64 = await compressImageBase64(file); setForm((prev: any) => ({ ...prev, [field]: base64 })); toast.success(`${field} attached`, { id: toastId }); }
    catch (err: any) { toast.error(err.message, { id: toastId }); }
  }

  function handlePreviewPI() {
    const dummyOrder = { id: 'ORD-DEMO-001', customer: 'Demo Client Pvt Ltd', date: new Date().toISOString(), dueDate: new Date().toISOString(), subtotal: 100000, taxAmount: 18000, total: 118000, discount: 0 };
    const dummyItems = [{ product: 'Demo Solar Inverter 5kW', qty: 2, price: 35000, tax: 18, unit: 'NOS' }, { product: 'Demo Solar Panels 540W', qty: 10, price: 3000, tax: 18, unit: 'NOS' }];
    const html = DocumentTemplateResolver(form as CompanyConfig, 'PROFORMA INVOICE', { ...dummyOrder, items: dummyItems });
    const win = window.open('', '_blank', 'width=800,height=600');
    if (win) { win.document.write(html); win.document.close(); }
  }

  // ── Bulk actions ──────────────────────────────────────────────────
  function handleBulkDelete() {
    if (!selected.size) return;
    const ids = Array.from(selected);
    Promise.all(ids.map(id => del.mutateAsync(id))).then(() => {
      qc.invalidateQueries({queryKey:['companies']});
      setSelected(new Set());
      toast.success(`Deleted ${ids.length} company${ids.length > 1 ? 'ies' : 'y'}`);
    });
  }

  function handleExport() {
    const data = selected.size > 0 ? (companies as any[]).filter((c:any) => selected.has(c.id)) : (companies as any[]);
    const rows = data.map((c:any) => ({
      Name: c.name, Code: c.companyCode || c.shortName || '', City: c.city || '', State: c.state || '',
      GST: c.gst || '', Phone: c.phone || '', Status: c.status || 'Active',
      Added: fmtDate(c.createdAt),
    }));
    const header = Object.keys(rows[0] || {}).join(',');
    const csv = [header, ...rows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `companies_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function handleKpiClick(kpiKey: string) {
    if (!kpiKey) return;
    const nextKpi = activeKpi === kpiKey ? '' : kpiKey;
    setActiveKpi(nextKpi); setPage(1);
    syncQueueParams({ kpi: nextKpi, page: 1 });
  }

  const hasActiveFilters = deferredSearch || activeKpi || statusF;

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero title="Companies"
        icon={<Building2 className="h-5 w-5" />}
        breadcrumbs={['Home', 'Settings', 'Companies']}
        statusText={isLoading ? 'Loading...' : `${companies.length} companies`}
        statusDotColor={isLoading ? 'yellow' : isError ? 'red' : 'green'}
        actions={
          <>
            <Button size="sm" variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()} />
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({...FORM0}); setEditId(null); setShowForm(true); }}>Add Company</Button>
          </>
        }
      />

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-6 gap-2">
        {KPI_CONFIGS.map(k => {
          const Icon = k.icon;
          let val: number;
          switch (k.key) {
            case 'active': val = stats.active; break;
            case 'gst': val = stats.gst; break;
            case 'inactive': val = stats.inactive; break;
            case 'new': val = stats.newThisMonth; break;
            case 'employees': val = stats.totalEmployees; break;
            default: val = stats.total; break;
          }
          return (
            <PremiumKpi key={k.key}
              label={k.label}
              value={k.noClick ? '—' : val}
              icon={<Icon className={`h-5 w-5 ${k.color}`} />}
              active={k.noClick ? false : activeKpi === k.key}
              onClick={k.noClick ? undefined : () => handleKpiClick(k.key)}
            />
          );
        })}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-[var(--shadow-enterprise-surface)]">
        {/* ── Bulk Action Bar ────────────────────────────────────────── */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-2.5 rounded-t-xl">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleExport}>Export CSV</Button>
              <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={handleBulkDelete}>Delete</Button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">✕ Clear</button>
            </div>
          </div>
        )}

        {/* ── CardHeader: Filters ────────────────────────────────────── */}
        <CardHeader className="flex flex-wrap items-center gap-2.5 px-4 py-2 border-b border-[var(--color-border-subtle)]">
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name, GST, code..."
            className="min-w-48 max-w-sm flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm text-[var(--color-text)] shadow-[var(--shadow-enterprise-control)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-focus-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
          <Select aria-label="Status" value={activeKpi ? '' : statusF}
            options={[{ label: 'Active', value: 'active' }, { label: 'Inactive', value: 'inactive' }]}
            onChange={v => { setStatusF(v.target.value); setPage(1); }} className="min-w-[140px]" />
          <span className={`ml-auto flex h-6 w-6 items-center justify-center rounded-full ${hasActiveFilters ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className="h-2 w-2 rounded-full bg-white" />
          </span>
        </CardHeader>

        {/* ── Active Filter Pills ───────────────────────────────────── */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] px-4 py-1.5">
            {activeKpi && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-primary-text)]">
                {KPI_CONFIGS.find(k => k.key === activeKpi)?.label || activeKpi}
                <button onClick={() => { setActiveKpi(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button>
              </span>
            )}
            {deferredSearch && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-hover)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-text-muted)]">
                Search: "{deferredSearch}"
                <button onClick={() => setSearch('')} className="ml-0.5 hover:opacity-70">✕</button>
              </span>
            )}
            {statusF && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-hover)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-text-muted)]">
                Status: {statusF}
                <button onClick={() => { setStatusF(''); setPage(1); }} className="ml-0.5 hover:opacity-70">✕</button>
              </span>
            )}
            <button onClick={clearAll} className="ml-auto text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors">Clear All</button>
          </div>
        )}

        {/* ── Scrollable Table ───────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <Thead>
              <Th className="w-8">
                <UniversalCheckbox checked={allSel} onChange={toggleAll} indeterminate={selected.size > 0 && !allSel} />
              </Th>
              <Th sortable sorted={sortKey === 'name'} desc={sortDesc} onSort={() => sort('name')}>COMPANY</Th>
              <Th sortable sorted={sortKey === 'companyCode'} desc={sortDesc} onSort={() => sort('companyCode')}>CODE</Th>
              <Th>CITY/STATE</Th>
              <Th>GST</Th>
              <Th>PHONE</Th>
              <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')}>STATUS</Th>
              <Th sortable sorted={sortKey === 'createdAt'} desc={sortDesc} onSort={() => sort('createdAt')}>ADDED</Th>
              <Th>ACTIONS</Th>
            </Thead>
            <Tbody>
              {isError ? (
                <tr><td colSpan={9} className="py-14 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Building2 className="h-10 w-10 text-[var(--color-text-disabled)]" />
                    <p className="text-sm text-[var(--color-text-muted)]">Failed to load companies.</p>
                    <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                  </div>
                </td></tr>
              ) : isLoading ? (
                <SkeletonRows cols={9} />
              ) : paginated.length === 0 ? (
                <tr><td colSpan={9} className="py-14 text-center">
                  <EmptyState icon={<Building2 className="h-10 w-10" />}
                    title={search || activeKpi ? 'No companies match filters' : 'No companies configured yet.'}
                    action={(!search && !activeKpi) ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({...FORM0}); setEditId(null); setShowForm(true); }}>Add Company</Button> : undefined}
                  />
                </td></tr>
              ) : paginated.map((c:any) => (
                <Tr key={c.id} selected={selected.has(c.id)}
                  data-record-id={c.id} role="button" tabIndex={0}
                  onClick={(e) => { if (!isRowOpenIgnored(e.target)) { setDetailTab('overview'); setViewItem(c); } }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailTab('overview'); setViewItem(c); } }}
                  className="group cursor-pointer outline-none transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset">
                  <Td>
                    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                      <UniversalCheckbox checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {c.logo ? (
                        <img src={c.logo} alt="logo" className="h-8 w-auto max-w-[60px] rounded object-contain" />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm" style={{backgroundColor:c.primaryColor||'#4f46e5'}}>{(c.shortName||c.name||'?')[0].toUpperCase()}</div>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-[var(--color-text)]">{c.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
                          {c.tagline||''}
                          <span className="inline-flex items-center rounded-full bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">{resolveBusinessMode(c)}</span>
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-xs font-semibold text-[var(--color-primary-text)]">{c.companyCode||c.shortName||'—'}</Td>
                  <Td className="text-xs"><p>{c.city||'—'}</p><p className="text-[var(--color-text-muted)]">{c.state||''}</p></Td>
                  <Td className="font-mono text-xs text-[var(--color-text-muted)]">{c.gst||'—'}</Td>
                  <Td className="text-xs">{c.phone||'—'}</Td>
                  <Td><span data-interactive onClick={(e) => e.stopPropagation()}>{statusBadge(c.status||'Active')}</span></Td>
                  <Td className="text-xs text-[var(--color-text-muted)]">{fmtDate(c.createdAt)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1 opacity-75 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" data-action>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDetailTab('overview'); setViewItem(c); }}
                        className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-3 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-enterprise-control)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[var(--shadow-enterprise-row)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                      {!c.isDefault && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setDefault.mutate(c.id); }}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-warning-text)] hover:bg-[var(--color-warning-light)] transition-colors" title="Set as Default Company">
                          ⭐ Default
                        </button>
                      )}
                      {c.isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary-light)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-primary-text)]">
                          ⭐ Default
                        </span>
                      )}
                      <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors" title="Edit">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDelId(c.id); }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-danger)] hover:bg-[var(--color-danger-light)] transition-colors" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>

        {/* ── Pagination Footer ──────────────────────────────────────── */}
        <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
          <Pagination page={page} total={filtered.length} perPage={perPage}
            onChange={p => { setPage(p); syncQueueParams({ page: p }); }}
            onPerPageChange={n => { setPerPage(n); setPage(1); syncQueueParams({ perPage: n, page: 1 }); }} />
        </div>
      </Card>

      {/* ── Form Modal (3 tabs) ─────────────────────────────────────── */}
      <Modal open={showForm} onClose={closeForm} title={editId ? `Edit Company — ${form.name}` : 'Add Company'} size="xl">
        <div className="flex gap-2 bg-[var(--color-bg-sunken)] p-1.5 rounded-xl mb-6">
          {TABS.map(tab => (
            <button key={tab} type="button" onClick={()=>setActiveTab(tab)}
              className={`flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab===tab ? 'bg-[var(--color-surface)] text-[var(--color-primary-text)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}>
              {tab === 'Info & Tax' && '🏢 '}
              {tab === 'Bank Details' && '🏦 '}
              {tab === 'Logo / QR / Sign' && '🖼️ '}
              {tab}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 pb-6">

          {/* TAB 1: INFO & TAX */}
          {activeTab === 'Info & Tax' && (
            <div className="space-y-5 animate-fadeIn">
              <FormSection title="Company Identity">
                <div className="flex items-center gap-2 mb-4 bg-[var(--color-primary-light)] border border-[var(--color-primary-muted)] p-3 rounded-xl w-fit">
                  <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={e=>setForm({...form,isDefault:e.target.checked})} className="rounded text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)] h-4 w-4"/>
                  <label htmlFor="isDefault" className="text-sm font-semibold text-[var(--color-primary-text)] cursor-pointer">Global Default ERP Company</label>
                  <span className="text-xs text-[var(--color-primary-text)] ml-2 opacity-70">(Used for login & sidebar branding)</span>
                </div>

                <div className="mb-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Business Mode</p>
                  <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
                    B2B = selling materials to a business/EPC buyer who installs it themselves. B2C = this company performs the installation
                    (Residential, Commercial, or Industrial project types are all B2C). These are never the same thing — a Commercial or
                    Industrial project is still B2C when Neozy does the install.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {COMPANY_BUSINESS_MODES.map((mode) => (
                      <label key={mode}
                        className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors ${form.businessMode === mode ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'}`}>
                        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                          <input type="radio" name="businessMode" value={mode} checked={form.businessMode === mode}
                            onChange={() => setForm({ ...form, businessMode: mode })}
                            className="text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)]" />
                          {BUSINESS_MODE_INFO[mode].label}
                        </span>
                        <span className="text-[11px] text-[var(--color-text-muted)]">{BUSINESS_MODE_INFO[mode].hint}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <FormRow>
                  <Input label="Company Name" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full legal name"/>
                  <Input label="Short Name" value={form.shortName} onChange={e=>setForm({...form,shortName:e.target.value})} placeholder="e.g. CGPL, STS"/>
                </FormRow>
                <FormRow>
                  <Input label="Company Code" required value={form.companyCode} onChange={e=>setForm({...form,companyCode:e.target.value})} hint="Used to identify company in PI templates"/>
                  <Input label="Tagline" value={form.tagline} onChange={e=>setForm({...form,tagline:e.target.value})}/>
                </FormRow>
                <FormRow>
                  <Input label="Phone" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
                  <Input label="Email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
                </FormRow>
                <Input label="Website" value={form.website} onChange={e=>setForm({...form,website:e.target.value})} placeholder="www.example.com"/>
              </FormSection>

              <FormSection title="Address">
                <Textarea label="Full Address" value={form.address} onChange={e=>setForm({...form,address:e.target.value})} rows={2}/>
                <FormRow cols={3}>
                  <Input label="City" value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/>
                  <InputSelect label="State" value={form.state} onChange={e=>setForm({...form,state:e.target.value})} options={STATE_OPTS}/>
                  <Input label="Pincode" value={form.pincode} onChange={e=>setForm({...form,pincode:e.target.value})}/>
                </FormRow>
              </FormSection>

              <FormSection title="Tax & Legal">
                <FormRow>
                  <Input label="GST Number" value={form.gst} onChange={e=>setForm({...form,gst:e.target.value.toUpperCase()})}/>
                  <Input label="PAN Number" value={form.pan} onChange={e=>setForm({...form,pan:e.target.value.toUpperCase()})}/>
                </FormRow>
                <Input label="CIN Number" value={form.cin} onChange={e=>setForm({...form,cin:e.target.value})}/>
              </FormSection>
            </div>
          )}

          {/* TAB 2: BANK DETAILS */}
          {activeTab === 'Bank Details' && (
            <div className="space-y-5 animate-fadeIn">
              <FormSection title="Bank Information">
                <FormRow>
                  <Input label="Bank Name" value={form.bankName} onChange={e=>setForm({...form,bankName:e.target.value})}/>
                  <Input label="Account Number" value={form.bankAccount} onChange={e=>setForm({...form,bankAccount:e.target.value})}/>
                </FormRow>
                <FormRow>
                  <Input label="IFSC Code" value={form.bankIfsc} onChange={e=>setForm({...form,bankIfsc:e.target.value})}/>
                  <Input label="Branch" value={form.bankBranch} onChange={e=>setForm({...form,bankBranch:e.target.value})}/>
                </FormRow>
              </FormSection>
              <FormSection title="Currency & Tracking">
                <FormRow cols={3}>
                  <Input label="Currency" value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})} placeholder="INR"/>
                  <Input label="Currency Symbol" value={form.currencySymbol} onChange={e=>setForm({...form,currencySymbol:e.target.value})} placeholder="₹"/>
                  <InputSelect label="Status" value={form.status} onChange={e=>setForm({...form,status:e.target.value})} options={['Active','Inactive'].map(s=>({label:s,value:s}))}/>
                </FormRow>
              </FormSection>
            </div>
          )}

          {/* TAB 3: LOGO / QR / SIGNATURE */}
          {activeTab === 'Logo / QR / Sign' && (
            <div className="space-y-5 animate-fadeIn">

              <FormSection title="Document Branding Colors">
                <FormRow>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Primary Color (Headers/Tables)</label>
                    <div className="flex items-center gap-3">
                      <input type="color" value={form.primaryColor} onChange={e=>setForm({...form,primaryColor:e.target.value})} className="h-10 w-20 rounded-lg border border-[var(--color-border)] cursor-pointer p-1 bg-[var(--color-surface)]"/>
                      <span className="text-sm font-mono text-[var(--color-text-muted)]">{form.primaryColor}</span>
                    </div>
                  </div>
                </FormRow>
              </FormSection>

              {/* ── Sidebar Logos ──────────────────────────────────────────────── */}
              <FormSection title="Sidebar Logos">
                <p className="text-xs text-[var(--color-text-muted)] -mt-3 mb-4">
                  Two logo variants power the sidebar branding system. Both are stored as base64 and never leave your Firestore.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

                  {/* FULL LOGO — expanded sidebar */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--color-primary-light)] text-[var(--color-primary-text)] text-[10px] font-bold uppercase tracking-wider">Expanded</span>
                      <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Full Logo</label>
                    </div>
                    <p className="text-[11px] text-muted dark:text-muted">Wide horizontal logo with company name text. Used when sidebar is hovered/expanded.</p>
                    <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] h-28 flex flex-col items-center justify-center relative overflow-hidden group transition-colors hover:border-[var(--color-primary)]">
                      {form.logo ? (
                        <>
                          <div className="w-full h-full flex items-center justify-center p-3">
                            <img src={form.logo} alt="Full Logo" className="max-h-full max-w-full object-contain" />
                          </div>
                          <button type="button" onClick={()=>setForm({...form,logo:''})}
                            className="absolute top-1.5 right-1.5 bg-[var(--color-danger)] text-white rounded-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                            <X className="h-3 w-3"/>
                          </button>
                          <div className="absolute bottom-1.5 left-1.5">
                            <span className="text-[9px] bg-[var(--color-success-light)] text-[var(--color-success-text)] px-1.5 py-0.5 rounded font-semibold">Uploaded</span>
                          </div>
                        </>
                      ) : (
                        <label className="flex flex-col items-center cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-primary-text)] w-full h-full justify-center gap-2 transition-colors">
                          <UploadCloud className="h-7 w-7"/>
                          <div className="text-center">
                            <span className="text-xs font-semibold block">Upload Full Logo</span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">PNG, SVG — recommended 300×64px</span>
                          </div>
                          <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, 'logo')} />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* ICON LOGO — collapsed sidebar */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--color-warning-light)] text-[var(--color-warning-text)] text-[10px] font-bold uppercase tracking-wider">Collapsed</span>
                      <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Icon Logo</label>
                    </div>
                    <p className="text-[11px] text-[var(--color-text-muted)]">Square/circle icon only — no text. Used when sidebar is in slim 64px collapsed state.</p>
                    <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] h-28 flex flex-col items-center justify-center relative overflow-hidden group transition-colors hover:border-[var(--color-warning)]">
                      {form.iconLogo ? (
                        <>
                          <div className="w-full h-full flex items-center justify-center p-3">
                            <img src={form.iconLogo} alt="Icon Logo" className="max-h-full max-w-full object-contain" />
                          </div>
                          <button type="button" onClick={()=>setForm({...form,iconLogo:''})}
                            className="absolute top-1.5 right-1.5 bg-[var(--color-danger)] text-white rounded-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                            <X className="h-3 w-3"/>
                          </button>
                          <div className="absolute bottom-1.5 left-1.5">
                            <span className="text-[9px] bg-[var(--color-success-light)] text-[var(--color-success-text)] px-1.5 py-0.5 rounded font-semibold">Uploaded</span>
                          </div>
                        </>
                      ) : (
                        <label className="flex flex-col items-center cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-warning-text)] w-full h-full justify-center gap-2 transition-colors">
                          <ImageIcon className="h-7 w-7"/>
                          <div className="text-center">
                            <span className="text-xs font-semibold block">Upload Icon Logo</span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">PNG, SVG — recommended 64×64px</span>
                          </div>
                          <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, 'iconLogo')} />
                        </label>
                      )}
                    </div>
                    {!form.iconLogo && form.logo && (
                      <p className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                        <span className="text-[var(--color-warning-text)]">⚠</span> Not uploaded — sidebar will fall back to full logo in collapsed mode.
                      </p>
                    )}
                  </div>
                </div>

                {/* Live sidebar preview strip */}
                {(form.logo || form.iconLogo) && (
                  <div className="mt-4 p-3 bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)]">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] mb-2">Sidebar Preview</p>
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-10 h-10 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center p-1.5 shadow-sm">
                          <img src={form.iconLogo || form.logo} alt="icon" className="max-h-full max-w-full object-contain" />
                        </div>
                        <span className="text-[9px] text-[var(--color-text-muted)]">Collapsed</span>
                      </div>
                      <div className="h-8 w-px bg-[var(--color-border)]" />
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-40 h-10 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center px-3 shadow-sm">
                          <img src={form.logo || form.iconLogo} alt="full" className="max-h-[28px] max-w-full object-contain" />
                        </div>
                        <span className="text-[9px] text-[var(--color-text-muted)]">Expanded</span>
                      </div>
                    </div>
                  </div>
                )}
              </FormSection>

              {/* ── Document Assets ─────────────────────────────────────────────── */}
              <FormSection title="Document Assets (Max 2MB)">
                <p className="text-xs text-[var(--color-text-muted)] -mt-3 mb-4">
                  Used in Proforma Invoices, Quotations, and Dispatch Challans.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

                  {/* QR CODE */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Payment QR Code</label>
                    <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] h-28 flex flex-col items-center justify-center relative overflow-hidden group transition-colors hover:border-[var(--color-primary)]">
                      {form.qrCode ? (
                        <>
                          <div className="w-full h-full flex items-center justify-center p-3">
                            <img src={form.qrCode} alt="QR" className="max-h-full max-w-full object-contain" />
                          </div>
                          <button type="button" onClick={()=>setForm({...form,qrCode:''})}
                            className="absolute top-1.5 right-1.5 bg-[var(--color-danger)] text-white rounded-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                            <X className="h-3 w-3"/>
                          </button>
                          <div className="absolute bottom-1.5 left-1.5">
                            <span className="text-[9px] bg-[var(--color-success-light)] text-[var(--color-success-text)] px-1.5 py-0.5 rounded font-semibold">Uploaded</span>
                          </div>
                        </>
                      ) : (
                        <label className="flex flex-col items-center cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-primary-text)] w-full h-full justify-center gap-2 transition-colors">
                          <ImageIcon className="h-7 w-7"/>
                          <div className="text-center">
                            <span className="text-xs font-semibold block">Upload QR Code</span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">PNG recommended — square format</span>
                          </div>
                          <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, 'qrCode')} />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* SIGNATURE */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Auth. Signature</label>
                    <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] h-28 flex flex-col items-center justify-center relative overflow-hidden group transition-colors hover:border-[var(--color-primary)]">
                      {form.signature ? (
                        <>
                          <div className="w-full h-full flex items-center justify-center p-3">
                            <img src={form.signature} alt="Signature" className="max-h-full max-w-full object-contain" />
                          </div>
                          <button type="button" onClick={()=>setForm({...form,signature:''})}
                            className="absolute top-1.5 right-1.5 bg-[var(--color-danger)] text-white rounded-lg p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                            <X className="h-3 w-3"/>
                          </button>
                          <div className="absolute bottom-1.5 left-1.5">
                            <span className="text-[9px] bg-[var(--color-success-light)] text-[var(--color-success-text)] px-1.5 py-0.5 rounded font-semibold">Uploaded</span>
                          </div>
                        </>
                      ) : (
                        <label className="flex flex-col items-center cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-primary-text)] w-full h-full justify-center gap-2 transition-colors">
                          <ImageIcon className="h-7 w-7"/>
                          <div className="text-center">
                            <span className="text-xs font-semibold block">Upload Signature</span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">PNG with transparent background</span>
                          </div>
                          <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, 'signature')} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </FormSection>

              <div className="bg-[var(--color-primary-light)] border border-[var(--color-primary-muted)] rounded-xl p-4 flex items-center justify-between mt-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-primary-text)]">Live Document Template Preview</p>
                  <p className="text-xs text-[var(--color-primary-text)] opacity-70 mt-1">See how your PI / Invoices will look with these settings.</p>
                </div>
                <Button type="button" variant="primary" onClick={handlePreviewPI}>Preview PI Template</Button>
              </div>

            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-4 mt-6">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{editId?'Update Company':'Add Company'}</Button>
          </div>
        </form>
      </Modal>

      {/* ── Detail View Modal ───────────────────────────────────────────── */}
      <Modal open={!!viewItem} onClose={() => setViewItem(null)} size="2xl">
        {viewItem && (() => {
          const tabs = [
            { key: 'overview' as const, label: 'Overview' },
            { key: 'financial' as const, label: 'Financial' },
            { key: 'branding' as const, label: 'Branding' },
            { key: 'audit' as const, label: 'Audit' },
          ];
          return (
            <div className="flex h-[70vh] max-h-[700px] min-h-0 flex-col">
              {/* Header */}
              <div className="shrink-0 flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-4">
                <div className="flex items-center gap-3">
                  {viewItem.logo ? (
                    <img src={viewItem.logo} alt="" className="h-14 w-auto max-w-[60px] rounded object-contain" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl font-bold text-white" style={{backgroundColor:viewItem.primaryColor||'#4f46e5'}}>
                      {(viewItem.shortName||viewItem.name||'?')[0].toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h2 className="text-xl font-bold text-[var(--color-text)]">{viewItem.name}</h2>
                    <p className="text-xs text-[var(--color-text-muted)]">{viewItem.tagline || viewItem.companyCode || ''}</p>
                  </div>
                </div>
                <button onClick={() => setViewItem(null)} className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="shrink-0 flex gap-1 border-b border-[var(--color-border-subtle)] py-3">
                {tabs.map(tab => (
                  <button key={tab.key} onClick={() => setDetailTab(tab.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      detailTab === tab.key
                        ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pt-4">
                {detailTab === 'overview' && (
                  <div className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <LeadField label="Company Name" value={viewItem.name} />
                      <LeadField label="Short Name">{viewItem.shortName || <MutedValue />}</LeadField>
                      <LeadField label="Company Code" value={viewItem.companyCode || <MutedValue />} />
                      <LeadField label="Status">{statusBadge(viewItem.status || 'Active')}</LeadField>
                      <LeadField label="Business Mode" value={BUSINESS_MODE_INFO[resolveBusinessMode(viewItem)].label} />
                    </div>
                    <DetailCard title="Contact & Address">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LeadField label="Phone" value={viewItem.phone || <MutedValue />} />
                        <LeadField label="Email" value={viewItem.email || <MutedValue />} />
                        <LeadField label="Address" children={<p className="text-sm text-[var(--color-text-secondary)]">{[viewItem.address, viewItem.city, viewItem.state, viewItem.pincode].filter(Boolean).join(', ') || <MutedValue />}</p>} />
                        <LeadField label="Website">{viewItem.website || <MutedValue />}</LeadField>
                      </div>
                    </DetailCard>
                    <DetailCard title="Tax Info">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <LeadField label="GST" value={viewItem.gst || <MutedValue />} />
                        <LeadField label="PAN" value={viewItem.pan || <MutedValue />} />
                        <LeadField label="CIN" value={viewItem.cin || <MutedValue />} />
                      </div>
                    </DetailCard>
                    {viewItem.isDefault ? (
                      <div className="rounded-xl bg-[var(--color-primary-light)] border border-[var(--color-primary-muted)] p-3 text-sm font-semibold text-[var(--color-primary-text)] text-center">
                        ⭐ Global Default ERP Company
                      </div>
                    ) : (
                      <div className="rounded-xl bg-[var(--color-warning-light)] border border-[var(--color-warning)] p-3 text-sm font-semibold text-[var(--color-warning-text)] text-center">
                        <button onClick={() => { setDefault.mutate(viewItem.id); }} disabled={setDefault.isPending}
                          className="hover:opacity-80 disabled:opacity-50 transition-opacity">
                          Set as Default ERP Company
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'financial' && (
                  <div className="space-y-5">
                    <DetailCard title="Bank Details">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LeadField label="Bank Name" value={viewItem.bankName || <MutedValue />} />
                        <LeadField label="Account Number" value={viewItem.bankAccount || <MutedValue />} />
                        <LeadField label="IFSC Code" value={viewItem.bankIfsc || <MutedValue />} />
                        <LeadField label="Branch" value={viewItem.bankBranch || <MutedValue />} />
                      </div>
                    </DetailCard>
                    <DetailCard title="Currency">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LeadField label="Currency" value={`${viewItem.currency || 'INR'} (${viewItem.currencySymbol || '₹'})`} />
                      </div>
                    </DetailCard>
                  </div>
                )}

                {detailTab === 'branding' && (
                  <div className="space-y-5">
                    <DetailCard title="Brand Colors">
                      <div className="flex gap-4 items-center">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg border" style={{backgroundColor:viewItem.primaryColor||'#4f46e5'}} />
                          <span className="text-xs font-mono">{viewItem.primaryColor||'#4f46e5'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-lg border" style={{backgroundColor:viewItem.accentColor||'#10b981'}} />
                          <span className="text-xs font-mono">{viewItem.accentColor||'#10b981'}</span>
                        </div>
                      </div>
                    </DetailCard>
                    <DetailCard title="Logos">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <LeadField label="Full Logo">{viewItem.logo ? <img src={viewItem.logo} alt="logo" className="h-10 object-contain" /> : <MutedValue>No logo</MutedValue>}</LeadField>
                        <LeadField label="Icon Logo">{viewItem.iconLogo ? <img src={viewItem.iconLogo} alt="icon" className="h-8 object-contain" /> : <MutedValue>No icon</MutedValue>}</LeadField>
                      </div>
                    </DetailCard>
                    <DetailCard title="Document Assets">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <LeadField label="QR Code">{viewItem.qrCode ? <img src={viewItem.qrCode} alt="QR" className="h-12" /> : <MutedValue>No QR</MutedValue>}</LeadField>
                        <LeadField label="Signature">{viewItem.signature ? <img src={viewItem.signature} alt="signature" className="h-8" /> : <MutedValue>No signature</MutedValue>}</LeadField>
                      </div>
                    </DetailCard>
                  </div>
                )}

                {detailTab === 'audit' && (
                  <DetailCard title="Metadata">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <LeadField label="Company ID" value={viewItem.id} />
                      <LeadField label="Created" value={fmtDate(viewItem.createdAt)} />
                    </div>
                  </DetailCard>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog open={!!delId} onClose={()=>setDelId(null)} onConfirm={()=>delId&&del.mutate(delId)} loading={del.isPending} title="Delete Company" message="Delete this company? This affects global reporting."/>
    </div>
  );
}
