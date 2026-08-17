/**
 * usersWarehouseField.test.ts — Phase 12 wiring check.
 *
 * Source-text analysis, matching this repo's established convention (no
 * @testing-library/react in this repository).
 *
 * Users.tsx already tracked form.warehouseId in state (FORM0, openEdit) and
 * already sent it on save — but no <Select> control ever existed for it, so
 * a user could never actually assign a warehouse through this page at all.
 * This guards against that control silently disappearing again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const usersPage = readFileSync(resolve(__dirname, '../Users.tsx'), 'utf-8');

describe('Users.tsx — Warehouse assignment is actually editable', () => {
  it('renders a Warehouse select bound to form.warehouseId', () => {
    expect(usersPage).toMatch(/label="Warehouse"[\s\S]{0,40}value=\{form\.warehouseId\}/);
    expect(usersPage).toContain('warehouseId: e.target.value');
  });

  it('sources its options from a real useWarehouses() query, not a hardcoded list', () => {
    expect(usersPage).toContain("import { useWarehouses } from '../features/warehouses/hooks/useWarehouses'");
    expect(usersPage).toContain('useWarehouses()');
  });
});
