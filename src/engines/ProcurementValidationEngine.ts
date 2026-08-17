/**
 * ProcurementValidationEngine — Procurement Integrity Validation Engine
 *
 * Phase 4E — Validates the complete Procurement domain:
 *   Vendor → Purchase Order → Goods Receipt → Inventory
 *
 * This is a READ-ONLY validation engine. It never mutates data automatically.
 * repairProcurementChain() is the sole mutation utility and requires explicit
 * invocation with dry-run mode enabled by default.
 *
 * Architecture follows CaseValidationEngine pattern (Phase 3C).
 */

import { getAll, getOne, updateDocById } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import type { VendorRecord, PurchaseOrderRecord, GoodsReceiptRecord, PurchaseOrderStatus } from '../features/procurement/types';

// ═════════════════════════════════════════════════════════════
//  TYPES
// ═════════════════════════════════════════════════════════════

export interface EntityValidationResult {
  entityType: string;
  entityId: string;
  valid: boolean;
  errors: string[];
}

export interface VendorValidation {
  vendor: VendorRecord | null;
  exists: boolean;
  isDeleted: boolean;
  hasPOs: boolean;
  hasGRs: boolean;
  poCount: number;
  grCount: number;
  valid: boolean;
  errors: string[];
}

export interface POValidation {
  purchaseOrder: PurchaseOrderRecord | null;
  exists: boolean;
  isDeleted: boolean;
  vendorExists: boolean;
  hasLineItems: boolean;
  totalPositive: boolean;
  validStatus: boolean;
  hasGRs: boolean;
  grCount: number;
  valid: boolean;
  errors: string[];
}

export interface GRValidation {
  goodsReceipt: GoodsReceiptRecord | null;
  exists: boolean;
  isDeleted: boolean;
  poExists: boolean;
  vendorExists: boolean;
  warehouseExists: boolean;
  qtyValid: boolean;
  hasStockEntries: boolean;
  stockEntryCount: number;
  valid: boolean;
  errors: string[];
}

export interface ProcurementChainLink {
  entityType: string;
  entityId: string;
  valid: boolean;
  error?: string;
}

export type ProcurementHealthReport = {
  totalVendors: number;
  totalPurchaseOrders: number;
  totalGoodsReceipts: number;
  healthyChains: number;
  brokenChains: number;
  orphanPurchaseOrders: number;
  orphanGoodsReceipts: number;
  duplicatePurchaseOrders: number;
  inventoryMismatches: number;
  validationTimestamp: string;
};

export interface RepairSummary {
  dryRun: boolean;
  entityType: string;
  entityId: string;
  checksPerformed: number;
  issuesFound: number;
  issuesFixed: number;
  repairsApplied: Array<{
    target: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    action: 'fix' | 'skip' | 'error';
    error?: string;
  }>;
}

// ═════════════════════════════════════════════════════════════
//  VALID STATUS TRANSITIONS
// ═════════════════════════════════════════════════════════════

const VALID_PO_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  Draft: ['Sent'],
  Sent: ['PartiallyReceived', 'Received', 'Cancelled'],
  PartiallyReceived: ['Received', 'Cancelled'],
  Received: ['Cancelled'],
  Cancelled: [],
};

// ═════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════

function nowISO(): string {
  return new Date().toISOString();
}

function isNotDeleted(record: any): boolean {
  return !record?.isDeleted;
}

// ═════════════════════════════════════════════════════════════
//  1. validateVendor — Full vendor validation
// ═════════════════════════════════════════════════════════════

