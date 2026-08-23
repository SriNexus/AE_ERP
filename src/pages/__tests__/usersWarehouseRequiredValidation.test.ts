/**
 * usersWarehouseRequiredValidation.test.ts — RBAC regression fix
 * (live-verified, 2026-08-23).
 *
 * ROOT CAUSE: nothing in the Add/Edit User form stopped an admin from
 * assigning a warehouse-restricted role (Warehouse/Operations,
 * isWarehouseRestrictedRole() — firestore.ts §8.1) without also setting a
 * warehouse. The save succeeded silently — the account persisted with
 * role: 'Operations' and no warehouseId — and the actual failure only
 * surfaced later, as an unexplained "Missing or insufficient permissions"
 * the moment that user tried to perform real warehouse work (stock
 * in/out, dispatch, goods receipts), with nothing in the UI connecting
 * that error back to the missing warehouse assignment. Live-reproduced
 * against a real account (role: Operations, warehouse: "No warehouse
 * assigned") before being fixed.
 *
 * FIX: handleSubmit now blocks the save with a clear, specific error
 * message when the selected role is warehouse-restricted and no warehouse
 * is selected — reusing the existing, canonical isWarehouseRestrictedRole()
 * helper (not a new, duplicate role-matching pattern).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

const source = readFileSync(new URL('../Users.tsx', import.meta.url), 'utf-8');

describe('Users.tsx blocks saving a warehouse-restricted role with no warehouse assigned', () => {
  it('imports the canonical isWarehouseRestrictedRole() helper rather than a duplicate role-matching pattern', () => {
    expect(source).toContain("import { getAll, getAllPlatform, getOne, fmtDate, isWarehouseRestrictedRole } from '../lib/firestore';");
  });

  it('handleSubmit checks isWarehouseRestrictedRole(form.role) && !form.warehouseId before calling save.mutate', () => {
    const fnStart = source.indexOf('function handleSubmit(e: FormEvent)');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBlock = source.slice(fnStart, source.indexOf('save.mutate(form);', fnStart) + 30);
    expect(fnBlock).toContain('if (isWarehouseRestrictedRole(form.role) && !form.warehouseId) {');
    expect(fnBlock).toContain('return toast.error(');
    // The check must run BEFORE save.mutate, not after (or it's dead code).
    const guardIdx = fnBlock.indexOf('isWarehouseRestrictedRole(form.role)');
    const saveIdx = fnBlock.indexOf('save.mutate(form);');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(guardIdx);
  });

  it('the Warehouse <Select> field exists in the form (the guard has an actual field to require)', () => {
    expect(source).toContain('<InputSelect label="Warehouse" value={form.warehouseId}');
  });
});
