/**
 * PartnerCreateCustomerModal — Create Customer modal for Partner Portal
 *
 * Reuses the canonical useSaveCustomer → createCustomerProjection path. The
 * partnerId is NOT collected in the form: createCustomerProjection derives it
 * from the authenticated user's canonical link (users.channelPartnerId), so
 * the UI can never supply another partner's id (Phase 3 §9.3).
 */

import { useState } from 'react';
import { Users, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, FormSection, FormRow } from '../../components/ui/Input';
import { useSaveCustomer, CUSTOMER_FORM_DEFAULT } from '../../features/customers/hooks/useCustomers';
import type { ChannelPartner } from '../../features/channel-partner/types';

interface PartnerCreateCustomerModalProps {
  open: boolean;
  onClose: () => void;
  partner: ChannelPartner | undefined;
}

// Base the form on the canonical customer form so the save path receives the
// full CustomerForm contract; partners only edit the fields shown here.
const FORM_DEFAULT = {
  ...CUSTOMER_FORM_DEFAULT,
  type: 'B2C',
};

type FormData = typeof FORM_DEFAULT;

export function PartnerCreateCustomerModal({ open, onClose, partner }: PartnerCreateCustomerModalProps) {
  const [form, setForm] = useState<FormData>({ ...FORM_DEFAULT });

  const saveCustomer = useSaveCustomer(null, () => {
    toast.success('Customer created successfully!');
    handleClose();
  });

  function handleClose() {
    setForm({ ...FORM_DEFAULT });
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveCustomer.isPending) return;
    if (!form.name.trim() && !form.phone.trim()) {
      toast.error('Customer name or phone is required');
      return;
    }
    // createCustomerProjection hard-requires a 10-digit phone on both the
    // demo and Firestore paths — surface it here instead of a post-submit
    // service error.
    const phoneDigits = form.phone.replace(/\D/g, '');
    if (!form.phone.trim() || phoneDigits.length !== 10) {
      toast.error('A valid 10-digit mobile number is required');
      return;
    }
    saveCustomer.mutate({
      ...form,
      // createCustomerProjection requires a 10-digit phone in the Firestore
      // path; demo/local path tolerates a missing one but validation is
      // surfaced by the service either way.
      type: (form.type === 'B2B' ? 'B2B' : 'B2C'),
    });
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Customer" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Partner attribution notice */}
        <div className="flex items-center gap-3 rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-3 text-sm">
          <Users className="h-5 w-5 text-[var(--color-primary-text)] shrink-0" />
          <div>
            <p className="font-semibold text-[var(--color-primary-text)]">
              This customer will be attributed to {partner?.firmName || 'your firm'}
            </p>
            <p className="text-xs text-[var(--color-primary-text)] opacity-80">
              Ownership is assigned automatically from your partner account.
            </p>
          </div>
        </div>

        <FormSection title="Customer Information">
          <FormRow>
            <Input
              label="Customer Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Customer name"
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="10-digit mobile"
              required
            />
          </FormRow>
          <FormRow>
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="email@example.com"
            />
            <Input
              label="Company"
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              placeholder="Company / business name"
            />
          </FormRow>
          <FormRow>
            <Input
              label="City"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="City"
            />
            <Input
              label="State"
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              placeholder="State"
            />
          </FormRow>
          <FormRow>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Type</p>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors"
              >
                <option value="B2C">B2C — Direct Installation Customer</option>
                <option value="B2B">B2B — Material/Distribution Buyer</option>
              </select>
            </div>
          </FormRow>
        </FormSection>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
          <Button variant="outline" type="button" onClick={handleClose} disabled={saveCustomer.isPending}>
            Cancel
          </Button>
          <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={saveCustomer.isPending}>
            Add Customer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default PartnerCreateCustomerModal;
