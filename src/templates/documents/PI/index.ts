/**
 * Proforma Invoice HTML Generator
 * Exact replica of the GAS HTML template — both CGPL and STS companies
 * Uses base64 images stored in Firestore company document
 */

import { b64ToSrc } from '../shared/utils';

function n(v: any, dec = 2): string {
  return (parseFloat(v) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function nInt(v: any): string {
  return (parseFloat(v) || 0).toLocaleString('en-IN');
}

function numberToWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function words(num: number): string {
    if (num === 0) return '';
    if (num < 20)  return ones[num] + ' ';
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '') + ' ';
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred ' + words(num % 100);
    if (num < 100000)  return words(Math.floor(num / 1000)) + 'Thousand ' + words(num % 1000);
    if (num < 10000000) return words(Math.floor(num / 100000)) + 'Lakh ' + words(num % 100000);
    return words(Math.floor(num / 10000000)) + 'Crore ' + words(num % 10000000);
  }

  const rounded = Math.round(amount);
  if (rounded === 0) return 'Zero';
  return words(rounded).trim();
}

export type PIData = {
  documentTitle?: string;
  invoice: {
    piId:       string;
    orderId:    string;
    subtotal:   number;
    gst:        number;
    grandTotal: number;
  };
  customer: {
    name:       string;
    address?:   string;
    city?:      string;
    phone?:     string;
    gstin?:     string;
    pan?:       string;
    customerId?:string;
  };
  items: {
    product:    string;
    quantity:   number;
    rate:       number;
    amount:     number;
    gstPercent: number;
    gstAmount:  number;
    total:      number;
  }[];
  company: {
    companyCode:  string;   // 'CGPL' | 'STS'
    companyName:  string;
    shortName?:   string;
    address:      string;
    phone:        string;
    email:        string;
    gstin:        string;
    bankName:     string;
    branch:       string;
    accountNo:    string;
    ifsc:         string;
    upiId?:       string;
    logo?:        string;
    qr?:          string;
    signature?:   string;
    cin?:         string;
    pan?:         string;
    website?:     string;
  };
  invoiceDate: string;
  dueDate?: string;
  terms?: string;
};

