import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Calendar,
  CornerUpRight,
  Download,
  Edit2,
  File,
  FileText,
  Mail,
  MessageCircle,
  Phone,
  Trash2,
  User,
  UserCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Card, ConfirmDialog, Input, Modal, Pagination, Select, Textarea, statusBadge } from '../../ui';
import {
  createCustomerProjection,
  deleteCustomerProjection,
  formatCustomerDate,
  updateCustomerProjectionWithPhoneLock,
  useCustomers,
} from '../../../features/customers/hooks/useCustomers';
import { COLLECTIONS } from '../../../lib/firebase';
import { createDocWithId, fmtDate, genId, getAll } from '../../../lib/firestore';
import { updateProjectionWithEntity } from '../../../lib/entityProjection';
import { notifyRoleUsers, notifyUsersOnce, resolveNotificationCompanyId, sendNotification } from '../../../lib/notifications';
import { usePermissions } from '../../../lib/permissions';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { NotificationType } from '../../../types';
import { cn } from '../../../utils/cn';

const PER_PAGE = 10;
const ALL = 'All';
const CUSTOMER_TYPES = ['B2B', 'B2C'];
const CUSTOMER_STATUSES = ['Active', 'Inactive'];

type Customer = Record<string, any> & { id: string };
type Mode = 'records' | 'create';
type CustomerFilters = {
  search: string;
  type: string;
  status: string;
  date: string;
};

const B2B_FORM0 = {
  company: '',
  companyName: '',
  gst: '',
  contactPerson: '',
  businessPhone: '',
  businessEmail: '',
  address: '',
  state: '',
  city: '',
  industryType: '',
  assignedToId: '',
  assignedToName: '',
  notes: '',
  billUploadName: '',
};

const B2C_FORM0 = {
  fullName: '',
  mobile: '',
  altMobile: '',
  email: '',
  address: '',
  state: '',
  city: '',
  aadhaar: '',
  monthlyBillAmount: '',
  roofType: '',
  sanctionLoad: '',
  propertyType: '',
  projectType: '',
  assignedToId: '',
  assignedToName: '',
  notes: '',
  electricityBillFileName: '',
};

