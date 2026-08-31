/**
 * Final completion pass — Group Admin employee-list visibility.
 *
 * Source-text/structural tests for `useEmployees.ts`'s merge logic, matching
 * this codebase's established convention (no `@testing-library/react`, so
 * `useEmployees()` itself — a hook depending on `useQuery`/`useAppStore`/
 * `useCurrentUser` — cannot be invoked outside a real component render).
 * Verifies: the merge is rules-provable (direct groupId+role query, never
 * routed through getAll()'s hard companyId constraint), scoped to ONLY a
 * GroupAdmin actor viewing one specific real company, deduplicates rather
 * than duplicates, and leaves every other actor's query completely
 * untouched.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const filePath = join(__dirname, '..', 'useEmployees.ts');
const raw = readFileSync(filePath, 'utf-8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = stripComments(raw);

describe('useEmployees.ts — Group Admin cross-company own-record visibility', () => {
  it('the merge query is scoped by groupId + role === "GroupAdmin", never companyId — the exact reason a normal company-scoped query excludes it', () => {
    expect(code).toContain("where('groupId', '==', groupId)");
    expect(code).toContain("where('role', '==', 'GroupAdmin')");
    expect(code).not.toMatch(/fetchOwnGroupAdminEmployeeRecords[\s\S]{0,400}where\('companyId'/);
  });

  it('bypasses getAll()/applyAccessFilters() for this specific query — uses the raw Firestore SDK directly (collection/getDocs/query/where)', () => {
    const fnBody = code.slice(code.indexOf('async function fetchOwnGroupAdminEmployeeRecords'), code.indexOf('export function useEmployees'));
    expect(fnBody).toContain('getDocs(query(');
    expect(fnBody).not.toContain('getAll(');
  });

  it('still filters out soft-deleted records — this bypass does not skip that defense-in-depth check', () => {
    expect(code).toContain("e.isDeleted !== true");
  });

  it('the merge only runs for a GroupAdmin actor, with a real groupId, viewing one specific real company — never for "all"/"group" sentinel views or any other role', () => {
    expect(code).toMatch(/if \(user\.role === 'GroupAdmin' && user\.groupId && isRealCompanyId\(activeCompanyId\)\)/);
  });

  it('merges by de-duplicating on id (a Map), never appending a second copy of an employee already present', () => {
    const mergeBlock = code.slice(code.indexOf("if (user.role === 'GroupAdmin'"), code.indexOf('return primary;'));
    expect(mergeBlock).toContain('new Map(primary.map((e: any) => [e.id, e]))');
    expect(mergeBlock).toContain('byId.set(ga.id, ga)');
  });

  it('a non-GroupAdmin actor (or GroupAdmin in "group"/"all" view) gets exactly the original getAll() result, completely unmodified', () => {
    // The function always computes `primary` first and returns it verbatim
    // whenever the GroupAdmin-specific branch's condition is false or finds
    // nothing to merge — no other code path mutates it.
    const queryFnBody = code.slice(code.indexOf('queryFn: async () => {'), code.indexOf('staleTime: 30_000,'));
    expect(queryFnBody).toContain('const primary = await getAll(COLLECTIONS.EMPLOYEES);');
    expect(queryFnBody.trim().endsWith('return primary;\n    },')).toBe(true);
  });

  it('creates no new employee document — this is a pure additional read, never a write (no createDocWithId/setDoc/EmployeeDomainService.create call anywhere near the merge logic)', () => {
    const mergeSection = code.slice(code.indexOf('async function fetchOwnGroupAdminEmployeeRecords'), code.indexOf('export function useSaveEmployee'));
    expect(mergeSection).not.toContain('createDocWithId');
    expect(mergeSection).not.toContain('EmployeeDomainService.create');
    expect(mergeSection).not.toMatch(/\bsetDoc\(/);
  });
});
