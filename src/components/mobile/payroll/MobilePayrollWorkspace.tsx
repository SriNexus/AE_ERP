/**
 * MobilePayrollWorkspace — Mobile Payroll module
 *
 * Architecture matches MobileLeadWorkspace:
 *   - No inline KPI/Search/Filters (handled by MobileTopBar at module level)
 *   - Filters read from URL params
 *   - Card-based list matching LeadCard pattern
 *   - Full-screen detail modal with Section/Detail components
 *   - Shared ConfirmDialog for deletes
 *   - Dirty state tracking + confirm close on forms
 *   - mode prop for 'records' | 'create'
 *
 * Reuses:
 *   - usePayroll, useSavePayroll, useDeletePayroll, MONTHS, PAYROLL_FORM_DEFAULT
 *     from features/hr/hooks/useHR.ts
 *   - useEmployees for employee lookup
 *   - fmtCurrency from lib/firestore
 *   - PAYMENT_MODES from config/company
 *   - Shared ui components (Badge, Button, Card, ConfirmDialog, Input, Modal,
 *     Pagination, Select, Textarea, statusBadge) from ../../ui
 *   - MobileTimelinePreview from ../shared/MobileTimelinePreview
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  DollarSign, Download, Edit2, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import {
  usePayroll, useSavePayroll, useDeletePayroll, MONTHS,
  PAYROLL_FORM_DEFAULT, type PayrollForm,
} from '../../../features/hr/hooks/useHR';
import { useEmployees } from '../../../features/employees/hooks/useEmployees';
import { fmtCurrency } from '../../../lib/firestore';
import { PAYMENT_MODES } from '../../../config/company';
import { usePermissions } from '../../../lib/permissions';
import { useAppStore } from '../../../store/useAppStore';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 15;
const ALL = 'All';

type PayrollRecord = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type PayrollFilters = {
  search: string;
  month: string;
  status: string;
};

function filterPayroll(records: PayrollRecord[], filters: PayrollFilters) {
  const term = filters.search.trim().toLowerCase();
  return records
    .filter((p) => {
      if (filters.status !== ALL && p.status !== filters.status) return false;
      if (filters.month !== ALL && p.month !== filters.month) return false;
      if (!term) return true;
      return [p.employee, p.employeeId]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = a.month && a.year ? `${a.year}-${String(MONTHS.indexOf(a.month) + 1).padStart(2, '0')}` : '';
      const bTime = b.month && b.year ? `${b.year}-${String(MONTHS.indexOf(b.month) + 1).padStart(2, '0')}` : '';
      return bTime.localeCompare(aTime);
    });
}

function downloadPayrollCsv(rows: PayrollRecord[], filename: string, sym: string) {
  const headers = ['Employee', 'Month', 'Year', 'Basic Salary', 'HRA', 'Allowances', 'Deductions', 'TDS', 'Advance', 'Net Salary', 'Status', 'Mode'];
  const lines = rows.map((p) =>
    [p.employee || '', p.month || '', p.year || '', p.basicSalary || 0, p.hra || 0, p.allowances || 0, p.deductions || 0, p.tds || 0, p.advance || 0, p.netSalary || 0, p.status || '', p.mode || '']
      .map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MobilePayrollWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const { company } = useAppStore();
  const { data: payroll = [], isLoading, isError, refetch } = usePayroll();
  const { data: employees = [] } = useEmployees();
  const deleteMut = useDeletePayroll();
  const sym = company?.currencySymbol || '₹';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PayrollForm>({ ...PAYROLL_FORM_DEFAULT });
  const [viewRecord, setViewRecord] = useState<PayrollRecord | null>(null);
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
    setForm({ ...PAYROLL_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  const canEdit = perms.can('payroll', 'create');
  const canDelete = perms.can('payroll', 'delete');
  const canExport = perms.can('payroll', 'export');

  const saveMut = useSavePayroll(editId, () => {
    setFormOpen(false);
    setEditId(null);
    setForm({ ...PAYROLL_FORM_DEFAULT });
    setDirty(false);
    void qc.invalidateQueries({ queryKey: ['payroll'] });
  });

  const filters = useMemo<PayrollFilters>(() => ({
    search: params.get('q') || '',
    month: params.get('month') || ALL,
    status: params.get('status') || ALL,
  }), [params]);

  const filteredRecords = useMemo(() => filterPayroll(payroll as PayrollRecord[], filters), [payroll, filters]);
  const paginatedRecords = useMemo(() => filteredRecords.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRecords, page]);
  const selectedRows = useMemo(() => (payroll as PayrollRecord[]).filter((p) => selected.has(p.id)), [payroll, selected]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRecords.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredRecords.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((payroll as PayrollRecord[]).map((p) => p.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [payroll]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function calcNet() {
    const n = (v: string) => Number(v) || 0;
    return n(form.basicSalary) + n(form.hra) + n(form.allowances) - n(form.deductions) - n(form.tds) - n(form.advance);
  }

  function requestCloseForm() {
    if (dirty) { setConfirmClose(true); return; }
    closeForm();
  }

  function closeForm() {
    setFormOpen(false);
    setEditId(null);
    setForm({ ...PAYROLL_FORM_DEFAULT });
    setDirty(false);
    if (mode === 'create') { navigate('/app', { replace: true }); return; }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function updateForm(patch: Partial<PayrollForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitPayroll(event: React.FormEvent) {
    event.preventDefault();
    if (!form.employeeId || !form.month) return toast.error('Employee & month required');
    saveMut.mutate(form);
  }

  function openEdit(p: PayrollRecord) {
    setEditId(p.id);
    setForm({
      employeeId: p.employeeId || '', employee: p.employee || '',
      month: p.month || '', year: p.year || String(new Date().getFullYear()),
      basicSalary: String(p.basicSalary || ''), hra: String(p.hra || ''),
      allowances: String(p.allowances || ''), deductions: String(p.deductions || ''),
      tds: String(p.tds || ''), advance: String(p.advance || ''), netSalary: String(p.netSalary || ''),
      mode: p.mode || 'Bank Transfer', status: p.status || 'Paid', notes: p.notes || '',
    });
    setDirty(false);
    setFormOpen(true);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((p) => deleteMut.mutateAsync(p.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  function exportRows(rows: PayrollRecord[]) {
    if (!rows.length) return toast.error('No records selected');
    downloadPayrollCsv(rows, `payroll-export-${new Date().toISOString().slice(0, 10)}.csv`, sym);
    toast.success(`Exported ${rows.length} record${rows.length > 1 ? 's' : ''}`);
  }

  if (mode === 'create') {
    return (
      <PayrollDialogs
        formOpen={formOpen}
        form={form}
        editId={editId}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        employees={employees as any[]}
        sym={sym}
        calcNet={calcNet}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitPayroll}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Payroll</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            {canExport && <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center min-h-[30vh] text-center px-6">
          <DollarSign className="h-10 w-10 text-rose-500 mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">Failed to load payroll</h3>
          <p className="text-xs text-[var(--color-text-muted)] max-w-[260px]">Could not load payroll data.</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90">Retry</button>
        </div>
      )}

      <div className="space-y-3">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <PayrollSkeletonCard key={index} />)}
        {!isLoading && !isError && filteredRecords.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No payroll records match the current filters.
          </Card>
        )}
        {!isLoading && !isError && paginatedRecords.map((p) => (
          <PayrollCard
            key={p.id}
            record={p}
            sym={sym}
            selected={selected.has(p.id)}
            onSelect={() => toggleSelect(p.id)}
            onView={() => setViewRecord(p)}
            onEdit={canEdit ? () => { setViewRecord(null); openEdit(p); } : undefined}
          />
        ))}
      </div>

      {!isLoading && !isError && filteredRecords.length > 0 && (
        <Pagination page={page} total={filteredRecords.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      <PayrollViewModal
        record={viewRecord}
        sym={sym}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={() => setViewRecord(null)}
        onEdit={(p) => { setViewRecord(null); openEdit(p); }}
        onDelete={(p) => { setSelected(new Set([p.id])); setViewRecord(null); setDeleteOpen(true); }}
      />

      <PayrollDialogs
        formOpen={formOpen}
        form={form}
        editId={editId}
        saving={saveMut.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        employees={employees as any[]}
        sym={sym}
        calcNet={calcNet}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitPayroll}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={deleteMut.isPending}
        title="Delete Records"
        message={`Delete ${selectedRows.length} selected payroll record${selectedRows.length > 1 ? 's' : ''}?`}
      />
    </div>
  );
}

/* ── Payroll Card ──────────────────────────────────────────── */

