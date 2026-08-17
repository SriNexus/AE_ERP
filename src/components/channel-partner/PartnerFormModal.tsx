/**
 * PartnerFormModal — Create/Edit Channel Partner form
 *
 * Follows the same pattern as the Lead/Customer form modals.
 * Uses Modal + FormSection + FormRow + Input/Select/Textarea components.
 * Business logic stays in hooks — this is pure presentation.
 */

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../ui/Input';
import { INDIAN_STATES } from '../../config/company';
import { COMMISSION_RULE_TYPE_OPTIONS } from '../../features/channel-partner/constants';
import type { ChannelPartner } from '../../features/channel-partner/types';
import toast from 'react-hot-toast';

const STATE_OPTIONS = [
  { label: 'Select State', value: '' },
  ...(INDIAN_STATES || []).map((s: string) => ({ label: s, value: s })),
];

export const PARTNER_FORM_DEFAULTS = {
  firmName: '',
  contactPerson: '',
  email: '',
  phone: '',
  alternatePhone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India',
  gstNumber: '',
  panNumber: '',
  bankAccountNumber: '',
  bankIfscCode: '',
  bankName: '',
  bankBranch: '',
  bankAccountHolderName: '',
  bankAccountType: 'savings',
  defaultCommissionType: '',
  defaultCommissionValue: 0,
  assignedSalesPerson: '',
  /** Phase 1 identity: linked ERP user (users/{userId}) — set via select. */
  userId: '',
  /** Phase 1 identity: supervising TL/Manager (users/{managerId}) — set via select. */
  managerId: '',
  notes: '',
  tags: '',
};

export type PartnerFormValues = typeof PARTNER_FORM_DEFAULTS;

interface PartnerFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: PartnerFormValues) => void;
  editPartner?: ChannelPartner | null;
  loading?: boolean;
  salesUsers?: { id: string; name: string }[];
  /** Phase 1 identity: candidate ERP users for linking (users/{userId}). */
  linkUserOptions?: { id: string; name: string }[];
  /** Phase 1 identity: candidate TL/Manager users for manager assignment. */
  managerOptions?: { id: string; name: string }[];
}

