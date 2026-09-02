/**
 * useAssignableSalesUsers — the ONE hook a "Sales Executive" assignment
 * dropdown should use (Lead create / Lead transfer / Lead→Customer conversion /
 * Customer create / Customer assignment).
 *
 * Returns EVERY sales-eligible, active user in the current company/tenant scope
 * — deliberately NOT narrowed by the viewer's own role, ownership visibility
 * (`self` / `team`), department, employee record, or previous assignments. The
 * business rule: if you may create the Lead/Customer, you may assign it to any
 * valid Sales Executive of your authorized company.
 *
 * Why not getAll(COLLECTIONS.USERS): getAll() runs applyAccessFilters(), whose
 * record-level `self`/`team` visibility for non-Admin roles (Sales, Manager,
 * Partner — none hold a `users` module grant) strips most/all Sales-rep records
 * out of the list before the caller's role filter runs. fetchAssignableSalesUsers()
 * is the canonical raw company-scoped read (identical query shape to
 * getNextAssignee()/getNotificationUsersByRoles()).
 *
 * Tenant isolation is preserved: the read is where('companyId','==', <resolved
 * company>) and firestore.rules' `users` list rule only proves a same-company
 * (or same-Group for a GroupAdmin) query — a cross-tenant roster is impossible.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { isRealCompanyId, resolveWriteCompanyId } from '../lib/firestore';
import { fetchAssignableSalesUsers } from '../lib/salesTeam';

/** Normalized shape for an assignment dropdown — `id`/`name` are always usable
 *  strings, `role` is a plain string when present; every original user field
 *  also remains available via the index signature. */
export type AssignableSalesUser = {
  id: string;
  name: string;
  role?: string;
  [key: string]: unknown;
};

export function useAssignableSalesUsers() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  // A real selected company wins; otherwise fall back to the canonical
  // write-time company (covers the GroupAdmin "whole group" view and the
  // owner/super-admin pre-boot window) — never a cross-tenant read, never the
  // 'all'/'group' sentinels.
  const companyId = isRealCompanyId(activeCompanyId) ? activeCompanyId : resolveWriteCompanyId();

  const query = useQuery({
    queryKey: ['assignable-sales-users', companyId],
    queryFn: () => fetchAssignableSalesUsers(companyId),
    staleTime: 60_000,
    enabled: Boolean(companyId),
  });

  const data = useMemo<AssignableSalesUser[]>(
    () => (query.data ?? []).map((u) => {
      const rec = u as Record<string, unknown>;
      return {
        ...rec,
        id: String(u.id),
        name: String(u.name ?? rec.displayName ?? rec.email ?? u.id),
        role: rec.role == null ? undefined : String(rec.role),
      };
    }),
    [query.data],
  );

  return { ...query, data };
}
