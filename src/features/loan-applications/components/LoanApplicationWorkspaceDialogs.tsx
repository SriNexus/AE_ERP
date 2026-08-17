import { useMemo, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { LOAN_APPLICATION_STATUSES } from '../hooks/useLoanApplications';
import { useCustomers } from '../../customers/hooks/useCustomers';

type RegDialogsProps = {
  ctx: any;
};

export function LoanApplicationWorkspaceDialogs({ ctx }: RegDialogsProps) {
  const {
    showForm, closeForm, editId, form, setForm, save,
    salesUsers,
    showBulkStatus, setShowBulkStatus, bulkStatus, setBulkStatus, bulkStatusMutation, selected,
    showBulkAssign, setShowBulkAssign, bulkAssignId, setBulkAssignId, bulkAssignName, setBulkAssignName, bulkAssignMutation,
    handleSubmit,
  } = ctx;

  const BANK_OPTIONS = ctx.bankOptions || [{ label: 'Select Bank', value: '' }];
  const STATUS_OPTIONS = [{ label: 'Select Status', value: '' }, ...LOAN_APPLICATION_STATUSES.map((s: string) => ({ label: s, value: s }))];
  const SIGN_OPTIONS = [
    { label: 'Pending', value: 'pending' },
    { label: 'Completed', value: 'completed' },
  ];

  // ── Create-mode customer picker: search the user's scoped customer list and
  // auto-load the existing profile into the form (no manual re-entry). The
  // service layer (createLoanApplication) remains the authoritative guard —
  // this picker only offers customers the user can already see. ──
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
    setForm({
      ...form,
      customerId: c.id,
      customerName: c.name || c.fullName || '',
      customerPhone: c.phone || c.mobile || '',
      customerAddress: c.address || '',
    });
    setCustomerQuery(c.name || c.fullName || c.id || '');
  }

  return (
    <>
      <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Loan Application' : 'Add Loan Application'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-5">
          {editId ? (
            <FormSection title="Customer Information">
              <FormRow>
                <Input label="Customer Name" required value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} placeholder="Customer name" />
                <Input label="Phone" required value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} placeholder="Phone number" />
              </FormRow>
              <Textarea label="Address" value={form.customerAddress} onChange={e => setForm({ ...form, customerAddress: e.target.value })} placeholder="Customer address" rows={2} />
            </FormSection>
          ) : (
            <FormSection title="Select Customer">
              <Input
                label="Search Customer"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Search by customer name, mobile or ID"
              />
              {form.customerId ? (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/40 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{form.customerName || 'Selected customer'}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{form.customerPhone || 'No phone'} · {form.customerId}</p>
                    {form.customerAddress ? <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{form.customerAddress}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setForm({ ...form, customerId: '', customerName: '', customerPhone: '', customerAddress: '' }); setCustomerQuery(''); }}
                    className="shrink-0 text-xs font-semibold text-[var(--color-primary-text)] hover:underline"
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
            </FormSection>
          )}

          <FormSection title="Bank Details">
            <FormRow>
              <Select label="Bank Name" value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} options={BANK_OPTIONS} />
              <Input label="Branch" value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} placeholder="Branch name" />
            </FormRow>
            <FormRow>
              <Input label="Loan Amount (₹)" type="number" value={form.loanAmount} onChange={e => setForm({ ...form, loanAmount: Number(e.target.value) })} placeholder="e.g. 500000" />
              <Input label="Application Number" value={form.applicationNumber} onChange={e => setForm({ ...form, applicationNumber: e.target.value })} placeholder="Bank application ref" />
            </FormRow>
          </FormSection>

          <FormSection title="Workflow">
            <FormRow>
              <Select label="Digital Sign" value={form.digitalSignStatus} onChange={e => setForm({ ...form, digitalSignStatus: e.target.value })} options={SIGN_OPTIONS} />
              <Input label="Bank Submission Date" type="date" value={form.submissionDate} onChange={e => setForm({ ...form, submissionDate: e.target.value })} />
            </FormRow>
            <FormRow>
              <Input label="Approval Date" type="date" value={form.approvalDate} onChange={e => setForm({ ...form, approvalDate: e.target.value })} />
              <Input label="Payment Date" type="date" value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
            </FormRow>
          </FormSection>

          <FormSection title="Assignment">
            <FormRow>
              <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} options={STATUS_OPTIONS} />
              <Select label="Assign To" value={form.assignedToId} onChange={e => {
                const u = (salesUsers || []).find((x: any) => x.id === e.target.value);
                setForm({ ...form, assignedToId: e.target.value, assignedToName: u ? u.name : '' });
              }} options={[{ label: 'Unassigned', value: '' }, ...(salesUsers || []).map((u: any) => ({ label: u.name, value: u.id }))]} />
            </FormRow>
            <Textarea label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes..." />
          </FormSection>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button type="submit" loading={save?.isPending}>{editId ? 'Update Loan Application' : 'Add Loan Application'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={showBulkStatus} onClose={() => { setShowBulkStatus(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected?.size || 0} loan application{(selected?.size || 0) > 1 ? 's' : ''}</span>.
          </p>
          <Select label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} options={STATUS_OPTIONS} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={() => {
              if (!bulkStatus) return;
              bulkStatusMutation?.mutate({ ids: Array.from(selected || []), status: bulkStatus });
            }} loading={bulkStatusMutation?.isPending}>Update {selected?.size || 0} Loan Applications</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showBulkAssign} onClose={() => { setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); }} title="Assign Loan Applications" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Assigning <span className="font-semibold text-[var(--color-text)]">{selected?.size || 0} loan application{(selected?.size || 0) > 1 ? 's' : ''}</span>.
          </p>
          <Select label="Assign To" value={bulkAssignId} onChange={e => {
            const u = (salesUsers || []).find((x: any) => x.id === e.target.value);
            setBulkAssignId(e.target.value);
            setBulkAssignName(u ? u.name : '');
          }} options={[{ label: 'Select User...', value: '' }, ...(salesUsers || []).map((u: any) => ({ label: u.name, value: u.id }))]} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); }}>Cancel</Button>
            <Button onClick={() => {
              if (!bulkAssignId) return;
              bulkAssignMutation?.mutate({ ids: Array.from(selected || []), userId: bulkAssignId, userName: bulkAssignName });
            }} loading={bulkAssignMutation?.isPending}>Assign {selected?.size || 0} Loan Applications</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
