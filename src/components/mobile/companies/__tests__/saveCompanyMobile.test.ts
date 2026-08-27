/**
 * DI-01 (Phase 8, Master Plan "GroupAdmin / Company Workflow Hardening —
 * Mobile/Desktop Parity") — regression tests for saveCompanyMobile(), the
 * extracted routing decision behind MobileCompaniesWorkspace's save
 * mutation. Follows the exact mocked-Firestore convention already
 * established for this class of authorization-routing logic
 * (phase5GroupAdmin.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCompanyInGroup: vi.fn(),
  updateCompanyInGroup: vi.fn(),
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  deleteDocById: vi.fn(),
  getAll: vi.fn(),
  fmtDate: vi.fn(),
  genId: { generic: vi.fn(() => 'CO-TEST-1') },
}));

vi.mock('../../../../lib/groupAdmin', () => ({
  createCompanyInGroup: mocks.createCompanyInGroup,
  updateCompanyInGroup: mocks.updateCompanyInGroup,
}));

vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  deleteDocById: mocks.deleteDocById,
  getAll: mocks.getAll,
  fmtDate: mocks.fmtDate,
  genId: mocks.genId,
}));

import { saveCompanyMobile } from '../MobileCompaniesWorkspace';

describe('saveCompanyMobile (DI-01, mobile/desktop parity)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a GroupAdmin creating a new Company routes through createCompanyInGroup (group-scoped, groupId correctly stamped by the callee)', async () => {
    await saveCompanyMobile({ name: 'Acme Co' }, null, { id: 'MUSR-GA-A', role: 'GroupAdmin' });
    expect(mocks.createCompanyInGroup).toHaveBeenCalledWith({ name: 'Acme Co' });
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('a GroupAdmin creating a new Company with a forged groupId in the payload still routes through createCompanyInGroup — the actor authoritative groupId wins inside that function, never a client-supplied one', async () => {
    await saveCompanyMobile({ name: 'Acme Co', groupId: 'FORGED-GROUP' }, null, { id: 'MUSR-GA-A', role: 'GroupAdmin' });
    // createCompanyInGroup itself (already tested in phase5GroupAdmin.test.ts)
    // ignores any groupId field on the payload and stamps its own — this test
    // proves the ROUTING never bypasses that protection by taking the
    // generic path instead, which would have trusted/stripped it differently.
    expect(mocks.createCompanyInGroup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Co' }));
    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('a GroupAdmin editing an existing Company routes through updateCompanyInGroup', async () => {
    await saveCompanyMobile({ name: 'Renamed Co' }, 'CO-EXISTING-1', { id: 'MUSR-GA-A', role: 'GroupAdmin' });
    expect(mocks.updateCompanyInGroup).toHaveBeenCalledWith('CO-EXISTING-1', { name: 'Renamed Co' });
    expect(mocks.updateDocById).not.toHaveBeenCalled();
  });

  it('a non-GroupAdmin (e.g. Owner/Super Admin) Company creation is unaffected — regression: still uses the existing generic path', async () => {
    await saveCompanyMobile({ name: 'Platform Co' }, null, { id: 'owner-1', role: 'Admin' });
    expect(mocks.createDocWithId).toHaveBeenCalledWith('companies', 'CO-TEST-1', { name: 'Platform Co', id: 'CO-TEST-1', createdBy: 'owner-1' });
    expect(mocks.createCompanyInGroup).not.toHaveBeenCalled();
  });

  it('a non-GroupAdmin Company edit is unaffected — regression: still uses the existing generic path', async () => {
    await saveCompanyMobile({ name: 'Renamed Platform Co' }, 'CO-EXISTING-2', { id: 'owner-1', role: 'Admin' });
    expect(mocks.updateDocById).toHaveBeenCalledWith('companies', 'CO-EXISTING-2', { name: 'Renamed Platform Co' });
    expect(mocks.updateCompanyInGroup).not.toHaveBeenCalled();
  });

  it('no signed-in user (defensive edge case) falls through to the generic path rather than throwing', async () => {
    await saveCompanyMobile({ name: 'No User Co' }, null, null);
    expect(mocks.createDocWithId).toHaveBeenCalledWith('companies', 'CO-TEST-1', { name: 'No User Co', id: 'CO-TEST-1', createdBy: undefined });
    expect(mocks.createCompanyInGroup).not.toHaveBeenCalled();
  });
});