export function PartnerFormModal({
  open, onClose, onSubmit, editPartner, loading = false, salesUsers = [],
  linkUserOptions = [], managerOptions = [],
}: PartnerFormModalProps) {
  const [form, setForm] = useState<PartnerFormValues>({ ...PARTNER_FORM_DEFAULTS });

  useEffect(() => {
    if (editPartner) {
      setForm({
        firmName: editPartner.firmName || '',
        contactPerson: editPartner.contactPerson || '',
        email: editPartner.email || '',
        phone: editPartner.phone || '',
        alternatePhone: editPartner.alternatePhone || '',
        addressLine1: editPartner.address?.line1 || '',
        addressLine2: editPartner.address?.line2 || '',
        city: editPartner.address?.city || '',
        state: editPartner.address?.state || '',
        pincode: editPartner.address?.pincode || '',
        country: editPartner.address?.country || 'India',
        gstNumber: editPartner.gstNumber || '',
        panNumber: editPartner.panNumber || '',
        bankAccountNumber: editPartner.bankDetails?.accountNumber || '',
        bankIfscCode: editPartner.bankDetails?.ifscCode || '',
        bankName: editPartner.bankDetails?.bankName || '',
        bankBranch: editPartner.bankDetails?.branchName || '',
        bankAccountHolderName: editPartner.bankDetails?.accountHolderName || '',
        bankAccountType: editPartner.bankDetails?.accountType || 'savings',
        defaultCommissionType: editPartner.defaultCommissionType || '',
        defaultCommissionValue: editPartner.defaultCommissionValue || 0,
        assignedSalesPerson: editPartner.assignedSalesPerson || '',
        userId: editPartner.userId || '',
        managerId: editPartner.managerId || '',
        notes: editPartner.notes || '',
        tags: (editPartner.tags || []).join(', '),
      });
    } else {
      setForm({ ...PARTNER_FORM_DEFAULTS });
    }
  }, [editPartner, open]);

  function handleChange(key: keyof PartnerFormValues, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    // Validation
    if (!form.firmName.trim() && !form.contactPerson.trim()) {
      return toast.error('Firm name or contact person is required');
    }
    if (!form.phone.trim()) {
      return toast.error('Phone number is required');
    }

    onSubmit(form);
  }

  const isEdit = !!editPartner;
  const assignOptions = [
    { label: 'Unassigned', value: '' },
    ...salesUsers.map((u) => ({ label: u.name, value: u.id })),
  ];

  const linkedUserOptions = [
    { label: 'Not linked', value: '' },
    ...linkUserOptions.map((u) => ({ label: u.name, value: u.id })),
  ];
  const managerAssignOptions = [
    { label: 'No manager', value: '' },
    ...managerOptions.map((u) => ({ label: u.name, value: u.id })),
  ];

  const commissionTypeOptions = useMemo(() => [
    { label: 'Not Set', value: '' },
    ...COMMISSION_RULE_TYPE_OPTIONS,
  ], []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Partner' : 'Add Partner'}
      size="xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form="partner-form" loading={loading}>
            {isEdit ? 'Update Partner' : 'Create Partner'}
          </Button>
        </div>
      }
    >
      <form id="partner-form" onSubmit={handleSubmit} className="space-y-5">
        <FormSection title="Basic Information">
          <FormRow>
            <Input
              label="Firm Name"
              value={form.firmName}
              onChange={(e) => handleChange('firmName', e.target.value)}
              placeholder="e.g. Green Energy Solutions"
            />
            <Input
              label="Contact Person *"
              required
              value={form.contactPerson}
              onChange={(e) => handleChange('contactPerson', e.target.value)}
              placeholder="Full name of primary contact"
            />
          </FormRow>
          <FormRow>
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
              placeholder="partner@company.com"
            />
            <Input
              label="Phone *"
              required
              value={form.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              placeholder="10-digit mobile number"
            />
          </FormRow>
          <FormRow>
            <Input
              label="Alternate Phone"
              value={form.alternatePhone}
              onChange={(e) => handleChange('alternatePhone', e.target.value)}
              placeholder="Optional alternate number"
            />
            <Input
              label="GST Number"
              value={form.gstNumber}
              onChange={(e) => handleChange('gstNumber', e.target.value.toUpperCase())}
              placeholder="15-character GST"
            />
          </FormRow>
          <FormRow>
            <Input
              label="PAN Number"
              value={form.panNumber}
              onChange={(e) => handleChange('panNumber', e.target.value.toUpperCase())}
              placeholder="10-character PAN"
            />              <Select
                label="Default Commission Type"
                value={form.defaultCommissionType}
                onChange={(e) => handleChange('defaultCommissionType', e.target.value)}
                options={commissionTypeOptions}
              />
          </FormRow>
        </FormSection>

        <FormSection title="Address">
          <Input
            label="Address Line 1"
            value={form.addressLine1}
            onChange={(e) => handleChange('addressLine1', e.target.value)}
            placeholder="Street address"
          />
          <FormRow>
            <Input
              label="Address Line 2"
              value={form.addressLine2}
              onChange={(e) => handleChange('addressLine2', e.target.value)}
              placeholder="Landmark / Locality"
            />
            <Input
              label="Pincode"
              value={form.pincode}
              onChange={(e) => handleChange('pincode', e.target.value)}
              placeholder="6-digit pincode"
            />
          </FormRow>
          <FormRow>
            <Input
              label="City"
              value={form.city}
              onChange={(e) => handleChange('city', e.target.value)}
              placeholder="City"
            />
            <Select
              label="State"
              value={form.state}
              onChange={(e) => handleChange('state', e.target.value)}
              options={STATE_OPTIONS}
            />
          </FormRow>
        </FormSection>

        <FormSection title="Bank Details">
          <FormRow>
            <Input
              label="Account Holder Name"
              value={form.bankAccountHolderName}
              onChange={(e) => handleChange('bankAccountHolderName', e.target.value)}
              placeholder="Name as on bank account"
            />
            <Input
              label="Account Number"
              value={form.bankAccountNumber}
              onChange={(e) => handleChange('bankAccountNumber', e.target.value)}
              placeholder="Bank account number"
            />
          </FormRow>
          <FormRow>
            <Input
              label="IFSC Code"
              value={form.bankIfscCode}
              onChange={(e) => handleChange('bankIfscCode', e.target.value.toUpperCase())}
              placeholder="e.g. HDFC0001234"
            />
            <Input
              label="Bank Name"
              value={form.bankName}
              onChange={(e) => handleChange('bankName', e.target.value)}
              placeholder="e.g. HDFC Bank"
            />
          </FormRow>
          <FormRow>
            <Input
              label="Branch"
              value={form.bankBranch}
              onChange={(e) => handleChange('bankBranch', e.target.value)}
              placeholder="Branch name"
            />
            <Select
              label="Account Type"
              value={form.bankAccountType}
              onChange={(e) => handleChange('bankAccountType', e.target.value)}
              options={[
                { label: 'Savings', value: 'savings' },
                { label: 'Current', value: 'current' },
              ]}
            />
          </FormRow>
        </FormSection>

        <FormSection title="Assignment & Notes">
          <FormRow>
            <Select
              label="Linked User"
              value={form.userId}
              onChange={(e) => handleChange('userId', e.target.value)}
              options={linkedUserOptions}
            />
            <Select
              label="Manager"
              value={form.managerId}
              onChange={(e) => handleChange('managerId', e.target.value)}
              options={managerAssignOptions}
            />
          </FormRow>
          <FormRow>
            <Select
              label="Assigned Sales Person"
              value={form.assignedSalesPerson}
              onChange={(e) => handleChange('assignedSalesPerson', e.target.value)}
              options={assignOptions}
            />
            <Input
              label="Default Commission Value (₹)"
              type="number"
              min={0}
              value={form.defaultCommissionValue}
              onChange={(e) => handleChange('defaultCommissionValue', Number(e.target.value))}
              placeholder="Amount"
            />
          </FormRow>
          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            placeholder="Additional notes about this partner..."
          />
          <Input
            label="Tags (comma-separated)"
            value={form.tags}
            onChange={(e) => handleChange('tags', e.target.value)}
            placeholder="e.g. solar, residential, maharashtra"
          />
        </FormSection>
      </form>
    </Modal>
  );
}

export default PartnerFormModal;