const EDIT_FORM0 = {
  name: '',
  phone: '',
  email: '',
  company: '',
  gst: '',
  pan: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  type: 'B2B',
  status: 'Active',
  creditLimit: '',
  paymentTerms: '30',
  notes: '',
  assignedToId: '',
  assignedToName: '',
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isThisMonth(value: any): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function customerName(customer: Customer) {
  return customer.name || customer.fullName || customer.contactPerson || customer.company || customer.companyName || 'Untitled Customer';
}

function customerCompany(customer: Customer) {
  return customer.company || customer.companyName || '';
}

function customerPhone(customer: Customer) {
  return customer.phone || customer.mobile || customer.businessPhone || '';
}

function customerEmail(customer: Customer) {
  return customer.email || customer.businessEmail || '';
}

function customerAddress(customer: Customer) {
  return customer.address || [customer.city, customer.state].filter(Boolean).join(', ') || '';
}

function phoneHref(phone?: string) {
  return phone ? `tel:${phone}` : undefined;
}

function whatsappHref(phone?: string) {
  const clean = String(phone || '').replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : undefined;
}

function filterCustomers(customers: Customer[], filters: CustomerFilters) {
  const term = filters.search.trim().toLowerCase();
  return customers
    .filter((customer) => {
      if (filters.type !== ALL && customer.type !== filters.type) return false;
      if (filters.status !== ALL && (customer.status || 'Active') !== filters.status) return false;
      if (filters.date === 'this_month' && !isThisMonth(customer.createdAt)) return false;
      if (filters.date === 'active' && (customer.status || 'Active') !== 'Active') return false;
      if (!term) return true;
      return [
        customer.name,
        customer.fullName,
        customer.contactPerson,
        customer.phone,
        customer.mobile,
        customer.businessPhone,
        customer.email,
        customer.businessEmail,
        customer.company,
        customer.companyName,
        customer.city,
        customer.gst,
      ].some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const aTime = toDate(a.updatedAt)?.getTime() || toDate(a.createdAt)?.getTime() || 0;
      const bTime = toDate(b.updatedAt)?.getTime() || toDate(b.createdAt)?.getTime() || 0;
      return bTime - aTime;
    });
}

function downloadCustomersCsv(rows: Customer[], filename: string) {
  const headers = ['Name', 'Company', 'Phone', 'Email', 'City', 'State', 'Type', 'Status', 'Assigned To', 'Created'];
  const lines = rows.map((customer) =>
    [
      customerName(customer),
      customerCompany(customer),
      customerPhone(customer),
      customerEmail(customer),
      customer.city || '',
      customer.state || '',
      customer.type || '',
      customer.status || 'Active',
      customer.assignedToName || '',
      formatCustomerDate(customer.createdAt),
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const csv = [headers.join(','), ...lines].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function MobileCustomerWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const notificationCompanyId = resolveNotificationCompanyId(activeCompanyId);
  const perms = usePermissions();
  const { data: customers = [], isLoading, error } = useCustomers();
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 300000,
  });
  const { data: leads = [] } = useQuery({ queryKey: keys.leadsAll, queryFn: () => getAll(COLLECTIONS.LEADS), staleTime: 60000 });
  const { data: orders = [] } = useQuery({ queryKey: keys.ordersAll, queryFn: () => getAll(COLLECTIONS.ORDERS), staleTime: 60000 });
  const { data: quotations = [] } = useQuery({ queryKey: keys.quotationsAll, queryFn: () => getAll(COLLECTIONS.QUOTATIONS), staleTime: 60000 });
  const { data: invoices = [] } = useQuery({ queryKey: keys.invoices, queryFn: () => getAll(COLLECTIONS.PROFORMA_INVOICES), staleTime: 60000 });

    const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<'B2B' | 'B2C' | null>(null);
  const [b2bForm, setB2bForm] = useState({ ...B2B_FORM0 });
  const [b2cForm, setB2cForm] = useState({ ...B2C_FORM0 });
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState({ ...EDIT_FORM0 });
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [followupCustomer, setFollowupCustomer] = useState<Customer | null>(null);
  const [followupNote, setFollowupNote] = useState('');
  const [followupDate, setFollowupDate] = useState('');
  const [transferCustomer, setTransferCustomer] = useState<Customer | null>(null);
  const [transferUserId, setTransferUserId] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const createParam = params.get('create');

  useEffect(() => {
    if (mode === 'create') {
      setCreateOpen(true);
      setCreateType(null);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'records' || createParam !== '1') return;
    setCreateOpen(true);
    setCreateType(null);
    setDirty(false);
  }, [mode, createParam]);

  const salesUsers = useMemo(
    () => (users as any[])
      .filter((entry) => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(entry.role) && entry.status !== 'Inactive' && !entry.isDeleted)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [users],
  );

  const filters = useMemo<CustomerFilters>(() => ({
    search: params.get('q') || '',
    type: params.get('type') || ALL,
    status: params.get('status') || ALL,
    date: params.get('date') || 'all',
  }), [params]);

  const filteredCustomers = useMemo(() => filterCustomers(customers as Customer[], filters), [customers, filters]);
  const paginatedCustomers = useMemo(() => filteredCustomers.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredCustomers, page]);
  const selectedRows = useMemo(() => (customers as Customer[]).filter((customer) => selected.has(customer.id)), [customers, selected]);
  const canEdit = perms.canEdit('customers');
  const canDelete = perms.canDelete('customers');

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredCustomers.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredCustomers.length, page]);

  useEffect(() => {
    setSelected((current) => {
      const available = new Set((customers as Customer[]).map((customer) => customer.id));
      const next = new Set(Array.from(current).filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [customers]);

  // Opening a customer navigates to the shared Customer Details page
  // (CustomerWorkspace) — the same implementation desktop uses, no popup.
  function openMobileDetail(customer: Customer) {
    navigate(`/customers/${encodeURIComponent(customer.id)}`);
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

  function closeCreate() {
    setCreateOpen(false);
    setCreateType(null);
    setB2bForm({ ...B2B_FORM0 });
    setB2cForm({ ...B2C_FORM0 });
    setDirty(false);
    if (mode === 'create') {
      navigate('/app', { replace: true });
      return;
    }
    if (params.get('create') === '1') {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  function requestCloseCreate() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeCreate();
  }

  function openEdit(customer: Customer) {
    setEditingCustomer(customer);
    setEditForm({
      name: customerName(customer),
      phone: customerPhone(customer),
      email: customerEmail(customer),
      company: customerCompany(customer),
      gst: customer.gst || '',
      pan: customer.pan || '',
      address: customer.address || '',
      city: customer.city || '',
      state: customer.state || '',
      pincode: customer.pincode || '',
      type: customer.type || 'B2B',
      status: customer.status || 'Active',
      creditLimit: String(customer.creditLimit || ''),
      paymentTerms: String(customer.paymentTerms || 30),
      notes: customer.notes || '',
      assignedToId: customer.assignedToId || '',
      assignedToName: customer.assignedToName || '',
    });
    setDirty(false);
  }

  function closeEdit() {
    setEditingCustomer(null);
    setEditForm({ ...EDIT_FORM0 });
    setDirty(false);
  }

  function requestCloseEdit() {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    closeEdit();
  }

  const createB2B = useMutation({
    mutationFn: async (form: typeof B2B_FORM0) => {
      const id = genId.customer();
      const logEntry = { id: genId.generic('LOG'), type: 'Creation', desc: 'B2B Customer created', date: new Date().toISOString(), userName: user.name };
      const customer = {
        ...form,
        id,
        type: 'B2B',
        name: form.contactPerson,
        phone: form.businessPhone,
        email: form.businessEmail,
        companyName: form.companyName || form.company,
        company: form.companyName || form.company,
        createdBy: user.id,
        status: 'Active',
        activityLog: [logEntry],
      };
      await createCustomerProjection(id, customer);
      if (form.assignedToId) await sendNotification(form.assignedToId, NotificationType.CUSTOMER_ASSIGNED, 'Customer assigned', `Customer ${form.contactPerson || form.company || id} was assigned to you.`, 'customer', id, notificationCompanyId);
      await notifyRoleUsers(['Admin', 'Director'], NotificationType.CUSTOMER_CREATED, 'Customer created', `Customer ${form.contactPerson || form.company || id} was created.`, 'customer', id, notificationCompanyId);
      return customer;
    },
    onSuccess: (customer) => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success('B2B Customer created');
      closeCreate();
      if (customer?.id) openMobileDetail(customer as Customer);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createB2C = useMutation({
    mutationFn: async (form: typeof B2C_FORM0) => {
      const id = genId.customer();
      const logEntry = { id: genId.generic('LOG'), type: 'Creation', desc: 'B2C Customer created', date: new Date().toISOString(), userName: user.name };
      const customer = {
        ...form,
        id,
        type: 'B2C',
        name: form.fullName,
        phone: form.mobile,
        projectType: form.projectType || form.propertyType,
        createdBy: user.id,
        status: 'Active',
        activityLog: [logEntry],
      };
      await createCustomerProjection(id, customer);
      if (form.assignedToId) await sendNotification(form.assignedToId, NotificationType.CUSTOMER_ASSIGNED, 'Customer assigned', `Customer ${form.fullName || id} was assigned to you.`, 'customer', id, notificationCompanyId);
      await notifyRoleUsers(['Admin', 'Director'], NotificationType.CUSTOMER_CREATED, 'Customer created', `Customer ${form.fullName || id} was created.`, 'customer', id, notificationCompanyId);
      return customer;
    },
    onSuccess: (customer) => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success('B2C Customer created');
      closeCreate();
      if (customer?.id) openMobileDetail(customer as Customer);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveEdit = useMutation({
    mutationFn: async (form: typeof EDIT_FORM0) => {
      if (!editingCustomer) return null;
      const payload = {
        ...form,
        creditLimit: Number(form.creditLimit) || 0,
        paymentTerms: Number(form.paymentTerms) || 30,
        updatedBy: user.id,
      };
      await updateCustomerProjectionWithPhoneLock(editingCustomer.id, payload);
      if (form.assignedToId) await sendNotification(form.assignedToId, NotificationType.CUSTOMER_UPDATED, 'Customer updated', `Customer ${form.name || editingCustomer.id} was updated.`, 'customer', editingCustomer.id, notificationCompanyId);
      return { ...editingCustomer, ...payload };
    },
    onSuccess: (customer) => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success('Customer updated');
      closeEdit();
      if (customer?.id) openMobileDetail(customer as Customer);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteCustomerProjection(id)));
      await notifyRoleUsers(['Admin', 'Director'], NotificationType.CUSTOMER_DELETED, 'Customer deleted', `${ids.length} customer${ids.length === 1 ? '' : 's'} deleted.`, 'customer', ids[0] || 'bulk', notificationCompanyId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success('Customer deleted');
      setSelected(new Set());
      setDeleteOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addFollowup = useMutation({
    mutationFn: async ({ customer, note, next }: { customer: Customer; note: string; next: string }) => {
      await createDocWithId(COLLECTIONS.FOLLOWUPS, genId.generic('FU'), { customerId: customer.id, note, next_date: next });
      const logEntry = { id: genId.generic('LOG'), type: 'Follow-up', desc: note, date: new Date().toISOString(), userName: user.name };
      await updateProjectionWithEntity(COLLECTIONS.CUSTOMERS, customer.id, {
        next_date: next,
        last_note: note,
        activityLog: [...(customer.activityLog || []), logEntry],
        updatedBy: user.id,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success('Follow-up added');
      setFollowupCustomer(null);
      setFollowupNote('');
      setFollowupDate('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const transferMutation = useMutation({
    mutationFn: async ({ customer, newUserId, newUserName, note }: { customer: Customer; newUserId: string; newUserName: string; note: string }) => {
      const logEntry = { id: genId.generic('LOG'), type: 'Transfer', desc: `Transferred to ${newUserName}. Note: ${note}`, date: new Date().toISOString(), userName: user.name };
      const historyEntry = { fromUserId: user.id, fromUserName: user.name, toUserId: newUserId, toUserName: newUserName, note, transferredAt: new Date().toISOString() };
      await updateProjectionWithEntity(COLLECTIONS.CUSTOMERS, customer.id, {
        assignedToId: newUserId,
        assignedToName: newUserName,
        activityLog: [...(customer.activityLog || []), logEntry],
        transferHistory: [...(customer.transferHistory || []), historyEntry],
        updatedBy: user.id,
      });
      await sendNotification(newUserId, NotificationType.CUSTOMER_ASSIGNED, 'Customer assigned', `Customer ${customerName(customer)} was assigned to you.`, 'customer', customer.id, notificationCompanyId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success('Customer assigned');
      setTransferCustomer(null);
      setTransferUserId('');
      setTransferNote('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      await Promise.all(ids.map((id) => updateProjectionWithEntity(COLLECTIONS.CUSTOMERS, id, { status, updatedBy: user.id })));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success(`Updated ${selected.size} customer${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkStatus('');
      setBulkStatusOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, assigneeId, assigneeName }: { ids: string[]; assigneeId: string; assigneeName: string }) => {
      await Promise.all(ids.map((id) => updateProjectionWithEntity(COLLECTIONS.CUSTOMERS, id, { assignedToId: assigneeId, assignedToName: assigneeName, updatedBy: user.id })));
      await notifyUsersOnce([{ id: assigneeId }], NotificationType.CUSTOMER_ASSIGNED, 'Customers assigned', `${ids.length} customer${ids.length === 1 ? '' : 's'} were assigned to you.`, 'customer', ids[0] || 'bulk', notificationCompanyId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success(`Assigned ${selected.size} customer${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkAssignId('');
      setBulkAssignOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function submitB2B(event: React.FormEvent) {
    event.preventDefault();
    if (!b2bForm.contactPerson) return toast.error('Name required');
    if (!b2bForm.companyName && !b2bForm.company) return toast.error('Company name required');
    if (!b2bForm.businessPhone) return toast.error('Business phone required');
    createB2B.mutate(b2bForm);
  }

  function submitB2C(event: React.FormEvent) {
    event.preventDefault();
    if (!b2cForm.fullName) return toast.error('Full name required');
    if (!b2cForm.mobile) return toast.error('Mobile number required');
    if (!b2cForm.address) return toast.error('Address required');
    createB2C.mutate(b2cForm);
  }

  function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editForm.name || !editForm.phone) return toast.error('Name & phone required');
    saveEdit.mutate(editForm);
  }

  function exportRows(rows: Customer[]) {
    if (!rows.length) return toast.error('No customers selected');
    downloadCustomersCsv(rows, `customers-export-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(`Exported ${rows.length} customer${rows.length > 1 ? 's' : ''}`);
  }

  const deleteIds = Array.from(selected);

  if (mode === 'create') {
    return (
      <CustomerDialogs
        createOpen={createOpen}
        createType={createType}
        b2bForm={b2bForm}
        b2cForm={b2cForm}
        salesUsers={salesUsers}
        saving={createB2B.isPending || createB2C.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onSelectType={setCreateType}
        onCloseCreate={requestCloseCreate}
        onB2BChange={(patch) => { setB2bForm((current) => ({ ...current, ...patch })); setDirty(true); }}
        onB2CChange={(patch) => { setB2cForm((current) => ({ ...current, ...patch })); setDirty(true); }}
        onB2BSubmit={submitB2B}
        onB2CSubmit={submitB2C}
        editingCustomer={null}
        editForm={editForm}
        editLocksIdentity={false}
        onEditChange={(patch) => { setEditForm((current) => ({ ...current, ...patch })); setDirty(true); }}
        onEditSubmit={submitEdit}
        onCloseEdit={requestCloseEdit}
        onDiscard={() => { setConfirmClose(false); closeCreate(); closeEdit(); }}
        onKeepEditing={() => setConfirmClose(false)}
        editSaving={saveEdit.isPending}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 data-tour="mobile-customers-header" className="text-xl font-bold text-[var(--color-text)]">Customer</h1>
      </div>

      {selected.size > 0 && (
        <Card className="rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold text-[var(--color-primary-text)]">{selected.size} selected</span>
            <Button size="xs" variant="outline" icon={<Download className="h-3 w-3" />} onClick={() => exportRows(selectedRows)}>Export</Button>
            {canEdit && <Button size="xs" variant="outline" icon={<UserCheck className="h-3 w-3" />} onClick={() => setBulkAssignOpen(true)}>Assign</Button>}
            {canEdit && <Button size="xs" variant="outline" onClick={() => setBulkStatusOpen(true)}>Status</Button>}
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

      <div className="space-y-3" data-tour="mobile-customers-list">
        {isLoading && Array.from({ length: 5 }).map((_, index) => <CustomerSkeletonCard key={index} />)}
        {!isLoading && filteredCustomers.length === 0 && (
          <Card className="rounded-xl p-5 text-center text-sm text-[var(--color-text-muted)]">
            No customers match the current filters.
          </Card>
        )}
        {!isLoading && paginatedCustomers.map((customer) => (
          <CustomerCard
            key={customer.id}
            customer={customer}
            selected={selected.has(customer.id)}
            onSelect={() => toggleSelect(customer.id)}
            onView={() => openMobileDetail(customer)}
          />
        ))}
      </div>

      {!isLoading && filteredCustomers.length > 0 && (
        <div data-tour="mobile-customers-pagination">
          <Pagination page={page} total={filteredCustomers.length} perPage={PER_PAGE} onChange={changePage} />
        </div>
      )}

      <CustomerDialogs
        createOpen={createOpen}
        createType={createType}
        b2bForm={b2bForm}
        b2cForm={b2cForm}
        salesUsers={salesUsers}
        saving={createB2B.isPending || createB2C.isPending}
        dirty={dirty}
        confirmClose={confirmClose}
        onSelectType={setCreateType}
        onCloseCreate={requestCloseCreate}
        onB2BChange={(patch) => { setB2bForm((current) => ({ ...current, ...patch })); setDirty(true); }}
        onB2CChange={(patch) => { setB2cForm((current) => ({ ...current, ...patch })); setDirty(true); }}
        onB2BSubmit={submitB2B}
        onB2CSubmit={submitB2C}
        editingCustomer={editingCustomer}
        editForm={editForm}
        editLocksIdentity={Boolean(editingCustomer?.sourceLeadId)}
        onEditChange={(patch) => { setEditForm((current) => ({ ...current, ...patch })); setDirty(true); }}
        onEditSubmit={submitEdit}
        onCloseEdit={requestCloseEdit}
        onDiscard={() => { setConfirmClose(false); closeCreate(); closeEdit(); }}
        onKeepEditing={() => setConfirmClose(false)}
        editSaving={saveEdit.isPending}
      />

      <Modal open={!!followupCustomer} onClose={() => setFollowupCustomer(null)} title="Add Follow-up" size="full">
        {followupCustomer && (
          <div className="space-y-4">
            <Textarea label="Follow-up Note" required value={followupNote} onChange={(event) => setFollowupNote(event.target.value)} />
            <Input label="Next Follow-up Date" type="date" value={followupDate} onChange={(event) => setFollowupDate(event.target.value)} />
            <Button className="w-full" loading={addFollowup.isPending} onClick={() => {
              if (!followupNote.trim()) return toast.error('Note required');
              addFollowup.mutate({ customer: followupCustomer, note: followupNote, next: followupDate });
            }}>
              Save Follow-up
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={!!transferCustomer} onClose={() => setTransferCustomer(null)} title="Assign Customer" size="full">
        {transferCustomer && (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--color-bg-sunken)] p-3 text-sm">
              <p className="text-[var(--color-text-muted)]">Current Assignee</p>
              <p className="font-semibold text-[var(--color-text)]">{transferCustomer.assignedToName || 'Unassigned'}</p>
            </div>
            <Select label="New Assignee" value={transferUserId} onChange={(event) => setTransferUserId(event.target.value)} options={[{ label: 'Select Salesperson...', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]} />
            <Textarea label="Assignment Note" required value={transferNote} onChange={(event) => setTransferNote(event.target.value)} />
            <Button className="w-full" loading={transferMutation.isPending} onClick={() => {
              const assignee = salesUsers.find((entry) => entry.id === transferUserId);
              if (!assignee || !transferNote.trim()) return toast.error('Assignee and note required');
              transferMutation.mutate({ customer: transferCustomer, newUserId: assignee.id, newUserName: assignee.name, note: transferNote });
            }}>
              Confirm Assignment
            </Button>
          </div>
        )}
      </Modal>

      <Modal open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} title="Change Status" size="sm">
        <div className="space-y-4">
          <Select label="New Status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} options={[{ label: 'Select status...', value: '' }, ...CUSTOMER_STATUSES.map((value) => ({ label: value, value }))]} />
          <Button className="w-full" loading={bulkStatusMutation.isPending} onClick={() => {
            if (!bulkStatus) return toast.error('Select a status');
            bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
          }}>
            Update {selected.size} Customers
          </Button>
        </div>
      </Modal>

      <Modal open={bulkAssignOpen} onClose={() => setBulkAssignOpen(false)} title="Assign Customers" size="sm">
        <div className="space-y-4">
          <Select label="Assign To" value={bulkAssignId} onChange={(event) => setBulkAssignId(event.target.value)} options={[{ label: 'Select salesperson...', value: '' }, ...salesUsers.map((entry) => ({ label: entry.name, value: entry.id }))]} />
          <Button className="w-full" loading={bulkAssignMutation.isPending} onClick={() => {
            const assignee = salesUsers.find((entry) => entry.id === bulkAssignId);
            if (!assignee) return toast.error('Select a salesperson');
            bulkAssignMutation.mutate({ ids: Array.from(selected), assigneeId: assignee.id, assigneeName: assignee.name });
          }}>
            Assign {selected.size} Customers
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate(deleteIds)}
        loading={deleteMutation.isPending}
        title="Delete Customer"
        message={`Delete ${deleteIds.length || 1} customer${deleteIds.length > 1 ? 's' : ''}? This cannot be undone.`}
      />
    </div>
  );
}

function CustomerCard({ customer, selected, onSelect, onView }: {
  customer: Customer;
  selected: boolean;
  onSelect: () => void;
  onView: () => void;
}) {
  const phone = customerPhone(customer);
  const email = customerEmail(customer);
  const whatsapp = whatsappHref(phone);
  const company = customerCompany(customer);
  return (
    <Card data-tour="mobile-customers-card" className={cn(
      'rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]',
      selected && 'border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40',
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-[var(--color-border)] text-[var(--color-primary)]"
          aria-label={`Select ${customerName(customer)}`}
        />
        <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[15px] font-bold leading-5 text-[var(--color-text)]">{customerName(customer)}</p>
          {company ? <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]">{company}</p> : null}
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
            <p className="truncate">{customerAddress(customer) || 'Address not available'}</p>
            <p className="truncate">{phone || 'Mobile not available'}</p>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {statusBadge(customer.status || 'Active')}
            {customer.type ? <Badge variant={customer.type === 'B2C' ? 'info' : 'purple'}>{customer.type}</Badge> : null}
            {customer.sourceLeadId ? <Badge variant="gray">Lead</Badge> : <Badge variant="gray">Direct</Badge>}
            {customer.assignedToName ? <span className="truncate text-xs font-semibold text-[var(--color-text-muted)]">{customer.assignedToName}</span> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <a href={whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp customer" className={cn(actionIconClass, 'bg-emerald-50/90 text-emerald-600 ring-emerald-100 dark:bg-emerald-900/25 dark:text-emerald-300 dark:ring-emerald-800/60', !whatsapp && 'pointer-events-none opacity-40')}>
            <MessageCircle className="h-4 w-4" strokeWidth={2.25} />
          </a>
          <a href={email ? `mailto:${email}` : undefined} aria-label="Email customer" className={cn(actionIconClass, 'bg-amber-50/90 text-amber-600 ring-amber-100 dark:bg-amber-900/25 dark:text-amber-300 dark:ring-amber-800/60', !email && 'pointer-events-none opacity-40')}>
            <Mail className="h-4 w-4" strokeWidth={2.2} />
          </a>
          <a href={phoneHref(phone)} aria-label="Call customer" className={cn(actionIconClass, 'bg-blue-50/90 text-blue-600 ring-blue-100 dark:bg-blue-900/25 dark:text-blue-300 dark:ring-blue-800/60', !phone && 'pointer-events-none opacity-40')}>
            <Phone className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </Card>
  );
}

const actionIconClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/60 shadow-sm ring-1 backdrop-blur-sm transition-transform active:scale-95';

function CustomerSkeletonCard() {
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

function CustomerDialogs({
  createOpen,
  createType,
  b2bForm,
  b2cForm,
  salesUsers,
  saving,
  dirty,
  confirmClose,
  onSelectType,
  onCloseCreate,
  onB2BChange,
  onB2CChange,
  onB2BSubmit,
  onB2CSubmit,
  editingCustomer,
  editForm,
  editLocksIdentity,
  onEditChange,
  onEditSubmit,
  onCloseEdit,
  onDiscard,
  onKeepEditing,
  editSaving,
}: {
  createOpen: boolean;
  createType: 'B2B' | 'B2C' | null;
  b2bForm: typeof B2B_FORM0;
  b2cForm: typeof B2C_FORM0;
  salesUsers: any[];
  saving: boolean;
  dirty: boolean;
  confirmClose: boolean;
  onSelectType: (type: 'B2B' | 'B2C') => void;
  onCloseCreate: () => void;
  onB2BChange: (patch: Partial<typeof B2B_FORM0>) => void;
  onB2CChange: (patch: Partial<typeof B2C_FORM0>) => void;
  onB2BSubmit: (event: React.FormEvent) => void;
  onB2CSubmit: (event: React.FormEvent) => void;
  editingCustomer: Customer | null;
  editForm: typeof EDIT_FORM0;
  editLocksIdentity: boolean;
  onEditChange: (patch: Partial<typeof EDIT_FORM0>) => void;
  onEditSubmit: (event: React.FormEvent) => void;
  onCloseEdit: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  editSaving: boolean;
}) {
  return (
    <>
      <Modal open={createOpen} onClose={onCloseCreate} title={createType ? `Create ${createType} Customer` : 'Create Customer'} size="full">
        {!createType ? (
          <div className="grid gap-3">
            <button type="button" onClick={() => onSelectType('B2B')} className="flex min-h-24 items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left">
              <Building2 className="h-6 w-6 text-[var(--color-primary)]" />
              <div>
                <p className="font-bold text-[var(--color-text)]">B2B Business</p>
                <p className="text-xs text-[var(--color-text-muted)]">Company, GST and business contact workflow</p>
              </div>
            </button>
            <button type="button" onClick={() => onSelectType('B2C')} className="flex min-h-24 items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left">
              <User className="h-6 w-6 text-[var(--color-primary)]" />
              <div>
                <p className="font-bold text-[var(--color-text)]">B2C Individual</p>
                <p className="text-xs text-[var(--color-text-muted)]">Residential customer and solar details</p>
              </div>
            </button>
          </div>
        ) : createType === 'B2B' ? (
          <form onSubmit={onB2BSubmit} className="space-y-4">
            <Input label="Contact Person" required value={b2bForm.contactPerson} onChange={(event) => onB2BChange({ contactPerson: event.target.value })} />
            <Input label="Company Name" required value={b2bForm.companyName || b2bForm.company} onChange={(event) => onB2BChange({ companyName: event.target.value, company: event.target.value })} />
            <Input label="Business Phone" required value={b2bForm.businessPhone} onChange={(event) => onB2BChange({ businessPhone: event.target.value })} />
            <Input label="Business Email" type="email" value={b2bForm.businessEmail} onChange={(event) => onB2BChange({ businessEmail: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="GST" value={b2bForm.gst} onChange={(event) => onB2BChange({ gst: event.target.value })} />
              <Input label="Industry" value={b2bForm.industryType} onChange={(event) => onB2BChange({ industryType: event.target.value })} />
            </div>
            <Textarea label="Address" value={b2bForm.address} onChange={(event) => onB2BChange({ address: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City" value={b2bForm.city} onChange={(event) => onB2BChange({ city: event.target.value })} />
              <Input label="State" value={b2bForm.state} onChange={(event) => onB2BChange({ state: event.target.value })} />
            </div>
            <AssigneeSelect value={b2bForm.assignedToId} users={salesUsers} onChange={(id, name) => onB2BChange({ assignedToId: id, assignedToName: name })} />
            <Textarea label="Notes" value={b2bForm.notes} onChange={(event) => onB2BChange({ notes: event.target.value })} />
            {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onCloseCreate}>Cancel</Button>
              <Button type="submit" className="flex-1" loading={saving}>Create</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={onB2CSubmit} className="space-y-4">
            <Input label="Full Name" required value={b2cForm.fullName} onChange={(event) => onB2CChange({ fullName: event.target.value })} />
            <Input label="Mobile" required value={b2cForm.mobile} onChange={(event) => onB2CChange({ mobile: event.target.value })} />
            <Input label="Email" type="email" value={b2cForm.email} onChange={(event) => onB2CChange({ email: event.target.value })} />
            <Textarea label="Address" required value={b2cForm.address} onChange={(event) => onB2CChange({ address: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City" value={b2cForm.city} onChange={(event) => onB2CChange({ city: event.target.value })} />
              <Input label="State" value={b2cForm.state} onChange={(event) => onB2CChange({ state: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Monthly Bill" value={b2cForm.monthlyBillAmount} onChange={(event) => onB2CChange({ monthlyBillAmount: event.target.value })} />
              <Input label="Sanction Load" value={b2cForm.sanctionLoad} onChange={(event) => onB2CChange({ sanctionLoad: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Roof Type" value={b2cForm.roofType} onChange={(event) => onB2CChange({ roofType: event.target.value })} />
              <Input label="Property Type" value={b2cForm.propertyType} onChange={(event) => onB2CChange({ propertyType: event.target.value })} />
            </div>
            <AssigneeSelect value={b2cForm.assignedToId} users={salesUsers} onChange={(id, name) => onB2CChange({ assignedToId: id, assignedToName: name })} />
            <Textarea label="Notes" value={b2cForm.notes} onChange={(event) => onB2CChange({ notes: event.target.value })} />
            {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onCloseCreate}>Cancel</Button>
              <Button type="submit" className="flex-1" loading={saving}>Create</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!editingCustomer} onClose={onCloseEdit} title="Edit Customer" size="full">
        {editingCustomer && (
          <form onSubmit={onEditSubmit} className="space-y-4">
            <Input label="Name" required disabled={editLocksIdentity} value={editForm.name} onChange={(event) => onEditChange({ name: event.target.value })} />
            <Input label="Phone" required disabled={editLocksIdentity} value={editForm.phone} onChange={(event) => onEditChange({ phone: event.target.value })} />
            <Input label="Email" type="email" value={editForm.email} onChange={(event) => onEditChange({ email: event.target.value })} />
            <Input label="Company" value={editForm.company} onChange={(event) => onEditChange({ company: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Type" value={editForm.type} onChange={(event) => onEditChange({ type: event.target.value })} options={CUSTOMER_TYPES.map((value) => ({ label: value, value }))} />
              <Select label="Status" value={editForm.status} onChange={(event) => onEditChange({ status: event.target.value })} options={CUSTOMER_STATUSES.map((value) => ({ label: value, value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="GST" value={editForm.gst} onChange={(event) => onEditChange({ gst: event.target.value })} />
              <Input label="PAN" value={editForm.pan} onChange={(event) => onEditChange({ pan: event.target.value })} />
            </div>
            <Textarea label="Address" value={editForm.address} onChange={(event) => onEditChange({ address: event.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="City" value={editForm.city} onChange={(event) => onEditChange({ city: event.target.value })} />
              <Input label="State" value={editForm.state} onChange={(event) => onEditChange({ state: event.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Credit Limit" value={editForm.creditLimit} onChange={(event) => onEditChange({ creditLimit: event.target.value })} />
              <Input label="Payment Terms" value={editForm.paymentTerms} onChange={(event) => onEditChange({ paymentTerms: event.target.value })} />
            </div>
            <AssigneeSelect value={editForm.assignedToId} users={salesUsers} onChange={(id, name) => onEditChange({ assignedToId: id, assignedToName: name })} />
            <Textarea label="Notes" value={editForm.notes} onChange={(event) => onEditChange({ notes: event.target.value })} />
            {editLocksIdentity ? <p className="text-xs text-[var(--color-text-muted)]">Name and phone are locked because this customer was converted from a lead.</p> : null}
            {dirty ? <p className="text-xs font-medium text-[var(--color-warning-text)]">Unsaved changes</p> : null}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onCloseEdit}>Cancel</Button>
              <Button type="submit" className="flex-1" loading={editSaving}>Save</Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog open={confirmClose} onClose={onKeepEditing} onConfirm={onDiscard} title="Discard Changes" message="Close this form and discard unsaved changes?" />
    </>
  );
}

function AssigneeSelect({ value, users, onChange }: { value: string; users: any[]; onChange: (id: string, name: string) => void }) {
  return (
    <Select
      label="Assigned To"
      value={value}
      onChange={(event) => {
        const assignee = users.find((entry) => entry.id === event.target.value);
        onChange(event.target.value, assignee?.name || '');
      }}
      options={[{ label: 'Unassigned', value: '' }, ...users.map((entry) => ({ label: entry.name, value: entry.id }))]}
    />
  );
}


export default MobileCustomerWorkspace;
