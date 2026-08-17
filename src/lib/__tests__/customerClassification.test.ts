/**
 * customerClassification.test.ts — Phase 2 (Customer/Lead Classification) foundation.
 *
 * Covers: the pure filter/gate functions, plus source-text wiring checks proving
 * every customer picker/creation-toggle discovered during the Phase 2 audit
 * actually calls them (this codebase's established convention for cross-file
 * wiring checks — see companyBusinessMode.test.ts from Phase 1 for the same pattern).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CUSTOMER_BUSINESS_TYPES,
  filterCustomersForBusinessMode,
  filterCustomersForProjectCreation,
  getAllowedCustomerTypesForBusinessMode,
  isCustomerTypeAllowedForBusinessMode,
  resolveCustomerType,
} from '../customerClassification';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

describe('resolveCustomerType', () => {
  it('returns the real type when set', () => {
    expect(resolveCustomerType({ id: 'C1', type: 'B2B' })).toBe('B2B');
    expect(resolveCustomerType({ id: 'C2', type: 'B2C' })).toBe('B2C');
  });
  it('returns null for missing/garbage type rather than guessing', () => {
    expect(resolveCustomerType({ id: 'C3' })).toBeNull();
    expect(resolveCustomerType({ id: 'C4', type: 'Commercial' })).toBeNull();
    expect(resolveCustomerType(null)).toBeNull();
  });
});

describe('getAllowedCustomerTypesForBusinessMode / isCustomerTypeAllowedForBusinessMode', () => {
  it('B2B mode allows only B2B', () => {
    expect(getAllowedCustomerTypesForBusinessMode('B2B')).toEqual(['B2B']);
    expect(isCustomerTypeAllowedForBusinessMode('B2B', 'B2B')).toBe(true);
    expect(isCustomerTypeAllowedForBusinessMode('B2C', 'B2B')).toBe(false);
  });
  it('B2C mode allows only B2C', () => {
    expect(getAllowedCustomerTypesForBusinessMode('B2C')).toEqual(['B2C']);
    expect(isCustomerTypeAllowedForBusinessMode('B2C', 'B2C')).toBe(true);
    expect(isCustomerTypeAllowedForBusinessMode('B2B', 'B2C')).toBe(false);
  });
  it('Both mode allows either', () => {
    expect(getAllowedCustomerTypesForBusinessMode('Both')).toEqual(['B2B', 'B2C']);
    expect(isCustomerTypeAllowedForBusinessMode('B2B', 'Both')).toBe(true);
    expect(isCustomerTypeAllowedForBusinessMode('B2C', 'Both')).toBe(true);
  });
  it('CUSTOMER_BUSINESS_TYPES enumerates exactly the two real values', () => {
    expect(CUSTOMER_BUSINESS_TYPES).toEqual(['B2B', 'B2C']);
  });
});

describe('filterCustomersForBusinessMode — shared financial/logistics pickers (Orders/Quotations/Payments/Dispatch)', () => {
  const customers = [
    { id: 'B1', type: 'B2B' },
    { id: 'C1', type: 'B2C' },
    { id: 'X1' }, // no type at all — must never leak into any picker
  ];
  it('B2B-mode company: only the B2B customer is selectable', () => {
    expect(filterCustomersForBusinessMode(customers, 'B2B').map((c) => c.id)).toEqual(['B1']);
  });
  it('B2C-mode company: only the B2C customer is selectable', () => {
    expect(filterCustomersForBusinessMode(customers, 'B2C').map((c) => c.id)).toEqual(['C1']);
  });
  it('Both-mode company: both real-typed customers selectable, untyped excluded', () => {
    expect(filterCustomersForBusinessMode(customers, 'Both').map((c) => c.id)).toEqual(['B1', 'C1']);
  });
});

describe('filterCustomersForProjectCreation — B2C-EXCLUSIVE, even in a Both-mode company', () => {
  const customers = [
    { id: 'B1', type: 'B2B' },
    { id: 'C1', type: 'B2C' },
  ];
  it('B2B customer is never selectable for Project creation, in any mode', () => {
    expect(filterCustomersForProjectCreation(customers, 'B2B').map((c) => c.id)).toEqual([]);
    expect(filterCustomersForProjectCreation(customers, 'B2C').map((c) => c.id)).toEqual(['C1']);
    expect(filterCustomersForProjectCreation(customers, 'Both').map((c) => c.id)).toEqual(['C1']);
  });
});

describe('Wiring — every discovered customer picker actually calls the Phase 2 filter, not a hand-rolled equivalent', () => {
  it('Projects.tsx (desktop) and MobileProjectList.tsx use filterCustomersForProjectCreation', () => {
    expect(read('../../pages/Projects.tsx')).toContain('filterCustomersForProjectCreation(customers as any[], businessMode)');
    expect(read('../../components/mobile/projects/MobileProjectList.tsx')).toContain('filterCustomersForProjectCreation(customers as any[], businessMode)');
  });

  it('Orders.tsx and MobileOrderWorkspace.tsx use filterCustomersForBusinessMode', () => {
    expect(read('../../pages/Orders.tsx')).toContain('filterCustomersForBusinessMode(customers as any[], businessMode)');
    expect(read('../../components/mobile/orders/MobileOrderWorkspace.tsx')).toContain('filterCustomersForBusinessMode(customers as any[], businessMode)');
    expect(read('../../components/mobile/orders/MobileOrderWorkspace.tsx')).toContain('customers={orderCustomerOptions}');
  });

  it('MobileQuotationWorkspace.tsx and MobilePaymentWorkspace.tsx use filterCustomersForBusinessMode', () => {
    expect(read('../../components/mobile/quotations/MobileQuotationWorkspace.tsx')).toContain('filterCustomersForBusinessMode(customers as any[], businessMode)');
    expect(read('../../components/mobile/payments/MobilePaymentWorkspace.tsx')).toContain('filterCustomersForBusinessMode(customers as any[], businessMode)');
  });

  it('LeadWorkspaceConversionFlow.tsx (desktop) and MobileLeadWorkspace.tsx gate the B2B/B2C conversion toggle by allowed types, and no longer mislabel B2C as "Residential"', () => {
    const desktop = read('../../features/leads/components/workspace/LeadWorkspaceConversionFlow.tsx');
    expect(desktop).toContain('getAllowedCustomerTypesForBusinessMode(businessMode)');
    expect(desktop).toContain("allowedTypes.includes('B2B')");
    expect(desktop).toContain("allowedTypes.includes('B2C')");
    expect(desktop).not.toContain('B2C — Residential');

    const mobile = read('../../components/mobile/leads/MobileLeadWorkspace.tsx');
    expect(mobile).toContain('getAllowedCustomerTypesForBusinessMode(businessMode)');
    expect(mobile).toContain('allowedConvertTypes.includes(option.value');
  });

  it('CustomerWorkspaceDialogs.tsx (direct-create type chooser) and CustomerWorkspaceEditor.tsx (existing-customer type re-edit) both respect Business Mode', () => {
    const dialogs = read('../../features/customers/components/CustomerWorkspaceDialogs.tsx');
    expect(dialogs).toContain('getAllowedCustomerTypesForBusinessMode(businessMode)');
    expect(dialogs).toContain("allowedTypes.includes('B2B')");
    expect(dialogs).toContain("allowedTypes.includes('B2C')");

    const editor = read('../../features/customers/components/workspace/CustomerWorkspaceEditor.tsx');
    expect(editor).toContain('getAllowedCustomerTypesForBusinessMode(businessMode)');
    expect(editor).toContain('options={allowedTypeOptions}');
  });

  it('leadWorkflow.ts (convertLeadToCustomer) and useCustomers.ts (createCustomerProjection) both carry a service-layer defense-in-depth guard — the true, single enforcement point regardless of which UI called them', () => {
    const leadWorkflow = read('../leadWorkflow.ts');
    expect(leadWorkflow).toContain('isCustomerTypeAllowedForBusinessMode(customerType, businessMode)');
    expect(leadWorkflow).toContain('cannot create ${customerType} customers');

    const useCustomers = read('../../features/customers/hooks/useCustomers.ts');
    expect(useCustomers).toContain('isCustomerTypeAllowedForBusinessMode(requestedType, businessMode)');
  });
});

describe('Canonical Customer interface exists (Phase 2 data-model requirement)', () => {
  it('types/index.ts declares interface Customer with a strict, non-widened type field', () => {
    const types = read('../../types/index.ts');
    expect(types).toContain('export interface Customer extends BaseRecord');
    expect(types).toContain("type: 'B2B' | 'B2C';");
  });
});

describe('Demo Mode — Customer.type schema fixed, count-preserving, non-contradictory', () => {
  it('businessGraph.ts sets the real type field on demo customers instead of the bogus customerType label', () => {
    const graph = read('../../../scripts/demo/datasets/businessGraph.ts');
    expect(graph).toContain("type:'B2C',projectType:i%3?'Residential':'Commercial'");
    expect(graph).not.toContain("customerType:i%3?'Residential':'Commercial'");
  });
});
