import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { companyScopedQuery, resolveReadCompanyId, resolveWriteCompanyId } from '../firestore';
import { COLLECTIONS } from '../firebase';
import { useAppStore } from '../../store/useAppStore';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Tenant context fail-closed — Admin companyId="default" 403-storm root cause', () => {
  beforeEach(() => {
    useAppStore.setState({
      user: null,
      isAuthenticated: false,
      activeCompanyId: 'default',
      company: { ...(useAppStore.getState().company), id: 'default' },
      globalCompany: null,
      roleData: null,
      teamMemberIds: [],
    });
  });

  describe('companyScopedQuery', () => {
    it('throws for an authenticated non-owner identity stuck on the neutral placeholder', () => {
      useAppStore.setState({
        user: {
          id: 'legacy-admin',
          name: 'Legacy Admin',
          email: 'admin@neozy.in',
          role: 'Admin',
          companyId: 'default',
        },
        isAuthenticated: true,
        activeCompanyId: 'default',
      });
      expect(() => companyScopedQuery(COLLECTIONS.LEADS)).toThrow(/no valid companyId/);
      expect(() => companyScopedQuery(COLLECTIONS.DISPATCH)).toThrow(/no valid companyId/);
      expect(() => companyScopedQuery(COLLECTIONS.SETTINGS)).toThrow(/no valid companyId/);
    });

    it('allows the owner/super-admin neutral pre-boot state (useGlobalBoot resolves it)', () => {
      useAppStore.setState({
        user: {
          id: 'owner-uid',
          name: 'ERP Owner',
          email: 'shreeniwas.tripathi0@gmail.com',
          role: 'Owner',
          companyId: 'default',
          isOwner: true,
          isSuperAdmin: true,
        },
        isAuthenticated: true,
        activeCompanyId: 'default',
      });
      expect(companyScopedQuery(COLLECTIONS.LEADS)).toHaveLength(0);

      useAppStore.setState({
        user: {
          id: 'sa-uid',
          name: 'Super Admin',
          email: 'super@test.erp',
          role: 'Admin',
          companyId: 'default',
          isSuperAdmin: true,
        },
        activeCompanyId: 'default',
      });
      expect(companyScopedQuery(COLLECTIONS.LEADS)).toHaveLength(0);
    });

    it('still constrains business collections with the canonical company for a valid identity', () => {
      useAppStore.setState({
        user: {
          id: 'admin-ok',
          name: 'Admin',
          email: 'admin@neozy.in',
          role: 'Admin',
          companyId: 'CO-1783978330465-3EV9',
        },
        isAuthenticated: true,
        activeCompanyId: 'CO-1783978330465-3EV9',
      });
      expect(companyScopedQuery(COLLECTIONS.LEADS)).toHaveLength(1);
      expect(companyScopedQuery(COLLECTIONS.CUSTOMERS)).toHaveLength(1);
      expect(companyScopedQuery(COLLECTIONS.ROLES)).toHaveLength(0);
      expect(companyScopedQuery(COLLECTIONS.COMPANIES)).toHaveLength(0);
    });
  });

  describe('resolveReadCompanyId', () => {
    it('returns a real active selection as-is', () => {
      useAppStore.setState({ activeCompanyId: 'CO-1783978330465-3EV9' });
      expect(resolveReadCompanyId()).toBe('CO-1783978330465-3EV9');
    });

    it('preserves the owner/super-admin "all" global read scope', () => {
      useAppStore.setState({
        activeCompanyId: 'all',
        user: {
          id: 'owner-uid', name: 'Owner', email: 'shreeniwas.tripathi0@gmail.com', role: 'Owner',
          companyId: 'CO-1783978330465-3EV9', isOwner: true, isSuperAdmin: true,
        },
      });
      expect(resolveReadCompanyId()).toBe('all');
    });

    it('never returns the neutral "default" placeholder — falls back to the user profile company', () => {
      useAppStore.setState({
        activeCompanyId: 'default',
        company: { ...useAppStore.getState().company, id: 'default' },
        user: {
          id: 'admin-ok', name: 'Admin', email: 'admin@neozy.in', role: 'Admin',
          companyId: 'CO-1783978330465-3EV9',
        },
      });
      // This is EXACTLY the Admin post-logout window: activeCompanyId is still
      // 'default' until useGlobalBoot resolves it — the read path must use the
      // user's canonical profile company, never emit where('companyId','==','default').
      expect(resolveReadCompanyId()).toBe('CO-1783978330465-3EV9');
    });

    it('returns empty when nothing real resolves (fail closed — caller must not query)', () => {
      useAppStore.setState({ activeCompanyId: 'default', company: { ...useAppStore.getState().company, id: 'default' }, user: null });
      expect(resolveReadCompanyId()).toBe('');
    });
  });

  describe('read-path consumers — canonical tenant on READS, never "default"', () => {
    it('Home.tsx resolves the dashboard company canonically', () => {
      const source = src('src/pages/Home.tsx');
      expect(source).not.toMatch(/activeCompanyId && activeCompanyId !== 'all'/);
      expect(source).toContain('resolveWriteCompanyId()');
    });

    it('mobile HomeWorkspace resolves the dashboard company canonically', () => {
      const source = src('src/components/mobile/home/HomeWorkspace.tsx');
      expect(source).not.toMatch(/activeCompanyId && activeCompanyId !== 'all'/);
      expect(source).toContain('resolveWriteCompanyId()');
    });

    it('useNotifications never scopes the snapshot query to the neutral placeholder', () => {
      const source = src('src/hooks/useNotifications.ts');
      expect(source).not.toMatch(/activeCompanyId && activeCompanyId !== 'all'/);
      expect(source).toContain('resolveWriteCompanyId()');
    });

    it('notifications.ts resolveNotificationCompanyId has no "default" fallback', () => {
      const source = src('src/lib/notifications.ts');
      expect(source).not.toMatch(/\|\| 'default';/);
      expect(source).toContain('resolveWriteCompanyId()');
    });

    it('inventoryMovements never scopes stock-ledger reads to "default"', () => {
      const source = src('src/lib/inventoryMovements.ts');
      expect(source).not.toMatch(/activeCompanyId && activeCompanyId !== 'all'/);
      expect(source).toContain('const companyId = resolveWriteCompanyId();');
    });

    it('WorkspaceDashboard + ProductPicker resolve company canonically', () => {
      expect(src('src/components/shared/WorkspaceDashboard.tsx')).toContain('resolveWriteCompanyId()');
      expect(src('src/components/products/ProductPicker.tsx')).toContain('resolveWriteCompanyId()');
    });

    it('useGlobalSearch never feeds the neutral placeholder into the search engine', () => {
      const source = src('src/features/search/hooks/useGlobalSearch.ts');
      expect(source).not.toMatch(/runGlobalSearch\(debouncedQuery, activeCompanyId\)/);
      expect(source).toContain('resolveWriteCompanyId()');
    });

    it('CaseEngine/TaskEngine/useTasks resolve company canonically (no activeCompanyId branch)', () => {
      expect(src('src/engines/CaseEngine.ts')).toContain('return resolveWriteCompanyId();');
      expect(src('src/engines/TaskEngine.ts')).toContain('return resolveWriteCompanyId();');
      expect(src('src/hooks/useTasks.ts')).toContain('return resolveWriteCompanyId();');
    });

    it('settingsService skips the read and returns defaults when the tenant is unresolved', () => {
      const source = src('src/features/settings/services/settingsService.ts');
      expect(source).toContain("if (scope === 'company' && !resolveScopeId('company'))");
      expect(source).toContain('readSettingsDocOrNull');
      // No garbage doc-id read path remains: the neutral placeholder is gone.
      // (The doc comment may legitimately reference the removed old branch.)
      expect(source).not.toMatch(/companyId = state\.activeCompanyId !== 'all'/);
      expect(source).not.toMatch(/getSettingsDocId\('default'/);
    });

    it('documentNumbering/documentRuntime never fall back to DEFAULT_COMPANY.id', () => {
      expect(src('src/lib/documentNumbering.ts')).toContain('resolveWriteCompanyId() || state.globalCompany?.id || \'\'');
      expect(src('src/features/settings/documentRuntime.ts')).toContain('resolveWriteCompanyId() || state.globalCompany?.id || \'\'');
    });

    it('firestore.ts getAll consumes resolveReadCompanyId (query core)', () => {
      const source = src('src/lib/firestore.ts');
      expect(source).toContain('const companyId = resolveReadCompanyId();');
      expect(source).toContain('const effectiveCompanyId = resolveReadCompanyId();');
    });
  });

  describe('resolveWriteCompanyId', () => {
    it('uses the active selection when it is a real company', () => {
      useAppStore.setState({ activeCompanyId: 'CO-1783978330465-3EV9' });
      expect(resolveWriteCompanyId()).toBe('CO-1783978330465-3EV9');
    });

    it('falls back to the loaded company config when active is neutral', () => {
      useAppStore.setState({ activeCompanyId: 'default', company: { ...useAppStore.getState().company, id: 'CO-1783978330465-3EV9' } });
      expect(resolveWriteCompanyId()).toBe('CO-1783978330465-3EV9');
    });

    it('falls back to the user canonical profile company when nothing else is real', () => {
      useAppStore.setState({
        activeCompanyId: 'default',
        company: { ...useAppStore.getState().company, id: 'default' },
        user: {
          id: 'u1', name: 'U', email: 'u@test.erp', role: 'Sales', companyId: 'CO-1783978330465-3EV9',
        },
      });
      expect(resolveWriteCompanyId()).toBe('CO-1783978330465-3EV9');
    });

    it('never returns the neutral "default" placeholder — returns empty so writes fail closed', () => {
      useAppStore.setState({ activeCompanyId: 'default', company: { ...useAppStore.getState().company, id: 'default' }, user: null });
      expect(resolveWriteCompanyId()).toBe('');
    });
  });

  describe('source contracts — no "default" fallback for authenticated identities', () => {
    it('firestore.ts: createDoc/createDocWithId no longer default companyId to "default"', () => {
      const source = src('src/lib/firestore.ts');
      expect(source).not.toMatch(/company\?\.id \|\| 'default'/);
      expect(source).toContain('resolveWriteCompanyId()');
    });

    it('firestore.ts: companyScopedQuery fails closed on "default" for non-owner identities', () => {
      const source = src('src/lib/firestore.ts');
      expect(source).toMatch(/Tenant context is not resolved/);
      expect(source).toContain("companyId === 'default'");
    });

    it('userIdentity.ts: systemCompanyId can never yield "default" for user creation', () => {
      const source = src('src/lib/userIdentity.ts');
      expect(source).not.toMatch(/\|\| 'default';/);
      expect(source).toContain("(id && id !== 'all' && id !== 'default' ? id : '')");
    });

    it('Login.tsx: no "default" company fallback for an authenticated ERP identity', () => {
      const source = src('src/pages/Login.tsx');
      expect(source).not.toContain("String(match.companyId || 'default')");
    });

    it('settingsService.ts: no "default" fallback for company-scoped settings', () => {
      const source = src('src/features/settings/services/settingsService.ts');
      expect(source).not.toMatch(/state\.company\?\.id \|\| 'default'/);
      expect(source).not.toMatch(/resolveScopeId\(scope\)[\s\S]*\|\| 'default'/);
    });
  });
});
