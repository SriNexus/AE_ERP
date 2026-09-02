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
import { collection, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS, db } from './firebase';
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

/**
 * Canonical fetch of the Sales Persons a lead may legitimately be assigned to
 * within ONE company.
 *
 * Scope: a single explicit `where('companyId','==',companyId)` equality — the
 * SAME query shape getNextAssignee() (lib/roundRobin.ts) and
 * getNotificationUsersByRoles() (lib/notifications.ts) already use. Tenant
 * isolation is therefore structural here AND independently enforced by the
 * `users` list rule in firestore.rules (which only proves a same-company list
 * query — a forged companyId is denied server-side). Status/active/soft-delete
 * and the hidden-owner record are removed by filterEligibleSalesUsers().
 *
 * Deliberately a RAW company-scoped read, NOT getAll(COLLECTIONS.USERS):
 * getAll() runs applyAccessFilters(), whose record-level `self` visibility for
 * the Partner role (that role holds no `users` module grant) strips every
 * Sales-rep user document out before this predicate can see it — the root
 * cause of the Channel Partner "Add Lead" Sales Person selector rendering an
 * empty list and the partner being left with no choice but implicit
 * company-side assignment.
 */
export async function fetchAssignableSalesUsers(companyId: string): Promise<SalesEligibleUser[]> {
  if (!companyId) return [];
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.USERS),
    where('companyId', '==', companyId),
  ));
  const users = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as SalesEligibleUser));
  return filterEligibleSalesUsers(users);
}
