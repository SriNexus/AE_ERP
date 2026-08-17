// features/leads/hooks/useLeads.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAll, genId,
} from '../../../lib/firestore';
import {
  batchCreateProjectionsWithUserId,
  createProjectionWithUserId,
  deleteProjectionWithEntity,
} from '../../../lib/entityProjection';
import { COLLECTIONS } from '../../../lib/firebase';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { LEAD_SOURCES, LEAD_STATUSES } from '../../../config/company';
import { logActivity } from '../../../lib/workflow';
import { getNextAssignee } from '../../../lib/roundRobin';
import { queryKeys } from '../../../lib/queryKeys';
import { resolveOrCreateMasterUser } from '../../../lib/userIdentity';
import { LeadDomainService } from '../../../services/LeadDomainService';
import { usePaginatedCollection } from '../../../hooks/usePaginatedCollection';
import { createCaseForLead } from '../../../lib/casePropagation';
import { notifyRoleUsers, resolveNotificationCompanyId, sendNotification } from '../../../lib/notifications';
import { NotificationType } from '../../../types';
import toast from 'react-hot-toast';

export const LEAD_FORM_DEFAULT = {
  name: '', phone: '', email: '', city: '', state: '',
  source: 'Website', status: 'New',
  assignedToId: '', assignedToName: '',
  notes: '', next_date: '',
};
export type LeadForm = typeof LEAD_FORM_DEFAULT;

export const SOURCE_OPTIONS = LEAD_SOURCES.map(s => ({ label: s, value: s }));
export const STATUS_OPTIONS  = LEAD_STATUSES.map(s => ({ label: s, value: s }));

export function createLeadProjection(id: string, payload: Record<string, unknown>) {
  return createProjectionWithUserId(COLLECTIONS.LEADS, id, payload);
}

export function batchCreateLeadProjections(items: Record<string, unknown>[]) {
  return batchCreateProjectionsWithUserId(COLLECTIONS.LEADS, items);
}

export function useLeads() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return usePaginatedCollection(keys.leadsPaged, COLLECTIONS.LEADS, 30_000);
}

export function useLeadsUsers() {
  return useQuery({
    queryKey: queryKeys.global.users,
    queryFn:  () => getAll(COLLECTIONS.USERS),
    staleTime: 60_000,
  });
}

export function useSaveLead(editId: string | null, onSuccess: (id: string) => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (data: LeadForm): Promise<string> => {
      if (editId) {
        await LeadDomainService.update(editId, { ...data, updatedBy: user.id });
        await logActivity('Leads', 'Lead Updated', editId, {
          entityName: data.name || data.phone || editId,
          actionLabel: `Lead updated by ${user.name}`,
        });
        return editId;
      } else {
        const id = genId.lead();
        // getNextAssignee() returns {userId,name} (the Assignee shape), not
        // {assignedToId,assignedToName} — normalize both branches to the
        // Lead document's real field names before spreading. Spreading the
        // raw Assignee shape here previously overwrote the lead's own
        // `name` (customer name) with the auto-assigned salesperson's name,
        // since `...assignment` was applied after `...data`.
        const assignment = data.assignedToId
          ? { assignedToId: data.assignedToId, assignedToName: data.assignedToName }
          : await getNextAssignee(activeCompanyId).then(a => ({ assignedToId: a.userId, assignedToName: a.name }));
        const masterUser = data.phone
          ? await resolveOrCreateMasterUser(data.phone, activeCompanyId, {
            name: data.name,
            email: data.email,
            role: 'Lead',
            linkedModules: ['leads'],
            createdBy: user.id,
          })
          : null;
        await createLeadProjection(id, {
          ...data, ...assignment, id, createdBy: user.id,
          companyId: activeCompanyId,
          ...(masterUser ? { userId: masterUser.id, masterUserId: masterUser.id } : {}),
        });
        // Phase 3B: Auto-create Case for new Lead
        void createCaseForLead(id, activeCompanyId);
        await logActivity('Leads', 'Lead Created', id, {
          entityName: data.name || data.phone || id,
          actionLabel: `Lead created by ${user.name}`,
        });
        const notificationCompanyId = resolveNotificationCompanyId(activeCompanyId);
        if (assignment.assignedToId) {
          await sendNotification(
            assignment.assignedToId,
            NotificationType.LEAD_ASSIGNED,
            'Lead assigned',
            `Lead ${data.name || id} was assigned to you.`,
            'lead',
            id,
            notificationCompanyId,
          );
        }
        await notifyRoleUsers(['Admin', 'Director'], NotificationType.LEAD_CREATED, 'Lead created', `Lead ${data.name || id} was created.`, 'lead', id, notificationCompanyId);
        return id;
      }
    },
    onSuccess: (id: string) => {
      qc.invalidateQueries({ queryKey: keys.leadsRoot });
      toast.success(editId ? 'Lead updated' : 'Lead created');
      onSuccess(id);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteLead() {
  const qc              = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: (id: string) => deleteProjectionWithEntity(COLLECTIONS.LEADS, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.leadsRoot }); toast.success('Lead deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}

export function useBulkImportLeads() {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: async (leads: LeadForm[]) => {
      const payload = leads.map(l => ({
        ...l, id: genId.lead(), createdBy: user.id,
        companyId: activeCompanyId,
      }));
      await batchCreateLeadProjections(payload);
      // Phase 3B: Auto-create Cases for imported Leads
      payload.forEach((lead) => void createCaseForLead(lead.id, activeCompanyId));
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: keys.leadsRoot });
      toast.success(`${vars.length} leads imported`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}
