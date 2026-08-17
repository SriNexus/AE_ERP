/**
 * dispatchPriceVisibility.test.ts — Phase 9 wiring check.
 *
 * Source-text analysis, matching this repo's established convention (no
 * @testing-library/react in this repository).
 *
 * The Blueprint's Phase 9 objective: the user physically verifying/loading
 * a dispatch (Warehouse role) must not see its selling price. The
 * verification editor — formerly the DispatchManagementModal popup
 * (DispatchWorkspaceParts.tsx, retired by the Dispatch Workspace Migration),
 * now the embedded Verify & Execute section in the Project Workspace's
 * Dispatch stage (ProjectDispatchWorkspace.tsx) — never renders prices, and
 * DispatchDetail.tsx's "Material Value" field and DispatchWorkspace.tsx's
 * "DISPATCH VALUE" KPI tile are both gated on the (pre-existing, previously
 * entirely unused) view_pricing permission.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

const dispatchDetail = read('../DispatchDetail.tsx');
const dispatchWorkspace = read('../DispatchWorkspace.tsx');
const dispatchStageWorkspace = read('../../features/projects/components/workspace/stages/ProjectDispatchWorkspace.tsx');

describe('Dispatch price visibility — gated on view_pricing, not just view', () => {
  it('DispatchDetail.tsx only renders Material Value when the user can view Dispatch pricing', () => {
    expect(dispatchDetail).toContain("canViewPricing = perms.canViewPricing('dispatch')");
    expect(dispatchDetail).toMatch(/canViewPricing && <OverviewField label="Material Value"/);
  });

  it('DispatchWorkspace.tsx only includes the DISPATCH VALUE KPI tile when the user can view Dispatch pricing', () => {
    expect(dispatchWorkspace).toContain("perms.canViewPricing('dispatch')");
    expect(dispatchWorkspace).toMatch(/perms\.canViewPricing\('dispatch'\)\s*\n?\s*\?\s*\[\{ label: 'DISPATCH VALUE'/);
  });

  it('the warehouse verification workspace itself never renders price/currency fields (the retired popup\'s rule carried into the embedded Dispatch stage workspace)', () => {
    expect(dispatchStageWorkspace).not.toMatch(/fmtCurrency|item\.price|currencySymbol/i);
  });
});
