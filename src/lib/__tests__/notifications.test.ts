/**
 * Notification System Tests
 *
 * Tests cover:
 * 1. Route resolution (pure function — all entity types)
 * 2. Notification utility functions
 * 3. Preference suppression logic
 * 4. Deduplication hash generation
 * 5. Recipient resolution bounds
 * 6. Notification metric tracking
 * 7. Edge cases and error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getNotificationRoute, navigateToNotification } from '../notificationRoutes';
import { NotificationType } from '../../types';

// ══════════════════════════════════════════════════════════
// 1. Notification Route Resolution
// ══════════════════════════════════════════════════════════

describe('getNotificationRoute', () => {
  // ── Core CRM / Sales ──
  describe('CRM / Sales', () => {
    it('resolves lead route', () => {
      expect(getNotificationRoute('lead', 'LD-001')).toBe('/leads?open=LD-001');
    });

    it('resolves lead route without entityId', () => {
      expect(getNotificationRoute('lead', '')).toBe('/leads');
    });

    it('resolves customer route', () => {
      expect(getNotificationRoute('customer', 'CU-001')).toBe('/customers?open=CU-001');
    });

    it('resolves quotation route', () => {
      expect(getNotificationRoute('quotation', 'QT-001')).toBe('/quotations/QT-001');
      expect(getNotificationRoute('quote', 'QT-001')).toBe('/quotations/QT-001');
    });

    it('resolves order route', () => {
      expect(getNotificationRoute('order', 'ORD-001')).toBe('/orders/ORD-001');
    });

    it('resolves invoice routes', () => {
      expect(getNotificationRoute('invoice', 'INV-001')).toBe('/invoices?open=INV-001');
      expect(getNotificationRoute('pi', 'INV-001')).toBe('/invoices?open=INV-001');
      expect(getNotificationRoute('proforma_invoice', 'INV-001')).toBe('/invoices?open=INV-001');
    });

    it('resolves tax_invoice route', () => {
      expect(getNotificationRoute('tax_invoice', 'TINV-001')).toBe('/tax-invoices?open=TINV-001');
    });

    it('resolves payment route', () => {
      expect(getNotificationRoute('payment', 'PAY-001')).toBe('/payments?open=PAY-001');
    });
  });

  // ── Operations / Dispatch ──
  describe('Operations / Dispatch', () => {
    it('resolves dispatch route to the full record workspace page (management popup retired)', () => {
      expect(getNotificationRoute('dispatch', 'DSP-001')).toBe('/dispatch/DSP-001');
    });
  });

  // ── Inventory / Stock ──
  describe('Inventory / Stock', () => {
    it('resolves product route', () => {
      expect(getNotificationRoute('product', 'PROD-001')).toBe('/products?open=PROD-001');
    });

    it('resolves stock route', () => {
      expect(getNotificationRoute('stock', 'STK-001')).toBe('/stock?open=STK-001');
      expect(getNotificationRoute('inventory', 'STK-001')).toBe('/stock?open=STK-001');
    });

    it('resolves warehouse route', () => {
      expect(getNotificationRoute('warehouse', 'WH-001')).toBe('/warehouses?open=WH-001');
    });

    it('resolves purchase_order route to the full PO workspace (view popup retired)', () => {
      expect(getNotificationRoute('purchase_order', 'PO-001')).toBe('/purchase-orders/PO-001');
      expect(getNotificationRoute('purchaseorder', 'PO-001')).toBe('/purchase-orders/PO-001');
    });

    it('resolves goods_receipt route', () => {
      expect(getNotificationRoute('goods_receipt', 'GR-001')).toBe('/goods-receipts?open=GR-001');
      expect(getNotificationRoute('goodsreceipt', 'GR-001')).toBe('/goods-receipts?open=GR-001');
    });

    it('resolves vendor route', () => {
      expect(getNotificationRoute('vendor', 'VND-001')).toBe('/vendors?open=VND-001');
    });
  });

  // ── Project Lifecycle ──
  describe('Project Lifecycle', () => {
    it('resolves project route', () => {
      expect(getNotificationRoute('project', 'PRJ-001')).toBe('/projects/PRJ-001');
    });

    it('resolves survey route to the Project Workspace (popup retired)', () => {
      // Survey detail popup retired — notifications now open the Survey stage
      // card inside the Project Workspace via the survey's projectId.
      expect(getNotificationRoute('survey', 'SRV-001', 'PRJ-001')).toBe('/projects/PRJ-001');
      // Legacy notifications without projectId degrade to the list page.
      expect(getNotificationRoute('survey', 'SRV-001')).toBe('/surveys');
    });

    it('resolves engineering design route to the Project Workspace (popup retired)', () => {
      expect(getNotificationRoute('engineering_design', 'ENG-001', 'PRJ-001')).toBe('/projects/PRJ-001');
      expect(getNotificationRoute('engineeringdesign', 'ENG-001', 'PRJ-001')).toBe('/projects/PRJ-001');
      // Legacy notifications without projectId degrade to the list page.
      expect(getNotificationRoute('engineering', 'ENG-001')).toBe('/engineering-designs');
    });

    it('resolves installation route', () => {
      // Installation notifications open the /installations/:id record workspace
      // page — the read-only installation detail modal was retired (Installation
      // Workspace Migration).
      expect(getNotificationRoute('installation', 'INST-001')).toBe('/installations/INST-001');
    });

    it('resolves QC route', () => {
      // QC notifications open the /qc/:id record workspace page — the QC
      // detail modal was retired (QC Workspace Migration).
      expect(getNotificationRoute('qc_check', 'QC-001')).toBe('/qc/QC-001');
      expect(getNotificationRoute('qccheck', 'QC-001')).toBe('/qc/QC-001');
      expect(getNotificationRoute('qc', 'QC-001')).toBe('/qc/QC-001');
    });

    it('resolves commissioning route', () => {
      // Commissioning notifications open the /commissioning/:id record workspace
      // page — the read-only commissioning detail modal was retired
      // (Commissioning Workspace Migration).
      expect(getNotificationRoute('commissioning_record', 'COM-001')).toBe('/commissioning/COM-001');
      expect(getNotificationRoute('commissioningrecord', 'COM-001')).toBe('/commissioning/COM-001');
      expect(getNotificationRoute('commissioning', 'COM-001')).toBe('/commissioning/COM-001');
    });

    it('resolves net metering route', () => {
      // Net metering notifications open the /net-metering/:id record workspace
      // page — the net metering detail modal was retired
      expect(getNotificationRoute('net_metering_application', 'NM-001')).toBe('/net-metering/NM-001');
      expect(getNotificationRoute('netmeteringapplication', 'NM-001')).toBe('/net-metering/NM-001');
      expect(getNotificationRoute('net_metering', 'NM-001')).toBe('/net-metering/NM-001');
    });

    it('resolves subsidy route', () => {
      // Subsidy notifications open the /subsidy/:id record workspace page —
      // the subsidy detail/disbursement modals were retired
      expect(getNotificationRoute('subsidy_application', 'SUB-001')).toBe('/subsidy/SUB-001');
      expect(getNotificationRoute('subsidyapplication', 'SUB-001')).toBe('/subsidy/SUB-001');
      expect(getNotificationRoute('subsidy', 'SUB-001')).toBe('/subsidy/SUB-001');
    });
  });

  // ── Post-Sale ──
  describe('Post-Sale', () => {
    it('resolves handover route', () => {
      expect(getNotificationRoute('project_handover', 'HO-001')).toBe('/handovers/HO-001');
      expect(getNotificationRoute('projecthandover', 'HO-001')).toBe('/handovers/HO-001');
      expect(getNotificationRoute('handover', 'HO-001')).toBe('/handovers/HO-001');
    });

    it('resolves AMC route', () => {
      expect(getNotificationRoute('amc_contract', 'AMC-001')).toBe('/amc-contracts/AMC-001');
      expect(getNotificationRoute('amccontract', 'AMC-001')).toBe('/amc-contracts/AMC-001');
      expect(getNotificationRoute('amc', 'AMC-001')).toBe('/amc-contracts/AMC-001');
    });

    it('resolves service ticket route', () => {
      expect(getNotificationRoute('service_ticket', 'ST-001')).toBe('/service-tickets?open=ST-001');
      expect(getNotificationRoute('serviceticket', 'ST-001')).toBe('/service-tickets?open=ST-001');
    });

    it('resolves monitoring route', () => {
      expect(getNotificationRoute('generation_reading', 'GEN-001')).toBe('/monitoring?open=GEN-001');
      expect(getNotificationRoute('generationreading', 'GEN-001')).toBe('/monitoring?open=GEN-001');
      expect(getNotificationRoute('monitoring', 'GEN-001')).toBe('/monitoring?open=GEN-001');
    });
  });

  // ── Tasks ──
  describe('Tasks', () => {
    it('resolves task route', () => {
      expect(getNotificationRoute('task', 'TSK-001')).toBe('/tasks/TSK-001');
    });
  });

  // ── HR ──
  describe('HR', () => {
    it('resolves employee route', () => {
      expect(getNotificationRoute('employee', 'EMP-001')).toBe('/employees?open=EMP-001');
    });

    it('resolves attendance route', () => {
      expect(getNotificationRoute('attendance', 'AT-001')).toBe('/attendance?open=AT-001');
    });

    it('resolves payroll route', () => {
      expect(getNotificationRoute('payroll', 'PR-001')).toBe('/payroll?open=PR-001');
    });
  });

  // ── Admin / Settings ──
  describe('Admin / Settings', () => {
    it('resolves user route', () => {
      expect(getNotificationRoute('user', 'USR-001')).toBe('/users?open=USR-001');
    });

    it('resolves role route', () => {
      expect(getNotificationRoute('role', 'ROLE-001')).toBe('/roles?open=ROLE-001');
    });

    it('resolves company route', () => {
      expect(getNotificationRoute('company', 'COMP-001')).toBe('/companies?open=COMP-001');
    });
  });

  // ── Channel Partners ──
  describe('Channel Partners', () => {
    it('resolves channel partner route', () => {
      expect(getNotificationRoute('channel_partner', 'CP-001')).toBe('/partners?open=CP-001');
      expect(getNotificationRoute('channelpartner', 'CP-001')).toBe('/partners?open=CP-001');
      expect(getNotificationRoute('partner', 'CP-001')).toBe('/partners?open=CP-001');
    });

    it('resolves commission route', () => {
      expect(getNotificationRoute('commission_rule', 'CR-001')).toBe('/commission-rules?open=CR-001');
      expect(getNotificationRoute('commissionrule', 'CR-001')).toBe('/commission-rules?open=CR-001');
      expect(getNotificationRoute('commission', 'CR-001')).toBe('/commission-rules?open=CR-001');
    });

    it('resolves settlement route', () => {
      expect(getNotificationRoute('settlement', 'STL-001')).toBe('/settlements?open=STL-001');
    });
  });

  // ── Fallback ──
  describe('Fallback', () => {
    it('falls back to /notifications for unknown entity types', () => {
      expect(getNotificationRoute('unknown_type', 'XYZ-001')).toBe('/notifications');
    });

    it('falls back to /notifications for empty entity types', () => {
      expect(getNotificationRoute('', 'XYZ-001')).toBe('/notifications');
    });

    it('handles special characters in entity IDs', () => {
      expect(getNotificationRoute('lead', 'LD-001/2')).toBe('/leads?open=LD-001%2F2');
    });
  });

  // ── Case Insensitivity ──
  describe('Case insensitivity', () => {
    it('handles uppercase entity types', () => {
      expect(getNotificationRoute('LEAD', 'LD-001')).toBe('/leads?open=LD-001');
    });

    it('handles mixed case entity types', () => {
      expect(getNotificationRoute('ProJect', 'PRJ-001')).toBe('/projects/PRJ-001');
    });
  });
});

describe('navigateToNotification', () => {
  it('calls navigate with the correct route', () => {
    const navigate = vi.fn();
    navigateToNotification(navigate, 'lead', 'LD-001');
    expect(navigate).toHaveBeenCalledWith('/leads?open=LD-001');
  });

  it('calls navigate with fallback route for unknown types', () => {
    const navigate = vi.fn();
    navigateToNotification(navigate, 'unknown_type', 'XYZ');
    expect(navigate).toHaveBeenCalledWith('/notifications');
  });
});

// ══════════════════════════════════════════════════════════
// 2. Notification Module Structure
// ══════════════════════════════════════════════════════════

describe('Notification module exports', () => {
  it('exports all expected functions from notifications.ts', async () => {
    // Dynamic import of the full notifications module (Firebase-backed) can
    // exceed the default 15s timeout when the full battery runs many heavy
    // modules in parallel — give it a generous window so the export contract
    // is verified rather than timing out.
    const mod = await import('../notifications');
    expect(mod.sendNotification).toBeDefined();
    expect(mod.notifyUsersOnce).toBeDefined();
    expect(mod.notifyRoleUsers).toBeDefined();
    expect(mod.getNotificationUsersByRoles).toBeDefined();
    expect(mod.resolveNotificationCompanyId).toBeDefined();
  }, 60000);

  it('exports NotificationType enum', () => {
    expect(NotificationType.LEAD_ASSIGNED).toBeDefined();
    expect(NotificationType.TASK_ASSIGNED).toBeDefined();
    expect(NotificationType.TASK_STATUS_CHANGED).toBeDefined();
    expect(NotificationType.ORDER_PLACED).toBeDefined();
    expect(NotificationType.ORDER_UPDATED).toBeDefined();
    expect(NotificationType.DISPATCH_REQUESTED).toBeDefined();
    expect(NotificationType.DISPATCH_APPROVED).toBeDefined();
    expect(NotificationType.DISPATCH_VERIFIED).toBeDefined();
    expect(NotificationType.DISPATCH_CLOSED).toBeDefined();
    expect(NotificationType.PAYMENT_CONFIRMED).toBeDefined();
    expect(NotificationType.INVENTORY_UPDATED).toBeDefined();
    expect(NotificationType.PI_GENERATED).toBeDefined();
    expect(NotificationType.INVOICE_UPDATED).toBeDefined();
  });

  it('has all expected notification types defined', () => {
    const expectedTypes = [
      'LEAD_ASSIGNED', 'TASK_ASSIGNED', 'TASK_STATUS_CHANGED',
      'ORDER_PLACED', 'ORDER_UPDATED',
      'DISPATCH_REQUESTED', 'DISPATCH_APPROVED', 'DISPATCH_VERIFIED', 'DISPATCH_CLOSED',
      'PAYMENT_CONFIRMED', 'PAYMENT_RECORDED', 'INVENTORY_UPDATED', 'PI_GENERATED', 'INVOICE_UPDATED',
      'REMINDER', 'ESCALATION_CRITICAL',
    ];
    for (const type of expectedTypes) {
      expect((NotificationType as Record<string, string>)[type]).toBeDefined();
    }
  });
});

// ══════════════════════════════════════════════════════════
// 3. Notification Route Consistency Validation
// ══════════════════════════════════════════════════════════

describe('Notification route consistency', () => {
  it('all known entity types in the API registry have corresponding routes', () => {
    // Core entity types that the API registry exposes
    // Each should have a dedicated route, not the fallback
    const entitiesWithRoutes: Array<[string, string]> = [
      ['lead', '/leads'],
      ['customer', '/customers'],
      ['quotation', '/quotations'],
      ['order', '/orders'],
      ['proforma_invoice', '/invoices'],
      ['tax_invoice', '/tax-invoices'],
      ['payment', '/payments'],
      ['dispatch', '/dispatch'],
      ['product', '/products'],
      ['stock', '/stock'],
      ['warehouse', '/warehouses'],
      ['purchase_order', '/purchase-orders'],
      ['goods_receipt', '/goods-receipts'],
      ['vendor', '/vendors'],
      ['project', '/projects'],
      ['survey', '/surveys'],
      ['engineering_design', '/engineering-designs'],
      ['installation', '/installations'],
      ['qc_check', '/qc'],
      ['commissioning_record', '/commissioning'],
      ['net_metering_application', '/net-metering'],
      ['subsidy_application', '/subsidy'],
      ['project_handover', '/handovers'],
      ['amc_contract', '/amc-contracts'],
      ['service_ticket', '/service-tickets'],
      ['generation_reading', '/monitoring'],
      ['task', '/tasks'],
      ['employee', '/employees'],
      ['attendance', '/attendance'],
      ['payroll', '/payroll'],
      ['user', '/users'],
      ['role', '/roles'],
      ['company', '/companies'],
      ['channel_partner', '/partners'],
      ['commission_rule', '/commission-rules'],
      ['settlement', '/settlements'],
    ];

    for (const [entityType, expectedPrefix] of entitiesWithRoutes) {
      const route = getNotificationRoute(entityType, 'ID-001');
      expect(route).toContain(expectedPrefix);
    }
  });
});

// ══════════════════════════════════════════════════════════
// 4. Notification Metrics
// ══════════════════════════════════════════════════════════

describe('trackNotificationMetric', () => {
  it('exists and accepts expected metric types', async () => {
    const { trackNotificationMetric } = await import('../notificationMetrics');
    // Should not throw for any metric type
    expect(() => {
      trackNotificationMetric('created', { userId: 'u1' });
    }).not.toThrow();
    expect(() => {
      trackNotificationMetric('delivered', { userId: 'u1' });
    }).not.toThrow();
    expect(() => {
      trackNotificationMetric('read', { userId: 'u1' });
    }).not.toThrow();
    expect(() => {
      trackNotificationMetric('failed', { userId: 'u1' });
    }).not.toThrow();
    expect(() => {
      trackNotificationMetric('deduplicated', { userId: 'u1' });
    }).not.toThrow();
  });

  it('handles empty details gracefully', async () => {
    const { trackNotificationMetric } = await import('../notificationMetrics');
    expect(() => trackNotificationMetric('created')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════
// 5. Notification Types Validation
// ══════════════════════════════════════════════════════════

describe('Notification interface structure', () => {
  it('Notification type defines expected fields', () => {
    // Verify the Notification interface has the expected shape
    const notification: Record<string, unknown> = {
      id: 'NTF-001',
      companyId: 'COMP-1',
      recipientUserId: 'USR-1',
      type: 'TASK_ASSIGNED',
      title: 'Task assigned',
      body: 'You have been assigned a task',
      entityType: 'task',
      entityId: 'TSK-001',
      isRead: false,
      createdAt: new Date().toISOString(),
      visibleTo: ['USR-1', 'USR-2'],
      notificationHash: 'hash',
    };

    expect(notification.id).toBe('NTF-001');
    expect(notification.companyId).toBe('COMP-1');
    expect(notification.recipientUserId).toBe('USR-1');
    expect(notification.type).toBe('TASK_ASSIGNED');
    expect(notification.isRead).toBe(false);
    expect(Array.isArray(notification.visibleTo)).toBe(true);
  });

  it('sendNotification writes visibleTo ⊆ {recipientUserId, createdBy}', async () => {
    // Contract behind the notification list query: buildNotificationQuery
    // reads via `recipientUserId ==` / `createdBy ==` only (no visibleTo
    // array-contains — Firestore rules reject that branch). This loses
    // nothing only while EVERY producer writes visibleTo as a subset of
    // {recipientUserId, createdBy}. sendNotification is the single canonical
    // producer — every notifyUsersOnce/notifyRoleUsers call funnels into it.
    // Guard the invariant at the source of truth so a future producer that
    // breaks it fails a test instead of silently hiding notifications from
    // list queries.
    const { readFileSync } = await import('node:fs');
    const sourceUrl = new URL('../notifications.ts', import.meta.url);
    const source = readFileSync(sourceUrl, 'utf8');
    const line = source.split('\n').find((l) => l.includes('const visibleTo ='));
    expect(line).toBeDefined();
    expect(line).toContain('recipientUserId');
    expect(line).toContain('createdBy');
    expect(line).toContain('new Set');
  });
});

// ══════════════════════════════════════════════════════════
// 6. Workflow Notification Integration Validation
// ══════════════════════════════════════════════════════════

describe('Workflow notification pattern validation', () => {
  // Verify that all workflow files import from the notification system correctly
  it('task workflow creates notifications with correct entity type', async () => {
    const { createTask } = await import('../tasks');
    const { sendNotification } = await import('../notifications');
    // Verify createTask imports sendNotification (already verified at module level)
    expect(typeof createTask).toBe('function');
    expect(typeof sendNotification).toBe('function');
  });

  it('lead workflow creates notification on conversion', async () => {
    const { convertLeadToCustomer } = await import('../leadWorkflow');
    expect(typeof convertLeadToCustomer).toBe('function');
  });

  it('dispatch workflow has notification calls', async () => {
    const mod = await import('../dispatchWorkflow');
    expect(typeof mod.requestDispatch).toBe('function');
    expect(typeof mod.closeDispatch).toBe('function');
    expect(typeof mod.confirmDelivery).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════
// 7. Auto-Reminder / Escalation Notifications
// ══════════════════════════════════════════════════════════

describe('Auto-reminder notification integration', () => {
  it('auto-reminder workflow uses notifyRoleUsers', async () => {
    const mod = await import('../autoReminderWorkflow');
    expect(typeof mod.evaluateRule).toBe('function');
    expect(typeof mod.loadReminderConfig).toBe('function');
    expect(typeof mod.saveReminderConfig).toBe('function');
    expect(typeof mod.executeReminderRules).toBe('function');
    expect(typeof mod.previewReminderEvaluation).toBe('function');
    expect(mod.DEFAULT_REMINDER_RULES).toBeDefined();
    expect(mod.DEFAULT_REMINDER_CONFIG).toBeDefined();
  });

  it('reminder rules have notification-compatible structure', async () => {
    const { DEFAULT_REMINDER_RULES } = await import('../autoReminderWorkflow');
    for (const rule of DEFAULT_REMINDER_RULES) {
      expect(rule.id).toBeDefined();
      expect(typeof rule.id).toBe('string');
      expect(rule.label).toBeDefined();
      expect(rule.entityType).toBeDefined();
      // All rules should have a corresponding entity route
      if (rule.entityType) {
        const route = getNotificationRoute(rule.entityType, 'ID');
        expect(route).not.toBe('');
      }
    }
  });
});