function PayrollCard({ record, sym, selected, onSelect, onView, onEdit }: {
  record: PayrollRecord;
  sym: string;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
  onEdit?: () => void;
}) {
  const empName = record.employee || record.employeeId || '—';
  const isPaid = record.status === 'Paid';
  const isPending = record.status === 'Pending';
  return (
    <Card className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
      isPending && 'border-l-4 border-l-amber-500',
      !isPaid && !isPending && 'border-l-4 border-l-gray-300',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${empName}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{empName}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{record.month} {record.year}</p>
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">Net: <span className="font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(record.netSalary, sym)}</span></p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(record.status || 'Paid')}
            {record.mode ? <Badge variant="gray">{record.mode}</Badge> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          {onEdit && (
            <button type="button" onClick={onEdit} aria-label="Edit payroll"
              className={actionIconBtnClass}>
              <Edit2 className="h-4 w-4" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

const actionIconBtnClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95 bg-indigo-50/90 text-indigo-600 ring-indigo-100 dark:bg-indigo-900/25 dark:text-indigo-300 dark:ring-indigo-800/60';

/* ── Skeleton Card ─────────────────────────────────────────── */

function PayrollSkeletonCard() {
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

/* ── Payroll Dialogs (Create/Edit form) ───────────────────── */

function PayrollDialogs({ formOpen, form, editId, saving, dirty, confirmClose, employees, sym, calcNet, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: PayrollForm;
  editId: string | null;
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  employees: any[];
  sym: string;
  calcNet: () => number;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<PayrollForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editId ? 'Edit Payroll' : 'Add Payroll'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          <Select label="Employee *" required value={form.employeeId}
            onChange={(event) => {
              const emp = employees.find((e: any) => e.id === event.target.value);
              onChange({ employeeId: event.target.value, employee: emp?.name || '', basicSalary: String(emp?.salary || '') });
            }}
            options={[
              { label: 'Select Employee', value: '' },
              ...employees
                .filter((e: any) => e.status !== 'Terminated' && e.status !== 'Inactive')
                .map((e: any) => ({ label: e.name, value: e.id })),
            ]} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Month *" required value={form.month} onChange={(event) => onChange({ month: event.target.value })}
              options={[{ label: 'Select Month', value: '' }, ...MONTHS.map(m => ({ label: m, value: m }))]} />
            <Input label="Year" type="number" value={form.year} onChange={(event) => onChange({ year: event.target.value })} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Salary Components</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Basic Salary (₹)" type="number" value={form.basicSalary} onChange={(event) => onChange({ basicSalary: event.target.value })} />
              <Input label="HRA (₹)" type="number" value={form.hra} onChange={(event) => onChange({ hra: event.target.value })} />
              <Input label="Allowances (₹)" type="number" value={form.allowances} onChange={(event) => onChange({ allowances: event.target.value })} />
              <Input label="Deductions (₹)" type="number" value={form.deductions} onChange={(event) => onChange({ deductions: event.target.value })} />
              <Input label="TDS (₹)" type="number" value={form.tds} onChange={(event) => onChange({ tds: event.target.value })} />
              <Input label="Advance (₹)" type="number" value={form.advance} onChange={(event) => onChange({ advance: event.target.value })} />
            </div>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-center">
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wide">Net Salary</p>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(Math.max(calcNet(), 0), sym)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Status" value={form.status} onChange={(event) => onChange({ status: event.target.value })}
              options={['Paid', 'Pending', 'Processing'].map(s => ({ label: s, value: s }))} />
            <Select label="Payment Mode" value={form.mode || 'Bank Transfer'} onChange={(event) => onChange({ mode: event.target.value } as any)}
              options={PAYMENT_MODES.map(m => ({ label: m, value: m }))} />
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(event) => onChange({ notes: event.target.value })} rows={2} />
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editId ? 'Update' : 'Save Payroll'}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmClose}
        onClose={onKeepEditing}
        onConfirm={onDiscard}
        title="Discard Changes"
        message="Close this form and discard unsaved changes?"
      />
    </>
  );
}

/* ── Payroll View Modal ────────────────────────────────────── */

function PayrollViewModal({ record, sym, canEdit, canDelete, onClose, onEdit, onDelete }: {
  record: PayrollRecord | null;
  sym: string;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (p: PayrollRecord) => void;
  onDelete: (p: PayrollRecord) => void;
}) {
  if (!record) return null;
  const totalEarnings = (Number(record.basicSalary) || 0) + (Number(record.hra) || 0) + (Number(record.allowances) || 0);
  const totalDeductions = (Number(record.deductions) || 0) + (Number(record.tds) || 0) + (Number(record.advance) || 0);
  return (
    <Modal open={!!record} onClose={onClose} title={record.employee || 'Payroll Record'} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(record.status || 'Paid')}
            {record.mode ? <Badge variant="gray">{record.mode}</Badge> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Period" value={`${record.month} ${record.year}`} />
            <Detail label="Net Salary" value={fmtCurrency(record.netSalary, sym)} />
          </div>
        </section>

        <Section title="Salary Breakdown">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Earnings</p>
            <div className="flex items-center justify-between text-sm"><span className="text-[var(--color-text-muted)]">Basic Salary</span><span className="font-semibold text-[var(--color-text)]">{fmtCurrency(record.basicSalary, sym)}</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-[var(--color-text-muted)]">HRA</span><span className="font-semibold text-[var(--color-text)]">{fmtCurrency(record.hra, sym)}</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-[var(--color-text-muted)]">Allowances</span><span className="font-semibold text-[var(--color-text)]">{fmtCurrency(record.allowances, sym)}</span></div>
            <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
              <span>Total Earnings</span><span>{fmtCurrency(totalEarnings, sym)}</span>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-red-500 dark:text-red-400">Deductions</p>
            <div className="flex items-center justify-between text-sm"><span className="text-[var(--color-text-muted)]">Deductions</span><span className="font-semibold text-[var(--color-text)]">{fmtCurrency(record.deductions, sym)}</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-[var(--color-text-muted)]">TDS</span><span className="font-semibold text-[var(--color-text)]">{fmtCurrency(record.tds, sym)}</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-[var(--color-text-muted)]">Advance</span><span className="font-semibold text-[var(--color-text)]">{fmtCurrency(record.advance, sym)}</span></div>
            <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-1.5 text-sm font-bold text-red-500 dark:text-red-400">
              <span>Total Deductions</span><span>{fmtCurrency(totalDeductions, sym)}</span>
            </div>
          </div>
          <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Net Salary</p>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{fmtCurrency(record.netSalary, sym)}</p>
          </div>
        </Section>

        <Section title="Notes">
          <p className="text-sm text-[var(--color-text-secondary)]">{record.notes || 'No notes recorded.'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title="Payroll Timeline" entries={record.activityLog || []} />
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

export { MobilePayrollWorkspace };