export async function validateVendor(vendorId: string): Promise<VendorValidation> {
  const errors: string[] = [];
  const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, vendorId);

  if (!vendor) {
    return { vendor: null, exists: false, isDeleted: false, hasPOs: false, hasGRs: false, poCount: 0, grCount: 0, valid: false, errors: ['Vendor not found'] };
  }

  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);

  const pos = allPOs.filter((po) => po.vendorId === vendorId && !po.isDeleted);
  const grs = allGRs.filter((gr) => gr.vendorId === vendorId && !gr.isDeleted);

  if (vendor.isDeleted) errors.push('Vendor is soft-deleted');

  return {
    vendor,
    exists: true,
    isDeleted: !!vendor.isDeleted,
    hasPOs: pos.length > 0,
    hasGRs: grs.length > 0,
    poCount: pos.length,
    grCount: grs.length,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  2. validatePurchaseOrder — Full PO validation
// ═════════════════════════════════════════════════════════════

export async function validatePurchaseOrder(poId: string): Promise<POValidation> {
  const errors: string[] = [];
  const po = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, poId);

  if (!po) {
    return { purchaseOrder: null, exists: false, isDeleted: false, vendorExists: false, hasLineItems: false, totalPositive: false, validStatus: false, hasGRs: false, grCount: 0, valid: false, errors: ['Purchase order not found'] };
  }

  if (po.isDeleted) errors.push('Purchase order is soft-deleted');

  let vendorExists = false;
  if (po.vendorId) {
    const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, po.vendorId);
    vendorExists = !!vendor && !vendor.isDeleted;
    if (!vendorExists) errors.push(`Referenced vendor ${po.vendorId} not found or deleted`);
  } else {
    errors.push('Purchase order has no vendorId');
  }

  const hasLineItems = po.items && po.items.length > 0;
  if (!hasLineItems) errors.push('Purchase order has no line items');

  const totalPositive = (po.total || 0) > 0;
  if (!totalPositive) errors.push('Purchase order total is not positive');

  // Validate status transition
  if (po.status && !VALID_PO_TRANSITIONS[po.status]) {
    errors.push(`Invalid purchase order status: ${po.status}`);
  }

  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);
  const grs = allGRs.filter((gr) => gr.purchaseOrderId === poId && !gr.isDeleted);

  return {
    purchaseOrder: po,
    exists: true,
    isDeleted: !!po.isDeleted,
    vendorExists,
    hasLineItems,
    totalPositive,
    validStatus: !!po.status && po.status in VALID_PO_TRANSITIONS,
    hasGRs: grs.length > 0,
    grCount: grs.length,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  3. validateGoodsReceipt — Full GR validation
// ═════════════════════════════════════════════════════════════

export async function validateGoodsReceipt(grnId: string): Promise<GRValidation> {
  const errors: string[] = [];
  const gr = await getOne<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS, grnId);

  if (!gr) {
    return { goodsReceipt: null, exists: false, isDeleted: false, poExists: false, vendorExists: false, warehouseExists: false, qtyValid: false, hasStockEntries: false, stockEntryCount: 0, valid: false, errors: ['Goods receipt not found'] };
  }

  if (gr.isDeleted) errors.push('Goods receipt is soft-deleted');

  // Validate PO exists
  let poExists = false;
  if (gr.purchaseOrderId) {
    const po = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, gr.purchaseOrderId);
    poExists = !!po && !po.isDeleted;
    if (!poExists) errors.push(`Referenced purchase order ${gr.purchaseOrderId} not found or deleted`);
  } else {
    errors.push('Goods receipt has no purchaseOrderId');
  }

  // Validate vendor exists
  let vendorExists = false;
  if (gr.vendorId) {
    const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, gr.vendorId);
    vendorExists = !!vendor && !vendor.isDeleted;
    if (!vendorExists) errors.push(`Referenced vendor ${gr.vendorId} not found or deleted`);
  } else {
    errors.push('Goods receipt has no vendorId');
  }

  // Validate received qty <= ordered qty
  let qtyValid = true;
  for (const item of gr.receivedItems || []) {
    if (item.qty > item.orderedQty) {
      qtyValid = false;
      errors.push(`Item ${item.product} (${item.productId}): received ${item.qty} > ordered ${item.orderedQty}`);
    }
  }

  const stockEntryCount = gr.stockEntries?.length || 0;
  const hasStockEntries = stockEntryCount > 0;

  return {
    goodsReceipt: gr,
    exists: true,
    isDeleted: !!gr.isDeleted,
    poExists,
    vendorExists,
    warehouseExists: !!gr.warehouseId,
    qtyValid,
    hasStockEntries,
    stockEntryCount,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  4. validateProcurementChain — Full chain walk for a vendor
// ═════════════════════════════════════════════════════════════

export async function validateProcurementChain(vendorId: string): Promise<{
  vendor: VendorRecord | null;
  vendorValid: boolean;
  links: ProcurementChainLink[];
  brokenLinks: number;
  healthy: boolean;
}> {
  const links: ProcurementChainLink[] = [];
  let brokenLinks = 0;

  // Step 1: Validate vendor
  const vendorResult = await validateVendor(vendorId);
  const vendorValid = vendorResult.valid;

  links.push({
    entityType: 'vendors',
    entityId: vendorId,
    valid: vendorValid,
    error: vendorValid ? undefined : vendorResult.errors.join('; '),
  });

  if (!vendorValid) brokenLinks++;

  // Step 2: Validate purchase orders
  if (vendorResult.vendor) {
    const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
    const pos = allPOs.filter((po) => po.vendorId === vendorId && !po.isDeleted);

    for (const po of pos) {
      const poResult = await validatePurchaseOrder(po.id);
      links.push({
        entityType: 'purchase_orders',
        entityId: po.id,
        valid: poResult.valid,
        error: poResult.valid ? undefined : poResult.errors.join('; '),
      });
      if (!poResult.valid) brokenLinks++;

      // Step 3: Validate goods receipts for this PO
      const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);
      const grs = allGRs.filter((gr) => gr.purchaseOrderId === po.id && !gr.isDeleted);

      for (const gr of grs) {
        const grResult = await validateGoodsReceipt(gr.id);
        links.push({
          entityType: 'goods_receipts',
          entityId: gr.id,
          valid: grResult.valid,
          error: grResult.valid ? undefined : grResult.errors.join('; '),
        });
        if (!grResult.valid) brokenLinks++;
      }
    }
  }

  return {
    vendor: vendorResult.vendor,
    vendorValid,
    links,
    brokenLinks,
    healthy: brokenLinks === 0,
  };
}

