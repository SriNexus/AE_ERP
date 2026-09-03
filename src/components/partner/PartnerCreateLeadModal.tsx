/**
 * PartnerCreateLeadModal — Create Lead modal for Partner Portal
 *
 * Reuses partnerCreateLead() from partnerLeadIntegration.ts.
 * Automatically stamps: partnerId, partnerName, source='Channel Partner', userId.
 * The partner fills in: name, phone, email, city, state, notes, AND explicitly
 * picks the Sales Person the lead is assigned to (no implicit / round-robin
 * company-side assignment for the Channel Partner flow).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target, Plus, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea, FormSection, FormRow } from '../../components/ui/Input';
import { partnerCreateLead } from '../../lib/partnerLeadIntegration';
import { partnerDisplayName } from '../../lib/partnerOwnership';
import { fetchAssignableSalesUsers } from '../../lib/salesTeam';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';
import type { ChannelPartner } from '../../features/channel-partner/types';

interface PartnerCreateLeadModalProps {
  open: boolean;
  onClose: () => void;
  partner: ChannelPartner | undefined;
}

const FORM_DEFAULT = {
  name: '',
  phone: '',
  email: '',
  city: '',
  state: '',
  notes: '',
  assignedToId: '',
};

type FormData = typeof FORM_DEFAULT;

export function PartnerCreateLeadModal({ open, onClose, partner }: PartnerCreateLeadModalProps) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const [form, setForm] = useState<FormData>({ ...FORM_DEFAULT });
  const [triedSubmit, setTriedSubmit] = useState(false);

  // Sales Persons this partner may assign a lead to — the partner's OWN
  // company only (fetchAssignableSalesUsers scopes the read with an explicit
  // where('companyId','==',...) equality, the same shape the internal
  // round-robin uses, and firestore.rules' `users` list rule only proves a
  // same-company query). Uses the canonical raw company-scoped read rather
  // than getAll(COLLECTIONS.USERS): the latter's applyAccessFilters() applies
  // record-level `self` visibility for the Partner role and would strip every
  // Sales-rep record out of the list before it reaches the dropdown.
  const companyId = String(activeCompanyId || '');
  const { data: salesUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['partner-assignable-sales-users', companyId],
    queryFn: () => fetchAssignableSalesUsers(companyId),
    staleTime: 60_000,
    enabled: open && Boolean(companyId) && companyId !== 'all' && companyId !== 'group',
  });

  const hasSalesUsers = salesUsers.length > 0;
  const assignmentMissing = hasSalesUsers && !form.assignedToId;
  const selectedSalesPerson = salesUsers.find((u: any) => u.id === form.assignedToId);

  const createLead = useMutation({
    mutationFn: async (data: FormData) => {
      // A Channel Partner is a HUMAN/AGENT — `firmName` is optional business
      // metadata and must NEVER gate lead creation (that was the "Partner
      // profile not found" root cause for firm-less agents). The only real
      // precondition is a resolved partner profile; `partnerCreateLead`
      // additionally re-validates the id against the authenticated link
      // server-side.
      if (!partner?.id) {
        throw new Error('Your account is not linked to a partner profile yet. Contact your administrator.');
      }
      const chosen = data.assignedToId ? salesUsers.find((u: any) => u.id === data.assignedToId) : undefined;
      return partnerCreateLead({
        name: data.name,
        phone: data.phone,
        email: data.email,
        city: data.city,
        state: data.state,
        notes: data.notes,
        partnerId: partner.id,
        partnerName: partnerDisplayName(partner),
        assignedToId: data.assignedToId || undefined,
        assignedToName: chosen ? String(chosen.name || '') : undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.leadsRoot });
      qc.invalidateQueries({ queryKey: keys.leadsAll });
      toast.success('Lead created successfully!');
      handleClose();
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create lead'),
  });

  function handleClose() {
    setForm({ ...FORM_DEFAULT });
    setTriedSubmit(false);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createLead.isPending) return;
    setTriedSubmit(true);
    if (!form.name && !form.phone) {
      toast.error('Lead name or phone is required');
      return;
    }
    // Business rule: when the company has assignable Sales Persons, the partner
    // must pick one explicitly — the lead is never left for implicit
    // company-side assignment.
    if (hasSalesUsers && !form.assignedToId) {
      toast.error('Select the Sales Person this lead should be assigned to');
      return;
    }
    createLead.mutate(form);
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create Lead" size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Partner attribution notice */}
        <div className="flex items-center gap-3 rounded-xl border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)] px-4 py-3 text-sm">
          <Target className="h-5 w-5 text-[var(--color-primary-text)] shrink-0" />
          <div>
            <p className="font-semibold text-[var(--color-primary-text)]">
              This lead will be attributed to {partnerDisplayName(partner, 'your account')}
            </p>
            <p className="text-xs text-[var(--color-primary-text)] opacity-80">
              Source will be set to "Channel Partner".
            </p>
          </div>
        </div>

        <FormSection title="Contact Information">
          <FormRow>
            <Input
              label="Lead Name"
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
              label="City"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="City"
            />
          </FormRow>
          <FormRow>
            <Input
              label="State"
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              placeholder="State"
            />
          </FormRow>
        </FormSection>

        <FormSection title="Sales Person Assignment">
          {usersLoading ? (
            <p className="text-xs text-[var(--color-text-muted)]">Loading Sales Persons…</p>
          ) : hasSalesUsers ? (
            <>
              <Select
                label="Assigned Sales Person"
                required
                value={form.assignedToId}
                onChange={(e) => setForm((f) => ({ ...f, assignedToId: e.target.value }))}
                error={triedSubmit && assignmentMissing ? 'Select a Sales Person to assign this lead to.' : undefined}
                options={[
                  { label: 'Select a Sales Person…', value: '' },
                  ...salesUsers.map((u: any) => ({ label: String(u.name || u.id), value: u.id })),
                ]}
              />
              {selectedSalesPerson ? (
                <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                  <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                  This lead will be assigned to <span className="font-semibold text-[var(--color-text)]">{String(selectedSalesPerson.name || selectedSalesPerson.id)}</span>.
                </p>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Pick the Sales Person who should own and follow up on this lead.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              No Sales Persons are currently available for assignment in your company. Please contact your Company Admin. Your lead will still be created and routed to your Company for follow-up.
            </p>
          )}
        </FormSection>

        <FormSection title="Notes">
          <Textarea
            label="Initial Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Any additional information about this lead..."
            rows={3}
          />
        </FormSection>

        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
          <Button variant="outline" type="button" onClick={handleClose} disabled={createLead.isPending}>
            Cancel
          </Button>
          <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={createLead.isPending}>
            Create Lead
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default PartnerCreateLeadModal;
