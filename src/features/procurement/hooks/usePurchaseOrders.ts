import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { createPurchaseOrder, transitionPurchaseOrder, updatePurchaseOrder } from '../services/purchaseOrderWorkflow';
import type { PurchaseOrderFormValues, PurchaseOrderRecord, PurchaseOrderStatus } from '../types';

export function usePurchaseOrders() { const companyId = useAppStore((state) => state.activeCompanyId); return useQuery({ queryKey: queryKeys.forCompany(companyId).purchaseOrders, queryFn: () => getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS), staleTime: 30_000 }); }
export function usePurchaseOrderActions() {
  const companyId = useAppStore((state) => state.activeCompanyId); const client = useQueryClient(); const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).purchaseOrders }); const error = (cause: Error) => toast.error(cause.message);
  return {
    create: useMutation({ mutationFn: (input: PurchaseOrderFormValues) => createPurchaseOrder(input), onSuccess: () => { void invalidate(); toast.success('Purchase order created'); }, onError: error }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: PurchaseOrderFormValues }) => updatePurchaseOrder(id, input), onSuccess: () => { void invalidate(); toast.success('Purchase order updated'); }, onError: error }),
    transition: useMutation({ mutationFn: ({ id, status }: { id: string; status: PurchaseOrderStatus }) => transitionPurchaseOrder(id, status), onSuccess: (_, input) => { void invalidate(); toast.success(`Purchase order marked ${input.status}`); }, onError: error }),
  };
}
