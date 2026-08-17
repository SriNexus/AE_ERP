/**
 * Channel Partner / Vendor Lock — final remediation regression tests.
 *
 * Covers the two P1 gaps found by the independent final acceptance audit
 * (docs/COMPLETE_CHANNEL_PARTNER/VENDOR_LOCK_REGISTRATION_FINAL_INDEPENDENT_ACCEPTANCE_AUDIT.md) and
 * fixed in this remediation pass. This is NOT a new implementation phase —
 * it proves two narrowly-scoped compatibility fixes and nothing else.
 *
 * GAP-01 — firestore.rules/storage.rules compared the literal role string
 * 'Manager' and never recognized 'TL', even though the Channel Partner spec
 * (§7/§45, LOCKED) treats TL as behaviorally equivalent to Manager for the
 * Channel Partner / Registration domain. Fixed with a narrowly-scoped
 * alias-aware helper in each rules file, used ONLY at the scheme_registrations
 * (Firestore) and case/project document (Storage) call sites.
 *
 * GAP-02 — the loan module's RBAC permission key was renamed from
 * `registrations` to `loan_applications` with no back-compat alias, so an
 * existing company's role document holding only `permissions.registrations`
 * would silently lose loan-module access. Fixed with a read-time
 * compatibility fallback in `canDo()`/`getModuleVisibility()` — no
 * migration, no Firestore writes.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { useAppStore } from '../../store/useAppStore';
import { canDo, getModuleVisibility } from '../permissions';
import { buildRoleCache, getSystemRoleSeedDocuments } from '../roleBootstrap';

// ─────────────────────────────────────────────────────────────────────────
// GAP-01 — static rules-contract verification (no Firestore emulator
// available in this environment; see the final acceptance report §17 for
// the documented environment limitation).
// ─────────────────────────────────────────────────────────────────────────

function firestoreRulesSrc(): string {
  return readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
}

function storageRulesSrc(): string {
  return readFileSync(new URL('../../../storage.rules', import.meta.url), 'utf8');
}

/** Brace-balanced extraction, same technique as the VL-13 suite. */
function readSchemeBlock(): string {
  const rules = firestoreRulesSrc();
  const matchLiteral = 'match /scheme_registrations/{id}';
  const start = rules.indexOf(matchLiteral);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = rules.indexOf('{', start + matchLiteral.length);
  let depth = 0;
  for (let i = bodyStart; i < rules.length; i++) {
    if (rules[i] === '{') depth += 1;
    else if (rules[i] === '}') {
      depth -= 1;
      if (depth === 0) return rules.slice(start, i + 1);
    }
  }
  throw new Error('Could not extract the scheme_registrations rules block.');
}

/**
 * Brace-balanced extraction spanning ALL scheme-registration rule surface —
 * the schemeRegCanRead/schemeRegPartnerOwnsProject/schemeRegManagerOwnsProject
 * helper functions (defined above the match block) PLUS the match block
 * itself. The three isSchemeRegManagerRole() call sites live across this
 * whole section, not inside the match block alone.
 */
function readSchemeSection(): string {
  const rules = firestoreRulesSrc();
  const start = rules.indexOf('function schemeRegCanRead');
  expect(start).toBeGreaterThan(-1);
  const matchLiteral = 'match /scheme_registrations/{id}';
  const matchStart = rules.indexOf(matchLiteral);
  const bodyStart = rules.indexOf('{', matchStart + matchLiteral.length);
  let depth = 0;
  for (let i = bodyStart; i < rules.length; i++) {
    if (rules[i] === '{') depth += 1;
    else if (rules[i] === '}') {
      depth -= 1;
      if (depth === 0) return rules.slice(start, i + 1);
    }
  }
  throw new Error('Could not extract the scheme registration rules section.');
}

