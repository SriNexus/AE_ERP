/**
 * PartnerCreateLeadModal — Create Lead modal for Partner Portal
 *
 * Reuses partnerCreateLead() from partnerLeadIntegration.ts.
 * Automatically assigns: partnerId, partnerName, source='Channel Partner', userId.
 * Partners can set: name, phone, email, city, state, notes.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea, FormSection, FormRow } from '../../components/ui/Input';
import { partnerCreateLead } from '../../lib/partnerLeadIntegration';
import { getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { filterEligibleSalesUsers } from '../../lib/salesTeam';
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

  // Eligible Sales Persons for this partner's own company — same
  // company-scoped users read (via activeCompanyId) already used by
  // PartnerLeads.tsx for the leads list itself, filtered with the shared
  // isSalesEligibleRole() predicate (lib/salesTeam.ts) so a company whose
  // Sales role isn't literally named "Sales" (e.g. "Sales Executive") still
  // shows real results here — the same fix applied to the internal
  // round-robin auto-assignment (lib/roundRobin.ts). Never queries across
  // companies/partners: getAll() is scoped to the partner's own
  // activeCompanyId, identical to every other query in this file.
  const { data: companyUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 60_000,
    enabled: open && Boolean(activeCompanyId),
  });
  const salesUsers = useMemo(() => filterEligibleSalesUsers(companyUsers as any[]), [companyUsers]);

  const createLead = useMutation({
    mutationFn: async (data: FormData) => {
      if (!partner?.id || !partner?.firmName) {
        throw new Error('Partner profile not found. Cannot create lead.');
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
        partnerName: partner.firmName,
        assignedToId: data.assignedToId || undefined,
        assignedToName: chosen ? String(chosen.name || '') : undefined,
      });
    },
    onSuccess: (leadId) => {
      qc.invalidateQueries({ queryKey: keys.leadsRoot });
      qc.invalidateQueries({ queryKey: keys.leadsAll });
      toast.success('Lead created successfully!');
      handleClose();
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create lead'),
  });

  function handleClose() {
    setForm({ ...FORM_DEFAULT });
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createLead.isPending) return;
    if (!form.name && !form.phone) {
      toast.error('Lead name or phone is required');
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
              This lead will be attributed to {partner?.firmName || 'your firm'}
            </p>
            <p className="text-xs text-[var(--color-primary-text)] opacity-80">
              Source will be set to "Channel Partner". Our team will follow up.
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

        <FormSection title="Assignment (Optional)">
          {usersLoading ? (
            <p className="text-xs text-[var(--color-text-muted)]">Loading Sales Persons…</p>
          ) : salesUsers.length > 0 ? (
            <>
              <Select
                label="Sales Person"
                value={form.assignedToId}
                onChange={(e) => setForm((f) => ({ ...f, assignedToId: e.target.value }))}
                options={[{ label: 'Unassigned — company will assign', value: '' }, ...salesUsers.map((u: any) => ({ label: String(u.name || u.id), value: u.id }))]}
              />
              <p className="text-xs text-[var(--color-text-muted)]">
                Optional — pick a Sales Person if you already know who should own this lead. Leave unassigned and the company will assign it.
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              No Sales Persons are available for assignment. Please contact your Company Admin. Your lead will still be created and routed to your Company for follow-up.
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
