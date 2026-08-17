/**
 * useDefaultCompany — Returns the default company config (single source of truth).
 *
 * Queries Companies collection for the document with isDefault === true.
 * Falls back to the first company, then to DEFAULT_COMPANY constant.
 *
 * This is the canonical way for any ERP module to get company information.
 * App Settings no longer owns company data — Companies module does.
 */

import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { DEFAULT_COMPANY, type CompanyConfig } from '../../../config/company';

export interface DefaultCompanyResult {
  /** The resolved default company config — never null */
  company: CompanyConfig;
  /** True while the initial Firestore query is loading */
  isLoading: boolean;
  /** True if the query failed */
  isError: boolean;
  /** Refetch the company list */
  refetch: () => void;
}

/**
 * useDefaultCompany
 *
 * @returns DefaultCompanyResult — always returns a CompanyConfig (falls back to DEFAULT_COMPANY)
 */
export function useDefaultCompany(): DefaultCompanyResult {
  const { data: companies = [], isLoading, isError, refetch } = useQuery<any[]>({
    queryKey: ['companies_default'],
    queryFn: () => getAll(COLLECTIONS.COMPANIES, []),
    staleTime: 5 * 60 * 1000,
  });

  // Resolve: isDefault flag → first company → hardcoded default
  const company: CompanyConfig = (() => {
    if (!companies || companies.length === 0) return DEFAULT_COMPANY;
    const defaultDoc = companies.find((c: any) => c.isDefault);
    if (defaultDoc) return { ...DEFAULT_COMPANY, ...defaultDoc } as CompanyConfig;
    return { ...DEFAULT_COMPANY, ...companies[0] } as CompanyConfig;
  })();

  return { company, isLoading, isError, refetch };
}
