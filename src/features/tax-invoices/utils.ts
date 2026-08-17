import type { CompanyConfig, Order, Product, ProformaInvoice } from '../../types';
import {
  calculateGstBreakdown,
  type GstInvoiceBreakdown,
  type GstPartyInput,
} from '../../lib/gstCalculation';
import type {
  TaxInvoiceFormState,
  TaxInvoiceRecord,
  TaxInvoiceLineItemForm,
  TaxInvoiceSourceType,
} from './types';

type SourceItem = {
  productId?: string;
  product?: string;
  description?: string;
  hsn?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  rate?: number;
  tax?: number;
};

type SourceCustomer = {
  id?: string;
  name?: string;
  customer?: string;
  customerName?: string;
  gst?: string;
  customerGst?: string;
  state?: string;
  customerState?: string;
};

function toMap(products: Product[] = []) {
  return new Map(products.map((product) => [product.id, product] as const));
}

function resolveCustomerName(source: SourceCustomer, fallback = '') {
  return String(source.customerName || source.customer || source.name || fallback || '').trim();
}

function resolveCustomerGst(source: SourceCustomer) {
  return String(source.customerGst || source.gst || '').trim().toUpperCase();
}

function resolveCustomerState(source: SourceCustomer) {
  return String(source.customerState || source.state || '').trim();
}

function sourceCompany(company: CompanyConfig): GstPartyInput {
  return {
    gstin: company.gst,
    state: company.state,
  };
}

function sourceCustomer(customer: SourceCustomer): GstPartyInput {
  return {
    gstin: resolveCustomerGst(customer),
    state: resolveCustomerState(customer),
  };
}

function sourceLineItems(items: SourceItem[] = [], productsById = new Map<string, Product>()) {
  return items.map<TaxInvoiceLineItemForm>((item) => {
    const product = item.productId ? productsById.get(String(item.productId)) : undefined;
    return {
      productId: item.productId,
      product: String(item.product || product?.name || '').trim(),
      description: String(item.description || product?.name || item.product || '').trim(),
      hsn: String(item.hsn || (product as any)?.hsn || '').trim(),
      quantity: Number(item.qty ?? item.quantity ?? 0) || 0,
      rate: Number(item.price ?? item.rate ?? 0) || 0,
      taxRate: Number(item.tax ?? product?.tax ?? 0) || 0,
    };
  });
}

function buildBaseForm(sourceType: TaxInvoiceSourceType, sourceId: string, company: CompanyConfig, customer: SourceCustomer, items: TaxInvoiceLineItemForm[], date?: string): TaxInvoiceFormState {
  const breakdown = calculateGstBreakdown(items, sourceCompany(company), sourceCustomer(customer));
  return {
    sourceType,
    sourceId,
    orderId: sourceType === 'order' ? sourceId : undefined,
    sourcePiId: sourceType === 'proforma_invoice' ? sourceId : undefined,
    date: date || new Date().toISOString().split('T')[0],
    status: 'Draft',
    companyId: company.id,
    companyName: company.shortName || company.name,
    companyGst: company.gst || '',
    companyState: company.state || '',
    customerId: String(customer.id || ''),
    customerName: resolveCustomerName(customer),
    customerGst: resolveCustomerGst(customer),
    customerState: resolveCustomerState(customer) || breakdown.customer.stateName,
    placeOfSupply: breakdown.placeOfSupply,
    items,
    subtotal: breakdown.subtotal,
    cgst: breakdown.cgst,
    sgst: breakdown.sgst,
    igst: breakdown.igst,
    totalTax: breakdown.totalTax,
    total: breakdown.grandTotal,
    notes: '',
  };
}

export function summarizeTaxInvoiceForm(form: TaxInvoiceFormState): GstInvoiceBreakdown {
  return calculateGstBreakdown(
    form.items,
    { gstin: form.companyGst, state: form.companyState },
    { gstin: form.customerGst, state: form.customerState }
  );
}

export function recalculateTaxInvoiceForm(form: TaxInvoiceFormState): TaxInvoiceFormState {
  const breakdown = summarizeTaxInvoiceForm(form);
  return {
    ...form,
    placeOfSupply: breakdown.placeOfSupply,
    subtotal: breakdown.subtotal,
    cgst: breakdown.cgst,
    sgst: breakdown.sgst,
    igst: breakdown.igst,
    totalTax: breakdown.totalTax,
    total: breakdown.grandTotal,
  };
}

export function buildTaxInvoiceDraftFromOrder(order: Order, company: CompanyConfig, products: Product[] = [], customer: SourceCustomer = order as unknown as SourceCustomer): TaxInvoiceFormState {
  return buildBaseForm('order', order.id, company, customer, sourceLineItems((order.items || []) as SourceItem[], toMap(products)), String(order.date || new Date().toISOString().split('T')[0]));
}

export function buildTaxInvoiceDraftFromProformaInvoice(pi: ProformaInvoice, company: CompanyConfig, products: Product[] = [], customer: SourceCustomer = pi as unknown as SourceCustomer): TaxInvoiceFormState {
  return buildBaseForm('proforma_invoice', pi.id, company, customer, sourceLineItems((pi.items || []) as SourceItem[], toMap(products)), String(pi.date || new Date().toISOString().split('T')[0]));
}

export function createEmptyTaxInvoiceForm(company: CompanyConfig): TaxInvoiceFormState {
  return {
    sourceType: 'order',
    sourceId: '',
    date: new Date().toISOString().split('T')[0],
    status: 'Draft',
    companyId: company.id,
    companyName: company.shortName || company.name,
    companyGst: company.gst || '',
    companyState: company.state || '',
    customerId: '',
    customerName: '',
    customerGst: '',
    customerState: '',
    placeOfSupply: company.state || '',
    items: [],
    subtotal: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalTax: 0,
    total: 0,
    notes: '',
  };
}

export function buildTaxInvoiceFormFromRecord(record: TaxInvoiceRecord): TaxInvoiceFormState {
  return {
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    orderId: record.orderId,
    sourcePiId: record.sourcePiId,
    invoiceNumber: record.invoiceNumber,
    serialNumber: record.serialNumber,
    fiscalYear: record.fiscalYear,
    date: record.date,
    status: record.status,
    companyId: record.companyId,
    companyName: record.companyName,
    companyGst: record.companyGst,
    companyState: record.companyState,
    customerId: record.customerId,
    customerName: record.customerName,
    customerGst: record.customerGst,
    customerState: record.customerState,
    placeOfSupply: record.placeOfSupply,
    items: record.items.map((item) => ({
      productId: item.productId,
      product: item.product,
      description: item.description,
      hsn: item.hsn,
      quantity: item.quantity,
      rate: item.rate,
      taxRate: item.taxRate,
    })),
    subtotal: record.subtotal,
    cgst: record.cgst,
    sgst: record.sgst,
    igst: record.igst,
    totalTax: record.totalTax,
    total: record.total,
    notes: record.notes,
    issuedAt: record.issuedAt,
    cancelledAt: record.cancelledAt,
    cancellationReason: record.cancellationReason,
  };
}
