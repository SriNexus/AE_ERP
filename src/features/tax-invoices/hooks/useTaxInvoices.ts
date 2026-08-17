import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import toast from 'react-hot-toast';
import type { TaxInvoiceFormState, TaxInvoiceRecord } from '../types';
import {
  cancelTaxInvoice,
  createTaxInvoiceDraft,
  issueTaxInvoice,
  updateTaxInvoiceDraft,
} from '../../../lib/taxInvoiceWorkflow';

export function useTaxInvoices() {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const result = useQuery({
    queryKey: keys.taxInvoices,
    queryFn: () => getAll<TaxInvoiceRecord>(COLLECTIONS.TAX_INVOICES),
    staleTime: 30_000,
  });

  return {
    ...result,
    data: (result.data || []) as TaxInvoiceRecord[],
  };
}

export function useSaveTaxInvoiceDraft(editId: string | null, onSuccess: () => void) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (form: TaxInvoiceFormState) => {
      return editId ? updateTaxInvoiceDraft(editId, form) : createTaxInvoiceDraft(form);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.taxInvoices });
      toast.success(editId ? 'Tax invoice draft updated' : 'Tax invoice draft created');
      onSuccess();
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to save tax invoice'),
  });
}

export function useIssueTaxInvoice(onSuccess: () => void) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (invoiceId: string) => issueTaxInvoice(invoiceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.taxInvoices });
      toast.success('Tax invoice issued');
      onSuccess();
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to issue tax invoice'),
  });
}

export function useCancelTaxInvoice(onSuccess: () => void) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async ({ invoiceId, reason }: { invoiceId: string; reason?: string }) => cancelTaxInvoice(invoiceId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.taxInvoices });
      toast.success('Tax invoice cancelled');
      onSuccess();
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to cancel tax invoice'),
  });
}

