/**
 * procurementLinkedRecords — Procurement Linked Records verification and enhancement
 *
 * Phase 4D: Read-only verification of the complete Procurement relationship chain.
 *
 * Master Procurement Workflow:
 *   Vendor → Purchase Order → Goods Receipt → Stock Summary → Stock Ledger → Dispatch
 *
 * Every function is READ-ONLY. No Firestore writes.
 */

import { getAll, getOne } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import type { VendorRecord, PurchaseOrderRecord, GoodsReceiptRecord } from '../types';

// ── Types ──────────────────────────────────────────────────

export interface VendorRelationships {
  vendorId: string;
  vendorName: string;
  purchaseOrders: PurchaseOrderRecord[];
  goodsReceipts: GoodsReceiptRecord[];
  hasOrphans: boolean;
  orphanDetails: string[];
}

export interface PurchaseOrderRelationships {
  purchaseOrderId: string;
  vendorId: string;
  vendorName: string;
  vendorExists: boolean;
  goodsReceipts: GoodsReceiptRecord[];
  hasOrphans: boolean;
  orphanDetails: string[];
}

export interface GoodsReceiptRelationships {
  goodsReceiptId: string;
  purchaseOrderId: string;
  vendorId: string;
  purchaseOrderExists: boolean;
  vendorExists: boolean;
  stockEntries: number;
  hasOrphans: boolean;
  orphanDetails: string[];
}

export interface ProcurementHealthReport {
  totalVendors: number;
  totalPurchaseOrders: number;
  totalGoodsReceipts: number;
  orphanRecords: number;
  brokenRelationships: number;
  invalidRoutes: number;
  vendorHealth: { total: number; withPOs: number; withGRs: number; orphans: number };
  poHealth: { total: number; withVendor: number; withGRs: number; orphans: number };
  grHealth: { total: number; withPO: number; withVendor: number; withStock: number; orphans: number };
  validationTimestamp: string;
  details: {
    vendorsWithOrphans: string[];
    posWithOrphans: string[];
    grsWithOrphans: string[];
  };
}

// ── Validation Utilities ─────────────────────────────────

/**
 * Validate all relationships for a single vendor.
 */
export async function validateVendorRelationships(vendorId: string): Promise<VendorRelationships> {
  const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, vendorId);
  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);

  const pos = allPOs.filter((po) => po.vendorId === vendorId && !po.isDeleted);
  const grs = allGRs.filter((gr) => gr.vendorId === vendorId && !gr.isDeleted);

  const orphanDetails: string[] = [];
  if (!vendor || vendor.isDeleted) orphanDetails.push(`Vendor ${vendorId} is deleted or missing`);

  return {
    vendorId,
    vendorName: vendor?.name || 'Unknown',
    purchaseOrders: pos,
    goodsReceipts: grs,
    hasOrphans: orphanDetails.length > 0,
    orphanDetails,
  };
}

/**
 * Validate all relationships for a single purchase order.
 */
export async function validatePurchaseOrderRelationships(poId: string): Promise<PurchaseOrderRelationships> {
  const po = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, poId);
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);

  let vendorExists = false;
  if (po?.vendorId) {
    const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, po.vendorId);
    vendorExists = !!vendor && !vendor.isDeleted;
  }

  const grs = allGRs.filter((gr) => gr.purchaseOrderId === poId && !gr.isDeleted);

  const orphanDetails: string[] = [];
  if (!po || po.isDeleted) orphanDetails.push(`PO ${poId} is deleted or missing`);
  if (po?.vendorId && !vendorExists) orphanDetails.push(`Vendor ${po.vendorId} is missing (referenced by PO ${poId})`);

  return {
    purchaseOrderId: po?.purchaseOrderId || poId,
    vendorId: po?.vendorId || '',
    vendorName: po?.vendorName || 'Unknown',
    vendorExists,
    goodsReceipts: grs,
    hasOrphans: orphanDetails.length > 0,
    orphanDetails,
  };
}

/**
 * Validate all relationships for a single goods receipt.
 */
export async function validateGoodsReceiptRelationships(grId: string): Promise<GoodsReceiptRelationships> {
  const gr = await getOne<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS, grId);

  let purchaseOrderExists = false;
  let vendorExists = false;

  if (gr?.purchaseOrderId) {
    const po = await getOne<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS, gr.purchaseOrderId);
    purchaseOrderExists = !!po && !po.isDeleted;
  }

  if (gr?.vendorId) {
    const vendor = await getOne<VendorRecord>(COLLECTIONS.VENDORS, gr.vendorId);
    vendorExists = !!vendor && !vendor.isDeleted;
  }

  const orphanDetails: string[] = [];
  if (!gr || gr.isDeleted) orphanDetails.push(`GR ${grId} is deleted or missing`);
  if (gr?.purchaseOrderId && !purchaseOrderExists) orphanDetails.push(`PO ${gr.purchaseOrderId} is missing (referenced by GR ${grId})`);
  if (gr?.vendorId && !vendorExists) orphanDetails.push(`Vendor ${gr.vendorId} is missing (referenced by GR ${grId})`);

  return {
    goodsReceiptId: gr?.goodsReceiptId || grId,
    purchaseOrderId: gr?.purchaseOrderId || '',
    vendorId: gr?.vendorId || '',
    purchaseOrderExists,
    vendorExists,
    stockEntries: gr?.stockEntries?.length || 0,
    hasOrphans: orphanDetails.length > 0,
    orphanDetails,
  };
}

/**
 * Validate all Procurement relationships across all entities.
 */
