/**
 * usePayment.ts — React Query hooks for Payment Collection
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import {
  createPayment,
  transitionPaymentStatus,
  type PaymentCreateInput,
  type PaymentRecord,
  type PaymentStatus,
} from '../../../lib/paymentWorkflow';

export function usePayments() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return useQuery({
    queryKey: keys.payments,
    queryFn: () => getAll<PaymentRecord>(COLLECTIONS.PAYMENTS),
    staleTime: 30_000,
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (input: PaymentCreateInput) => createPayment(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.payments });
      toast.success('Payment recorded');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useTransitionPayment() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      paymentId,
      nextStatus,
      note,
    }: {
      paymentId: string;
      nextStatus: PaymentStatus;
      note?: string;
    }) => transitionPaymentStatus(paymentId, nextStatus, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.payments });
      toast.success('Payment status updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