// ═════════════════════════════════════════════════════════════
//  5. validateOrphanPurchaseOrders — Orphan PO detection
// ═════════════════════════════════════════════════════════════

export async function validateOrphanPurchaseOrders(): Promise<{
  orphanCount: number;
  orphans: Array<{ poId: string; poNumber: string; vendorId: string; vendorName: string }>;
  healthy: boolean;
}> {
  const orphans: Array<{ poId: string; poNumber: string; vendorId: string; vendorName: string }> = [];
  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const activePOs = allPOs.filter((p) => !p.isDeleted);

  for (const po of activePOs) {
    if (!po.vendorId) {
      orphans.push({ poId: po.id, poNumber: po.purchaseOrderId, vendorId: '', vendorName: '' });
      continue;
    }
    const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, po.vendorId);
    if (!vendor || vendor.isDeleted) {
      orphans.push({ poId: po.id, poNumber: po.purchaseOrderId, vendorId: po.vendorId, vendorName: po.vendorName });
    }
  }

  return {
    orphanCount: orphans.length,
    orphans,
    healthy: orphans.length === 0,
  };
}

// ═════════════════════════════════════════════════════════════
//  6. validateOrphanGoodsReceipts — Orphan GR detection
// ═════════════════════════════════════════════════════════════

export async function validateOrphanGoodsReceipts(): Promise<{
  orphanCount: number;
  orphans: Array<{ grId: string; grNumber: string; purchaseOrderId: string; vendorName: string }>;
  healthy: boolean;
}> {
  const orphans: Array<{ grId: string; grNumber: string; purchaseOrderId: string; vendorName: string }> = [];
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);
  const activeGRs = allGRs.filter((g) => !g.isDeleted);

  for (const gr of activeGRs) {
    // Check PO exists
    if (gr.purchaseOrderId) {
      const po = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, gr.purchaseOrderId);
      if (!po || po.isDeleted) {
        orphans.push({ grId: gr.id, grNumber: gr.goodsReceiptId, purchaseOrderId: gr.purchaseOrderId, vendorName: gr.vendorName });
        continue;
      }
    } else {
      orphans.push({ grId: gr.id, grNumber: gr.goodsReceiptId, purchaseOrderId: '', vendorName: gr.vendorName });
      continue;
    }

    // Check vendor exists
    if (gr.vendorId) {
      const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, gr.vendorId);
      if (!vendor || vendor.isDeleted) {
        orphans.push({ grId: gr.id, grNumber: gr.goodsReceiptId, purchaseOrderId: gr.purchaseOrderId, vendorName: gr.vendorName });
      }
    }
  }

  return {
    orphanCount: orphans.length,
    orphans,
    healthy: orphans.length === 0,
  };
}

// ═════════════════════════════════════════════════════════════
//  7. validateDuplicatePurchaseOrders — Duplicate PO detection
// ═════════════════════════════════════════════════════════════

