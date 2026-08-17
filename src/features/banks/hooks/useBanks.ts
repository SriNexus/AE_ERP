/**
 * useBanks — Bank Master hooks (Phase REG-6)
 *
 * Provides hooks for managing banks and their self-learning branch repository.
 * Banks are stored in the Firestore 'banks' collection.
 * Branches are stored as a subcollection 'branches' under each bank document.
 *
 * The branch repository is self-learning:
 * - New branches are auto-created when users enter unknown branch names
 * - usageCount is incremented on every use
 * - Suggestions are ranked by usageCount > lastUsedAt > alphabetical
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import {
  getAll, createDocWithId, updateDocById, softDelete, genId, fromDoc,
} from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────

export interface BankRecord {
  id: string;
  bankCode: string;
  bankName: string;
  displayName: string;
  status: 'Active' | 'Inactive';
  priority: number;
  bankType?: string;       // Public / Private / Cooperative / NBFC
  supportedSchemes?: string[];
  activeRegions?: string[];
  contactPerson?: string;
  ifscPrefix?: string;
  logoUrl?: string;
  companyId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface BranchRecord {
  id: string;
  branchName: string;
  normalizedName: string;
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export const BANK_FORM_DEFAULT = {
  bankCode: '',
  bankName: '',
  displayName: '',
  status: 'Active' as 'Active' | 'Inactive',
  priority: 0,
  bankType: '',
};

export type BankForm = typeof BANK_FORM_DEFAULT;

// ── Normalize branch name for duplicate prevention ────────

export function normalizeBranchName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '');
}

// ── Hook: Fetch all banks ─────────────────────────────────

export function useBanks() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useQuery({
    queryKey: keys.banksAll,
    queryFn: async () => {
      const all = await getAll<any>(COLLECTIONS.BANKS);
      return (all as BankRecord[]).filter(b => !b.isDeleted).sort((a, b) => (a.priority || 999) - (b.priority || 999));
    },
    staleTime: 60_000,
  });
}

// ── Hook: Fetch branches for a specific bank ──────────────

export function useBranches(bankId: string | undefined) {
  return useQuery({
    queryKey: ['bank-branches', bankId],
    queryFn: async () => {
      if (!bankId) return [];
      const snap = await getDocs(collection(db, COLLECTIONS.BANKS, bankId, 'branches'));
      return snap.docs.map(d => fromDoc<any>(d as any));
    },
    enabled: Boolean(bankId),
    staleTime: 30_000,
  });
}

// ── Hook: Smart branch suggestions ────────────────────────

export function useBranchSuggestions(bankId: string | undefined, query: string) {
  const { data: branches = [] } = useBranches(bankId);

  return useMemo(() => {
    if (!query || query.length < 2) return branches.slice(0, 10);
    const q = query.trim().toLowerCase();

    return (branches as BranchRecord[])
      .filter(b => {
        const name = b.normalizedName || normalizeBranchName(b.branchName);
        return name.startsWith(q) || name.includes(q);
      })
      .sort((a, b) => {
        // Exact match first, then startsWith, then contains
        const aNorm = a.normalizedName || normalizeBranchName(a.branchName);
        const bNorm = b.normalizedName || normalizeBranchName(b.branchName);
        const aExact = aNorm === q ? 0 : aNorm.startsWith(q) ? 1 : 2;
        const bExact = bNorm === q ? 0 : bNorm.startsWith(q) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
        // Then by usage count
        if (a.usageCount !== b.usageCount) return (b.usageCount || 0) - (a.usageCount || 0);
        // Then by last used
        const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
        const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
        // Finally alphabetical
        return a.branchName.localeCompare(b.branchName);
      })
      .slice(0, 15);
  }, [branches, query]);
}

// ── Hook: Record a branch usage (learn from user input) ───

export function useLearnBranch() {
  const user = useCurrentUser();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ bankId, branchName }: { bankId: string; branchName: string }) => {
      if (!bankId || !branchName?.trim()) return null;
      const normalized = normalizeBranchName(branchName);
      const now = new Date().toISOString();

      // Check if branch already exists
      const existingSnap = await getDocs(collection(db, COLLECTIONS.BANKS, bankId, 'branches'));
      const existing = existingSnap.docs.map(d => fromDoc<any>(d as any));
      const match = existing.find((b: any) => (b.normalizedName || normalizeBranchName(b.branchName)) === normalized);

      if (match) {
        // Increment usage count
        await updateDocById(`/${COLLECTIONS.BANKS}/${bankId}/branches`, match.id, {
          usageCount: (match.usageCount || 0) + 1,
          lastUsedAt: now,
          updatedAt: now,
        });
        return { id: match.id, branchName: match.branchName };
      }

      // Auto-create new branch
      const branchId = genId.generic('BRN');
      const newBranch = {
        id: branchId,
        branchName: branchName.trim(),
        normalizedName: normalized,
        usageCount: 1,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: user?.id || 'system',
        isDeleted: false,
      };
      await createDocWithId(`${COLLECTIONS.BANKS}/${bankId}/branches`, branchId, newBranch);
      return { id: branchId, branchName: branchName.trim() };
    },
    onSuccess: (result, vars) => {
      if (result) {
        void qc.invalidateQueries({ queryKey: ['bank-branches', vars.bankId] });
      }
    },
  });
}

// ── Bank CRUD mutations ───────────────────────────────────

export function useSaveBank() {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const keys = queryKeys.forCompany(useAppStore.getState().activeCompanyId);

  return useMutation({
    mutationFn: async ({ bankId, data }: { bankId?: string; data: BankForm }) => {
      const now = new Date().toISOString();
      if (bankId) {
        await updateDocById(COLLECTIONS.BANKS, bankId, { ...data, updatedBy: user?.id, updatedAt: now });
        return { ...data, id: bankId };
      }
      const id = genId.generic('BNK');
      await createDocWithId(COLLECTIONS.BANKS, id, {
        ...data, id, companyId: user?.companyId || '',
        createdBy: user?.id || 'system', createdAt: now, updatedBy: user?.id, updatedAt: now, isDeleted: false,
      });
      return { ...data, id };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.banksAll });
      toast.success('Bank saved');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteBank() {
  const qc = useQueryClient();
  const keys = queryKeys.forCompany(useAppStore.getState().activeCompanyId);

  return useMutation({
    mutationFn: (bankId: string) => softDelete(COLLECTIONS.BANKS, bankId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.banksAll }); toast.success('Bank deleted'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useBulkBankStatus() {
  const qc = useQueryClient();
  const keys = queryKeys.forCompany(useAppStore.getState().activeCompanyId);

  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: 'Active' | 'Inactive' }) => {
      await Promise.all(ids.map(id => updateDocById(COLLECTIONS.BANKS, id, { status })));
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: keys.banksAll }); toast.success('Banks updated'); },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Branch admin mutations ────────────────────────────────

export function useUpdateBranch() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ bankId, branchId, branchName }: { bankId: string; branchId: string; branchName: string }) => {
      await updateDocById(`${COLLECTIONS.BANKS}/${bankId}/branches`, branchId, {
        branchName,
        normalizedName: normalizeBranchName(branchName),
        updatedAt: new Date().toISOString(),
      });
    },
    onSuccess: (_, vars) => { void qc.invalidateQueries({ queryKey: ['bank-branches', vars.bankId] }); toast.success('Branch updated'); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteBranch() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ bankId, branchId }: { bankId: string; branchId: string }) => {
      await softDelete(`${COLLECTIONS.BANKS}/${bankId}/branches`, branchId);
    },
    onSuccess: (_, vars) => { void qc.invalidateQueries({ queryKey: ['bank-branches', vars.bankId] }); toast.success('Branch deleted'); },
    onError: (e: any) => toast.error(e.message),
  });
}

// ── Active bank options for dropdowns (reusable) ──────────

export function useBankOptions() {
  const { data: banks = [], isLoading } = useBanks();
  const options = useMemo(() => [
    { label: 'Select Bank', value: '' },
    ...(banks as BankRecord[])
      .filter(b => b.status === 'Active')
      .map(b => ({ label: b.displayName || b.bankName, value: b.bankName })),
  ], [banks]);

  return { banks: banks as BankRecord[], options, isLoading };
}
