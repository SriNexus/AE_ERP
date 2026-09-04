import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import {
  createTransfer, shipTransfer, receiveTransfer, cancelTransfer, listTransfers,
  type CreateTransferInput,
} from '../services/warehouseTransferWorkflow';
import type { StockTransferRecord } from '../types/stockTransfer';

function transferKey(companyId: string | undefined) {
  return [...queryKeys.forCompany(companyId ?? 'default').warehouses, 'stock-transfers'];
}

export function useStockTransfers() {
  const { activeCompanyId } = useAppStore();
  return useQuery<StockTransferRecord[]>({
    queryKey: transferKey(activeCompanyId),
    queryFn: () => listTransfers(),
    staleTime: 20_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  const { activeCompanyId } = useAppStore();
  return () => qc.invalidateQueries({ queryKey: transferKey(activeCompanyId) });
}

export function useCreateTransfer(onSuccess?: (t: StockTransferRecord) => void) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateTransferInput) => createTransfer(input),
    onSuccess: (t) => { invalidate(); toast.success('Transfer created'); onSuccess?.(t); },
    onError: (e: any) => toast.error(e?.message || 'Could not create the transfer'),
  });
}

export function useShipTransfer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (transferId: string) => shipTransfer(transferId),
    onSuccess: (r) => { invalidate(); toast.success(r.alreadyShipped ? 'Transfer already shipped' : 'Transfer shipped'); },
    onError: (e: any) => toast.error(e?.message || 'Could not ship the transfer'),
  });
}

export function useReceiveTransfer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (args: { transferId: string; receivedQuantities?: Record<string, number> }) =>
      receiveTransfer(args.transferId, args.receivedQuantities),
    onSuccess: (r) => {
      invalidate();
      toast.success(
        r.alreadyReceived ? 'Transfer already received'
          : (r.shortfallQty ?? 0) > 0 ? `Transfer received — ${r.shortfallQty} unit(s) short (reconcile the loss)`
          : 'Transfer received',
      );
    },
    onError: (e: any) => toast.error(e?.message || 'Could not receive the transfer'),
  });
}

export function useCancelTransfer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (args: { transferId: string; reason?: string }) => cancelTransfer(args.transferId, args.reason),
    onSuccess: (r) => { invalidate(); toast.success(r.alreadyCancelled ? 'Transfer already cancelled' : 'Transfer cancelled'); },
    onError: (e: any) => toast.error(e?.message || 'Could not cancel the transfer'),
  });
}
