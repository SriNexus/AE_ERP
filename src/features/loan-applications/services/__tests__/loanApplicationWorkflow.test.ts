import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDocWithId: vi.fn(),
  updateDocById: vi.fn(),
  getOne: vi.fn(),
  getAll: vi.fn(),
  genId: {
    registration: vi.fn(() => 'REG-001'),
    generic: vi.fn((prefix: string) => `${prefix}-001`),
    payment: vi.fn(() => 'PAY-001'),
  },
  createTask: vi.fn(),
  completeTask: vi.fn(),
  getTasksForEntity: vi.fn(() => Promise.resolve([])),
  sendNotification: vi.fn(),
  notifyRoleUsers: vi.fn(),
  logUpdate: vi.fn(),
  logActivity: vi.fn(),
  createProject: vi.fn(),
  propagateCaseIdFromChain: vi.fn(),
  getState: vi.fn(),
  canDo: vi.fn(() => true),
}));

vi.mock('../../../../lib/firestore', () => ({
  createDocWithId: mocks.createDocWithId,
  updateDocById: mocks.updateDocById,
  getOne: mocks.getOne,
  getAll: mocks.getAll,
  genId: mocks.genId,
  resolveWriteCompanyId: () => {
    const s = mocks.getState();
    return s.activeCompanyId || s.company?.id || s.user?.companyId || '';
  },
}));

vi.mock('../../../../lib/firebase', () => ({
  COLLECTIONS: {
    LOAN_APPLICATIONS: 'registrations',
    PAYMENTS: 'payments',
    PROJECTS: 'projects',
    CUSTOMERS: 'customers',
  },
}));

vi.mock('../../../../engines/TaskEngine', () => ({
  taskEngine: {
    createTask: mocks.createTask,
    completeTask: mocks.completeTask,
    getTasksForEntity: mocks.getTasksForEntity,
  },
}));

vi.mock('../../../../lib/notifications', () => ({
  sendNotification: mocks.sendNotification,
  notifyRoleUsers: mocks.notifyRoleUsers,
}));

vi.mock('../../../../lib/auditLogger', () => ({
  logUpdate: mocks.logUpdate,
}));

vi.mock('../../../../lib/workflow', () => ({
  logActivity: mocks.logActivity,
}));

vi.mock('../../../../lib/projectWorkflow', () => ({
  createProject: mocks.createProject,
}));

vi.mock('../../../../lib/casePropagation', () => ({
  propagateCaseIdFromChain: mocks.propagateCaseIdFromChain,
}));

vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: { getState: mocks.getState },
}));

vi.mock('../../../../lib/permissions', () => ({
  canDo: mocks.canDo,
}));

import { createLoanApplication, createProjectFromLoanApplication } from '../loanApplicationWorkflow';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createLoanApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      user: { id: 'user-1', name: 'Test User', companyId: 'comp-1' },
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
    });
    // onLoanApplicationStatusChange (fired internally, fire-and-forget) reads
    // the just-created loan application back before it can proceed.
    mocks.getOne.mockResolvedValue({
      id: 'REG-001', registrationId: 'REG-001', status: 'Draft',
      customerId: 'C-1', customerName: 'Customer A', isDeleted: false,
    });
  });

  it('writes the loan application document with a generated id, creator, and a Creation log entry', async () => {
    const result = await createLoanApplication({
      form: { customerId: 'C-1', customerName: 'Customer A', customerPhone: '9999999999', status: 'Draft' },
      createdById: 'user-1',
      createdByName: 'Test User',
    });

    expect(mocks.createDocWithId).toHaveBeenCalledWith(
      'registrations',
      'REG-001',
      expect.objectContaining({
        id: 'REG-001',
        registrationId: 'REG-001',
        customerId: 'C-1',
        customerName: 'Customer A',
        createdBy: 'user-1',
        isDeleted: false,
        activityLog: [expect.objectContaining({ type: 'Creation', desc: 'Loan application created', userName: 'Test User' })],
      }),
    );
    expect(result).toMatchObject({ id: 'REG-001', registrationId: 'REG-001' });
  });

  it('defaults the post-create status workflow to Draft when the form has no status', async () => {
    await createLoanApplication({
      form: { customerId: 'C-1', customerName: 'Customer A' },
      createdById: 'user-1',
      createdByName: 'Test User',
    });
    await flush();

    // onLoanApplicationStatusChange('REG-001', '', 'Draft') reads the record back
    // and, for Draft, auto-creates the "Process loan application documents" task —
    // observing that task confirms the default status actually reached it.
    expect(mocks.getOne).toHaveBeenCalledWith('registrations', 'REG-001');
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Process loan application documents', linkedEntityId: 'REG-001' }),
    );
  });

  it('does not double-fire the status workflow — createLoanApplication triggers it exactly once', async () => {
    await createLoanApplication({
      form: { customerId: 'C-1', customerName: 'Customer A', status: 'Draft' },
      createdById: 'user-1',
      createdByName: 'Test User',
    });
    await flush();

    // Phase 16: one getOne call is the pre-existing status-workflow read;
    // the other is the new B2B-guard customer lookup (see the dedicated
    // describe block below) — both real, both expected, not a double-fire
    // of the status workflow itself (still asserted via createTask below).
    expect(mocks.getOne).toHaveBeenCalledTimes(2);
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });
});

