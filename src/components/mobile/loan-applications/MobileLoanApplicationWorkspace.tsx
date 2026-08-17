/**
 * MobileLoanApplicationWorkspace — Mobile loan application workspace
 *
 * Follows the exact same pattern as MobileLeadWorkspace.
 * Desktop is source of truth. No mobile-specific business logic.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Target, Plus, Trash2, UserCheck, CreditCard, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, ConfirmDialog, Modal, Pagination, Select, Textarea, Input } from '../../ui';
import { LOAN_APPLICATION_FORM_DEFAULT, type LoanApplicationForm, LOAN_APPLICATION_STATUSES } from '../../../features/loan-applications/hooks/useLoanApplications';
import { useLoanApplications } from '../../../features/loan-applications/hooks/useLoanApplications';
import { useBankOptions } from '../../../features/banks/hooks/useBanks';
import { useCustomers } from '../../../features/customers/hooks/useCustomers';
import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, genId, updateDocById, fmtDate, softDelete } from '../../../lib/firestore';
import { usePermissions } from '../../../lib/permissions';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';


const PER_PAGE = 10;
const ALL = 'All';

type RegRecord = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type RegFilters = {
  search: string;
  status: string;
  date: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterLoanApplications(rows: RegRecord[], filters: RegFilters) {
  const term = filters.search.trim().toLowerCase();
  return rows
    .filter((r) => {
      if (filters.status !== ALL && r.status !== filters.status) return false;
      if (!term) return true;
      return [r.customerName, r.customerPhone, r.bankName, r.registrationId, r.id, r.branch]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function downloadCsv(rows: RegRecord[], filename: string) {
  const headers = ['Loan Application ID','Customer','Phone','Bank','Branch','Loan Amount','Status','Digital Sign','Bank Submission','Assigned To','Created Date'];
  const lines = rows.map(r =>
    [r.registrationId || r.id || '', r.customerName || '', r.customerPhone || '', r.bankName || '', r.branch || '', r.loanAmount || 0, r.status || '', r.digitalSignStatus || 'pending', r.submissionDate || '', r.assignedToName || '', fmtDate(r.createdAt) || '']
      .map(v => `"${v}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobileLoanApplicationWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const perms = usePermissions();
  const { data: registrations = [], isLoading, error } = useLoanApplications();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingReg, setEditingReg] = useState<RegRecord | null>(null);
  const [form, setForm] = useState<LoanApplicationForm>({ ...LOAN_APPLICATION_FORM_DEFAULT });
  const [viewReg, setViewReg] = useState<RegRecord | null>(null);
  const openId = params.get('open') || '';
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') setFormOpen(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setEditingReg(null);
    setForm({ ...LOAN_APPLICATION_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }, [mode, createParam]);

  const filters = useMemo<RegFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredRows = useMemo(() => filterLoanApplications(registrations as RegRecord[], filters), [registrations, filters]);
  const paginatedRows = useMemo(() => filteredRows.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRows, page]);
  const selectedRows = useMemo(() => (registrations as RegRecord[]).filter((r) => selected.has(r.id)), [registrations, selected]);
  const canEdit = perms.canEdit('loan_applications');
  const canDelete = perms.canDelete('loan_applications');

  const userClosedRef = useRef(false);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRows.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredRows.length, page]);

  // Sync view with URL open param
  useEffect(() => {
    if (userClosedRef.current) { userClosedRef.current = false; return; }
    if (!openId || isLoading) return;
    const target = (registrations as RegRecord[]).find((r) => r.id === openId);
    if (target && !viewReg) setViewReg(target);
  }, [openId, isLoading, registrations, viewReg]);

  function openDetail(reg: RegRecord) {
    userClosedRef.current = false;
    setViewReg(reg);
    const next = new URLSearchParams(params);
    next.set('open', reg.id);
    setParams(next, { replace: true });
  }

  function closeDetail() {
    userClosedRef.current = true;
    setViewReg(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }

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

  const saveMutation = useMutation({
    mutationFn: async (d: LoanApplicationForm) => {
      if (editingReg) {
        await updateDocById('registrations', editingReg.id, { ...d, updatedBy: user.id });
        return { ...d, id: editingReg.id };
      }
      const id = genId.registration();
      const createdReg = { ...d, id, registrationId: id, createdBy: user.id, isDeleted: false, activityLog: [{ id: genId.generic('LOG'), type: 'Creation', desc: 'Loan application created', date: new Date().toISOString(), userName: user.name }] };
      await createDocWithId('registrations', id, createdReg);
      return createdReg;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['registrations'] });
      toast.success(editingReg ? 'Loan application updated' : 'Loan application created');
      setFormOpen(false);
      setEditingReg(null);
      setForm({ ...LOAN_APPLICATION_FORM_DEFAULT });
      setDirty(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => softDelete('registrations', id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['registrations'] }); toast.success('Deleted'); setDeleteOpen(false); setSelected(new Set()); },
    onError: (e: any) => toast.error(e.message),
  });

  function openEdit(reg: RegRecord) {
    closeDetail();
    setEditingReg(reg);
    setForm({
      customerId: reg.customerId || '',
      customerName: reg.customerName || '',
      customerPhone: reg.customerPhone || '',
      customerAddress: reg.customerAddress || '',
      bankName: reg.bankName || '',
      branch: reg.branch || '',
      loanAmount: Number(reg.loanAmount) || 0,
      applicationNumber: reg.applicationNumber || '',
      status: reg.status || 'Draft',
      digitalSignStatus: reg.digitalSignStatus || 'pending',
      submissionDate: reg.submissionDate || '',
      approvalDate: reg.approvalDate || '',
      paymentDate: reg.paymentDate || '',
      caseId: reg.caseId || '', registrationId: reg.registrationId || '',
      assignedToId: reg.assignedToId || '',
      assignedToName: reg.assignedToName || '',
      notes: reg.notes || '',
    });
    setDirty(false);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingReg(null);
    setForm({ ...LOAN_APPLICATION_FORM_DEFAULT });
    setDirty(false);
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseForm() {
    if (dirty) { setConfirmClose(true); return; }
    closeForm();
  }

  function updateForm(patch: Partial<LoanApplicationForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!editingReg && !form.customerId) return toast.error('Please select a customer');
    if (!form.customerName && !form.customerPhone) return toast.error('Customer name or phone required');
    saveMutation.mutate(form);
  }

  function exportRows(rows: RegRecord[]) {
    if (!rows.length) return toast.error('No loan applications selected');
    downloadCsv(rows, `loan-applications-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} loan application${rows.length > 1 ? 's' : ''}`);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((r) => deleteMutation.mutateAsync(r.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  if (mode === 'create') {
    return (
      <RegDialogs
        formOpen={formOpen}
        form={form}
        editingReg={editingReg}
        saving={saveMutation.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitForm}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Loan Applications</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>
            {canEdit && <Button size="xs" variant="outline" icon={<UserCheck className="h-3 w-3" />} onClick={() => {}}>Assign</Button>}
            {canDelete && <Button size="xs" variant="danger" icon={<Trash2 className="h-3 w-3" />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
            <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Clear</button>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {(error as Error).message}
        </div>
      )}

      <div className="space-y-3">
        {isLoading && Array.from({ length: 5 }).map((_, i) => <RegSkeletonCard key={i} />)}
        {!isLoading && filteredRows.length === 0 && (
          <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
            <Target className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="mt-2">
              {filters.search || filters.status !== ALL
                ? 'No loan applications match the current filters.'
                : 'No loan applications yet.'}
            </p>
            {!filters.search && filters.status === ALL && canEdit && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />}
                onClick={() => { setEditingReg(null); setForm({ ...LOAN_APPLICATION_FORM_DEFAULT }); setDirty(false); setFormOpen(true); }}
                className="mt-3">Create Your First Loan Application</Button>
            )}
          </Card>
        )}
        {!isLoading && paginatedRows.map((reg) => (
          <RegCard key={reg.id} reg={reg} selected={selected.has(reg.id)} onSelect={() => toggleSelect(reg.id)} onView={() => openDetail(reg)} />
        ))}
      </div>

      {!isLoading && filteredRows.length > 0 && (
        <Pagination page={page} total={filteredRows.length} perPage={PER_PAGE} onChange={changePage} />
      )}

      <RegViewModal reg={viewReg} canEdit={canEdit} canDelete={canDelete} onClose={closeDetail}
        onEdit={(reg) => openEdit(reg)}
        onDelete={(reg) => { setSelected(new Set([reg.id])); closeDetail(); setDeleteOpen(true); }}
        onCreatePayment={viewReg?.status === 'Approved' ? () => { closeDetail(); } : undefined}
        onCreateProject={viewReg?.status === 'Payment Received' ? () => { closeDetail(); } : undefined}
      />

      <RegDialogs
        formOpen={formOpen}
        form={form}
        editingReg={editingReg}
        saving={saveMutation.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => { setConfirmClose(false); closeForm(); }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitForm}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={deleteMutation.isPending}
        title="Delete Loan Applications"
        message={`Delete ${selectedRows.length} selected loan application${selectedRows.length > 1 ? 's' : ''}?`}
      />
    </div>
  );
}

function RegCard({ reg, selected, onSelect, onView }: { reg: RegRecord; selected: boolean; onSelect: () => void; onView: () => void }) {
  const statusColors: Record<string, string> = {
    'Draft': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    'Digital Sign Pending': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    'Digital Sign Completed': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    'Bank Submission Pending': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
    'Submitted To Bank': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400',
    'Under Review': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    'Approved': 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    'Rejected': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    'Payment Received': 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
    'Closed': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <Card className="rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]">
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${reg.customerName || 'Loan Application'}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{reg.customerName || `LA-${reg.registrationId || reg.id?.slice(0, 8)}`}</p>
          {reg.bankName || reg.branch ? (
            <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">
              {[reg.bankName, reg.branch].filter(Boolean).join(' · ') || ''}
            </p>
          ) : null}
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{reg.customerPhone || 'Phone not available'}</p>
            {reg.loanAmount ? <p className="font-semibold">₹{Number(reg.loanAmount).toLocaleString('en-IN')}</p> : null}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${statusColors[reg.status] || statusColors['Draft']}`}>
              {reg.status || 'Draft'}
            </span>
            {reg.assignedToName ? <span className="mt-1 block truncate text-xs font-semibold text-[var(--color-text-muted)]">{reg.assignedToName}</span> : null}
          </div>
        </button>
      </div>
    </Card>
  );
}

function RegSkeletonCard() {
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

function RegViewModal({ reg, canEdit, canDelete, onClose, onEdit, onDelete, onCreatePayment, onCreateProject }: {
  reg: RegRecord | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (reg: RegRecord) => void;
  onDelete: (reg: RegRecord) => void;
  onCreatePayment?: () => void;
  onCreateProject?: () => void;
}) {
  if (!reg) return null;
  const activity = reg.activityLog || [];
  return (
    <Modal open={!!reg} onClose={onClose} title={reg.customerName || 'Loan Application'} size="full">
      <div className="space-y-4">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-tight bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-700">{reg.status || 'Draft'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Loan Application ID" value={reg.registrationId || reg.id} />
            <Detail label="Assigned To" value={reg.assignedToName || 'Unassigned'} />
          </div>
        </section>

        <Section title="Customer Information">
          <Detail label="Name" value={reg.customerName || 'Not available'} />
          <Detail label="Phone" value={reg.customerPhone || 'Not available'} />
          <Detail label="Address" value={reg.customerAddress || 'Not available'} />
        </Section>

        <Section title="Bank Details">
          <Detail label="Bank" value={reg.bankName || 'Not available'} />
          <Detail label="Branch" value={reg.branch || 'Not available'} />
          <Detail label="Loan Amount" value={reg.loanAmount ? `₹${Number(reg.loanAmount).toLocaleString('en-IN')}` : 'Not available'} />
          <Detail label="Application No" value={reg.applicationNumber || 'Not available'} />
        </Section>

        <Section title="Workflow">
          <Detail label="Digital Sign" value={reg.digitalSignStatus === 'completed' ? '✅ Completed' : '✍️ Pending'} />
          <Detail label="Submission Date" value={reg.submissionDate || 'Not submitted'} />
          <Detail label="Approval Date" value={reg.approvalDate || 'Not approved'} />
          <Detail label="Payment Date" value={reg.paymentDate || 'Not received'} />
        </Section>

        <Section title="Activity">
          {activity.length > 0 ? (
            <div className="space-y-2">
              {[...activity].reverse().slice(0, 10).map((log: any, idx: number) => (
                <div key={log.id || idx} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{log.type || 'Activity'}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{log.desc || 'No details'}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--color-text-disabled)]">{log.date ? fmtDate(log.date) : ''}{log.userName ? ` · by ${log.userName}` : ''}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--color-text-muted)]">No activity recorded.</p>}
        </Section>

        <Section title="Activity History (Tasks)">
          {activity.length > 0 ? (
            <div className="space-y-2">
              {activity.slice(0, 8).map((log: any, idx: number) => (
                <div key={log.id || idx} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[var(--color-text)]">{log.type || 'Activity'}</p>
                    <span className="text-[10px] text-[var(--color-text-muted)]">{log.date ? log.date.slice(0, 10) : ''}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{log.desc || ''}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{log.userName || ''}</p>
                </div>
              ))}
              {activity.length > 8 && <p className="text-xs text-[var(--color-text-muted)]">+{activity.length - 8} more entries</p>}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No activity recorded. Tasks will auto-create when loan application status changes.</p>
          )}
        </Section>

        <Section title="Notifications">
          <p className="text-sm text-[var(--color-text-muted)]">
            Notifications are auto-generated when loan application status changes. Recipients include the assigned employee, manager, and owner based on the status transition.
          </p>
        </Section>

        <Section title="Notes">
          <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{reg.notes || 'No notes recorded.'}</p>
        </Section>

        <div className="space-y-2">
          {reg.status === 'Approved' && onCreatePayment && (
            <Button variant="primary" className="w-full" icon={<CreditCard className="h-4 w-4" />} onClick={onCreatePayment}>Create Payment</Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            {canEdit ? <Button variant="outline" onClick={() => onEdit(reg)}>Edit</Button> : null}
            {canDelete ? <Button variant="danger" onClick={() => onDelete(reg)}>Delete</Button> : null}
          </div>
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

function RegDialogs({ formOpen, form, editingReg, saving, dirty, confirmClose, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: LoanApplicationForm;
  editingReg: RegRecord | null;
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<LoanApplicationForm>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { options: bankOptList } = useBankOptions();
  const BANK_OPTIONS = [{ label: 'Select Bank', value: '' }, ...bankOptList.filter(b => b.value !== '')];
  const STATUS_OPTIONS = [{ label: 'Select Status', value: '' }, ...LOAN_APPLICATION_STATUSES.map(s => ({ label: s, value: s }))];
  const SIGN_OPTIONS = [{ label: 'Pending', value: 'pending' }, { label: 'Completed', value: 'completed' }];

  // ── Create-mode customer picker (same shared, permission-scoped hook the
  // desktop dialog uses — no mobile-specific business logic). ──
  const { data: customers = [] } = useCustomers();
  const [customerQuery, setCustomerQuery] = useState('');

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    const list = (customers as any[]).filter((c) => {
      const name = String(c.name || c.fullName || '').toLowerCase();
      const phone = String(c.phone || c.mobile || '');
      const id = String(c.id || c.customerId || '').toLowerCase();
      return !q || name.includes(q) || phone.includes(q) || id.includes(q);
    });
    return list.slice(0, 30);
  }, [customers, customerQuery]);

  function selectCustomer(c: any) {
    onChange({ customerId: c.id, customerName: c.name || c.fullName || '', customerPhone: c.phone || c.mobile || '', customerAddress: c.address || '' });
    setCustomerQuery(c.name || c.fullName || c.id || '');
  }

  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editingReg ? 'Edit Loan Application' : 'Create Loan Application'} size="full">
        <form onSubmit={onSubmit} className="space-y-4">
          {editingReg ? (
            <>
              <Input label="Customer Name" required value={form.customerName} onChange={(e) => onChange({ customerName: e.target.value })} placeholder="Customer name" />
              <Input label="Phone" required value={form.customerPhone} onChange={(e) => onChange({ customerPhone: e.target.value })} placeholder="Phone number" />
              <Input label="Address" value={form.customerAddress} onChange={(e) => onChange({ customerAddress: e.target.value })} placeholder="Customer address" />
            </>
          ) : (
            <>
              <Input label="Search Customer" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Search by name, mobile or ID" />
              {form.customerId ? (
                <div className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40 px-3 py-2.5">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{form.customerName || 'Selected customer'}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{form.customerPhone || 'No phone'} · {form.customerId}</p>
                  <button
                    type="button"
                    onClick={() => { onChange({ customerId: '', customerName: '', customerPhone: '', customerAddress: '' }); setCustomerQuery(''); }}
                    className="mt-1 text-xs font-semibold text-[var(--color-primary-text)] hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="max-h-52 overflow-y-auto rounded-xl border border-[var(--color-border-subtle)]">
                  {filteredCustomers.length === 0 ? (
                    <p className="p-3 text-xs text-[var(--color-text-muted)]">No customers match “{customerQuery}”.</p>
                  ) : filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="block w-full border-b border-[var(--color-border-subtle)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--color-surface-hover)]"
                    >
                      <p className="text-sm font-medium text-[var(--color-text)]">{c.name || c.fullName || 'Unnamed customer'}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{c.phone || c.mobile || ''}{c.id ? ` · ${c.id}` : ''}</p>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-[var(--color-text-muted)]">The customer's existing profile is auto-loaded — you only enter loan-specific details below.</p>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Select label="Bank Name" value={form.bankName} onChange={(e) => onChange({ bankName: e.target.value })} options={BANK_OPTIONS} />
            <Input label="Branch" value={form.branch} onChange={(e) => onChange({ branch: e.target.value })} placeholder="Branch name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Loan Amount (₹)" type="number" value={form.loanAmount} onChange={(e) => onChange({ loanAmount: Number(e.target.value) })} placeholder="e.g. 500000" />
            <Input label="Application Number" value={form.applicationNumber} onChange={(e) => onChange({ applicationNumber: e.target.value })} placeholder="Bank application ref" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Digital Sign" value={form.digitalSignStatus} onChange={(e) => onChange({ digitalSignStatus: e.target.value as 'pending' | 'completed' })} options={SIGN_OPTIONS} />
            <Input label="Bank Submission Date" type="date" value={form.submissionDate} onChange={(e) => onChange({ submissionDate: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Approval Date" type="date" value={form.approvalDate} onChange={(e) => onChange({ approvalDate: e.target.value })} />
            <Input label="Payment Date" type="date" value={form.paymentDate} onChange={(e) => onChange({ paymentDate: e.target.value })} />
          </div>
          <Select label="Status" value={form.status} onChange={(e) => onChange({ status: e.target.value as any })} options={STATUS_OPTIONS} />
          <Input label="Assigned To" value={form.assignedToName} onChange={(e) => onChange({ assignedToName: e.target.value })} placeholder="Assignee name" />
          <Textarea label="Notes" value={form.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Additional notes..." />
          {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCloseForm}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>{editingReg ? 'Save' : 'Create'}</Button>
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

export default MobileLoanApplicationWorkspace;
