/**
 * useSchemeRegistrations — Phase 6 (Channel Partner — Vendor Lock / Scheme
 * Registration) React Query hooks. Mirrors the established useSubsidy hook
 * architecture: company-scoped query keys, canonical workflow mutations,
 * toast feedback, and invalidation of the registrations + projects caches.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import {
  attachRegistrationDocument,
  createSchemeRegistration,
  reopenSchemeRegistration,
  transitionSchemeRegistrationStatus,
} from '../services/schemeRegistrationWorkflow';
import type {
  SchemeRegistrationRecord,
  SchemeRegistrationCreateInput,
  SchemeRegistrationStatus,
  SchemeRegistrationTransitionOptions,
} from '../types';

export function useSchemeRegistrations() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: keys.schemeRegistrationsAll,
    queryFn: () => getAll<SchemeRegistrationRecord>(COLLECTIONS.SCHEME_REGISTRATIONS),
    staleTime: 15_000,
  });
}

export function useCreateSchemeRegistration() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: (input: SchemeRegistrationCreateInput) => createSchemeRegistration(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.schemeRegistrationsAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success('Scheme registration draft created');
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create registration'),
  });
}

export function useReopenSchemeRegistration() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => reopenSchemeRegistration(id, note),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: keys.schemeRegistrationsAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(`Registration reopened (now ${data.status})`);
    },
    onError: (err: any) => toast.error(err?.message || 'Reopen failed'),
  });
}

export function useAttachRegistrationDocument() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      id,
      category,
      documentId,
      uploadedByName,
    }: {
      id: string;
      category: string;
      documentId: string;
      uploadedByName?: string;
    }) => attachRegistrationDocument(id, category, documentId, { uploadedByName }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.schemeRegistrationsAll });
      void qc.invalidateQueries({ queryKey: keys.caseDocumentsRoot });
      toast.success('Document linked to registration');
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to link document'),
  });
}

export function useTransitionSchemeRegistration() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: ({
      id,
      status,
      options,
    }: {
      id: string;
      status: SchemeRegistrationStatus;
      options?: SchemeRegistrationTransitionOptions;
    }) => transitionSchemeRegistrationStatus(id, status, options),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: keys.schemeRegistrationsAll });
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(`Registration status updated to ${data.status}`);
    },
    onError: (err: any) => toast.error(err?.message || 'Status update failed'),
  });
}
