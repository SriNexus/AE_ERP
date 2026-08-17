import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createDocWithId: vi.fn(), getOne: vi.fn(), updateDocById: vi.fn(), stockIn: vi.fn(), canDo: vi.fn(() => true), logActivity: vi.fn(), notifyUsers: vi.fn(), usersByRole: vi.fn(async () => []), getState: vi.fn(() => ({ user: { id: 'U-1' }, activeCompanyId: 'COMP-1' })), generic: vi.fn(() => 'GRN-1') }));
vi.mock('../../../lib/firebase', () => ({ COLLECTIONS: { PURCHASE_ORDERS: 'purchase_orders', GOODS_RECEIPTS: 'goods_receipts', WAREHOUSES: 'warehouses' }, db: {} }));
vi.mock('../../../lib/firestore', () => ({ createDocWithId: mocks.createDocWithId, getOne: mocks.getOne, updateDocById: mocks.updateDocById, genId: { generic: mocks.generic }, resolveWriteCompanyId: () => { const s = mocks.getState() as any; return s.activeCompanyId || s.company?.id || s.user?.companyId || ''; } }));
vi.mock('../../../lib/permissions', () => ({ canDo: mocks.canDo }));
vi.mock('../../../lib/stockWorkflow', () => ({ stockIn: mocks.stockIn }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: mocks.getState } }));
vi.mock('../../../lib/workflow', () => ({ logActivity: mocks.logActivity, notifyUsers: mocks.notifyUsers, usersByRole: mocks.usersByRole }));

import { calculateReceiptState, createGoodsReceipt } from './goodsReceiptWorkflow';

const order: any = { id: 'PO-1', purchaseOrderId: 'PO-1', vendorId: 'VEN-1', vendorName: 'Vendor', companyId: 'COMP-1', status: 'Sent', statusHistory: [], items: [{ productId: 'P-1', product: 'Panel', qty: 10, unit: 'Nos', receivedQty: 0 }, { productId: 'P-2', product: 'Inverter', qty: 2, unit: 'Nos', receivedQty: 1 }] };

describe('goodsReceiptWorkflow', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.canDo.mockReturnValue(true); mocks.getOne.mockImplementation(async (collection: string) => collection === 'purchase_orders' ? order : { id: 'WH-1', name: 'Main Warehouse' }); mocks.stockIn.mockImplementation(async ({ productId }: any) => ({ stockId: `SUM-${productId}`, ledgerId: `LED-${productId}`, transactionId: `TX-${productId}` })); });

  it('derives partial and complete receipt quantities without exceeding the PO', () => {
    expect(calculateReceiptState(order, { 0: '4' })).toMatchObject({ status: 'PartiallyReceived', items: [{ receivedQty: 4, remainingQty: 6 }, { receivedQty: 1, remainingQty: 1 }] });
    expect(calculateReceiptState(order, { 0: '10', 1: '1' }).status).toBe('Received');
    expect(() => calculateReceiptState(order, { 0: '11' })).toThrow('exceeds remaining');
  });

  it('calls stockIn for every received line and persists receipt and PO state', async () => {
    await createGoodsReceipt({ purchaseOrderId: 'PO-1', projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: 'Delivery', quantities: { 0: '4', 1: '1' } });
    expect(mocks.stockIn).toHaveBeenCalledTimes(2);
    expect(mocks.stockIn).toHaveBeenCalledWith(expect.objectContaining({ productId: 'P-1', warehouseId: 'WH-1', qty: 4, sourceType: 'purchase', sourceId: expect.stringContaining('purchase_order:PO-1:goods_receipt:GRN-1') }));
    expect(mocks.createDocWithId).toHaveBeenCalledWith('goods_receipts', 'GRN-1', expect.objectContaining({ purchaseOrderId: 'PO-1', receivedItems: expect.any(Array), stockEntries: expect.any(Array) }));
    expect(mocks.updateDocById).toHaveBeenCalledWith('purchase_orders', 'PO-1', expect.objectContaining({ status: 'PartiallyReceived', items: expect.any(Array), statusHistory: [expect.objectContaining({ status: 'PartiallyReceived' })] }));
  });

  it('rejects receipts against non-receivable purchase orders', async () => {
    mocks.getOne.mockImplementation(async (collection: string) => collection === 'purchase_orders' ? { ...order, status: 'Draft' } : { id: 'WH-1', name: 'Main' });
    await expect(createGoodsReceipt({ purchaseOrderId: 'PO-1', projectId: '', projectName: '', warehouseId: 'WH-1', receivedDate: '2026-07-10', notes: '', quantities: { 0: '1' } })).rejects.toThrow('Sent or Partially Received');
    expect(mocks.stockIn).not.toHaveBeenCalled();
  });
});
