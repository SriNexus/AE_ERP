/**
 * CustomerLoanApplicationForm — embedded Loan Application creation for the Customer
 * Workspace Center Panel (Phase 2). Customer is locked (no re-selection).
 *
 * Scope, per "produce, don't manage downstream" (Master Plan §6.2): this
 * embeds *creation only* — bank name, branch, loan amount, application
 * number. The full 9-status bank-loan pipeline (Digital Sign → Bank
 * Submission → Approved → Payment Received, with its automated
 * task-per-status system in loanApplicationWorkflow.ts) stays exclusively on
 * the dedicated Loan Applications workspace; this form does not attempt to
 * reimplement it. Reuses createLoanApplication() (lib extracted this phase from
 * LoanApplicationsWorkspace.tsx's own create path) — no duplicate business logic.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../../components/ui/Input';
import { useCurrentUser } from '../../../../store/useAppStore';
import { createLoanApplication } from '../../../loan-applications/services/loanApplicationWorkflow';
import { LOAN_APPLICATION_FORM_DEFAULT } from '../../../loan-applications/hooks/useLoanApplications';
import { useBankOptions } from '../../../banks/hooks/useBanks';

interface Props {
  customer: any;
  onCancel: () => void;
  onCreated: () => void;
}

export default function CustomerLoanApplicationForm({ customer, onCancel, onCreated }: Props) {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const { options: bankOptions } = useBankOptions();
  const [form, setForm] = useState({
    ...LOAN_APPLICATION_FORM_DEFAULT,
    customerId: customer.id,
    customerName: customer.name || customer.fullName || '',
    customerPhone: customer.phone || customer.mobile || '',
    customerAddress: customer.address || '',
  });

  const save = useMutation({
    mutationFn: () => createLoanApplication({ form, createdById: user.id, createdByName: user.name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-kpi-registrations', customer.id] });
      qc.invalidateQueries({ queryKey: ['registrations'] });
      toast.success('Loan application created');
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (!form.customerName) return toast.error('Customer name required');
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--color-text)]">New Loan Application for {form.customerName || 'this customer'}</h3>
        <button type="button" onClick={onCancel} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <FormSection title="Bank Details">
        <FormRow>
          <Select label="Bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} options={bankOptions} />
          <Input label="Branch" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="Branch name" />
        </FormRow>
        <FormRow>
          <Input label="Loan Amount (₹)" type="number" min="0" value={form.loanAmount} onChange={(e) => setForm({ ...form, loanAmount: Number(e.target.value) || 0 })} />
          <Input label="Application Number" value={form.applicationNumber} onChange={(e) => setForm({ ...form, applicationNumber: e.target.value })} placeholder="Optional, once available" />
        </FormRow>
      </FormSection>

      <FormSection title="Notes">
        <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </FormSection>

      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3 text-xs text-[var(--color-text-muted)]">
        Bank-submission status, digital signing, approval, and payment tracking happen in the full Loan Applications workspace after this is created.
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Create Loan Application</Button>
      </div>
    </form>
  );
}