describe('createLoanApplication — B2B guard (Phase 16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      user: { id: 'user-1', name: 'Test User', companyId: 'comp-1' },
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
    });
  });

  // Mirrors projectWorkflow.ts's createProject() defense-in-depth guard
  // (Phase 4) — Loan Application is a B2C-only pre-Project financing module;
  // the B2C customer workspace used to surface "Start Loan Application" in its
  // center panel (that section now offers only Project), but UI placement
  // alone never stopped a direct/future call site from creating one for a
  // B2B customer, since createLoanApplication() itself never checked.
  it('rejects creating a Loan Application for a B2B customer', async () => {
    mocks.getOne.mockResolvedValue({ id: 'C-2', type: 'B2B', name: 'Demo Distributor' });

    await expect(
      createLoanApplication({
        form: { customerId: 'C-2', customerName: 'Demo Distributor', status: 'Draft' },
        createdById: 'user-1',
        createdByName: 'Test User',
      }),
    ).rejects.toThrow(/B2B customers cannot have a Loan Application/);

    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });

  it('allows creating a Loan Application for a B2C customer', async () => {
    mocks.getOne.mockResolvedValue({ id: 'C-1', type: 'B2C', name: 'Demo Residence' });

    await expect(
      createLoanApplication({
        form: { customerId: 'C-1', customerName: 'Demo Residence', status: 'Draft' },
        createdById: 'user-1',
        createdByName: 'Test User',
      }),
    ).resolves.toMatchObject({ id: 'REG-001' });

    expect(mocks.createDocWithId).toHaveBeenCalled();
  });

  it('rejects creation for a role with no create permission on loan_applications — RBAC is enforced at the service layer, not only via UI gating', async () => {
    mocks.canDo.mockReturnValueOnce(false);
    mocks.getOne.mockResolvedValue({ id: 'C-1', type: 'B2C', name: 'Demo Residence' });

    await expect(
      createLoanApplication({
        form: { customerId: 'C-1', customerName: 'Demo Residence', status: 'Draft' },
        createdById: 'user-1',
        createdByName: 'Test User',
      }),
    ).rejects.toThrow('permission');

    expect(mocks.createDocWithId).not.toHaveBeenCalled();
  });
});

describe('createProjectFromLoanApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockReturnValue({
      user: { id: 'user-1', name: 'Test User', companyId: 'comp-1' },
      activeCompanyId: 'comp-1',
      company: { id: 'comp-1' },
    });
    mocks.getOne.mockResolvedValue({
      id: 'REG-001', registrationId: 'REG-001', status: 'Payment Received',
      customerId: 'C-1', customerName: 'Customer A', customerAddress: 'Plot 1, Demo Colony', isDeleted: false,
    });
    mocks.getAll.mockResolvedValue([]);
    mocks.createProject.mockResolvedValue({ id: 'PRJ-001', projectId: 'PRJ-001' });
  });

  // Phase 4: Project Type is mandatory and was previously hardcoded to '' on
  // this path, silently discarding whatever the caller's form actually
  // collected — this is the regression test for that fix.
  it('forwards the caller-supplied projectType through to createProject() instead of hardcoding it empty', async () => {
    await createProjectFromLoanApplication('REG-001', 6, 'Residential', 'Plot 1, Demo Colony');

    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'C-1', projectType: 'Residential' }),
      expect.objectContaining({ customerName: 'Customer A' }),
    );
  });

  it('falls back to the loan application customerAddress when no siteAddressInput is supplied', async () => {
    await createProjectFromLoanApplication('REG-001', 6, 'Commercial');

    expect(mocks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectType: 'Commercial', siteAddress: expect.objectContaining({ line1: expect.stringContaining('Plot 1') }) }),
      expect.anything(),
    );
  });
});
