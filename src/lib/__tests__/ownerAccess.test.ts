import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOwnerAppIdentity, filterManageableUsers, isHiddenOwnerRecord, isOwnerEmail } from '../ownerAccess';

describe('hidden ERP owner policy', () => {
  it('normalizes the Firebase identity without storing a password', () => {
    expect(isOwnerEmail('  SHREENIWAS.TRIPATHI0@GMAIL.COM ')).toBe(true);
    expect(isOwnerEmail('admin@example.com')).toBe(false);
    // The Owner's own ProfileSection reads this identity through
    // normalizeUserProfile(), which requires a non-empty email — so the
    // synthetic identity must carry the real authenticated email, normalized.
    expect(createOwnerAppIdentity('firebase-owner', ' Shreeniwas.Tripathi0@Gmail.com ').email).toBe('shreeniwas.tripathi0@gmail.com');
    expect(readFileSync('src/lib/ownerAccess.ts', 'utf8').toLowerCase()).not.toContain('password');
  });

  it('excludes only the owner from manageable user records', () => {
    const normal = { id: 'normal', email: 'admin@example.com' };
    const owner = { id: 'legacy-owner', email: 'shreeniwas.tripathi0@gmail.com' };
    expect(isHiddenOwnerRecord(owner)).toBe(true);
    expect(filterManageableUsers([normal, owner])).toEqual([normal]);
  });

  it('gates AI navigation and its direct route with the centralized owner policy', () => {
    const nav = readFileSync('src/components/layout/navigationConfig.tsx', 'utf8');
    const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
    const routes = readFileSync('src/app/router/routes.tsx', 'utf8');
    expect(nav).toMatch(/AI Intelligence.*ownerOnly: true/);
    expect(sidebar).toContain('item.ownerOnly && !hasOwnerAccess');
    // /ai-intelligence is guarded by SuperAdminRoute. Self-validate that the
    // route's guard is the SAME centralized owner policy as OwnerRoute: both
    // hooks call isOwnerFirebaseUser, so the route stays owner-only even
    // though the wrapper component name differs.
    expect(routes).toContain('<SuperAdminRoute><SafePage><AiIntelligence /></SafePage></SuperAdminRoute>');
    const superAdminRoute = readFileSync('src/components/auth/SuperAdminRoute.tsx', 'utf8');
    expect(superAdminRoute).toContain('isOwnerFirebaseUser');
  });

  it('filters normal user consumers and grants the Firebase owner through rules', () => {
    const firestore = readFileSync('src/lib/firestore.ts', 'utf8');
    const taskSelector = readFileSync('src/components/tasks/CreateTaskModal.tsx', 'utf8');
    const notifications = readFileSync('src/lib/notifications.ts', 'utf8');
    const roundRobin = readFileSync('src/lib/roundRobin.ts', 'utf8');
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(firestore).toContain('docs = filterManageableUsers(docs)');
    expect(taskSelector).toContain('filterManageableUsers');
    expect(notifications).toContain('!isHiddenOwnerRecord(user)');
    expect(roundRobin).toContain('!isHiddenOwnerRecord(user)');
    expect(rules).toContain('function isOwnerIdentity()');
  });
});