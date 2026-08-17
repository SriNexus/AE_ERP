import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Building2,
  Download,
  Edit2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select } from '../../ui';
import { usePermissions } from '../../../lib/permissions';
import { useVendorActions, useVendors } from '../../../features/procurement/hooks/useVendors';
import { VENDOR_FORM_DEFAULT, type VendorFormValues, type VendorRecord } from '../../../features/procurement/types';
import { VendorForm } from '../../../features/procurement/components/VendorForm';
import { fmtDate } from '../../../lib/firestore';
import { cn } from '../../../utils/cn';
import { MobileTimelinePreview } from '../shared/MobileTimelinePreview';

const PER_PAGE = 10;
const ALL = 'All';

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterVendors(vendors: VendorRecord[], filters: { search: string; status: string; category: string }) {
  const term = filters.search.trim().toLowerCase();
  return vendors
    .filter((vendor) => {
      if (filters.status !== ALL) {
        if (filters.status === 'active' && vendor.isDeleted) return false;
        if (filters.status === 'inactive' && !vendor.isDeleted) return false;
      }
      if (filters.category !== ALL && !vendor.categoryTags?.includes(filters.category)) return false;
      if (!term) return true;
      return [vendor.name, vendor.vendorId, vendor.gstin, vendor.contactInfo?.contactPerson, vendor.contactInfo?.phone, vendor.contactInfo?.email]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      const bTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function downloadVendorsCsv(rows: VendorRecord[], filename: string) {
  const headers = ['Vendor Code', 'Name', 'GSTIN', 'Contact Person', 'Phone', 'Email', 'Payment Terms', 'Categories', 'Created Date'];
  const lines = rows.map(v =>
    [
      v.vendorId || '', v.name || '', v.gstin || '',
      v.contactInfo?.contactPerson || '', v.contactInfo?.phone || '', v.contactInfo?.email || '',
      v.paymentTerms || '', (v.categoryTags || []).join('; '),
      fmtDate(v.createdAt) || '',
    ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobileVendorWorkspace() {
  const [params, setParams] = useSearchParams();
  const perms = usePermissions();
  const { data: vendors = [], isLoading } = useVendors();
  const actions = useVendorActions();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [formOpen, setFormOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorRecord | null>(null);
  const [form, setForm] = useState<VendorFormValues>({ ...VENDOR_FORM_DEFAULT });
  const [viewVendor, setViewVendor] = useState<VendorRecord | null>(null);
  const openId = params.get('open') || '';
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const createParam = params.get('create');

  const userClosedRef = useRef(false);
  const reopenVendorIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (createParam !== '1') return;
    setEditingVendor(null);
    setForm({ ...VENDOR_FORM_DEFAULT });
    setDirty(false);
    setFormOpen(true);
  }, [createParam]);

  const categories = useMemo(() =>
    Array.from(new Set((vendors as VendorRecord[]).flatMap((v) => v.categoryTags || []))).sort(),
    [vendors],
  );

  const filters = useMemo(() => ({
    search: params.get('q') || '',
    status: params.get('status') || ALL,
    category: params.get('category') || ALL,
  }), [params]);

  const filteredVendors = useMemo(() => filterVendors(vendors as VendorRecord[], filters), [vendors, filters]);
  const paginatedVendors = useMemo(() => filteredVendors.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredVendors, page]);
  const selectedRows = useMemo(() => (vendors as VendorRecord[]).filter((v) => selected.has(v.id)), [vendors, selected]);
  const canEdit = perms.canEdit('vendors');
  const canDelete = perms.canDelete('vendors');

  useEffect(() => {
    if (!reopenVendorIdRef.current) return;
    const updated = (vendors as VendorRecord[]).find((v) => v.id === reopenVendorIdRef.current);
    if (updated) {
      reopenVendorIdRef.current = null;
      openMobileDetail(updated);
    }
  }, [vendors]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredVendors.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredVendors.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((vendors as VendorRecord[]).map((v) => v.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [vendors]);

  useEffect(() => {
    if (userClosedRef.current) {
      userClosedRef.current = false;
      return;
    }
    if (!openId || isLoading) return;
    const target = (vendors as VendorRecord[]).find((v) => v.id === openId);
    if (target && !viewVendor) {
      setViewVendor(target);
    }
  }, [openId, isLoading, vendors, viewVendor]);

  function openMobileDetail(vendor: VendorRecord) {
    userClosedRef.current = false;
    setViewVendor(vendor);
    const next = new URLSearchParams(params);
    next.set('open', vendor.id);
    setParams(next, { replace: true });
  }

  function closeMobileDetail() {
    userClosedRef.current = true;
    setViewVendor(null);
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

  function openEdit(vendor: VendorRecord) {
    setEditingVendor(vendor);
    setForm({
      name: vendor.name || '',
      gstin: vendor.gstin || '',
      contactPerson: vendor.contactInfo?.contactPerson || '',
      phone: vendor.contactInfo?.phone || '',
      email: vendor.contactInfo?.email || '',
      address: vendor.contactInfo?.address || '',
      paymentTerms: vendor.paymentTerms || '',
      categoryTags: (vendor.categoryTags || []).join(', '),
    });
    setDirty(false);
    setFormOpen(true);
  }

  function requestCloseForm() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeForm();
  }

  function closeForm() {
    setFormOpen(false);
    setEditingVendor(null);
    setForm({ ...VENDOR_FORM_DEFAULT });
    setDirty(false);
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function updateForm(patch: Partial<VendorFormValues>) {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  }

  function submitVendor(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name) return toast.error('Vendor name is required');
    const promise = editingVendor
      ? actions.update.mutateAsync({ id: editingVendor.id, input: form })
      : actions.create.mutateAsync(form);
    promise.then(closeForm).catch((e: Error) => toast.error(e.message));
  }

  function exportRows(rows: VendorRecord[]) {
    if (!rows.length) return toast.error('No vendors selected');
    downloadVendorsCsv(rows, `vendors-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} vendor${rows.length > 1 ? 's' : ''}`);
  }

  async function deleteSelected() {
    await Promise.all(selectedRows.map((v) => actions.remove.mutateAsync(v.id)));
    setSelected(new Set());
    setDeleteOpen(false);
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 data-tour="mobile-vendors-header" className="text-xl font-bold text-[var(--color-text)]">Vendors</h1>
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

      <div className="space-y-3" data-tour="vendors-table">
        {isLoading && Array.from({ length: 3 }).map((_, index) => <VendorSkeletonCard key={index} />)}
        {!isLoading && filteredVendors.length === 0 && (
          <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
            <Building2 className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="mt-2">
              {filters.search || filters.status !== ALL || filters.category !== ALL
                ? 'No vendors match the current filters.'
                : 'No vendors yet. Create your first vendor!'}
            </p>
            {!filters.search && filters.status === ALL && filters.category === ALL && canEdit && (
              <Button
                size="sm"
                data-tour="vendors-create"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => { setEditingVendor(null); setForm({ ...VENDOR_FORM_DEFAULT }); setDirty(false); setFormOpen(true); }}
                className="mt-3"
              >
                Create Your First Vendor
              </Button>
            )}
          </Card>
        )}
        {!isLoading && paginatedVendors.map((vendor) => (
          <VendorCard
            key={vendor.id}
            vendor={vendor}
            selected={selected.has(vendor.id)}
            onSelect={() => toggleSelect(vendor.id)}
            onView={() => openMobileDetail(vendor)}
          />
        ))}
      </div>

      {!isLoading && filteredVendors.length > 0 && (
        <div data-tour="vendors-pagination">
          <Pagination page={page} total={filteredVendors.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      )}

      <VendorViewModal
        vendor={viewVendor}
        canEdit={canEdit}
        canDelete={canDelete}
        onClose={closeMobileDetail}
        onEdit={(v) => {
          closeMobileDetail();
          openEdit(v);
        }}
        onDelete={(v) => {
          setSelected(new Set([v.id]));
          closeMobileDetail();
          setDeleteOpen(true);
        }}
      />

      <VendorDialogs
        formOpen={formOpen}
        form={form}
        editingVendor={editingVendor}
        saving={actions.create.isPending || actions.update.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onCloseForm={requestCloseForm}
        onDiscard={() => {
          setConfirmClose(false);
          closeForm();
        }}
        onKeepEditing={() => setConfirmClose(false)}
        onChange={updateForm}
        onSubmit={submitVendor}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteSelected()}
        loading={actions.remove.isPending}
        title="Delete Vendors"
        message={`Delete ${selectedRows.length} selected vendor${selectedRows.length > 1 ? 's' : ''}?`}
      />
    </div>
  );
}

function VendorCard({ vendor, selected, onSelect, onView }: {
  vendor: VendorRecord;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  const phone = vendor.contactInfo?.phone ? `tel:${vendor.contactInfo.phone}` : undefined;
  const whatsapp = vendor.contactInfo?.phone
    ? `https://wa.me/${String(vendor.contactInfo.phone).replace(/\D/g, '')}`
    : undefined;
  return (
    <Card data-tour="vendors-row-view" className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow',
      'hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${vendor.name}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{vendor.name}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{vendor.vendorId}</p>
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{vendor.gstin || 'No GSTIN'}</p>
            <p className="truncate">{vendor.contactInfo?.phone || 'Phone not available'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {vendor.paymentTerms ? <Badge variant="gray">{vendor.paymentTerms}</Badge> : null}
            {vendor.categoryTags?.length ? (
              <span className="truncate text-[10px] text-[var(--color-text-muted)]">
                {vendor.categoryTags.join(', ')}
              </span>
            ) : null}
            {vendor.contactInfo?.contactPerson ? (
              <span className="mt-1 block truncate text-xs font-semibold text-[var(--color-text-muted)]">
                {vendor.contactInfo.contactPerson}
              </span>
            ) : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp vendor" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !whatsapp && 'pointer-events-none opacity-40')}>
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={vendor.contactInfo?.email ? `mailto:${vendor.contactInfo.email}` : undefined} aria-label="Email vendor" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !vendor.contactInfo?.email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
          <a href={phone} aria-label="Call vendor" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function VendorSkeletonCard() {
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

function VendorDialogs({ formOpen, form, editingVendor, saving, dirty, confirmClose, onCloseForm, onDiscard, onKeepEditing, onChange, onSubmit }: {
  formOpen: boolean;
  form: VendorFormValues;
  editingVendor: VendorRecord | null;
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  onCloseForm: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onChange: (patch: Partial<VendorFormValues>) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <>
      <Modal open={formOpen} onClose={onCloseForm} title={editingVendor ? 'Edit Vendor' : 'Create Vendor'} size="full">
        <VendorForm value={form} onChange={(v) => { onChange(v); }} onSubmit={onSubmit} onCancel={onCloseForm} saving={saving} />
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

function VendorViewModal({ vendor, canEdit, canDelete, onClose, onEdit, onDelete }: {
  vendor: VendorRecord | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onEdit: (vendor: VendorRecord) => void;
  onDelete: (vendor: VendorRecord) => void;
}) {
  if (!vendor) return null;

  return (
    <Modal open={!!vendor} onClose={onClose} title={vendor.name || 'Vendor'} size="full">
      <div className="space-y-4">
        <Section title="Vendor Information">
          <Detail label="Vendor Code" value={vendor.vendorId} />
          <Detail label="GSTIN" value={vendor.gstin || 'Not available'} />
          <Detail label="Payment Terms" value={vendor.paymentTerms || 'Not set'} />
          <Detail label="Categories" value={vendor.categoryTags?.join(', ') || 'None'} />
          <Detail label="Created" value={vendor.createdAt ? fmtDate(vendor.createdAt) : 'Not available'} />
        </Section>

        <Section title="Contact Details">
          <Detail label="Contact Person" value={vendor.contactInfo?.contactPerson || 'Not available'} />
          <Detail label="Phone" value={vendor.contactInfo?.phone || 'Not available'} />
          <Detail label="Email" value={vendor.contactInfo?.email || 'Not available'} />
        </Section>

        <Section title="Address">
          <p className="text-sm text-[var(--color-text-secondary)]">{vendor.contactInfo?.address || 'Not available'}</p>
        </Section>

        <Section title="Timeline">
          <MobileTimelinePreview title={`${vendor.name} Timeline`} entries={[
            ...(vendor.createdAt ? [{ type: 'Creation', desc: 'Vendor created', date: vendor.createdAt }] : []),
            ...(vendor.updatedAt ? [{ type: 'Update', desc: 'Vendor updated', date: vendor.updatedAt }] : []),
          ]} />
        </Section>

        <div className="grid grid-cols-2 gap-2">
          {vendor.contactInfo?.phone
            ? <><a className={linkButtonClass} href={`tel:${vendor.contactInfo.phone}`}><Phone className="h-4 w-4" />Call</a>
              <a className={linkButtonClass} href={`https://wa.me/${String(vendor.contactInfo.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a></>
            : null}
          {vendor.contactInfo?.email
            ? <a className={linkButtonClass} href={`mailto:${vendor.contactInfo.email}`}><Mail className="h-4 w-4" />Email</a>
            : null}
          {canEdit ? <button type="button" className={linkButtonClass} onClick={() => onEdit(vendor)}><Edit2 className="h-4 w-4" />Edit</button> : null}
          {canDelete ? <button type="button" className={`${linkButtonClass} text-red-600 border-red-200`} onClick={() => onDelete(vendor)}><Trash2 className="h-4 w-4" />Delete</button> : null}
        </div>
      </div>
    </Modal>
  );
}

const linkButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]';

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

export default MobileVendorWorkspace;
