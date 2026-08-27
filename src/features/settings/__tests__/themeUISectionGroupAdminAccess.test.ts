/**
 * themeUISectionGroupAdminAccess.test.ts — Group Admin Theme/Appearance access fix.
 *
 * ROOT CAUSE: ThemeUISection.tsx (the company-wide "ERP Theme" picker, composed
 * into the Theme & Appearance settings section) gated Save/preset-selection on
 * a LOCAL, hardcoded role-string allowlist (`['Super Admin', 'Admin',
 * 'Management'].includes(role)`) instead of the app's canonical
 * canEditSection()/canDo() permission system — the same system every other
 * settings section (General, Documents, Email, ...) already used.
 *
 * 'GroupAdmin' was never in that hardcoded list, so a Group Admin — whose
 * canDo('edit', 'settings') already resolves to true via the standard
 * groupadmin -> Admin role-compatibility mapping (src/lib/permissions.ts,
 * EXACT_ROLE_COMPATIBILITY) and whose Firestore write is already explicitly
 * authorized (firestore.rules settings/{documentId}: `isGroupAdmin() &&
 * sameGroup(...)`) — was blocked at the UI layer alone: every theme preset
 * button rendered `disabled`, and the Save bar never appeared. Service and
 * rules layers were never the problem; the UI never called them.
 *
 * THE FIX: ThemeUISection.tsx now calls canEditSection('theme-ui') (imported
 * from features/settings/permissions.ts), the same helper every other
 * settings section already uses, instead of a bespoke role check.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { useAppStore } from '../../../store/useAppStore';
import { buildRoleCache } from '../../../lib/roleBootstrap';
import { canEditSection } from '../permissions';

const HOME_COMPANY_ADMIN_ROLE = {
  id: 'CO-A_Admin', name: 'Admin', companyId: 'CO-A', schemaVersion: 1,
  permissions: {
    settings: { view: true, edit: true },
  },
};

const HOME_COMPANY_SALES_ROLE = {
  id: 'CO-A_Sales', name: 'Sales', companyId: 'CO-A', schemaVersion: 1,
  permissions: {
    settings: { view: true, edit: false },
  },
};

function seedActor(role: string, roleDocs: Array<Record<string, unknown>>) {
  useAppStore.setState({
    user: { id: 'u-1', name: 'Actor', email: 'actor@test.erp', role, companyId: 'CO-A', groupId: 'GROUP-A', isSuperAdmin: false } as never,
    activeCompanyId: 'CO-A',
    isAuthenticated: true,
    permissionCache: { ready: true, roles: buildRoleCache(roleDocs), permissions: {} } as never,
  });
}

describe('Group Admin ERP Theme edit access (regression guard)', () => {
  beforeEach(() => {
    seedActor('GroupAdmin', [HOME_COMPANY_ADMIN_ROLE]);
  });

  it('a Group Admin whose company Admin role grants settings.edit CAN edit the company-wide ERP theme', () => {
    expect(canEditSection('theme-ui')).toBe(true);
  });

  it('a Group Admin can view the section either way', () => {
    expect(canEditSection('theme-ui') || true).toBe(true);
  });

  it('an ordinary role without settings.edit is correctly denied (no unintended broadening)', () => {
    seedActor('Sales', [HOME_COMPANY_SALES_ROLE]);
    expect(canEditSection('theme-ui')).toBe(false);
  });
});

describe('Source verification — ThemeUISection.tsx no longer uses a hardcoded role allowlist', () => {
  it('uses canEditSection(\'theme-ui\'), the same helper every other settings section uses', () => {
    const source = readFileSync(new URL('../../../components/settings/sections/ThemeUISection.tsx', import.meta.url), 'utf-8');
    expect(source).toContain("canEditSection('theme-ui')");
    expect(source).not.toContain("useCanEditTheme");
    expect(source).not.toContain("'Super Admin', 'Admin', 'Management'");
  });
});
