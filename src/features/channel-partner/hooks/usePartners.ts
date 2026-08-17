/**
 * usePartners — React Query hooks for Channel Partner domain
 *
 * Follows the exact same patterns as:
 *   - src/features/leads/hooks/useLeads.ts
 *   - src/features/customers/hooks/useCustomers.ts
 *
 * Architecture:
 *   - usePaginatedCollection for list views
 *   - useMutation for create/update/delete
 *   - queryKeys.forCompany() for cache isolation
 *   - Centralized firestore.ts helpers for all data access
 *   - ChannelPartnerDomainService for domain logic
 *   - Auto-invalidation on mutations
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { usePaginatedCollection } from '../../../hooks/usePaginatedCollection';
import { ChannelPartnerDomainService } from '../../../services/ChannelPartnerDomainService';
import { assignPartnerManager, linkPartnerUser } from '../../../lib/channelPartnerWorkflow';
import toast from 'react-hot-toast';

export type PartnerFormValues = {
  firmName: string;
  contactPerson: string;
  email: string;
  phone: string;
  alternatePhone?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  gstNumber?: string;
  panNumber?: string;
  notes?: string;
  tags?: string[];
  /** Phase 1 identity: the authenticated users doc id this partner is linked to. */
  userId?: string;
  /** Phase 1 identity: the TL/Manager users doc id supervising this partner. */
  managerId?: string;
};

export const PARTNER_FORM_DEFAULT: PartnerFormValues = {
  firmName: '',
  contactPerson: '',
  email: '',
  phone: '',
  alternatePhone: '',
  address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
  gstNumber: '',
  panNumber: '',
  notes: '',
  tags: [],
};

/**
 * Paginated list of channel partners.
 * Uses existing usePaginatedCollection pattern.
 */
export function usePartners() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return usePaginatedCollection(keys.partnersPaged, COLLECTIONS.CHANNEL_PARTNERS, 30_000);
}

/**
 * Create or update a channel partner.
 * Follows the exact same pattern as useSaveLead in useLeads.ts.
 */
export function useSavePartner(editId: string | null, onSuccess: () => void) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (data: PartnerFormValues) => {
      // Phase 1 identity: `userId`/`managerId` NEVER flow through the raw
      // update payload — they are canonical identity fields managed ONLY by
      // the workflow services (linkPartnerUser / assignPartnerManager), which
      // validate tenant boundaries and reject conflicts. Writing them via the
      // generic update would allow a half-clear (e.g. blanking the partner's
      // userId while the user-side channelPartnerId stays immutable).
      const { userId: linkedUser, managerId: manager, ...rest } = data;
      let savedId = editId;
      if (editId) {
        await ChannelPartnerDomainService.update(editId, {
          ...rest,
          updatedBy: user.id,
        });
      } else {
        savedId = await ChannelPartnerDomainService.create({
          ...rest,
          contactPerson: rest.contactPerson || rest.firmName,
          companyId: activeCompanyId,
          createdBy: user.id,
          status: 'pending_approval',
          kycStatus: 'not_started',
          walletBalance: 0,
          pendingBalance: 0,
          totalCommissionEarned: 0,
          totalCommissionPaid: 0,
          totalLeadsCreated: 0,
          totalLeadsConverted: 0,
          conversionRate: 0,
          averageCommissionPerLead: 0,
          kycDocuments: [],
          statusHistory: [{
            status: 'pending_approval',
            changedBy: user.id,
            changedAt: new Date().toISOString(),
          }],
        });
      }

      // Phase 1 identity: after the partner record is saved, establish the
      // canonical user link and manager assignment through the workflow
      // services (they validate tenant + conflicts atomically). The form only
      // SETS a link/manager — unlink is a controlled action for a later phase
      // (users.channelPartnerId is immutable once established).
      if (savedId) {
        if (linkedUser) {
          await linkPartnerUser(savedId, linkedUser);
        }
        if (manager) {
          await assignPartnerManager(savedId, manager);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success(editId ? 'Partner updated' : 'Partner created');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Link a channel partner to an authenticated user (Phase 1 identity).
 * Uses the canonical linkPartnerUser workflow service (tenant-safe,
 * conflict-rejecting, idempotent).
 */
export function useLinkPartnerUser() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({ partnerId, userId }: { partnerId: string; userId: string }) =>
      linkPartnerUser(partnerId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.partnersRoot });
      qc.invalidateQueries({ queryKey: keys.partnerSelf });
      toast.success('Partner linked to user');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Assign a TL/Manager to a channel partner (Phase 1 identity).
 * Uses the canonical assignPartnerManager workflow service (orgHierarchy-validated).
 */
export function useAssignPartnerManager() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({ partnerId, managerId }: { partnerId: string; managerId: string }) =>
      assignPartnerManager(partnerId, managerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success('Manager assigned');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Soft-delete a channel partner.
 */
export function useDeletePartner() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (id: string) => ChannelPartnerDomainService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success('Partner deleted');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Approve a partner (transition from pending_approval to active).
 */
export function useApprovePartner() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (partnerId: string) => {
      await ChannelPartnerDomainService.transitionStatus(partnerId, 'active', user.id);
      await ChannelPartnerDomainService.update(partnerId, {
        approvedBy: user.id,
        approvedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success('Partner approved');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Suspend a partner.
 */
export function useSuspendPartner() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({ partnerId, reason }: { partnerId: string; reason?: string }) =>
      ChannelPartnerDomainService.transitionStatus(partnerId, 'suspended', user.id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success('Partner suspended');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/**
 * Reactivate a suspended partner.
 */
export function useReactivatePartner() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (partnerId: string) =>
      ChannelPartnerDomainService.transitionStatus(partnerId, 'active', user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.partnersRoot });
      toast.success('Partner reactivated');
    },
    onError: (e: any) => toast.error(e.message),
  });
}
