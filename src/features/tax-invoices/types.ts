import type { BaseRecord } from '../../types';

export type TaxInvoiceStatus = 'Draft' | 'Issued' | 'Cancelled';
export type TaxInvoiceSourceType = 'order' | 'proforma_invoice';

export interface TaxInvoiceLineItemForm {
  productId?: string;
  product?: string;
  description?: string;
  hsn: string;
  quantity: number;
  rate: number;
  taxRate: number;
}

export interface TaxInvoiceLineItem extends TaxInvoiceLineItemForm {
  taxableValue: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  lineTotal: number;
}

export interface TaxInvoiceFormState {
  id?: string;
  sourceType: TaxInvoiceSourceType;
  sourceId: string;
  orderId?: string;
  sourcePiId?: string;
  invoiceNumber?: string;
  serialNumber?: number;
  fiscalYear?: string;
  date: string;
  status: TaxInvoiceStatus;
  companyId: string;
  companyName: string;
  companyGst: string;
  companyState: string;
  customerId: string;
  customerName: string;
  customerGst: string;
  customerState: string;
  placeOfSupply: string;
  items: TaxInvoiceLineItemForm[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  total: number;
  notes: string;
  issuedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface TaxInvoiceRecord extends BaseRecord {
  invoiceNumber: string;
  serialNumber: number;
  fiscalYear: string;
  sourceType: TaxInvoiceSourceType;
  sourceId: string;
  orderId?: string;
  sourcePiId?: string;
  date: string;
  status: TaxInvoiceStatus;
  companyName: string;
  companyGst: string;
  companyState: string;
  customerId: string;
  customerName: string;
  customerGst: string;
  customerState: string;
  placeOfSupply: string;
  items: TaxInvoiceLineItem[];
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  total: number;
  notes: string;
  issuedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
}
