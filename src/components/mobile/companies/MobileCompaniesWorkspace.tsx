/**
 * MobileCompaniesWorkspace — Mobile Companies module
 *
 * Architecture matches MobileLeadWorkspace:
 *   - No inline KPI/Search/Filters (handled by MobileTopBar at module level)
 *   - Filters read from URL params
 *   - Card-based list matching LeadCard pattern
 *   - Full-screen detail modal with Section/Detail components
 *   - Shared ConfirmDialog for deletes
 *   - mode prop for 'records' | 'create'
 *
 * Reuses:
 *   - useCompanies hook, COLLECTIONS, getAll
 *   - fmtDate from lib/firestore
 *   - Shared ui components (Badge, Button, Card, ConfirmDialog, Input, Modal,
 *     Pagination, Select, Textarea, statusBadge) from ../../ui
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2, Download, Edit2, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import { getAll, createDocWithId, updateDocById, deleteDocById, genId, fmtDate } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { INDIAN_STATES } from '../../../config/company';
import { usePermissions } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../utils/cn';

const PER_PAGE = 15;
const ALL = 'All';
const STATE_OPTS = [{ label: 'Select State', value: '' }, ...INDIAN_STATES.map(s => ({ label: s, value: s }))];

type CompanyRecord = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type CompanyFilters = {
  search: string;
  status: string;
};

const FORM0: any = { name: '', shortName: '', companyCode: '', tagline: '', address: '', city: '', state: '', pincode: '', phone: '', email: '', website: '', gst: '', pan: '', cin: '', bankName: '', bankAccount: '', bankIfsc: '', bankBranch: '', currency: 'INR', currencySymbol: '₹', status: 'Active', primaryColor: '#4f46e5', accentColor: '#10b981', logo: '', iconLogo: '', qrCode: '', signature: '', isDefault: false };

function filterCompanies(records: CompanyRecord[], filters: CompanyFilters, all: CompanyRecord[]) {
  const term = filters.search.trim().toLowerCase();
  return all
    .filter((c) => {
      if (filters.status !== ALL && c.status !== filters.status) return false;
      if (!term) return true;
      return [c.name, c.shortName, c.city, c.gst, c.email, c.companyCode]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = a.createdAt || '';
      const bTime = b.createdAt || '';
      return bTime.localeCompare(aTime);
    });
}

function downloadCompaniesCsv(rows: CompanyRecord[], filename: string) {
  const headers = ['Name', 'Short Name', 'Code', 'City', 'GST', 'Phone', 'Email', 'Status'];
  const lines = rows.map((c) =>
    [c.name || '', c.shortName || '', c.companyCode || '', c.city || '', c.gst || '', c.phone || '', c.email || '', c.status || '']
      .map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MobileCompaniesWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const user = useAppStore((state) => state.user);

  const { data: companies = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['companies'], queryFn: () => getAll(COLLECTIONS.COMPANIES), staleTime: 30000,
  });
  const canEdit = perms.can('settings', 'edit') || perms.can('companies', 'edit');
  const canDelete = perms.can('companies', 'delete');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...FORM0 });
  const [viewRecord, setViewRecord] = useState<CompanyRecord | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditId(null);
    setForm({ ...FORM0 });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  const delMut = useMutation({
    mutationFn: (id: string) => deleteDocById(COLLECTIONS.COMPANIES, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); toast.success('Deleted'); },
  });

  const saveMut = useMutation({
    mutationFn: async (d: any) => {
      if (editId) await updateDocById(COLLECTIONS.COMPANIES, editId, d);
      else { const id = genId.generic('CO'); await createDocWithId(COLLECTIONS.COMPANIES, id, { ...d, id, createdBy: user?.id }); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['companies'] }); toast.success(editId ? 'Updated' : 'Company added'); closeForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const filters = useMemo<CompanyFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
  }), [params]);

  const filteredRecords = useMemo(() => filterCompanies(companies as CompanyRecord[], filters, companies as CompanyRecord[]), [companies, filters]);
  const paginatedRecords = useMemo(() => filteredRecords.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRecords, page]);
  const selectedRows = useMemo(() => (companies as CompanyRecord[]).filter((c) => selected.has(c.id)), [companies, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRecords.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredRecords.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((companies as CompanyRecord[]).map((c) => c.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [companies]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => { const n = new Set(current); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function closeForm() { setFormOpen(false); setEditId(null); setForm({ ...FORM0 }); setDirty(false); }

  function requestCloseForm() { if (dirty) { setConfirmClose(true); return; } closeForm(); }

  function openEdit(c: CompanyRecord) {
    setForm({ ...FORM0, ...c });
    setDirty(false);
    setEditId(c.id);
    setFormOpen(true);
  }

  function updateForm(patch: Partial<any>) { setForm((current: any) => ({ ...current, ...patch })); setDirty(true); }

  function submitCompany(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name) return toast.error('Company name required');
    saveMut.mutate(form);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((c) => delMut.mutateAsync(c.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function exportRows(rows: CompanyRecord[]) {
    if (!rows.length) return toast.error('No companies selected');
    downloadCompaniesCsv(rows, `companies-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} compan${rows.length > 1 ? 'ies' : 'y'}`);
  }

  if (mode === 'create') {
    return (
      <CompanyDialogs
        formOpen={formOpen}
        form={form}
        editId={editId}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitCompany}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Companies</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center px-6">
          <Building2 className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load companies</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load company data.</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90">Retry</button>
        </div>
      )}

      <div className="space-y-3">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <CompanySkeletonCard key={index} />)}
        {!isLoading && !isError && filteredRecords.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No companies match the current filters.
          </Card>
        )}
        {!isLoading && !isError && paginatedRecords.map((c) => (
          <CompanyCard
            key={c.id}
            company={c}
            selected={selected.has(c.id)}
            onSelect={() => toggleSelect(c.id)}
            onView={() => setViewRecord(c)}
            onEdit={canEdit ? () => { setViewRecord(null); openEdit(c); } : undefined}
          />
        ))}
      </div>

      {!isLoading && !isError && filteredRecords.length > 0 && (
        <Pagination page={page} total={filteredRecords.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      <CompanyViewModal
        record={viewRecord}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={() => setViewRecord(null)}
        onEdit={(c) => { setViewRecord(null); openEdit(c); }}
        onDelete={(c) => { setSelected(new Set([c.id])); setViewRecord(null); setDeleteOpen(true); }}
      />

      <CompanyDialogs
        formOpen={formOpen}
        form={form}
        editId={editId}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitCompany}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={delMut.isPending}
        title="Delete Companies"
        message={`Delete ${selectedRows.length} selected compan${selectedRows.length > 1 ? 'ies' : 'y'}?`}
      />
    </div>
  );
}

/* ── Company Card ─────────────────────────────────────────── */

