import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Desktop/Mobile navigation must resolve the exact same authorization
 * result for the same user (ownerOnly, permission cache readiness,
 * business-mode). Prior to this fix, ModuleNavDrawer (mobile) filtered
 * only by module + business mode — omitting the ownerOnly check that
 * Sidebar.tsx (desktop) applies — so Platform, Group Administration,
 * Audit Logs, and AI Intelligence leaked into the mobile drawer for every
 * role.
 *
 * Demo-to-Group conversion (docs/reports/NEOZY_DEMO_GROUP_CONVERSION_REPORT.md):
 * the demo-hidden-module gate this test used to assert on both files was
 * removed from both — Neozy Demo's own role/permission resolution now
 * governs its nav visibility the same way any other Group's does, so
 * there is no longer a separate demo-specific gate for desktop and mobile
 * to stay consistent on.
 */
describe('desktop/mobile navigation permission parity', () => {
  it('applies the same ownerOnly gate as the desktop sidebar, with no demo-specific nav filtering left in either tree', () => {
    const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
    const drawer = readFileSync('src/components/mobile/shell/ModuleNavDrawer.tsx', 'utf8');

    // Both consume the same owner-access primitive.
    expect(sidebar).toContain('item.ownerOnly && !hasOwnerAccess');
    expect(drawer).toContain('item.ownerOnly && !hasOwnerAccess');
    expect(sidebar).toContain('c.ownerOnly && !hasOwnerAccess');
    expect(drawer).toContain('c.ownerOnly && !hasOwnerAccess');

    // Neither tree special-cases demo for nav visibility anymore.
    expect(sidebar).not.toContain('isDemoHiddenModule');
    expect(drawer).not.toContain('isDemoHiddenModule');
    expect(sidebar).not.toContain('isDemoUser');
    expect(drawer).not.toContain('isDemoUser');

    // Both gate on the cache-aware usePermissions().canView, not a raw
    // canDo call that can pass before the permission cache is ready.
    expect(sidebar).toContain('perms.canView(item.module)');
    expect(drawer).toContain('perms.canView(item.module)');
    expect(sidebar).toContain('perms.canView(c.module)');
    expect(drawer).toContain('perms.canView(c.module)');
  });

  it('gates the mobile Audit Logs route the same way as the desktop route', () => {
    const routes = readFileSync('src/app/router/routes.tsx', 'utf8');
    const mobileRoutes = readFileSync('src/components/mobile/routing/MobileRoutes.tsx', 'utf8');

    expect(routes).toContain('<Route path="/audit-logs" element={<SuperAdminRoute><SafePage><AuditLogs /></SafePage></SuperAdminRoute>} />');
    expect(mobileRoutes).toContain('<SuperAdminRoute><MobileAuditWorkspace /></SuperAdminRoute>');
  });
});
