/**
 * casePropagationPhase11.test.ts — Phase 11 coverage.
 *
 * net_metering_applications and subsidy_applications' PARENT_CHAIN entries
 * previously pointed at commissioning_records/net_metering_applications via
 * commissioningId/netMeteringId FK fields that neither
 * createNetMeteringApplication() nor createSubsidyApplication() (nor their
 * TypeScript interfaces) ever declare or write — so caseId propagation for
 * both was permanently broken, the same bug family Phase 10 fixed for
 * qc_checks/installations. Fixed by chaining both directly to the Project
 * via projectId, which both records always have.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOne: vi.fn(),
  updateDocById: vi.fn(),
}));

vi.mock('../firestore', () => ({
  getOne: mocks.getOne,
  updateDocById: mocks.updateDocById,
}));

vi.mock('../firebase', () => ({
  COLLECTIONS: {
    LEADS: 'leads',
    CUSTOMERS: 'customers',
    PROJECTS: 'projects',
    SURVEYS: 'surveys',
    ENGINEERING_DESIGNS: 'engineering_designs',
    QUOTATIONS: 'quotations',
    ORDERS: 'orders',
    PROFORMA_INVOICES: 'proforma_invoices',
    PAYMENTS: 'payments',
    DISPATCH: 'dispatch',
    QC_CHECKS: 'qc_checks',
    COMMISSIONING_RECORDS: 'commissioning_records',
    NET_METERING_APPLICATIONS: 'net_metering_applications',
    SUBSIDY_APPLICATIONS: 'subsidy_applications',
    PROJECT_HANDOVERS: 'project_handovers',
    AMC_CONTRACTS: 'amc_contracts',
    SERVICE_TICKETS: 'service_tickets',
    GENERATION_READINGS: 'generation_readings',
    PURCHASE_ORDERS: 'purchase_orders',
    GOODS_RECEIPTS: 'goods_receipts',
    TAX_INVOICES: 'tax_invoices',
    INSTALLATIONS: 'installations',
    LOAN_APPLICATIONS: 'registrations',
  },
}));

vi.mock('../../engines/CaseEngine', () => ({
  caseEngine: {},
}));

import { propagateCaseIdFromChain } from '../casePropagation';

describe('propagateCaseIdFromChain — net_metering_applications / subsidy_applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDocById.mockResolvedValue(undefined);
  });

  it('resolves NetMetering caseId via the Project (projectId), not a nonexistent commissioningId field', async () => {
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'net_metering_applications') return { id, projectId: 'PRJ-1' };
      if (collection === 'projects') return { id: 'PRJ-1', caseId: 'CASE-1' };
      return null;
    });

    const result = await propagateCaseIdFromChain('net_metering_applications', 'NET-1');

    expect(result).toBe('CASE-1');
    expect(mocks.updateDocById).toHaveBeenCalledWith('net_metering_applications', 'NET-1', { caseId: 'CASE-1' });
  });

  it('resolves Subsidy caseId via the Project (projectId), not a nonexistent netMeteringId field', async () => {
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'subsidy_applications') return { id, projectId: 'PRJ-2' };
      if (collection === 'projects') return { id: 'PRJ-2', caseId: 'CASE-2' };
      return null;
    });

    const result = await propagateCaseIdFromChain('subsidy_applications', 'SUB-1');

    expect(result).toBe('CASE-2');
    expect(mocks.updateDocById).toHaveBeenCalledWith('subsidy_applications', 'SUB-1', { caseId: 'CASE-2' });
  });

  it('returns null (never throws) when the Project itself has no caseId yet', async () => {
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'subsidy_applications') return { id, projectId: 'PRJ-4' };
      if (collection === 'projects') return { id: 'PRJ-4' }; // no caseId
      return null;
    });

    const result = await propagateCaseIdFromChain('subsidy_applications', 'SUB-2');

    expect(result).toBeNull();
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });
});

describe('Phase 16: propagateCaseIdFromChain — registrations', () => {
  // registrationWorkflow.ts's onRegistrationStatusChange() has always called
  // propagateCaseIdFromChain('registrations', registrationId) on approval,
  // but 'registrations' was never a key in PARENT_CHAIN/COLLECTION_MAP — the
  // lookup silently returned null every time (entityType is a plain
  // `string`, so nothing ever caught this at compile time), meaning
  // Registration's caseId was never actually populated in production.
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDocById.mockResolvedValue(undefined);
  });

  it('resolves Registration caseId via its Customer (customerId)', async () => {
    mocks.getOne.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'registrations') return { id, customerId: 'CUS-1' };
      if (collection === 'customers') return { id: 'CUS-1', caseId: 'CASE-9' };
      return null;
    });

    const result = await propagateCaseIdFromChain('registrations', 'REG-1');

    expect(result).toBe('CASE-9');
    expect(mocks.updateDocById).toHaveBeenCalledWith('registrations', 'REG-1', { caseId: 'CASE-9' });
  });
});
