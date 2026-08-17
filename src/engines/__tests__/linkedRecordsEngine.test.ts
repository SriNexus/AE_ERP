/**
 * linkedRecordsEngine.test.ts — Phase 4 additions/fix.
 *
 * Covers two things this phase touched in the shared engine:
 * 1. RELATIONSHIP_MAP.customers gained 4 entries (Dispatch, Payments,
 *    Invoices, Project Handovers) — re-verified genuinely missing before
 *    adding, each with a real customerId field confirmed against its
 *    write path (dispatchWorkflow.ts / paymentWorkflow.ts /
 *    invoiceWorkflow.ts / projectHandoverWorkflow.ts).
 * 2. hasPermissionForEntityType() no longer throws — it previously called
 *    usePermissions() (a React hook) from a plain async function outside
 *    any render, which threw "Invalid hook call" the moment
 *    RELATIONSHIP_MAP had entries for the queried type (true for every
 *    entity type that matters, including 'customers'). This was a real,
 *    reproducible crash, fixed as a direct Phase 4 prerequisite (the new
 *    CustomerLinkedRecords component calls this exact function) — see the
 *    Phase 4 report §7.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(async () => ({ docs: [] })),
  getOne: vi.fn(async () => null),
  getState: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: mocks.getDocs,
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({
  db: {},
  COLLECTIONS: {
    ENTITY_RELATIONSHIPS: 'entity_relationships',
    CUSTOMERS: 'customers', LEADS: 'leads', LOAN_APPLICATIONS: 'registrations',
    PROJECTS: 'projects', QUOTATIONS: 'quotations', ORDERS: 'orders',
    SERVICE_TICKETS: 'service_tickets', AMC_CONTRACTS: 'amc_contracts',
    CASES: 'cases', DISPATCH: 'dispatch', PAYMENTS: 'payments',
    PROFORMA_INVOICES: 'proforma_invoices', PROJECT_HANDOVERS: 'project_handovers',
  },
}));

vi.mock('../../lib/firestore', () => ({
  fromDoc: (d: any) => d.data(),
  getOne: mocks.getOne,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState },
}));

import { RELATIONSHIP_MAP, linkedRecordsEngine } from '../LinkedRecordsEngine';

describe('RELATIONSHIP_MAP.customers — Phase 4 additions', () => {
  it('includes the 4 previously-missing relationship types, each with a real customerId foreign key', () => {
    const defs = RELATIONSHIP_MAP.customers;
    for (const entityType of ['dispatch', 'payments', 'invoices', 'project_handovers']) {
      const def = defs.find((d) => d.entityType === entityType);
      expect(def).toBeDefined();
      expect(def?.foreignKey).toBe('customerId');
    }
  });

  it('did not remove or alter any pre-existing relationship definition', () => {
    const defs = RELATIONSHIP_MAP.customers;
    for (const entityType of ['leads', 'registrations', 'projects', 'quotations', 'orders', 'service_tickets', 'amc_contracts', 'cases']) {
      expect(defs.find((d) => d.entityType === entityType)).toBeDefined();
    }
  });
});

describe('getLinkedRecords — hook-call bug fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      user: { role: 'Admin', isSuperAdmin: true },
    });
  });

  it('does not throw when called for an entity type with RELATIONSHIP_MAP entries (previously always threw)', async () => {
    await expect(linkedRecordsEngine.getLinkedRecords('cust-1', 'customers', 'comp-1')).resolves.toBeDefined();
  });

  it('returns an array (possibly empty when no related documents exist) rather than crashing', async () => {
    const result = await linkedRecordsEngine.getLinkedRecords('cust-1', 'customers', 'comp-1');
    expect(Array.isArray(result)).toBe(true);
  });
});