export async function validateProcurementRelationships(): Promise<{
  vendors: VendorRelationships[];
  purchaseOrders: PurchaseOrderRelationships[];
  goodsReceipts: GoodsReceiptRelationships[];
  totalOrphans: number;
  totalBroken: number;
}> {
  const allVendors = await getAll<VendorRecord>(COLLECTIONS.VENDORS);
  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);

  const activeVendors = allVendors.filter((v) => !v.isDeleted);
  const activePOs = allPOs.filter((po) => !po.isDeleted);
  const activeGRs = allGRs.filter((gr) => !gr.isDeleted);

  // Validate each vendor
  const vendorResults: VendorRelationships[] = [];
  let totalOrphans = 0;
  let totalBroken = 0;

  for (const v of activeVendors) {
    const result = await validateVendorRelationships(v.id);
    vendorResults.push(result);
    if (result.hasOrphans) totalOrphans++;
  }

  // Validate each PO
  const poResults: PurchaseOrderRelationships[] = [];
  for (const po of activePOs) {
    const result = await validatePurchaseOrderRelationships(po.id);
    poResults.push(result);
    if (result.hasOrphans) totalOrphans++;
    if (po.vendorId && !result.vendorExists) totalBroken++;
  }

  // Validate each GR
  const grResults: GoodsReceiptRelationships[] = [];
  for (const gr of activeGRs) {
    const result = await validateGoodsReceiptRelationships(gr.id);
    grResults.push(result);
    if (result.hasOrphans) totalOrphans++;
    if ((gr.purchaseOrderId && !result.purchaseOrderExists) || (gr.vendorId && !result.vendorExists)) totalBroken++;
  }

  return {
    vendors: vendorResults,
    purchaseOrders: poResults,
    goodsReceipts: grResults,
    totalOrphans,
    totalBroken,
  };
}

/**
 * Generate a comprehensive Procurement Health Report.
 */
export async function generateProcurementHealthReport(): Promise<ProcurementHealthReport> {
  const allVendors = await getAll<VendorRecord>(COLLECTIONS.VENDORS);
  const allPOs = await getAll<PurchaseOrderRecord>(COLLECTIONS.PURCHASE_ORDERS);
  const allGRs = await getAll<GoodsReceiptRecord>(COLLECTIONS.GOODS_RECEIPTS);

  const activeVendors = allVendors.filter((v) => !v.isDeleted);
  const activePOs = allPOs.filter((po) => !po.isDeleted);
  const activeGRs = allGRs.filter((gr) => !gr.isDeleted);

  // Vendor health
  let vendorsWithPOs = 0;
  let vendorsWithGRs = 0;
  let vendorOrphans = 0;
  const vendorsWithOrphans: string[] = [];

  for (const v of activeVendors) {
    const pos = activePOs.filter((po) => po.vendorId === v.id);
    const grs = activeGRs.filter((gr) => gr.vendorId === v.id);
    if (pos.length > 0) vendorsWithPOs++;
    if (grs.length > 0) vendorsWithGRs++;
    if (pos.length === 0 && grs.length === 0) {
      vendorOrphans++;
      vendorsWithOrphans.push(v.name || v.id);
    }
  }

  // PO health
  let posWithVendor = 0;
  let posWithGRs = 0;
  let poOrphans = 0;
  const posWithOrphans: string[] = [];

  for (const po of activePOs) {
    const vendor = po.vendorId ? activeVendors.find((v) => v.id === po.vendorId) : undefined;
    const grs = activeGRs.filter((gr) => gr.purchaseOrderId === po.id);
    if (vendor) posWithVendor++;
    if (grs.length > 0) posWithGRs++;
    if (!vendor) {
      poOrphans++;
      posWithOrphans.push(po.purchaseOrderId || po.id);
    }
  }

  // GR health
  let grsWithPO = 0;
  let grsWithVendor = 0;
  let grsWithStock = 0;
  let grOrphans = 0;
  const grsWithOrphans: string[] = [];

  for (const gr of activeGRs) {
    const po = gr.purchaseOrderId ? activePOs.find((p) => p.id === gr.purchaseOrderId) : undefined;
    const vendor = gr.vendorId ? activeVendors.find((v) => v.id === gr.vendorId) : undefined;
    if (po) grsWithPO++;
    if (vendor) grsWithVendor++;
    if (gr.stockEntries?.length > 0) grsWithStock++;
    if (!po || !vendor) {
      grOrphans++;
      grsWithOrphans.push(gr.goodsReceiptId || gr.id);
    }
  }

  const totalOrphans = vendorOrphans + poOrphans + grOrphans;
  const totalBroken = (activePOs.length - posWithVendor) + (activeGRs.length - grsWithPO) + (activeGRs.length - grsWithVendor);

  return {
    totalVendors: activeVendors.length,
    totalPurchaseOrders: activePOs.length,
    totalGoodsReceipts: activeGRs.length,
    orphanRecords: totalOrphans,
    brokenRelationships: totalBroken,
    invalidRoutes: 0,
    vendorHealth: { total: activeVendors.length, withPOs: vendorsWithPOs, withGRs: vendorsWithGRs, orphans: vendorOrphans },
    poHealth: { total: activePOs.length, withVendor: posWithVendor, withGRs: posWithGRs, orphans: poOrphans },
    grHealth: { total: activeGRs.length, withPO: grsWithPO, withVendor: grsWithVendor, withStock: grsWithStock, orphans: grOrphans },
    validationTimestamp: new Date().toISOString(),
    details: {
      vendorsWithOrphans,
      posWithOrphans,
      grsWithOrphans,
    },
  };
}
