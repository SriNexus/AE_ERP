import { type FormEvent } from 'react';

import { INDIAN_STATES } from '../../../config/company';
import { Button } from '../../../components/ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { PROJECT_TYPES, type ProjectFormValues } from '../types';
import { projectCustomerLabel } from '../utils/projectDisplay';

type CustomerOption = {
  id: string;
  name?: string;
  fullName?: string;
  contactPerson?: string;
  company?: string;
  companyName?: string;
  customerId?: string;
};

interface ProjectFormProps {
  form: ProjectFormValues;
  onChange: (form: ProjectFormValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  customers: CustomerOption[];
  loading: boolean;
  isEdit: boolean;
  /** When set, the Customer field renders as a read-only label instead of a
   * Select — used by the Customer Workspace's embedded Center Panel, where
   * the customer is already fixed by the workspace itself and re-selecting
   * it would be a duplicate selector for no reason. `form.customerId` must
   * already be set by the caller before mount; `customers` is unused in this
   * mode. Optional and backward-compatible — the standalone Projects page
   * (which doesn't pass this prop) is unaffected. */
  lockedCustomerLabel?: string;
}

const STATE_OPTIONS = [
  { label: 'Select State', value: '' },
  ...INDIAN_STATES.map((state) => ({ label: state, value: state })),
];

export function ProjectForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  customers,
  loading,
  isEdit,
  lockedCustomerLabel,
}: ProjectFormProps) {
  const setAddress = (key: keyof ProjectFormValues['siteAddress'], value: string) => {
    onChange({
      ...form,
      siteAddress: {
        ...form.siteAddress,
        [key]: value,
      },
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <FormSection title="Project Basics">
        <FormRow>
          {lockedCustomerLabel ? (
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wide">Customer</label>
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-3 py-2 text-sm text-[var(--color-text)]">
                {lockedCustomerLabel}
              </div>
            </div>
          ) : (
            <Select
              label="Customer"
              required
              value={form.customerId}
              onChange={(event) => onChange({ ...form, customerId: event.target.value })}
              options={[
                { label: 'Select customer', value: '' },
                ...customers.map((customer) => ({
                  label: projectCustomerLabel(customer),
                  value: customer.id,
                })),
              ]}
            />
          )}
          <Input
            label="Lead ID"
            value={form.leadId}
            onChange={(event) => onChange({ ...form, leadId: event.target.value })}
            placeholder="Optional lead reference"
          />
        </FormRow>
        <FormRow>
          <Input
            label="Capacity (kW)"
            required
            type="number"
            min="0"
            step="0.1"
            value={form.capacityKw}
            onChange={(event) => onChange({ ...form, capacityKw: event.target.value })}
          />
          <Select
            label="Project Type"
            required
            value={form.projectType}
            onChange={(event) => onChange({ ...form, projectType: event.target.value })}
            options={[{ label: 'Select Project Type', value: '' }, ...PROJECT_TYPES.map((t) => ({ label: t, value: t }))]}
          />
        </FormRow>
        <FormRow>
          <Input
            label="Sales Owner"
            value={form.salesOwner}
            onChange={(event) => onChange({ ...form, salesOwner: event.target.value })}
            placeholder="Optional user / owner reference"
          />
          <Input
            label="Assigned Surveyor"
            value={form.assignedSurveyor}
            onChange={(event) => onChange({ ...form, assignedSurveyor: event.target.value })}
            placeholder="Optional user / surveyor reference"
          />
        </FormRow>
        <FormRow>
          <Input
            label="Assigned Installer"
            value={form.assignedInstaller}
            onChange={(event) => onChange({ ...form, assignedInstaller: event.target.value })}
            placeholder="Optional user / installer reference"
          />
        </FormRow>
      </FormSection>

      <FormSection title="Site Address">
        <Input
          label="Address Line 1"
          value={form.siteAddress.line1 || ''}
          onChange={(event) => setAddress('line1', event.target.value)}
        />
        <Input
          label="Address Line 2"
          value={form.siteAddress.line2 || ''}
          onChange={(event) => setAddress('line2', event.target.value)}
        />
        <Input
          label="Landmark"
          value={form.siteAddress.landmark || ''}
          onChange={(event) => setAddress('landmark', event.target.value)}
        />
        <FormRow>
          <Input
            label="City"
            value={form.siteAddress.city || ''}
            onChange={(event) => setAddress('city', event.target.value)}
          />
          <Input
            label="District"
            value={form.siteAddress.district || ''}
            onChange={(event) => setAddress('district', event.target.value)}
          />
        </FormRow>
        <FormRow>
          <Select
            label="State"
            value={form.siteAddress.state || ''}
            onChange={(event) => setAddress('state', event.target.value)}
            options={STATE_OPTIONS}
          />
          <Input
            label="Pincode"
            value={form.siteAddress.pincode || ''}
            onChange={(event) => setAddress('pincode', event.target.value)}
          />
        </FormRow>
        <Input
          label="Country"
          value={form.siteAddress.country || 'India'}
          onChange={(event) => setAddress('country', event.target.value)}
        />
      </FormSection>

      <FormSection title="Notes">
        <Textarea
          label="Notes"
          value={form.notes}
          onChange={(event) => onChange({ ...form, notes: event.target.value })}
          rows={3}
        />
      </FormSection>

      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3 text-xs text-[var(--color-text-muted)]">
        {isEdit
          ? 'Project ID, stage history, and linked records remain unchanged when you save this form.'
          : 'A new project ID is generated automatically when you create the project.'}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button type="submit" loading={loading}>{isEdit ? 'Update Project' : 'Create Project'}</Button>
      </div>
    </form>
  );
}