export async function validateDuplicatePurchaseOrders(): Promise<{
  duplicateCount: number;
  duplicates: Array<{ vendorId: string; vendorName: string; poNumbers: string[]; poIds: string[] }>;
  healthy: boolean;
}> {
  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const activePOs = allPOs.filter((p) => !p.isDeleted);

  // Group POs by vendor
  const groups = new Map<string, PurchaseOrderRecord[]>();
  for (const po of activePOs) {
    const key = po.vendorId || 'unknown';
    const existing = groups.get(key) || [];
    existing.push(po);
    groups.set(key, existing);
  }

  const duplicates: Array<{ vendorId: string; vendorName: string; poNumbers: string[]; poIds: string[] }> = [];

  // Check for POs with same vendor and similar amounts (potential duplicates)
  groups.forEach((pos, vendorId) => {
    if (pos.length <= 1) return;
    const vendorName = pos[0].vendorName;

    // Check for POs with same total amount (likely duplicates)
    const amountGroups = new Map<number, PurchaseOrderRecord[]>();
    for (const po of pos) {
      const total = po.total || 0;
      const existing = amountGroups.get(total) || [];
      existing.push(po);
      amountGroups.set(total, existing);
    }

    amountGroups.forEach((sameAmountPos) => {
      if (sameAmountPos.length <= 1) return;
      duplicates.push({
        vendorId,
        vendorName,
        poNumbers: sameAmountPos.map((p) => p.purchaseOrderId),
        poIds: sameAmountPos.map((p) => p.id),
      });
    });
  });

  return {
    duplicateCount: duplicates.length,
    duplicates,
    healthy: duplicates.length === 0,
  };
}

// ═════════════════════════════════════════════════════════════
//  8. validateInventoryImpact — Inventory reconciliation
// ═════════════════════════════════════════════════════════════

export async function validateInventoryImpact(grnId: string): Promise<{
  goodsReceipt: GoodsReceiptRecord | null;
  hasStockEntries: boolean;
  stockEntryCount: number;
  itemsWithoutStock: string[];
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const gr = await getOne<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS, grnId);

  if (!gr) {
    return { goodsReceipt: null, hasStockEntries: false, stockEntryCount: 0, itemsWithoutStock: [], valid: false, errors: ['Goods receipt not found'] };
  }

  const stockEntryCount = gr.stockEntries?.length || 0;
  const hasStockEntries = stockEntryCount > 0;
  const itemsWithoutStock: string[] = [];

  // Check each received item has a corresponding stock entry
  for (const item of gr.receivedItems || []) {
    const hasEntry = (gr.stockEntries || []).some((se) => se.productId === item.productId);
    if (!hasEntry) {
      itemsWithoutStock.push(item.product || item.productId);
      errors.push(`Item ${item.product} (${item.productId}) has no stock entry`);
    }
  }

  return {
    goodsReceipt: gr,
    hasStockEntries,
    stockEntryCount,
    itemsWithoutStock,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  9. validateVendorFinancials — Vendor financial validation
// ═════════════════════════════════════════════════════════════

export async function validateVendorFinancials(vendorId: string): Promise<{
  vendor: VendorRecord | null;
  totalPOValue: number;
  totalGRValue: number;
  outstandingValue: number;
  poCount: number;
  grCount: number;
  valid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, vendorId);

  if (!vendor) {
    return { vendor: null, totalPOValue: 0, totalGRValue: 0, outstandingValue: 0, poCount: 0, grCount: 0, valid: false, errors: ['Vendor not found'] };
  }

  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);

  const pos = allPOs.filter((po) => po.vendorId === vendorId && !po.isDeleted);
  const grs = allGRs.filter((gr) => gr.vendorId === vendorId && !gr.isDeleted);

  const totalPOValue = pos.reduce((sum, po) => sum + (po.total || 0), 0);
  // GR items carry no price data — totalGRValue cannot be computed from receipt data alone
  const totalGRValue = 0;

  // Outstanding = unreconciled PO value
  const completedPOs = pos.filter((po) => po.status === 'Received');
  const completedValue = completedPOs.reduce((sum, po) => sum + (po.total || 0), 0);
  const outstandingValue = totalPOValue - completedValue;

  return {
    vendor,
    totalPOValue,
    totalGRValue,
    outstandingValue,
    poCount: pos.length,
    grCount: grs.length,
    valid: errors.length === 0,
    errors,
  };
}

// ═════════════════════════════════════════════════════════════
//  10. generateProcurementHealthReport — Full health report
// ═════════════════════════════════════════════════════════════

