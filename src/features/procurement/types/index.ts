import type { BaseRecord } from '../../../types';

export interface VendorContactInfo {
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
}

export interface VendorRecord extends BaseRecord {
  vendorId: string;
  name: string;
  gstin: string;
  contactInfo: VendorContactInfo;
  paymentTerms: string;
  categoryTags: string[];
}

export interface VendorFormValues {
  name: string;
  gstin: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  paymentTerms: string;
  categoryTags: string;
}

export const VENDOR_FORM_DEFAULT: VendorFormValues = {
  name: '', gstin: '', contactPerson: '', phone: '', email: '', address: '', paymentTerms: '', categoryTags: '',
};

export type PurchaseOrderStatus = 'Draft' | 'Sent' | 'PartiallyReceived' | 'Received' | 'Cancelled';

export interface PurchaseOrderItem {
  productId: string;
  product: string;
  description: string;
  hsn: string;
  qty: number;
  unit: string;
  price: number;
  tax: number;
  discount: number;
  taxableValue: number;
  taxAmount: number;
  total: number;
  receivedQty?: number;
  remainingQty?: number;
}

export interface PurchaseOrderRecord extends BaseRecord {
  purchaseOrderId: string;
  vendorId: string;
  vendorName: string;
  vendorGstin: string;
  projectId?: string;
  projectName?: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate: string;
  items: PurchaseOrderItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  notes: string;
  statusHistory: Array<{ status: PurchaseOrderStatus; changedAt: string; changedBy: string }>;
}

export interface PurchaseOrderItemForm {
  productId: string; product: string; description: string; hsn: string;
  qty: string; unit: string; price: string; tax: string; discount: string;
}

export interface PurchaseOrderFormValues {
  vendorId: string;
  projectId: string;
  orderDate: string;
  expectedDeliveryDate: string;
  notes: string;
  items: PurchaseOrderItemForm[];
}

export const PURCHASE_ORDER_ITEM_DEFAULT: PurchaseOrderItemForm = { productId: '', product: '', description: '', hsn: '', qty: '1', unit: 'Nos', price: '', tax: '0', discount: '0' };
export const PURCHASE_ORDER_FORM_DEFAULT: PurchaseOrderFormValues = { vendorId: '', projectId: '', orderDate: '', expectedDeliveryDate: '', notes: '', items: [{ ...PURCHASE_ORDER_ITEM_DEFAULT }] };
export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = ['Draft', 'Sent', 'PartiallyReceived', 'Received', 'Cancelled'];

export interface GoodsReceiptItem {
  lineIndex: number;
  productId: string;
  product: string;
  qty: number;
  unit: string;
  orderedQty: number;
  previouslyReceivedQty: number;
}

export interface GoodsReceiptStockEntry {
  productId: string;
  stockId: string;
  ledgerId: string;
  transactionId: string;
}

export interface GoodsReceiptRecord extends BaseRecord {
  goodsReceiptId: string;
  purchaseOrderId: string;
  vendorId: string;
  vendorName: string;
  projectId?: string;
  projectName?: string;
  warehouseId: string;
  warehouseName: string;
  receivedDate: string;
  receivedBy: string;
  notes: string;
  receivedItems: GoodsReceiptItem[];
  stockEntries: GoodsReceiptStockEntry[];
}

export interface GoodsReceiptFormValues {
  purchaseOrderId: string;
  projectId: string;
  projectName: string;
  warehouseId: string;
  receivedDate: string;
  notes: string;
  quantities: Record<number, string>;
}
