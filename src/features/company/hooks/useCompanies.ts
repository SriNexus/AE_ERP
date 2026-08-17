import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';

// ═══════════════════════════════════════════════════════════
//  Company name normalization
//  Handles: "CSGPL", "CSGPL Default", "csgpl", "Csgpl", "default"
// ═══════════════════════════════════════════════════════════

const CANONICAL_MAP: Record<string, string> = {
  csgpl: 'CSGPL',
  'csgpl default': 'CSGPL',
  'csgpl enterprise': 'CSGPL',
  default: 'CSGPL',
};

export function normalizeCompanyName(raw: string): string {
  const key = (raw || '').trim().toLowerCase();
  return CANONICAL_MAP[key] ?? raw.trim();
}

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
        // Normalize display name
        name: normalizeCompanyName(c.name || c.shortName || c.id),
        shortName: normalizeCompanyName(c.shortName || c.name || c.id),
      })),
  });
}
