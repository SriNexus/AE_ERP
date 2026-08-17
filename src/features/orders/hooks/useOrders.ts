import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { generatePIsFromOrder, markPIAsPaid } from '../../../lib/invoiceWorkflow';
import { cancelOrder } from '../../../lib/stockWorkflow';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import type { Order } from '../../../types';

export function useGeneratePIFromOrder() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (order: Order) => generatePIsFromOrder(order),
    onSuccess: (piIds) => {
      qc.invalidateQueries({ queryKey: keys.ordersRoot });
      qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success(`Generated PI${piIds.length === 1 ? '' : 's'}: ${piIds.join(', ')}`);
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'PI generation failed'),
  });
}

export function useMarkPIAsPaid() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (piId: string) => markPIAsPaid(piId),
    onSuccess: ({ piId }) => {
      qc.invalidateQueries({ queryKey: keys.ordersRoot });
      qc.invalidateQueries({ queryKey: keys.invoices });
      toast.success(`Payment confirmed for ${piId}`);
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Payment update failed'),
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason?: string }) => cancelOrder(orderId, reason),
    onSuccess: ({ orderId }) => {
      qc.invalidateQueries({ queryKey: keys.ordersRoot });
      qc.invalidateQueries({ queryKey: keys.dispatchRoot });
      qc.invalidateQueries({ queryKey: keys.stock });
      qc.invalidateQueries({ queryKey: keys.stockLedger });
      toast.success(`Order ${orderId} cancelled`);
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Order cancellation failed'),
  });
}
