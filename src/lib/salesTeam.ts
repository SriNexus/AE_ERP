/**
 * Canonical "who counts as an assignable Sales Person" predicate.
 *
 * Neozy's RBAC is data-driven — companies/Admins create and rename roles
 * freely via Roles.tsx (see lib/roleBootstrap.ts) — so a fixed role-NAME
 * whitelist silently excludes a company's real Sales team the moment their
 * role is spelled differently from the seeded default (e.g. "Sales
 * Executive" instead of "Sales"). This is the root cause behind
 * getNextAssignee() throwing "No sales team members available" (surfaced to
 * users as a blocking error on Lead creation) for any company whose Sales
 * role isn't named exactly one of the historical short forms.
 *
 * The seeded system roles denormalize an organizational `department` onto
 * every user (SYSTEM_ROLE_DEPARTMENTS: Sales -> 'Sales', roleBootstrap.ts) —
 * that field is the more robust signal when present. When it isn't (a
 * free-text/legacy role with no matching role document), fall back to the
 * existing name-based convention already used across the app (Leads.tsx's
 * inline `salesUsers` filter and its ~9 duplicates), widened to be
 * case-insensitive and to recognize the role name containing the word
 * "sales" as a whole word — covers "Sales Executive", "Sales Manager", etc.
 * without inventing a new per-company configuration surface.
 */
import { isHiddenOwnerRecord } from './ownerAccess';

const SALES_ROLE_SHORT_NAMES = new Set(['sales', 'executive', 'bde', 'bdm', 'manager', 'tl']);

export function isSalesEligibleRole(role: unknown, department?: unknown): boolean {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!normalizedRole) return false;
  if (String(department || '').trim().toLowerCase() === 'sales') return true;
  if (SALES_ROLE_SHORT_NAMES.has(normalizedRole)) return true;
  return /\bsales\b/.test(normalizedRole);
}

export interface SalesEligibleUser {
  id: string;
  name?: unknown;
  role?: unknown;
  department?: unknown;
  status?: unknown;
  isDeleted?: unknown;
  [key: string]: unknown;
}

/** Company-scoped list should already be filtered by companyId by the caller (mirrors Leads.tsx's own pattern: fetch company users once, then filter this way). */
export function filterEligibleSalesUsers<T extends SalesEligibleUser>(users: T[]): T[] {
  return users
    .filter((u) => isSalesEligibleRole(u.role, u.department) && u.status !== 'Inactive' && u.isDeleted !== true && !isHiddenOwnerRecord(u))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}