export function generatePIHtml(data: PIData): string {
  const { invoice, customer, items, company, invoiceDate, documentTitle } = data;

  const isCGPL = company.companyCode === 'CGPL';
  const isSTS  = company.companyCode === 'STS';
  const wrapCls = isSTS ? 'sts' : '';

  const hsnCode = isCGPL ? '85414300' : '7308';

  // Images
  const hasLogo = !!(company.logo && company.logo.length > 100);
  const hasQr   = !!(company.qr   && company.qr.length   > 100);
  const hasSig  = !!(company.signature && company.signature.length > 100);

  const logoSrc = hasLogo ? b64ToSrc(company.logo) : '';
  const qrSrc   = hasQr   ? b64ToSrc(company.qr)   : '';
  const sigSrc  = hasSig  ? b64ToSrc(company.signature) : '';

  // Totals
  const totalQty = items.reduce((s, i) => s + (i.quantity || 0), 0);
  const halfGst  = (invoice.gst || 0) / 2;

  // GST rate from first item
  const firstGstPct = items[0]?.gstPercent || 18;
  const halfGstRate = (firstGstPct / 2).toString().replace(/\.?0+$/, '');

  const amountInWords = numberToWords(Math.round(invoice.grandTotal));
  const docTypeHeader = documentTitle || 'PROFORMA INVOICE';

  // Item rows
  const itemRows = items.map((item, idx) => {
    const halfPct  = ((item.gstPercent || 0) / 2).toFixed(2).replace(/\.?0+$/, '');
    const cgstAmt  = (item.gstAmount || 0) / 2;
    return `
      <tr>
        <td class="tc">${idx + 1}</td>
        <td>${item.product || ''}</td>
        <td class="tc">${hsnCode}</td>
        <td class="tr">${nInt(item.quantity)}</td>
        <td class="tc">NOS</td>
        <td class="tr">${n(item.rate)}</td>
        <td class="tc">0</td>
        <td class="tr">${n(item.amount)}</td>
        <td class="tc">${halfPct}%</td>
        <td class="tr">${n(cgstAmt)}</td>
        <td class="tc">${halfPct}%</td>
        <td class="tr">${n(cgstAmt)}</td>
        <td class="tr"><strong>${n(item.total)}</strong></td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${docTypeHeader} - ${invoice.piId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: A4 portrait; margin: 8mm; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8.5pt;
      line-height: 1.25;
      color: #000;
      background: #fff;
      width: 194mm;
      margin: auto;
    }
    .pi-wrap { width: 100%; border: 1.5pt solid #000; border-collapse: collapse; }

    /* HEADER */
    .hdr-table { width: 100%; border-collapse: collapse; }
    .logo-td {
      width: 88pt; text-align: center; padding: 5pt;
      border-right: 1pt solid #000; vertical-align: middle;
    }
    .logo-td img { max-width: 80pt; max-height: 65pt; display: block; margin: 0 auto; }
    .logo-placeholder {
      width: 80pt; height: 65pt; border: 1pt dashed #aaa;
      display: inline-block; line-height: 65pt;
      font-size: 7pt; color: #999; text-align: center;
    }
    .co-info-td { padding: 5pt 8pt; border-right: 1pt solid #000; vertical-align: middle; }
    .co-name { font-size: 14pt; font-weight: bold; line-height: 1.15; margin-bottom: 3pt; }
    .co-addr { font-size: 7.5pt; line-height: 1.4; }
    .co-contact-td {
      width: 148pt; padding: 5pt 6pt;
      font-size: 7.5pt; line-height: 1.6; vertical-align: top;
    }
    .co-contact-td b { display: inline-block; min-width: 44pt; }

    /* GSTIN BAR */
    .gstin-bar {
      width: 100%; border-collapse: collapse;
      border-top: 1pt solid #000; background: #f0f0f0;
    }
    .gstin-bar td { padding: 4pt 8pt; }
    .gstin-td  { font-size: 9pt; font-weight: bold; width: 33%; }
    .pititle-td { font-size: 12pt; font-weight: bold; text-align: center; width: 34%; letter-spacing: 0.5pt; text-transform: uppercase; }
    .orig-td   { font-size: 8pt; font-weight: bold; text-align: right; width: 33%; }

    /* META */
    .meta { width: 100%; border-collapse: collapse; border-top: 1pt solid #000; }
    .meta td { border: 0.5pt solid #000; padding: 3pt 5pt; font-size: 8pt; vertical-align: middle; }
    .meta .sh  { background: #e8e8e8; font-weight: bold; text-align: center; font-size: 8.5pt; }
    .meta .lbl { background: #f5f5f5; font-weight: bold; width: 55pt; }
    .meta .lbl2 { background: #f5f5f5; font-weight: bold; width: 68pt; }

    /* ITEMS */
    .items { width: 100%; border-collapse: collapse; border-top: 1pt solid #000; font-size: 7.5pt; }
    .items th {
      background: #e0e0e0; padding: 3pt 2pt; text-align: center;
      font-weight: bold; border: 0.5pt solid #000; font-size: 7pt; vertical-align: middle;
    }
    .items td { padding: 3pt 2pt; border: 0.5pt solid #000; vertical-align: middle; }
    .tr { text-align: right; }
    .tc { text-align: center; }
    .tot-row td { background: #f0f0f0; font-weight: bold; }

    /* SUMMARY */
    .summ { width: 100%; border-collapse: collapse; border-top: 1pt solid #000; font-size: 8.5pt; }
    .summ td { border: 0.5pt solid #000; padding: 4pt 6pt; vertical-align: middle; }
    .words-hd  { background: #e8e8e8; font-weight: bold; text-align: center; }
    .words-val { font-weight: bold; text-align: center; font-size: 8pt; text-transform: uppercase; }
    .s-lbl { background: #f5f5f5; font-weight: bold; width: 55%; }
    .s-val { text-align: right; font-weight: bold; }
    .grand td { background: #d0d0d0; font-weight: bold; font-size: 10pt; }

    /* BANK */
    .bank { width: 100%; border-collapse: collapse; border-top: 1pt solid #000; font-size: 8pt; }
    .bank td { border: 0.5pt solid #000; padding: 4pt 6pt; vertical-align: middle; }
    .bk-hd  { background: #e8e8e8; font-weight: bold; text-align: center; }
    .bk-lbl { background: #f5f5f5; font-weight: bold; width: 55pt; }
    .qr-td  { width: 90pt; text-align: center; padding: 4pt !important; vertical-align: middle; }
    .qr-td img { width: 80pt; height: 80pt; display: block; margin: 0 auto; border: 0.5pt solid #ccc; }
    .qr-placeholder {
      width: 80pt; height: 80pt; border: 1pt dashed #aaa;
      display: inline-block; line-height: 80pt;
      font-size: 7pt; color: #999; text-align: center;
    }
    .qr-lbl { font-size: 7pt; font-weight: bold; margin-top: 2pt; }
    .sig-td { width: 128pt; text-align: center; padding: 4pt !important; vertical-align: middle; }
    .sig-td img { max-width: 118pt; max-height: 52pt; display: block; margin: 0 auto; }
    .sig-placeholder {
      width: 118pt; height: 52pt; border: 1pt dashed #aaa;
      display: inline-block; line-height: 52pt;
      font-size: 7pt; color: #999; text-align: center;
    }
    .sig-co  { font-weight: bold; font-size: 8pt; margin-bottom: 3pt; }
    .sig-lbl { font-weight: bold; font-size: 8pt; border-top: 0.5pt solid #000; padding-top: 2pt; margin-top: 2pt; }

    /* TERMS */
    .terms { width: 100%; border-collapse: collapse; border-top: 1pt solid #000; font-size: 7pt; line-height: 1.35; }
    .terms td { border: 0.5pt solid #000; padding: 4pt 7pt; vertical-align: top; }
    .terms-hd { background: #e8e8e8; font-weight: bold; text-align: center; padding: 3pt 7pt; }
    .terms ol { padding-left: 14pt; margin: 0; }
    .terms li { margin-bottom: 1pt; }

    /* FOOTER */
    .footer { width: 100%; border-collapse: collapse; border-top: 1pt solid #000; font-size: 8pt; font-weight: bold; }
    .footer td { padding: 4pt 7pt; border: 0.5pt solid #000; }
    .pg-info { text-align: right; font-weight: normal; }

    /* STS amber overrides */
    .sts .pi-wrap,
    .sts .gstin-bar, .sts .meta, .sts .items,
    .sts .summ, .sts .bank, .sts .terms, .sts .footer { border-color: #d97706; }
    .sts .meta td, .sts .items th, .sts .items td,
    .sts .summ td, .sts .bank td, .sts .terms td, .sts .footer td { border-color: #d97706; }
    .sts .gstin-bar, .sts .meta .sh, .sts .words-hd,
    .sts .bk-hd, .sts .terms-hd { background: #fef3c7; }
    .sts .meta .lbl, .sts .meta .lbl2,
    .sts .s-lbl, .sts .bk-lbl { background: #fffbeb; }
    .sts .items th { background: #fde68a; color: #92400e; }
    .sts .grand td { background: #fcd34d; }
    .sts .co-name  { color: #92400e; }

    @media print {
      body { width: 100%; margin: 0; padding: 0; }
      .no-print { display: none; }
      * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
    }
  </style>
</head>
<body>

<div class="${wrapCls}">
<table class="pi-wrap" cellpadding="0" cellspacing="0">

  <!-- ══ HEADER ══ -->
  <tr><td style="padding:0;border:none">
    <table class="hdr-table" cellpadding="0" cellspacing="0">
      <tr>
        <td class="logo-td">
          ${hasLogo ? `<img src="${logoSrc}" alt="Logo" />` : `<span class="logo-placeholder">LOGO</span>`}
        </td>
        <td class="co-info-td">
          <div class="co-name">${company.companyName}</div>
          <div class="co-addr">${company.address}</div>
          ${company.cin ? `<div class="co-addr" style="margin-top:2pt;font-size:7pt;">CIN NO- ${company.cin}</div>` : ''}
        </td>
        <td class="co-contact-td">
          <div><b>Name :</b> ${company.companyName}</div>
          <div><b>Phone :</b> ${company.phone}</div>
          <div><b>Email :</b> ${company.email}</div>
          ${company.website ? `<div><b>Website :</b> ${company.website}</div>` : ''}
          ${company.pan ? `<div><b>PAN :</b> ${company.pan}</div>` : ''}
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ══ GSTIN BAR ══ -->
  <tr><td style="padding:0;border:none">
    <table class="gstin-bar" cellpadding="0" cellspacing="0">
      <tr>
        <td class="gstin-td">GSTIN : ${company.gstin}</td>
        <td class="pititle-td">${docTypeHeader}</td>
        <td class="orig-td">ORIGINAL FOR RECIPIENT</td>
      </tr>
    </table>
  </td></tr>

  <!-- ══ META ══ -->
  <tr><td style="padding:0;border:none">
    <table class="meta" cellpadding="0" cellspacing="0">
      <tr>
        <td colspan="2" class="sh">Customer Detail</td>
        <td class="lbl2">Document No.</td>
        <td><strong>${invoice.piId}</strong></td>
        <td class="lbl2">Document Date</td>
        <td>${invoiceDate}</td>
      </tr>
      <tr>
        <td class="lbl">M/S</td>
        <td><strong>${customer.name}</strong></td>
        <td class="lbl2">Delivery Terms</td>
        <td>EX-WORK</td>
        <td class="lbl2">Payment Terms</td>
        <td>100% ADVANCE</td>
      </tr>
      <tr>
        <td class="lbl">Address</td>
        <td>${customer.address || '-'}${customer.city ? ', ' + customer.city : ''}</td>
        <td class="lbl2">Valid/Due Date</td>
        <td>${data.dueDate ? data.dueDate : invoiceDate}</td>
        <td class="lbl2">Order ID</td>
        <td>${invoice.orderId}</td>
      </tr>
      <tr>
        <td class="lbl">Phone</td>
        <td>${customer.phone || '-'}</td>
        <td class="lbl2">Customer ID</td>
        <td colspan="3">${customer.customerId || '-'}</td>
      </tr>
      <tr>
        <td class="lbl">GSTIN</td>
        <td>${customer.gstin || '-'}</td>
        <td class="lbl2">PAN</td>
        <td colspan="3">${customer.pan || '-'}</td>
      </tr>
      <tr>
        <td class="lbl">Place of Supply</td>
        <td colspan="5">${customer.city || customer.address || 'Uttar Pradesh'}</td>
      </tr>
    </table>
  </td></tr>

  <!-- ══ ITEMS ══ -->
  <tr><td style="padding:0;border:none">
    <table class="items" cellpadding="0" cellspacing="0">
      <thead>
        <tr>
          <th style="width:18pt">Sr.<br>No.</th>
          <th>Name of Product / Service</th>
          <th style="width:40pt">HSN/SAC</th>
          <th style="width:34pt">Qty</th>
          <th style="width:28pt">Unit</th>
          <th style="width:50pt">Rate</th>
          <th style="width:28pt">Disc.<br>(%)</th>
          <th style="width:54pt">Taxable<br>Value</th>
          <th style="width:20pt">CGST<br>%</th>
          <th style="width:44pt">CGST<br>Amt</th>
          <th style="width:20pt">SGST<br>%</th>
          <th style="width:44pt">SGST<br>Amt</th>
          <th style="width:54pt">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="tot-row">
          <td colspan="3" class="tr">Total</td>
          <td class="tr">${nInt(totalQty)} NOS</td>
          <td colspan="2"></td>
          <td class="tr">0.00</td>
          <td class="tr">${n(invoice.subtotal)}</td>
          <td></td>
          <td class="tr">${n(halfGst)}</td>
          <td></td>
          <td class="tr">${n(halfGst)}</td>
          <td class="tr"><strong>${n(invoice.grandTotal)}</strong></td>
        </tr>
      </tbody>
    </table>
  </td></tr>

  <!-- ══ SUMMARY ══ -->
  <tr><td style="padding:0;border:none">
    <table class="summ" cellpadding="0" cellspacing="0">
      <tr>
        <td colspan="2" class="words-hd">Total in words</td>
        <td class="s-lbl">Taxable Amount</td>
        <td class="s-val">${n(invoice.subtotal)}</td>
      </tr>
      <tr>
        <td colspan="2" rowspan="5" class="words-val">${amountInWords} RUPEES ONLY</td>
        <td class="s-lbl">Add : CGST (${halfGstRate}%)</td>
        <td class="s-val">${n(halfGst)}</td>
      </tr>
      <tr>
        <td class="s-lbl">Add : SGST (${halfGstRate}%)</td>
        <td class="s-val">${n(halfGst)}</td>
      </tr>
      <tr>
        <td class="s-lbl">Total Tax</td>
        <td class="s-val">${n(invoice.gst)}</td>
      </tr>
      <tr>
        <td class="s-lbl">Round off Amount</td>
        <td class="s-val">0.00</td>
      </tr>
      <tr class="grand">
        <td class="s-lbl">Total Amount After Tax</td>
        <td class="s-val">₹${n(invoice.grandTotal)}</td>
      </tr>
      <tr>
        <td colspan="4" style="text-align:right;font-size:7pt;font-style:italic;background:#fafafa;">
          (E &amp; O.E.) &nbsp; Certified that the particulars given above are true and correct.
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ══ BANK + QR + SIGNATURE ══ -->
  <tr><td style="padding:0;border:none">
    <table class="bank" cellpadding="0" cellspacing="0">
      <tr>
        <td colspan="2" class="bk-hd">Bank Details</td>
        <td rowspan="6" class="qr-td">
          ${hasQr ? `<img src="${qrSrc}" alt="QR Code" />` : `<span class="qr-placeholder">QR CODE</span>`}
          <div class="qr-lbl">Pay using UPI</div>
        </td>
        <td rowspan="6" class="sig-td">
          <div class="sig-co">For ${company.companyName}</div>
          ${hasSig ? `<img src="${sigSrc}" alt="Signature" />` : `<span class="sig-placeholder">Signature</span>`}
          <div class="sig-lbl">AUTHORISED SIGNATORY</div>
        </td>
      </tr>
      <tr><td class="bk-lbl">Name</td><td>${company.bankName}</td></tr>
      <tr><td class="bk-lbl">Branch</td><td>${company.branch}</td></tr>
      <tr><td class="bk-lbl">Acc. Number</td><td>${company.accountNo}</td></tr>
      <tr><td class="bk-lbl">IFSC</td><td>${company.ifsc}</td></tr>
      <tr><td class="bk-lbl">UPI ID</td><td>${company.upiId || '-'}</td></tr>
    </table>
  </td></tr>

  <!-- ══ TERMS ══ -->
  <tr><td style="padding:0;border:none">
    <table class="terms" cellpadding="0" cellspacing="0">
      <tr><td class="terms-hd">Terms &amp; Condition</td></tr>
      <tr><td>
        ${data.terms ? data.terms.replace(/\n/g, '<br/>') : `
        <ol>
          <li>All Prices Mentioned Are Exclusive of GST. The Rate of GST Is Subject to Change As Per Government Policies.</li>
          <li>PI will be valid on first come first serve basis. If material is sold out, PI will be honored in the next lot of material.</li>
          <li>Freight : Extra</li>
          <li>Packing Type: Bare</li>
          <li>Transit Insurance: Exclusive</li>
          <li>Unloading of Material at Site Is in Customer Scope.</li>
          <li>Transportation: By Road</li>
          <li>All Warranty and Services Will Be As Per OEM Terms and Conditions. ${company.shortName || company.companyName} Will Not Be Responsible for Any Rejection of Claim Or Non Servicing of Warranty Or Claim by OEM.</li>
          <li>All Warranty and Services Claims Are to Be Made Directly to OEM.</li>
          <li>Accordingly, These Terms Supersede Any Warranty / Claims Or Damages Terms Set in Your Purchase Order, If Any.</li>
          <li>All Disputes, Will Be Subject to the Varanasi Jurisdiction.</li>
          <li>Typographical, Clerical Or Computer Errors on the Face of Any PI Or Tax Invoice of ${company.shortName || company.companyName} Is Subject to Correction by ${company.shortName || company.companyName} Only.</li>
        </ol>
        `}
      </td></tr>
    </table>
  </td></tr>

  <!-- ══ FOOTER ══ -->
  <tr><td style="padding:0;border:none">
    <table class="footer" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:80%">REGISTERED OFFICE: ${company.address}</td>
        <td class="pg-info">Page 1 of 1</td>
      </tr>
    </table>
  </td></tr>

</table>
</div>

</body>
</html>`;
}
