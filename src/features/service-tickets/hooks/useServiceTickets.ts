/**
 * useServiceTickets.ts — React Query hooks for Service Tickets
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import {
  createServiceTicket,
  transitionTicketStatus,
  type ServiceTicketCreateInput,
  type ServiceTicketRecord,
  type TicketStatus,
} from '../../../lib/serviceTicketWorkflow';

export function useServiceTickets() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({
    queryKey: keys.serviceTickets,
    queryFn: () => getAll<ServiceTicketRecord>(COLLECTIONS.SERVICE_TICKETS),
    staleTime: 30_000,
  });
}

export function useCreateServiceTicket() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (input: ServiceTicketCreateInput) => createServiceTicket(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.serviceTickets });
      toast.success('Service ticket created');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTransitionServiceTicket() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      ticketId,
      nextStatus,
      note,
    }: {
      ticketId: string;
      nextStatus: TicketStatus;
      note?: string;
    }) => transitionTicketStatus(ticketId, nextStatus, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.serviceTickets });
      toast.success('Service ticket status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
