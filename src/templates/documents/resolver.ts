import { CompanyConfig } from '../../config/company';

import { renderDispatchChallan } from './Dispatch';
import { generateQuotationHtml } from './Quotation';

export type DocType = 'PROFORMA INVOICE' | 'QUOTATION' | 'INVOICE' | 'DISPATCH CHALLAN';

/**
 * Resolves and renders the requested document type utilizing the company branding assets
 * and the specific A4 document template architectures.
 */
import { generatePIHtml, PIData } from './PI';

function mapToPIData(company: CompanyConfig, docType: DocType, data: any): PIData {
  return {
    documentTitle: docType,
    invoice: {
      piId: data.invoiceNumber || data.piNumber || data.refNo || data.id,
      orderId: data.orderId || '—',
      subtotal: Number(data.subtotal) || 0,
      gst: Number(data.taxAmount) || 0,
      grandTotal: Number(data.total) || 0
    },
    customer: {
      name: data.customer || '—',
      address: data.deliveryAddress || data.address || '',
      city: data.city || '',
      phone: data.phone || '',
      gstin: data.customerGst || '',
      pan: data.customerPan || '',
      customerId: data.customerId || ''
    },
    items: (data.items || []).map((it: any) => {
      const qty = Number(it.qty) || 0;
      const rate = Number(it.price) || 0;
      const amount = qty * rate;
      const gstPercent = Number(it.tax) || 0;
      const gstAmount = amount * (gstPercent / 100);
      return {
        product: it.product,
        quantity: qty,
        rate: rate,
        amount: amount,
        gstPercent: gstPercent,
        gstAmount: gstAmount,
        total: amount + gstAmount,
        hsn: it.hsn || ''
      };
    }),
    company: {
      companyCode: company.companyCode || 'CGPL',
      companyName: company.name,
      shortName: company.shortName,
      address: company.address + ', ' + company.city + ', ' + company.state + ' - ' + company.pincode,
      phone: company.phone,
      email: company.email,
      gstin: company.gst,
      bankName: company.bankName,
      branch: company.bankBranch,
      accountNo: company.bankAccount,
      ifsc: company.bankIfsc,
      upiId: company.qrCode ? 'Scannable via QR' : '', 
      logo: company.logo,
      qr: company.qrCode,
      signature: company.signature,
      cin: company.cin,
      pan: company.pan,
      website: company.website
    },
    invoiceDate: new Date(data.date || data.createdAt || Date.now()).toLocaleDateString('en-IN')
  };
}

export function DocumentTemplateResolver(company: CompanyConfig, docType: DocType, docData: any): string {
  switch (docType) {
    case 'QUOTATION':
      return generateQuotationHtml({
        id: docData.id, refNo: docData.refNo || docData.id,
        date: docData.date, validUntil: docData.validUntil,
        customer: docData.customer || '—',
        customerAddress: docData.customerAddress || docData.deliveryAddress || docData.address || '',
        customerPhone: docData.customerPhone || docData.phone || '',
        customerEmail: docData.customerEmail || docData.email || '',
        customerGst: docData.customerGst || '', customerState: docData.customerState || '',
        items: (docData.items || []).map((it: any) => ({
          product: it.product || '', description: it.description || '', hsn: it.hsn || '',
          specs: it.specs || '', warranty: it.warranty || '', qty: Number(it.qty) || 1,
          unit: it.unit || 'Nos', price: Number(it.price) || 0, tax: Number(it.tax) || 0, discount: Number(it.discount) || 0,
        })),
        subtotal: Number(docData.subtotal) || 0, taxTotal: Number(docData.taxTotal) || 0,
        discount: Number(docData.discount) || 0, total: Number(docData.total) || 0,
        notes: docData.notes || '', terms: docData.terms || '',
        deliveryTimeline: docData.deliveryTimeline || '',
        installationCharges: Number(docData.installationCharges) || 0,
        transportCharges: Number(docData.transportCharges) || 0,
        specialDiscount: Number(docData.specialDiscount) || 0,
        company: {
          name: company.name, shortName: company.shortName,
          address: company.address + ', ' + company.city + ', ' + company.state + ' - ' + company.pincode,
          phone: company.phone, email: company.email, gstin: company.gst,
          cin: company.cin, pan: company.pan, bankName: company.bankName,
          bankAccount: company.bankAccount, bankIfsc: company.bankIfsc, bankBranch: company.bankBranch,
          logo: company.logo, qr: company.qrCode, signature: company.signature, website: company.website,
        },
      });

    case 'PROFORMA INVOICE':
    case 'INVOICE':
      const piData = mapToPIData(company, docType, docData);
      return generatePIHtml(piData);
    
    case 'DISPATCH CHALLAN':
      return renderDispatchChallan(company, docData);

    default:
      return `<html><body><h1>Unknown Document Type: ${docType}</h1></body></html>`;
  }
}

/**
 * Triggers the browser print dialog. 
 * Supports "Save as PDF" through the browser's native print engine.
 */
export function triggerPrint(html: string) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow popups for printing.');
    return;
  }
  win.document.write(html);
  win.document.close();
  
  // Wait for Base64 images to render on the DOM before firing print()
  setTimeout(() => {
    win.focus();
    win.print();
  }, 500);
}