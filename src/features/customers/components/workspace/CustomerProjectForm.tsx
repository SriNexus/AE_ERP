/**
 * CustomerProjectForm — embedded Project creation for the Customer Workspace
 * Center Panel (Phase 2). Wraps `ProjectForm` directly (already a clean,
 * prop-driven, reusable component — no extraction needed) with the
 * `lockedCustomerLabel` prop added this phase so the customer isn't
 * re-selected. Reuses `createProject()`/`createProjectFromLoanApplication()`
 * (lib/projectWorkflow.ts, loanApplicationWorkflow.ts) unmodified.
 *
 * Scope, per "produce, don't manage downstream": this embeds project
 * *creation* only. The Project's own 16-stage lifecycle (Survey → ... →
 * Monitoring) is tracked entirely in the Project Workspace, never here.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { ProjectForm } from '../../../projects/components/ProjectForm';
import type { ProjectFormValues } from '../../../projects/types';
import { PROJECT_FORM_DEFAULT } from '../../../projects/types';
import { createProject } from '../../../../lib/projectWorkflow';
import { createProjectFromLoanApplication } from '../../../loan-applications/services/loanApplicationWorkflow';

interface Props {
  customer: any;
  /** If a Payment-Received loan application with no project yet exists, this
   * offers the "from Loan Application" fast path (reuses createProjectFromLoanApplication
   * exactly as the Loan Applications workspace's own UI does). */
  eligibleLoanApplication?: { id: string; registrationId?: string } | null;
  onCancel: () => void;
  onCreated: () => void;
}

function customerLabel(customer: any): string {
  return customer.name || customer.fullName || customer.contactPerson || 'This customer';
}

export default function CustomerProjectForm({ customer, eligibleLoanApplication, onCancel, onCreated }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ProjectFormValues>({ ...PROJECT_FORM_DEFAULT, customerId: customer.id });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['customer-kpi-projects', customer.id] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const saveDirect = useMutation({
    mutationFn: () => createProject(form, { customerName: customerLabel(customer) }),
    onSuccess: () => { invalidate(); toast.success('Project created'); onCreated(); },
    onError: (e: any) => toast.error(e.message),
  });

  const saveFromLoanApplication = useMutation({
    mutationFn: () => createProjectFromLoanApplication(eligibleLoanApplication!.id, Number(form.capacityKw) || 1, form.projectType, form.siteAddress.line1 || undefined),
    onSuccess: () => { invalidate(); toast.success('Project created from loan application'); onCreated(); },
    onError: (e: any) => toast.error(e.message),
  });

  const saving = saveDirect.isPending || saveFromLoanApplication.isPending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    if (eligibleLoanApplication) { saveFromLoanApplication.mutate(); return; }
    saveDirect.mutate();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--color-text)]">New Project for {customerLabel(customer)}</h3>
        <button type="button" onClick={onCancel} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>
      {eligibleLoanApplication && (
        <div className="rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-3 py-2 text-xs text-[var(--color-primary-text)]">
          Loan Application {eligibleLoanApplication.registrationId || eligibleLoanApplication.id} has Payment Received — this project will be created from it and cross-linked automatically.
        </div>
      )}
      <ProjectForm
        form={form}
        onChange={setForm}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        customers={[]}
        loading={saving}
        isEdit={false}
        lockedCustomerLabel={customerLabel(customer)}
      />
    </div>
  );
}
