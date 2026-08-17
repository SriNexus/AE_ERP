import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { createGoodsReceipt } from '../services/goodsReceiptWorkflow';
import type { GoodsReceiptFormValues, GoodsReceiptRecord } from '../types';

export function useGoodsReceipts() { const companyId = useAppStore((state) => state.activeCompanyId); return useQuery({ queryKey: queryKeys.forCompany(companyId).goodsReceipts, queryFn: () => getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS), staleTime: 30_000 }); }
export function useCreateGoodsReceipt() { const companyId = useAppStore((state) => state.activeCompanyId); const client = useQueryClient(); const keys = queryKeys.forCompany(companyId); return useMutation({ mutationFn: (input: GoodsReceiptFormValues) => createGoodsReceipt(input), onSuccess: () => { void Promise.all([client.invalidateQueries({ queryKey: keys.goodsReceipts }), client.invalidateQueries({ queryKey: keys.purchaseOrders }), client.invalidateQueries({ queryKey: keys.stock }), client.invalidateQueries({ queryKey: keys.stockLedger })]); toast.success('Goods receipt posted to stock'); }, onError: (error: Error) => toast.error(error.message) }); }
