/**
 * channelPartnerPhase12MigrationCompatibility.test.ts — VL-12 (Vendor Lock /
 * Scheme Registration) MIGRATION / COMPATIBILITY contract tests.
 *
 * Proves the two Registration domains are completely isolated and that the
 * Loan Registration domain remains behaviorally intact:
 *
 *   LOAN DOMAIN                 collection  registrations
 *                               entityType  registration
 *                               module      (loan permission module, distinct)
 *                               route       /registrations
 *
 *   VENDOR LOCK DOMAIN          collection  scheme_registrations
 *                               entityType  scheme_registration
 *                               module      scheme_registration
 *                               route       /registration
 *                               user-facing label  Registration
 *
 * Per docs/COMPLETE_CHANNEL_PARTNER/VENDOR_LOCK_REGISTRATION_IMPLEMENTATION_SPECIFICATION.md VL-12:
 *   - NO data migration, NO migration scripts, NO collection rename.
 *   - No /loan-registrations redirect without business approval.
 *   - Loan persisted contracts (collection, entityType, linkedEntityType,
 *     audit entityType) retained untouched.
 *
 * Where useful the suite reads the actual workflow/route sources from disk so
 * it proves the current repository state rather than imported re-exports.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLLECTIONS } from '../firebase';
import { ALL_MODULES, type Module } from '../permissions';
import {
  ENTITY_REGISTRY,
  getCollectionForEntityType,
  getEntityTypeForCollection,
} from '../entityRegistry';
import { getNotificationRoute } from '../notificationRoutes';
import { projectStageLabel } from '../../features/projects/utils/projectDisplay';
import { queryKeys } from '../queryKeys';

// Vitest runs with the project root as cwd — resolve sources from there so
// the suite keeps working if the test file ever moves.
const ROOT = process.cwd();

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(resolve(ROOT, dir))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.mjs') || f.endsWith('.cjs'))
    .map((f) => `${dir}/${f}`);
}

// ── 1. Collection identity ────────────────────────────────────────────────
describe('VL-12 — collection identity: scheme_registrations ≠ registrations', () => {
  it('LOAN_APPLICATIONS = "registrations" (persisted loan contract)', () => {
    expect(COLLECTIONS.LOAN_APPLICATIONS).toBe('registrations');
  });

  it('SCHEME_REGISTRATIONS = "scheme_registrations" (new Vendor Lock collection)', () => {
    expect(COLLECTIONS.SCHEME_REGISTRATIONS).toBe('scheme_registrations');
  });

  it('the two collection constants are never equal', () => {
    expect(COLLECTIONS.SCHEME_REGISTRATIONS).not.toBe(COLLECTIONS.LOAN_APPLICATIONS);
    expect(COLLECTIONS.SCHEME_REGISTRATIONS).not.toBe('registrations');
  });

  it('no collection constant redirects loan to the scheme collection (or vice versa)', () => {
    expect(COLLECTIONS.LOAN_APPLICATIONS).not.toBe('scheme_registrations');
  });
});

// ── 2. Entity identity ────────────────────────────────────────────────────
describe('VL-12 — entityType identity: scheme_registration ≠ registration', () => {
  it('entity registry maps scheme_registrations → scheme_registration', () => {
    expect(getEntityTypeForCollection('scheme_registrations')).toBe('scheme_registration');
  });

  it('entity registry maps registrations → registration (loan entityType preserved)', () => {
    expect(getEntityTypeForCollection('registrations')).toBe('registration');
  });

  it('the reverse lookups return the correct, distinct collections', () => {
    expect(getCollectionForEntityType('scheme_registration')).toBe('scheme_registrations');
    expect(getCollectionForEntityType('registration')).toBe('registrations');
  });

  it('module identity: scheme_registration is a reserved module, distinct from the loan module', () => {
    expect(ALL_MODULES).toContain('scheme_registration');
    const loanModule = getModuleForLoan();
    expect(loanModule).toBeTruthy();
    expect(loanModule).not.toBe('scheme_registration');
  });

  it('source-level: the loan workflow never emits entityType scheme_registration', () => {
    const loanSource = readSource('src/features/loan-applications/services/loanApplicationWorkflow.ts');
    expect(loanSource).not.toMatch(/scheme_registration/);
    expect(loanSource).toContain("linkedEntityType: 'registration'");
  });

  it('source-level: the scheme workflow never emits entityType registration', () => {
    const schemeSource = readSource('src/features/scheme-registration/services/schemeRegistrationWorkflow.ts');
    expect(schemeSource).toMatch(/entityType: 'scheme_registration'/);
    // It may reference the loan module only in comments explaining separation.
    expect(schemeSource).not.toMatch(/linkedEntityType: 'registration'/);
  });
});

function getModuleForLoan(): Module | undefined {
  // The loan permission module is a real Module value distinct from
  // scheme_registration, taken from the entity registry entry for the loan
  // collection ('registrations' → module).
  return ENTITY_REGISTRY.find((e) => e.collectionName === 'registrations')?.module as Module | undefined;
}

// ── 3. Route identity ─────────────────────────────────────────────────────
describe('VL-12 — route identity: /registration ≠ /registrations', () => {
  it('desktop routes declare BOTH /registrations (loan) and /registration (Vendor Lock)', () => {
    const routes = readSource('src/app/router/routes.tsx');
    expect(routes).toMatch(/path="\/registrations"/);
    expect(routes).toMatch(/path="\/registration"/);
  });

  it('the Vendor Lock /registration route is gated on the scheme_registration module', () => {
    const routes = readSource('src/app/router/routes.tsx');
    const registrationRoute = routes.match(/<Route path="\/registration"[\s\S]*?\/>/)?.[0] ?? '';
    expect(registrationRoute).toContain('scheme_registration');
  });

  it('the loan /registrations route is NOT a scheme_registration surface', () => {
    const routes = readSource('src/app/router/routes.tsx');
    const loanRoute = routes.match(/<Route path="\/registrations"[\s\S]*?\/>/)?.[0] ?? '';
    expect(loanRoute).not.toContain('scheme_registration');
  });

  it('mobile routes declare /registration for the scheme surface', () => {
    const mobile = readSource('src/components/mobile/routing/MobileRoutes.tsx');
    expect(mobile).toMatch(/path="\/registration"/);
    expect(mobile).toMatch(/scheme_registration/);
  });

  it('navigation config exposes the Vendor Lock surface at /registration (label Registration)', () => {
    const nav = readSource('src/components/layout/navigationConfig.tsx');
    expect(nav).toMatch(/path: '\/registration'/);
    expect(nav).toMatch(/module: 'scheme_registration'/);
  });

  it('no /loan-registrations redirect exists without business approval', () => {
    // Read every src route/nav source for the unapproved alias.
    for (const rel of [
      'src/app/router/routes.tsx',
      'src/components/mobile/routing/MobileRoutes.tsx',
      'src/components/layout/navigationConfig.tsx',
      'src/lib/notificationRoutes.ts',
    ]) {
      expect(readSource(rel)).not.toMatch(/loan-registrations/);
    }
  });
});

// ── 4. Workflow separation ────────────────────────────────────────────────
describe('VL-12 — workflow separation (no cross-invocation)', () => {
  it('the scheme workflow does not import or call the loan workflow', () => {
    const schemeSource = readSource('src/features/scheme-registration/services/schemeRegistrationWorkflow.ts');
    expect(schemeSource).not.toMatch(/loan-applications|loanApplicationWorkflow/);
    expect(schemeSource).not.toMatch(/onLoanApplicationStatusChange/);
  });

  it('the loan workflow does not import or call the scheme workflow', () => {
    const loanSource = readSource('src/features/loan-applications/services/loanApplicationWorkflow.ts');
    expect(loanSource).not.toMatch(/scheme-registration|schemeRegistrationWorkflow/);
    expect(loanSource).not.toMatch(/transitionSchemeRegistrationStatus/);
  });

  it('the scheme workflow writes exclusively to COLLECTIONS.SCHEME_REGISTRATIONS', () => {
    const schemeSource = readSource('src/features/scheme-registration/services/schemeRegistrationWorkflow.ts');
    // The loan 'registrations' collection must never appear as a write target.
    expect(schemeSource).toMatch(/COLLECTIONS\.SCHEME_REGISTRATIONS/);
    expect(schemeSource).not.toMatch(/COLLECTIONS\.LOAN_APPLICATIONS/);
  });

  it('the loan workflow writes exclusively to COLLECTIONS.LOAN_APPLICATIONS', () => {
    const loanSource = readSource('src/features/loan-applications/services/loanApplicationWorkflow.ts');
    expect(loanSource).toMatch(/COLLECTIONS\.LOAN_APPLICATIONS/);
    expect(loanSource).not.toMatch(/COLLECTIONS\.SCHEME_REGISTRATIONS/);
  });
});

// ── 5. Notification separation ────────────────────────────────────────────
describe('VL-12 — notification separation', () => {
  it('scheme_registration notifications deep-link to the Project Workspace', () => {
    expect(getNotificationRoute('scheme_registration', 'SREG-001', 'PRJ-1')).toBe('/projects/PRJ-1');
    expect(getNotificationRoute('scheme_registration', 'SREG-001')).toBe('/projects');
  });

  it('the loan entityType "registration" is NOT routed through the scheme branch', () => {
    const schemeRoute = getNotificationRoute('scheme_registration', 'SREG-001', 'PRJ-1');
    const loanRoute = getNotificationRoute('registration', 'RG-001', 'PRJ-1');
    expect(loanRoute).not.toBe(schemeRoute);
  });

  it('the loan workflow notifies with entityType "registration" (unchanged)', () => {
    const loanSource = readSource('src/features/loan-applications/services/loanApplicationWorkflow.ts');
    const notifications = loanSource.match(/'registration',/g) ?? [];
    expect(notifications.length).toBeGreaterThan(0);
  });
});

// ── 6. Audit separation ───────────────────────────────────────────────────
describe('VL-12 — audit separation', () => {
  it('the loan workflow audits with entityType "registration" (logUpdate, unchanged)', () => {
    const loanSource = readSource('src/features/loan-applications/services/loanApplicationWorkflow.ts');
    expect(loanSource).toMatch(/logUpdate\(\s*\n?\s*'registration',/);
  });

  it('the scheme workflow audits with entityType "scheme_registration"', () => {
    const schemeSource = readSource('src/features/scheme-registration/services/schemeRegistrationWorkflow.ts');
    expect(schemeSource).toMatch(/logEntityChange\(\s*\n?\s*'scheme_registration'/);
  });
});

// ── 7. Naming contract ────────────────────────────────────────────────────
describe('VL-12 — naming contract: user-facing stage is "Registration"', () => {
  it('projectStageLabel("SchemeRegistration") = "Registration" (never Vendor Lock etc.)', () => {
    expect(projectStageLabel('SchemeRegistration')).toBe('Registration');
    expect(projectStageLabel('SchemeRegistration')).not.toBe('Vendor Lock');
    expect(projectStageLabel('SchemeRegistration')).not.toBe('Scheme Registration');
    expect(projectStageLabel('SchemeRegistration')).not.toBe('Vendor Registration');
    expect(projectStageLabel('SchemeRegistration')).not.toBe('Portal Registration');
  });

  it('the scheme list page title is "Registration"', () => {
    const page = readSource('src/pages/SchemeRegistrations.tsx');
    expect(page).toMatch(/title="Registration"/);
  });
});

// ── 8. Query-key separation ───────────────────────────────────────────────
describe('VL-12 — query-key separation', () => {
  it('loan keys are scoped to "registrations"; scheme keys to "scheme_registrations"', () => {
    const c = 'C1';
    expect(queryKeys.forCompany(c).registrationsRoot[0]).toBe('registrations');
    expect(queryKeys.forCompany(c).schemeRegistrationsRoot[0]).toBe('scheme_registrations');
    expect(queryKeys.forCompany(c).schemeRegistrationsRoot[0]).not.toBe(
      queryKeys.forCompany(c).registrationsRoot[0],
    );
  });
});

// ── 9. No migration / no rename ───────────────────────────────────────────
describe('VL-12 — NO data migration, NO unapproved rename', () => {
  it('the production workflow sources never pass BOTH collections to one call (no copy/rename wiring)', () => {
    for (const rel of [
      'src/features/scheme-registration/services/schemeRegistrationWorkflow.ts',
      'src/features/loan-applications/services/loanApplicationWorkflow.ts',
      'src/lib/sandboxReset.ts',
    ]) {
      const source = readSource(rel);
      expect(source).not.toMatch(/LOAN_APPLICATIONS\s*,[^)]{0,120}SCHEME_REGISTRATIONS/);
      expect(source).not.toMatch(/SCHEME_REGISTRATIONS\s*,[^)]{0,120}LOAN_APPLICATIONS/);
    }
  });

  it('no script under scripts/ is a loan→scheme migration', () => {
    // Precise heuristic: a REAL loan→scheme data migration copies/renames
    // data FROM the loan collection TO the scheme collection, so it must
    // reference BOTH collections in a single code statement (e.g.
    // `copy('registrations', 'scheme_registrations')` or a rename wiring
    // the two together). Checking per-line — not file-wide co-occurrence —
    // is deliberate: the Phase 1 (Multi-Tenant) backfill scripts (Master
    // Plan §3.2) legitimately list both `registrations` and
    // `scheme_registrations` in the groupId-denormalization collection list
    // and copy role templates from `roles/{name}`, but never connect the
    // two Registration domains in any statement.
    for (const rel of listSourceFiles('scripts')) {
      const source = readSource(rel);
      const loanRef = /(?:'registrations'|COLLECTIONS\.LOAN_APPLICATIONS)/;
      const schemeRef = /(?:'scheme_registrations'|SCHEME_REGISTRATIONS)/;
      const flagged = source
        .split('\n')
        .some((line) => loanRef.test(line) && schemeRef.test(line) && /copy|rename|migrat|move/i.test(line));
      expect(flagged, `${rel} looks like a loan→scheme migration`).toBe(false);
    }
  });

  it('the loan route /registrations persists (backward-compatible), distinct from /registration', () => {
    const routes = readSource('src/app/router/routes.tsx');
    expect(routes).toMatch(/path="\/registrations"/);
    expect(routes).toMatch(/path="\/registration"/);
  });

  it('the loan permission module is distinct from scheme_registration (no alias)', () => {
    const loanModule = getModuleForLoan();
    expect(loanModule).toBeDefined();
    expect(loanModule).not.toBe('scheme_registration');
  });
});