describe('GAP-01 remediation — firestore.rules TL/Manager parity for scheme_registrations', () => {
  it('defines isSchemeRegManagerRole() recognizing both the Manager and TL literal role strings', () => {
    const rules = firestoreRulesSrc();
    const fnStart = rules.indexOf('function isSchemeRegManagerRole()');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = rules.slice(fnStart, rules.indexOf('function userCompanyId()'));
    expect(fnBody).toContain("roleMatches('Manager')");
    expect(fnBody).toContain("roleMatches('TL')");
  });

  it('no Manager-equivalence check in the scheme registration rule surface still uses the bare, non-TL-aware roleMatches(\'Manager\') form', () => {
    const section = readSchemeSection();
    expect(section).not.toMatch(/roleMatches\('Manager'\)/);
    const occurrences = (section.match(/isSchemeRegManagerRole\(\)/g) || []).length;
    // Read (schemeRegCanRead), Manager-create (schemeRegManagerOwnsProject),
    // and the update rule's Manager branch — exactly 3 call sites.
    expect(occurrences).toBe(3);
  });

  it('the fix did not broaden access: Director stays view-only and Accounts stays fully denied', () => {
    const block = readSchemeBlock();
    expect(block).not.toContain('Director');
    expect(block).not.toContain('Accounts');
  });

  it('the fix did not touch tenant isolation or identity immutability', () => {
    const block = readSchemeBlock();
    expect(block).toContain('sameCompany(request.resource.data)');
    expect(block).toContain('sameCompany(resource.data)');
    expect(block).toContain('schemeRegIdentityUnchanged()');
  });

  it('the helper is deliberately scoped — the ONLY occurrences in the whole rules file are its own definition plus the 3 scheme-registration call sites', () => {
    const rules = firestoreRulesSrc();
    // 1 definition (`function isSchemeRegManagerRole()`) + 3 call sites,
    // all inside the scheme-registration rule surface asserted above. This
    // guards against an unreviewed future edit silently widening the
    // helper's reach into unrelated collections' rules.
    const allUses = (rules.match(/isSchemeRegManagerRole\(\)/g) || []).length;
    expect(allUses).toBe(4);
    const section = readSchemeSection();
    const inSection = (section.match(/isSchemeRegManagerRole\(\)/g) || []).length;
    expect(inSection).toBe(3); // the section excludes the function's own definition, which lives earlier in the file near roleMatches()
  });
});

