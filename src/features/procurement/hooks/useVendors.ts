import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { createVendor, deleteVendor, updateVendor } from '../services/vendorWorkflow';
import type { VendorFormValues, VendorRecord } from '../types';

export function useVendors() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  return useQuery({ queryKey: queryKeys.forCompany(companyId).vendors, queryFn: () => getAll<VendorRecord>(COLLECTIONS.VENDORS), staleTime: 30_000 });
}

export function useVendorActions() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).vendors });
  const error = (cause: Error) => toast.error(cause.message);
  return {
    create: useMutation({ mutationFn: (input: VendorFormValues) => createVendor(input), onSuccess: () => { void invalidate(); toast.success('Vendor created'); }, onError: error }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: VendorFormValues }) => updateVendor(id, input), onSuccess: () => { void invalidate(); toast.success('Vendor updated'); }, onError: error }),
    remove: useMutation({ mutationFn: (id: string) => deleteVendor(id), onSuccess: () => { void invalidate(); toast.success('Vendor deleted'); }, onError: error }),
  };
}
