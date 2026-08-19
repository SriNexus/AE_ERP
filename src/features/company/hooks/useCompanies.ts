import { useQuery } from '@tanstack/react-query';
import { query, collection, where } from 'firebase/firestore';
import { getDocs } from 'firebase/firestore';
import { getAll, fromDoc } from '../../../lib/firestore';
import { db, COLLECTIONS } from '../../../lib/firebase';

// ─── Company shape returned from Firestore ──────────────────
export interface CompanyDoc {
  id: string;
  name: string;
  shortName?: string;
  companyCode?: string;
  logo?: string;
  iconLogo?: string;
  isDefault?: boolean;
  status?: string;
  /** Phase 1: which workflow(s) this company operates — see lib/companyBusinessMode.ts. */
  businessMode?: 'B2B' | 'B2C' | 'Both';
  groupId?: string;
  isDeleted?: boolean;
}

// ═══════════════════════════════════════════════════════════
//  useCompanies
//  React Query cached company list — 5m stale time
// ═══════════════════════════════════════════════════════════

export function useCompanies() {
  return useQuery<CompanyDoc[]>({
    queryKey: ['companies'],
    queryFn: () => getAll<CompanyDoc>(COLLECTIONS.COMPANIES),
    staleTime: 5 * 60 * 1000,
    select: (docs) =>
      docs.map((c) => ({
        ...c,
        name: c.name || c.shortName || c.id,
        shortName: c.shortName || c.name || c.id,
      })),
  });
}

/**
 * Group-scoped company list for Group Admin actors (Phase 5, Master Plan
 * §7.2). Query-level where('groupId','==',...) — provable against the
 * companies read rule's groupAdminCanRead() branch (emulator-proven), so a
 * Group Admin's switcher lists EVERY Company in their own Group regardless of
 * the currently selected company. Never a client-side filter over all
 * companies.
 */
export function useGroupCompanies(groupId: string | undefined) {
  return useQuery<CompanyDoc[]>({
    queryKey: ['group-companies', groupId],
    queryFn: async () => {
      if (!groupId) return [];
      const snap = await getDocs(query(collection(db, COLLECTIONS.COMPANIES), where('groupId', '==', groupId)));
      return snap.docs.map((d) => fromDoc<CompanyDoc>(d as any));
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!groupId,
    select: (docs) =>
      docs
        .filter((c) => c.isDeleted !== true)
        .map((c) => ({
          ...c,
          name: c.name || c.shortName || c.id,
          shortName: c.shortName || c.name || c.id,
        })),
  });
}