function CompanyCard({ company, selected, onSelect, onView, onEdit }: {
  company: CompanyRecord;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onEdit?: () => void;
}) {
  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]" />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{company.name || '—'}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{company.companyCode || company.shortName || '—'}</p>
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{company.city ? `${company.city}${company.state ? `, ${company.state}` : ''}` : '—'}</p>
            <p className="truncate">{company.gst ? `GST: ${company.gst}` : '—'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(company.status || 'Active')}
            {company.isDefault ? <Badge variant="info">Default</Badge> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          {onEdit && (
            <button type="button" onClick={onEdit}
              className={cn(actionIconBtnClass)}>
              <Edit2 className="h-4 w-4" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

const actionIconBtnClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95 bg-indigo-50/90 text-indigo-600 ring-indigo-100 dark:bg-indigo-900/25 dark:text-indigo-300 dark:ring-indigo-800/60';

function CompanySkeletonCard() {
  return (
    <Card className="rounded-xl p-3">
      <div className="flex gap-3">
        <div className="h-4 w-4 rounded bg-[var(--color-bg-sunken)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
          <div className="h-8 rounded bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    </Card>
  );
}

/* ── Company Dialogs ──────────────────────────────────────── */

function CompanyDialogs({ formOpen, form, editId, saving, dirty, confirmClose, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: any;
  editId: string | null;
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<any>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editId ? 'Edit Company' : 'Add Company'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Company Info</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Company Name *" required value={form.name} onChange={(e) => onChange({ name: e.target.value })} />
              <Input label="Short Name" value={form.shortName} onChange={(e) => onChange({ shortName: e.target.value })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="Company Code" value={form.companyCode} onChange={(e) => onChange({ companyCode: e.target.value })} />
              <Input label="Phone" value={form.phone} onChange={(e) => onChange({ phone: e.target.value })} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Input label="Email" type="email" value={form.email} onChange={(e) => onChange({ email: e.target.value })} />
              <Input label="GST" value={form.gst} onChange={(e) => onChange({ gst: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Address</p>
            <Textarea label="Address" value={form.address} onChange={(e) => onChange({ address: e.target.value })} rows={1} />
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Input label="City" value={form.city} onChange={(e) => onChange({ city: e.target.value })} />
              <Select label="State" value={form.state} onChange={(e) => onChange({ state: e.target.value })} options={STATE_OPTS} />
              <Input label="Pincode" value={form.pincode} onChange={(e) => onChange({ pincode: e.target.value })} />
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Status</p>
            <Select label="Status" value={form.status} onChange={(e) => onChange({ status: e.target.value })}
              options={['Active', 'Inactive'].map(s => ({ label: s, value: s }))} />
          </div>
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editId ? 'Update' : 'Add Company'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard}
        title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

/* ── Company View Modal ───────────────────────────────────── */

function CompanyViewModal({ record, canEdit, canDelete, onClose, onEdit, onDelete }: {
  record: CompanyRecord | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (c: CompanyRecord) => void;
  onDelete: (c: CompanyRecord) => void;
}) {
  if (!record) return null;
  return (
    <Modal open={!!record} onClose={onClose} title={record.name || 'Company'} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(record.status || 'Active')}
            {record.isDefault ? <Badge variant="info">Default</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Code" value={record.companyCode || record.shortName || '—'} />
            <Detail label="GST" value={record.gst || '—'} />
          </div>
        </section>

        <Section title="Contact">
          <Detail label="Phone" value={record.phone || '—'} />
          <Detail label="Email" value={record.email || '—'} />
          <Detail label="Website" value={record.website || '—'} />
        </Section>

        <Section title="Address">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {[record.address, record.city, record.state, record.pincode].filter(Boolean).join(', ') || 'Not available'}
          </p>
        </Section>

        <Section title="Timeline">
          <Detail label="Created" value={fmtDate(record.createdAt) || '—'} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {canEdit ? <Button variant="outline" icon={<Edit2 className="h-4 w-4" />} onClick={() => onEdit(record)}>Edit</Button> : null}
          {canDelete ? <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(record)}>Delete</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}

export { MobileCompaniesWorkspace };
