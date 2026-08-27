/**
 * Demo-to-Group conversion — regression tests
 * (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md).
 *
 * Proves the acceptance-criteria properties directly, not just incidentally
 * via other suites:
 *   - Neozy Demo is a real Group (name, status, demo@neozy.in as its
 *     GroupAdmin, a real per-company Admin role document).
 *   - No if(isDemo)-style bypass remains for ordinary business/
 *     authorization behavior (nav visibility, permission resolution) —
 *     source-grep style assertions, matching this codebase's existing
 *     convention (see ownerAccess.test.ts) for verifying architectural
 *     invariants that are cheap to check by content rather than by
 *     spinning up the full app.
 *   - The one deliberately-kept safeguard (blocking real outbound side
 *     effects) is still present, and is documented as being about the
 *     account's public credentials, not about Neozy Demo being a
 *     different kind of tenant.
 *   - The GroupAdmin/Group-suspension authorization path in Firestore
 *     rules does not special-case demo in any way — Neozy Demo is subject
 *     to the exact same rule text as every other Group.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIdentityDocuments } from '../../../scripts/demo/datasets/foundation.ts';
import { DEMO_COMPANY_ID, DEMO_GROUP_ID, DEMO_ERP_USER_ID } from '../../config/demo';

describe('Demo-to-Group conversion — Neozy Demo is a real Group', () => {
  const plan = buildIdentityDocuments('TEST-AUTH-UID');
  const group = plan.find((d) => d.collection === 'groups' && d.id === DEMO_GROUP_ID);
  const company = plan.find((d) => d.collection === 'companies' && d.id === DEMO_COMPANY_ID);
  const role = plan.find((d) => d.collection === 'roles' && d.id === `${DEMO_COMPANY_ID}_Admin`);
  const user = plan.find((d) => d.collection === 'users' && d.id === DEMO_ERP_USER_ID);

  it('has a Group named "Neozy Demo", Active, not the platform default', () => {
    expect(group).toBeDefined();
    expect(group?.data.name).toBe('Neozy Demo');
    expect(group?.data.status).toBe('Active');
    expect(group?.data.isDefault).toBe(false);
  });

  it('has a Company named "Neozy Demo", owned by the Neozy Demo Group', () => {
    expect(company).toBeDefined();
    expect(company?.data.name).toBe('Neozy Demo');
    expect(company?.data.groupId).toBe(DEMO_GROUP_ID);
    expect(company?.data.status).toBe('Active');
  });

  it('demo@neozy.in is a real GroupAdmin of the Neozy Demo Group — not a parallel demo-only role', () => {
    expect(user).toBeDefined();
    expect(user?.data.role).toBe('GroupAdmin');
    expect(user?.data.groupId).toBe(DEMO_GROUP_ID);
    expect(user?.data.companyId).toBe(DEMO_COMPANY_ID);
    expect(user?.data.isSuperAdmin).toBe(false);
  });

  it('has a real, full Admin role document — the same shape every other company\'s Admin role has, not a restricted custom role', () => {
    expect(role).toBeDefined();
    expect(role?.data.name).toBe('Admin');
    expect(role?.data.isSystem).toBe(true);
    const perms = role?.data.permissions as Record<string, Record<string, unknown>>;
    // The old "Demo Operator" role denied exactly these — now they must be
    // fully granted, proving GroupAdmin capability is real, not cosmetic.
    for (const module of ['companies', 'users', 'roles', 'settings']) {
      expect(perms[module]?.create).toBe(true);
      expect(perms[module]?.edit).toBe(true);
      expect(perms[module]?.view).toBe(true);
    }
  });

  it('no longer seeds the old restricted "Demo Operator" custom role', () => {
    const oldRole = plan.find((d) => d.collection === 'roles' && d.id === `${DEMO_COMPANY_ID}_Demo Operator`);
    expect(oldRole).toBeUndefined();
  });
});

describe('Demo-to-Group conversion — no if(isDemo)-style bypass left for ordinary ERP behavior', () => {
  it('permissions.ts no longer grants demo-only fallback permissions', () => {
    const permissions = readFileSync('src/lib/permissions.ts', 'utf8');
    expect(permissions).not.toContain('isOfficialDemoCompany');
    expect(permissions).not.toContain('Demo fallback role definition');
  });

  it('desktop and mobile nav no longer hide modules for demo users', () => {
    for (const file of [
      'src/components/layout/Sidebar.tsx',
      'src/components/mobile/shell/ModuleNavDrawer.tsx',
      'src/components/mobile/app/ModuleGrid.tsx',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('isDemoHiddenModule');
      expect(source).not.toContain('isDemoUser');
    }
  });

  it('RoleRoute no longer blocks demo users from routes by module', () => {
    const source = readFileSync('src/components/auth/RoleRoute.tsx', 'utf8');
    expect(source).not.toContain('isDemoHiddenModule');
    expect(source).not.toContain('isDemoUser');
    expect(source).not.toContain('Not available in Demo Mode');
  });

  it('the desktop sidebar brand uses the same CompanySwitcher for every Group, including Neozy Demo', () => {
    const source = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
    // The old inline "show a static demo logo instead of CompanySwitcher"
    // branch is gone — Neozy Demo now resolves its logo the same way any
    // other Company does.
    expect(source).not.toContain('Demo mode: show static demo logo');
    expect(source.match(/<CompanySwitcher/g)?.length).toBeGreaterThan(0);
  });

  it('DEMO_HIDDEN_MODULES no longer exists as a concept', () => {
    const demoConfig = readFileSync('src/config/demo.ts', 'utf8');
    const demoPolicy = readFileSync('src/lib/demoCapabilityPolicy.ts', 'utf8');
    expect(demoConfig).not.toContain('DEMO_HIDDEN_MODULES');
    expect(demoPolicy).not.toContain('DEMO_HIDDEN_MODULES');
    expect(demoPolicy).not.toContain('isDemoHiddenModule');
  });
});

describe('Demo-to-Group conversion (follow-up pass) — no artificial Demo restriction remains, matching normal-Group parity', () => {
  // Follow-up requirement (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md
  // gap-closure pass): "There must be NO artificial Demo restrictions that
  // would not exist for a normal Group." The one previously-kept safeguard
  // (blocking real outbound email/phone/WhatsApp) has been removed —
  // external communication now works for Neozy Demo exactly like any other
  // Group, through the same production code path, with no Demo-only gate.

  it('no capability-gating module/type remains — the mechanism was deleted, not just narrowed', () => {
    const demoPolicy = readFileSync('src/lib/demoCapabilityPolicy.ts', 'utf8');
    expect(demoPolicy).not.toContain('DemoCapability');
    expect(demoPolicy).not.toContain('isDemoCapabilityAllowed');
    expect(demoPolicy).not.toContain('assertDemoCapability');
  });

  it('the real outbound-communication trigger (openGmailCompose) no longer checks any demo gate', () => {
    const emailRuntime = readFileSync('src/features/settings/emailRuntime.ts', 'utf8');
    expect(emailRuntime).not.toContain('isDemoCapabilityAllowed');
    expect(emailRuntime).not.toContain('demoCapabilityPolicy');
  });

  it('the global external-communication click guard (mailto/tel/sms/WhatsApp blocker) no longer exists', () => {
    expect(() => readFileSync('src/components/auth/DemoExternalActionGuard.tsx', 'utf8')).toThrow();
    const providers = readFileSync('src/app/providers/index.tsx', 'utf8');
    expect(providers).not.toContain('DemoExternalActionGuard');
  });

  it('the demo-only session timeout (6h/30min auto-logout) no longer exists', () => {
    expect(() => readFileSync('src/lib/demoSession.ts', 'utf8')).toThrow();
    const routes = readFileSync('src/app/router/routes.tsx', 'utf8');
    expect(routes).not.toContain('useDemoSession');
  });

  it('the reset-on-new-browser-login mechanism no longer exists — demo@neozy.in flows through the exact same login path as every other user', () => {
    expect(() => readFileSync('src/lib/sandboxReset.ts', 'utf8')).toThrow();
    const login = readFileSync('src/pages/Login.tsx', 'utf8');
    expect(login).not.toContain('isOfficialDemoEmail');
    expect(login).not.toContain('triggerDemoReset');
    expect(login).not.toContain('startDemoSession');
  });

  it('the demo-only client-side upload path restriction no longer exists — Storage Rules alone govern every Group\'s uploads, including Neozy Demo\'s', () => {
    expect(() => readFileSync('src/lib/demoUploadPolicy.ts', 'utf8')).toThrow();
  });

  it('the scheduled nightly wipe-and-reseed is disabled — Neozy Demo persists real testing data like any other Group; reset stays available only as an explicit manual action', () => {
    const workflow = readFileSync('.github/workflows/demo-reset.yml', 'utf8');
    expect(workflow).not.toMatch(/schedule:/);
    expect(workflow).toMatch(/workflow_dispatch/);
  });
});

describe('Demo-to-Group conversion — Firestore rules do not special-case demo', () => {
  it('actorIsGroupAdmin()/isGroupAdmin() is a plain role check, with no demo branch', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const match = rules.match(/function actorIsGroupAdmin\(\)\s*\{[\s\S]*?\n\s*\}/);
    expect(match).toBeTruthy();
    const body = match![0];
    expect(body).toContain("data.role == 'GroupAdmin'");
    expect(body.toLowerCase()).not.toContain('demo');
  });

  it('groupIsActive() (Group suspension enforcement) has no demo branch — a deactivated Neozy Demo is blocked exactly like any other Group', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    const match = rules.match(/function groupIsActive\(groupId\)\s*\{[\s\S]*?\n\s*\}/);
    expect(match).toBeTruthy();
    const body = match![0];
    expect(body).toContain("data.status == 'Active'");
    expect(body.toLowerCase()).not.toContain('demo');
  });

  it('no rule anywhere references company-demo-neozy or group-demo-neozy by literal id', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).not.toContain(DEMO_COMPANY_ID);
    expect(rules).not.toContain(DEMO_GROUP_ID);
  });
});