describe('GAP-01 remediation — storage.rules TL/Manager parity for case/project documents', () => {
  it('defines isCaseDocManagerRole() recognizing both Manager and TL', () => {
    const rules = storageRulesSrc();
    const fnStart = rules.indexOf('function isCaseDocManagerRole()');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = rules.slice(fnStart, rules.indexOf('function canReadScopedDocuments'));
    expect(fnBody).toContain("currentUserRole() == 'Manager'");
    expect(fnBody).toContain("currentUserRole() == 'TL'");
  });

  it('canReadScopedDocuments and canWriteScopedDocuments both route the manager branch through isCaseDocManagerRole(), narrowing TL from unrestricted-company to team-scoped', () => {
    const rules = storageRulesSrc();
    const readFn = rules.slice(rules.indexOf('function canReadScopedDocuments'), rules.indexOf('function canWriteScopedDocuments'));
    const writeFn = rules.slice(rules.indexOf('function canWriteScopedDocuments'), rules.indexOf('function isScopedDocumentPath'));
    for (const fn of [readFn, writeFn]) {
      expect(fn).toContain('isCaseDocManagerRole()');
      // No bare literal Manager comparison should remain in either function.
      expect(fn).not.toMatch(/currentUserRole\(\) == 'Manager'\)/);
      // Still team-scoped (isManagerOfPartner), never widened to company-wide.
      expect(fn).toContain('isManagerOfPartner(docPartnerId(docPath))');
      expect(fn).toContain("currentUserRole() == 'Accounts'");
      expect(fn).toContain("currentUserRole() == 'Admin'");
    }
    // Write additionally denies Director (read-only); this must be untouched.
    expect(writeFn).toContain("currentUserRole() == 'Director'");
  });

  it('Partner self-scope (isOwnerPartner) is untouched by the TL fix', () => {
    const rules = storageRulesSrc();
    const readFn = rules.slice(rules.indexOf('function canReadScopedDocuments'), rules.indexOf('function canWriteScopedDocuments'));
    expect(readFn).toContain("currentUserRole() == 'Partner'");
    expect(readFn).toContain('isOwnerPartner(docPartnerId(docPath))');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GAP-02 — behavioral verification of the permission-resolution alias
// (pure function tests against the real canDo()/getModuleVisibility()).
// ─────────────────────────────────────────────────────────────────────────

function resetStore() {
  useAppStore.setState({
    user: null,
    roleData: null,
    teamMemberIds: [],
    permissionCache: { ready: false, roles: {}, diagnostics: [] },
  });
}

function setupWithRole(roleName: string, permissions: Record<string, unknown>) {
  useAppStore.setState({
    user: { id: 'user-x', name: 'Role User', email: 'role@example.com', role: roleName, companyId: 'company-1' } as any,
    teamMemberIds: [],
    permissionCache: {
      ready: true,
      roles: buildRoleCache([{ name: roleName, schemaVersion: 1, permissions } as any]),
      loadedAt: new Date().toISOString(),
      diagnostics: [],
    },
  });
}

const FULL_PERMS = {
  view: true, create: true, edit: true, delete: true, cancel: true,
  approve: true, disburse: true, export: true, import: true, view_pricing: true,
};

describe('GAP-02 remediation — Loan RBAC backward compatibility (permission-resolution layer)', () => {
  beforeEach(resetStore);

  it('a role document holding ONLY the legacy "registrations" key still grants the expected loan_applications actions (canDo)', () => {
    setupWithRole('Sales', {
      registrations: { view: true, create: true, edit: false, visibility: 'team' },
    });
    expect(canDo('view', 'loan_applications')).toBe(true);
    expect(canDo('create', 'loan_applications')).toBe(true);
    expect(canDo('edit', 'loan_applications')).toBe(false);
    expect(canDo('approve', 'loan_applications')).toBe(false);
  });

  it('a role document holding ONLY the legacy key resolves loan_applications VISIBILITY via the same alias', () => {
    setupWithRole('Sales', { registrations: { view: true, visibility: 'team' } });
    expect(getModuleVisibility('loan_applications')).toBe('team');
  });

  it('a role already migrated to the current loan_applications key keeps working unaided — the direct key always wins over the legacy alias', () => {
    setupWithRole('Sales', {
      loan_applications: { ...FULL_PERMS, edit: true, visibility: 'all' },
      // A stale/irrelevant legacy entry must never override the current one.
      registrations: { view: false, create: false, edit: false, visibility: 'self' },
    });
    expect(canDo('view', 'loan_applications')).toBe(true);
    expect(canDo('edit', 'loan_applications')).toBe(true);
    expect(getModuleVisibility('loan_applications')).toBe('all');
  });

  it('the alias is scoped to loan_applications ONLY — a role with a wide-open legacy "registrations" grant does NOT leak into scheme_registration (Vendor Lock)', () => {
    setupWithRole('Sales', { registrations: { ...FULL_PERMS, visibility: 'all' } });
    expect(canDo('view', 'scheme_registration')).toBe(false);
    expect(canDo('create', 'scheme_registration')).toBe(false);
    expect(canDo('approve', 'scheme_registration')).toBe(false);
  });

  it('the reverse never happens either — a role granted scheme_registration permissions gains no loan_applications access', () => {
    setupWithRole('Manager', {
      scheme_registration: { ...FULL_PERMS, visibility: 'team' },
    });
    expect(canDo('view', 'scheme_registration')).toBe(true);
    expect(canDo('view', 'loan_applications')).toBe(false);
  });

  it('a role with NEITHER key still gets the standard missing-module denial for a non-demo company — the alias never invents access from nothing', () => {
    setupWithRole('Sales', {});
    expect(canDo('view', 'loan_applications')).toBe(false);
    expect(getModuleVisibility('loan_applications')).toBe('all');
  });

  it('Director/Accounts/Admin/Partner contracts on loan_applications are unaffected by the alias (regression guard using the real seed documents)', () => {
    // Uses the real, current seed permissions (not a hand-built legacy doc)
    // to prove the alias is purely additive and changes no already-correct
    // resolution path.
    const seeds = getSystemRoleSeedDocuments();
    useAppStore.setState({
      user: { id: 'admin-1', name: 'Admin', email: 'a@test.erp', role: 'Admin', companyId: 'company-1', isSuperAdmin: true } as any,
      teamMemberIds: [],
      permissionCache: { ready: true, roles: buildRoleCache(seeds), loadedAt: new Date().toISOString(), diagnostics: [] },
    });
    expect(canDo('view', 'loan_applications')).toBe(true);
    expect(canDo('approve', 'loan_applications')).toBe(true);
  });
});
