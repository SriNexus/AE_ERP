import { describe, expect, it } from 'vitest';
import { resolveActiveRoleDocument } from '../useGlobalBoot';

/**
 * RC-A regression — roleData resolution must stay consistent with canDo() /
 * getModuleVisibility() (both go through the compatibility alias).
 *
 * A user whose role string is a data-driven / legacy name with only an alias
 * and NO exact per-company role document (e.g. "Sales Executive" in a company
 * that only seeded the canonical "Sales" role) previously resolved to
 * roleData=null in useGlobalBoot -> resolveVisibility() (lib/firestore.ts) then
 * fell through to 'self' and hid every lead the viewer did not personally own,
 * even though the aliased role grants 'all'. resolveActiveRoleDocument() tries
 * the exact name first, then the alias — one resolution, shared everywhere.
 */
describe('resolveActiveRoleDocument', () => {
  const roles = [
    { id: 'CO_Sales', name: 'Sales', permissions: { leads: { create: true, visibility: 'all' } } },
    { id: 'CO_Manager', name: 'Manager', permissions: { leads: { create: true, visibility: 'all' } } },
    { id: 'CO_Admin', name: 'Admin', permissions: { leads: { visibility: 'all' } } },
    { id: 'CO_Partner', name: 'Partner', permissions: { leads: { create: true, visibility: 'self' } } },
  ];

  it('exact role-name match wins', () => {
    expect(resolveActiveRoleDocument(roles, 'Sales')?.id).toBe('CO_Sales');
    expect(resolveActiveRoleDocument(roles, 'Manager')?.id).toBe('CO_Manager');
    expect(resolveActiveRoleDocument(roles, 'Partner')?.id).toBe('CO_Partner');
  });

  it('a role with only a compatibility alias resolves to the aliased doc', () => {
    expect(resolveActiveRoleDocument(roles, 'Sales Executive')?.id).toBe('CO_Sales');
    expect(resolveActiveRoleDocument(roles, 'BDM')?.id).toBe('CO_Sales');
    expect(resolveActiveRoleDocument(roles, 'TL')?.id).toBe('CO_Manager');
    // GroupAdmin has no role doc in most companies -> aliases to Admin.
    expect(resolveActiveRoleDocument(roles, 'GroupAdmin')?.id).toBe('CO_Admin');
  });

  it('is case / whitespace insensitive', () => {
    expect(resolveActiveRoleDocument(roles, '  sales executive  ')?.id).toBe('CO_Sales');
  });

  it('returns null for a genuinely unknown role and for an empty role', () => {
    expect(resolveActiveRoleDocument(roles, 'Astronaut')).toBeNull();
    expect(resolveActiveRoleDocument(roles, '')).toBeNull();
    expect(resolveActiveRoleDocument(roles, undefined)).toBeNull();
  });

  it('the alias resolves but the target doc is absent -> null (no crash)', () => {
    expect(resolveActiveRoleDocument([{ id: 'x', name: 'Warehouse' }], 'Sales Executive')).toBeNull();
  });
});