export async function generateProcurementHealthReport(): Promise<ProcurementHealthReport> {
  const allVendors = await getAll<VendorRecord>(COLLECTIONS.VENDORS);
  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);

  const activeVendors = allVendors.filter((v) => !v.isDeleted);
  const activePOs = allPOs.filter((p) => !p.isDeleted);
  const activeGRs = allGRs.filter((g) => !g.isDeleted);

  // Count healthy chains (vendor with at least one PO that has GRs)
  let healthyChains = 0;
  let brokenChains = 0;
  let inventoryMismatches = 0;

  for (const vendor of activeVendors) {
    const pos = activePOs.filter((p) => p.vendorId === vendor.id);

    if (pos.length === 0) {
      brokenChains++;
      continue;
    }

    let hasHealthyPO = false;
    for (const po of pos) {
      const grs = activeGRs.filter((g) => g.purchaseOrderId === po.id);
      if (grs.length > 0) {
        hasHealthyPO = true;
        // Check inventory impact for each GR
        for (const gr of grs) {
          if (!gr.stockEntries || gr.stockEntries.length === 0) {
            inventoryMismatches++;
          }
        }
      }
    }

    if (hasHealthyPO) {
      healthyChains++;
    } else {
      brokenChains++;
    }
  }

  // Orphan detection
  const orphanPOs = await validateOrphanPurchaseOrders();
  const orphanGRs = await validateOrphanGoodsReceipts();

  // Duplicate detection
  const duplicatePOs = await validateDuplicatePurchaseOrders();

  return {
    totalVendors: activeVendors.length,
    totalPurchaseOrders: activePOs.length,
    totalGoodsReceipts: activeGRs.length,
    healthyChains,
    brokenChains,
    orphanPurchaseOrders: orphanPOs.orphanCount,
    orphanGoodsReceipts: orphanGRs.orphanCount,
    duplicatePurchaseOrders: duplicatePOs.duplicateCount,
    inventoryMismatches,
    validationTimestamp: nowISO(),
  };
}

// ═════════════════════════════════════════════════════════════
//  11. repairProcurementChain — Chain repair utility (dry-run safe)
// ═════════════════════════════════════════════════════════════

export async function repairProcurementChain(
  entityId: string,
  options: { dryRun?: boolean; entityType?: string } = {},
): Promise<RepairSummary> {
  const dryRun = options.dryRun !== false;
  const entityType = options.entityType || 'purchase_orders';

  const summary: RepairSummary = {
    dryRun,
    entityType,
    entityId,
    checksPerformed: 0,
    issuesFound: 0,
    issuesFixed: 0,
    repairsApplied: [],
  };

  if (entityType === 'purchase_orders') {
    const po = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, entityId);
    summary.checksPerformed++;

    if (!po) {
      summary.repairsApplied.push({ target: entityId, field: 'record', oldValue: null, newValue: null, action: 'error', error: 'Purchase order not found' });
      summary.issuesFound++;
      return summary;
    }

    // Fix missing vendorId
    if (!po.vendorId) {
      summary.issuesFound++;
      summary.repairsApplied.push({ target: entityId, field: 'vendorId', oldValue: null, newValue: null, action: 'skip', error: 'Cannot auto-fix missing vendorId' });
    }

    // Fix invalid status transition
    if (po.status && !VALID_PO_TRANSITIONS[po.status]) {
      summary.issuesFound++;
      summary.repairsApplied.push({ target: entityId, field: 'status', oldValue: po.status, newValue: 'Draft', action: dryRun ? 'skip' : 'fix' });
      if (!dryRun) {
        await updateDocById(COLLECTIONS.PURCHASE_ORDERS, entityId, { status: 'Draft' });
        summary.issuesFixed++;
      }
    }

    // Fix vendor reference
    if (po.vendorId) {
      const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, po.vendorId);
      if (!vendor || vendor.isDeleted) {
        summary.issuesFound++;
        summary.repairsApplied.push({ target: entityId, field: 'vendorId', oldValue: po.vendorId, newValue: null, action: 'skip', error: 'Vendor not found — manual intervention required' });
      }
    }
  } else if (entityType === 'goods_receipts') {
    const gr = await getOne<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS, entityId);
    summary.checksPerformed++;

    if (!gr) {
      summary.repairsApplied.push({ target: entityId, field: 'record', oldValue: null, newValue: null, action: 'error', error: 'Goods receipt not found' });
      summary.issuesFound++;
      return summary;
    }

    // Fix missing PO reference
    if (!gr.purchaseOrderId) {
      summary.issuesFound++;
      summary.repairsApplied.push({ target: entityId, field: 'purchaseOrderId', oldValue: null, newValue: null, action: 'skip', error: 'Cannot auto-fix missing purchaseOrderId' });
    }

    // Fix missing vendorId
    if (!gr.vendorId) {
      summary.issuesFound++;
      summary.repairsApplied.push({ target: entityId, field: 'vendorId', oldValue: null, newValue: null, action: 'skip', error: 'Cannot auto-fix missing vendorId' });
    }
  }

  return summary;
}

export const procurementValidationEngine = {
  validateVendor,
  validatePurchaseOrder,
  validateGoodsReceipt,
  validateProcurementChain,
  validateOrphanPurchaseOrders,
  validateOrphanGoodsReceipts,
  validateDuplicatePurchaseOrders,
  validateInventoryImpact,
  validateVendorFinancials,
  generateProcurementHealthReport,
  repairProcurementChain,
};

export default procurementValidationEngine;
