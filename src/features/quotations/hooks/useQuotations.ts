import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { convertQuotationToOrder } from '../../../lib/quotationWorkflow';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import type { Quotation } from '../../../types';

export function useConvertQuotationToOrder() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (quote: Quotation) => {
      toast('Stock availability should be reviewed before dispatch.');
      return convertQuotationToOrder(quote);
    },
    onSuccess: (orderId) => {
      qc.invalidateQueries({ queryKey: keys.quotationsRoot });
      qc.invalidateQueries({ queryKey: keys.ordersRoot });
      toast.success(`Converted to Order ${orderId}`);
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : 'Conversion failed'),
  });
}
