/**
 * Tests for the interactive tutorial system:
 *  - definition integrity (ids, step shape, terminal complete step)
 *  - every `target` identifier actually exists in the real source files
 *    (broken tutorials are caught at test time, not in production)
 *  - progress persistence semantics (started / in-progress / completed / reset)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TUTORIALS, getTutorialById } from '../tutorials';
import { useTutorialProgress, getTutorialProgress, progressPercent } from '../progress';

const INTERACTIVE_TYPES = ['click', 'input', 'select'];

describe('tutorial definitions', () => {
  it('has tutorials across all categories (Sales, Operations, Finance, HR)', () => {
    const ids = TUTORIALS.map((t) => t.id);
    // Sales (pilot)
    expect(ids).toContain('leads-quick-tour');
    expect(ids).toContain('leads-workflow');
    expect(ids).toContain('leads-create');
    expect(ids).toContain('leads-search-filter');
    expect(ids).toContain('leads-followup');
    // Operations
    expect(ids).toContain('projects-quick-tour');
    expect(ids).toContain('projects-create');
    expect(ids).toContain('stock-quick-tour');
    expect(ids).toContain('stock-check');
    expect(ids).toContain('purchase-orders-quick-tour');
    expect(ids).toContain('purchase-orders-create');
    expect(ids).toContain('vendors-quick-tour');
    expect(ids).toContain('vendors-create');
    expect(ids).toContain('dispatch-quick-tour');
    // Finance
    expect(ids).toContain('payments-quick-tour');
    expect(ids).toContain('payments-record');
    expect(ids).toContain('reports-quick-tour');
    // HR
    expect(ids).toContain('employees-quick-tour');
    expect(ids).toContain('employees-add');
    expect(ids).toContain('attendance-quick-tour');
    expect(ids).toContain('attendance-mark');
    // Every category has at least one tutorial.
    const categories = new Set(TUTORIALS.map((t) => t.category));
    expect(categories.has('sales')).toBe(true);
    expect(categories.has('operations')).toBe(true);
    expect(categories.has('finance')).toBe(true);
    expect(categories.has('hr')).toBe(true);
  });

  it('has unique ids, non-empty steps and a terminal complete step', () => {
    const seen = new Set<string>();
    for (const t of TUTORIALS) {
      expect(seen.has(t.id)).toBe(false);
      seen.add(t.id);
      expect(t.steps.length).toBeGreaterThan(0);
      expect(t.steps[t.steps.length - 1].type).toBe('complete');
      expect(t.learnings.length).toBeGreaterThan(0);
      expect(getTutorialById(t.id)).toBe(t);
    }
  });

  it('gives every step a title and description with business context', () => {
    for (const t of TUTORIALS) {
      for (const s of t.steps) {
        expect(s.title.trim().length).toBeGreaterThan(0);
        expect(s.description.trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('interactive steps have a target', () => {
    for (const t of TUTORIALS) {
      for (const s of t.steps) {
        if (INTERACTIVE_TYPES.includes(s.type)) {
          expect(s.target, `${t.id}/${s.id} must have a target`).toBeTruthy();
        }
      }
    }
  });

  it('every target identifier exists as a data-tour attribute in the real source', () => {
    const sourceFiles = [
      // Desktop pages / components
      'src/pages/Leads.tsx',
      'src/features/leads/components/LeadWorkspaceDialogs.tsx',
      'src/pages/LeadWorkspace.tsx',
      'src/pages/Projects.tsx',
      'src/pages/StockWorkspace.tsx',
      'src/pages/DispatchWorkspace.tsx',
      'src/pages/PurchaseOrders.tsx',
      'src/pages/Vendors.tsx',
      'src/pages/Payments.tsx',
      'src/pages/Reports.tsx',
      'src/pages/Employees.tsx',
      'src/pages/Attendance.tsx',
      'src/components/shared/RowViewAction.tsx',
      // Mobile workspaces (same ids, so the same definitions work on mobile)
      'src/components/mobile/leads/MobileLeadWorkspace.tsx',
      'src/components/mobile/customers/MobileCustomerWorkspace.tsx',
      'src/components/mobile/projects/MobileProjectList.tsx',
      'src/components/mobile/stock/MobileStockWorkspace.tsx',
      'src/components/mobile/purchase-orders/MobilePurchaseOrderWorkspace.tsx',
      'src/components/mobile/vendors/MobileVendorWorkspace.tsx',
      'src/components/mobile/dispatch/MobileDispatchWorkspace.tsx',
      'src/components/mobile/payments/MobilePaymentWorkspace.tsx',
      'src/components/mobile/employees/MobileEmployeesWorkspace.tsx',
      'src/components/mobile/attendance/MobileAttendanceWorkspace.tsx',
      'src/components/mobile/reports/MobileReportsWorkspace.tsx',
      'src/components/mobile/shell/MobileTopBar.tsx',
    ];
    const sources = sourceFiles.map((f) => readFileSync(path.resolve(process.cwd(), f), 'utf8'));

    for (const t of TUTORIALS) {
      for (const s of t.steps) {
        if (!s.target) continue;
        const attr = `data-tour="${s.target}"`;
        // Direct attribute, or a `dataTour=` prop that the local component
        // maps to the attribute (e.g. LeadWorkspace's FooterActionButton).
        const found = sources.some((src) => src.includes(attr) || src.includes(`dataTour="${s.target}"`));
        expect(
          found,
          `${t.id}/${s.id}: [data-tour="${s.target}"] must exist in ${sourceFiles.join(' or ')}`,
        ).toBe(true);
      }
    }
  });

  it('every step route is a real app route', () => {
    const routes = [
      '/leads',
      '/leads/workspace/:id',
      '/projects',
      '/stock',
      '/purchase-orders',
      '/vendors',
      '/dispatch',
      '/payments',
      '/reports',
      '/employees',
      '/attendance',
    ];
    for (const t of TUTORIALS) {
      expect(routes).toContain(t.route);
      for (const s of t.steps) {
        if (s.route) expect(routes).toContain(s.route);
      }
    }
  });
});

describe('tutorial progress persistence', () => {
  afterEach(() => {
    useTutorialProgress.setState({ map: {} });
  });

  it('tracks in-progress state and the furthest step', () => {
    useTutorialProgress.getState().recordStep('user-1', 'tutorial-1', 0, 5);
    useTutorialProgress.getState().recordStep('user-1', 'tutorial-1', 2, 5);
    // Going backwards must not lower the furthest step.
    useTutorialProgress.getState().recordStep('user-1', 'tutorial-1', 1, 5);

    const entry = getTutorialProgress('user-1', 'tutorial-1');
    expect(entry?.status).toBe('in-progress');
    expect(entry?.lastStep).toBe(2);
    expect(entry?.totalSteps).toBe(5);
    expect(progressPercent(entry)).toBe(60);
  });

  it('keeps progress per user', () => {
    useTutorialProgress.getState().recordStep('user-1', 'tutorial-1', 1, 4);
    useTutorialProgress.getState().recordStep('user-2', 'tutorial-1', 3, 4);
    expect(getTutorialProgress('user-1', 'tutorial-1')?.lastStep).toBe(1);
    expect(getTutorialProgress('user-2', 'tutorial-1')?.lastStep).toBe(3);
    expect(getTutorialProgress('user-1', 'tutorial-2')).toBeUndefined();
  });

  it('marks completion and supports replay via reset', () => {
    useTutorialProgress.getState().complete('user-1', 'tutorial-1', 8);
    let entry = getTutorialProgress('user-1', 'tutorial-1');
    expect(entry?.status).toBe('completed');
    expect(entry?.completedAt).toBeTypeOf('number');
    expect(progressPercent(entry)).toBe(100);

    // Recording a step after completion must not un-complete it.
    useTutorialProgress.getState().recordStep('user-1', 'tutorial-1', 0, 8);
    expect(getTutorialProgress('user-1', 'tutorial-1')?.status).toBe('completed');

    // Replay = reset → back to not started.
    useTutorialProgress.getState().reset('user-1', 'tutorial-1');
    expect(getTutorialProgress('user-1', 'tutorial-1')).toBeUndefined();
    expect(progressPercent(undefined)).toBe(0);
  });
});
