import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/firebase', () => ({ COLLECTIONS: { PURCHASE_ORDERS: 'purchase_orders', VENDORS: 'vendors' }, db: {} }));
vi.mock('../../../lib/firestore', () => ({ createDocWithId: vi.fn(), genId: { generic: vi.fn(() => 'PO-1') }, getOne: vi.fn(), updateDocById: vi.fn() }));
vi.mock('../../../lib/permissions', () => ({ canDo: vi.fn(() => true) }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: vi.fn(() => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' })) } }));
vi.mock('../../../lib/workflow', () => ({ logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(() => []) }));

import { calculatePurchaseOrderTotals, projectProcurementPatch, PURCHASE_ORDER_TRANSITIONS } from './purchaseOrderWorkflow';

describe('purchaseOrderWorkflow', () => {
  it('calculates normalized line and order totals', () => {
    const result = calculatePurchaseOrderTotals([{ productId: 'P-1', product: 'Panel', description: '', hsn: '8541', qty: '10', unit: 'Nos', price: '100', tax: '18', discount: '100' }]);
    expect(result).toMatchObject({ subtotal: 900, taxTotal: 162, discountTotal: 100, total: 1062 });
    expect(result.items[0]).toMatchObject({ qty: 10, taxableValue: 900, taxAmount: 162, total: 1062 });
  });

  it('rejects invalid quantities, tax, and discounts', () => {
    const base = { productId: 'P-1', product: 'Panel', description: '', hsn: '', qty: '1', unit: 'Nos', price: '100', tax: '18', discount: '0' };
    expect(() => calculatePurchaseOrderTotals([{ ...base, qty: '0' }])).toThrow('Quantity');
    expect(() => calculatePurchaseOrderTotals([{ ...base, tax: '101' }])).toThrow('Tax');
    expect(() => calculatePurchaseOrderTotals([{ ...base, discount: '101' }])).toThrow('discount');
  });

  it('links a project and advances it to Procurement without regressing later stages', () => {
    expect(projectProcurementPatch({ currentStage: 'Order', linkedPurchaseOrderIds: [], stageHistory: [] }, 'PO-1', 'U-1', 'NOW')).toMatchObject({ currentStage: 'Procurement', linkedPurchaseOrderIds: ['PO-1'], stageHistory: [{ stage: 'Procurement' }] });
    expect(projectProcurementPatch({ currentStage: 'Dispatch', linkedPurchaseOrderIds: ['PO-0'], stageHistory: [] }, 'PO-1', 'U-1', 'NOW')).toEqual({ linkedPurchaseOrderIds: ['PO-0', 'PO-1'] });
  });
  it('defines the Blueprint lifecycle without transitions from terminal states', () => {
    expect(PURCHASE_ORDER_TRANSITIONS.Draft).toEqual(['Sent', 'Cancelled']);
    expect(PURCHASE_ORDER_TRANSITIONS.Sent).toEqual(['PartiallyReceived', 'Received', 'Cancelled']);
    expect(PURCHASE_ORDER_TRANSITIONS.PartiallyReceived).toEqual(['Received', 'Cancelled']);
    expect(PURCHASE_ORDER_TRANSITIONS.Received).toEqual([]);
    expect(PURCHASE_ORDER_TRANSITIONS.Cancelled).toEqual([]);
  });
});
