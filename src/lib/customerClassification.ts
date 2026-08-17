/**
 * Customer/Lead Business Classification Enforcement — Phase 2 foundation.
 *
 * The single, reusable place every customer picker/query/creation-toggle in the
 * ERP goes through to decide "which customer type(s) are selectable here."
 * Replaces ad-hoc, unfiltered `customers.map(...)` picker construction that
 * previously let a B2B (material-distribution) customer appear in a B2C
 * (installation) picker, and vice versa — the exact contamination the Gap
 * Audit's §8 flagged as CRITICAL.
 *
 * Two independent axes, never conflated (Blueprint §4 rule 3):
 *   - Customer.type       : 'B2B' | 'B2C'                         (this file)
 *   - Company.businessMode: 'B2B' | 'B2C' | 'Both'                (lib/companyBusinessMode.ts)
 *   - Project.projectType : 'Residential' | 'Commercial' | 'Industrial' (Phase 4 — a Project concept, never a Customer concept)
 */
import type { CompanyBusinessMode } from './companyBusinessMode';

export type CustomerBusinessType = 'B2B' | 'B2C';

export const CUSTOMER_BUSINESS_TYPES: CustomerBusinessType[] = ['B2B', 'B2C'];

/** Minimal shape every picker/filter helper below needs — real Customer records satisfy this. */
export interface ClassifiableCustomer {
  id: string;
  type?: string;
}

/** Normalizes a possibly-missing/garbage `type` value. Existing Customer docs always have a real value
 * (Audit §2/§8: set once, reliably, by convertLeadToCustomer) — this only guards against defensive/test data. */
export function resolveCustomerType(customer: ClassifiableCustomer | null | undefined): CustomerBusinessType | null {
  return customer?.type === 'B2B' || customer?.type === 'B2C' ? customer.type : null;
}

/** Which customer type(s) a company in the given business mode may create/select. */
export function getAllowedCustomerTypesForBusinessMode(mode: CompanyBusinessMode): CustomerBusinessType[] {
  if (mode === 'B2B') return ['B2B'];
  if (mode === 'B2C') return ['B2C'];
  return ['B2B', 'B2C'];
}

/** Whether a specific customer type may be created/selected under the company's active business mode. */
export function isCustomerTypeAllowedForBusinessMode(type: CustomerBusinessType, mode: CompanyBusinessMode): boolean {
  return getAllowedCustomerTypesForBusinessMode(mode).includes(type);
}

/**
 * Shared financial/logistics pickers (Orders, Quotations, Payments, Dispatch) — both B2B and
 * B2C customers are legitimate here in a 'Both' company; only the company's business mode
 * excludes an entirely-wrong-mode customer. Does NOT restrict to a single fixed type.
 */
export function filterCustomersForBusinessMode<T extends ClassifiableCustomer>(customers: T[], mode: CompanyBusinessMode): T[] {
  const allowed = getAllowedCustomerTypesForBusinessMode(mode);
  return customers.filter((customer) => {
    const type = resolveCustomerType(customer);
    return type !== null && allowed.includes(type);
  });
}

/**
 * B2C-EXCLUSIVE pickers (Project creation only, per Blueprint §7: "Project creation
 * customer picker MUST exclude customer.type==='B2B'"). Always excludes B2B, even in a
 * 'Both' company where B2B customers otherwise legitimately exist — this is the one
 * absolute, non-negotiable exclusion in the whole classification model.
 */
export function filterCustomersForProjectCreation<T extends ClassifiableCustomer>(customers: T[], mode: CompanyBusinessMode): T[] {
  return filterCustomersForBusinessMode(customers, mode).filter((customer) => resolveCustomerType(customer) === 'B2C');
}
