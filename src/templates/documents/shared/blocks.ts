import { CompanyConfig } from '../../../config/company';
import { fmtDate, fmtCurrency } from '../../../lib/firestore';
import { b64ToSrc } from './utils';

export function renderCompanyCustomerBlock(company: CompanyConfig, docData: any, docMeta: { label: string; value: string }[]) {
  const logoSrc = b64ToSrc(company.logo);
  return `
    <table style="border: none;">
      <tr>
        <td class="company-block border-right border-bottom no-border">
          ${logoSrc ? `<img src="${logoSrc}" class="logo-img" alt="Logo"/>` : `<h2 class="primary-text" style="margin:0;font-size:18px;">${company.name}</h2>`}
          <div class="font-bold" style="font-size:12px;margin-bottom:4px;">${company.name}</div>
          <div>${company.address}</div>
          <div>${company.city}, ${company.state} - ${company.pincode}</div>
          <div><b>Phone:</b> ${company.phone}</div>
          <div><b>Email:</b> ${company.email}</div>
          <div><b>GSTIN:</b> <span class="font-bold">${company.gst}</span></div>
          ${company.pan ? `<div><b>PAN:</b> ${company.pan}</div>` : ''}
        </td>
        <td class="company-block border-bottom no-border">
          <table class="meta-table">
            ${docMeta.map(m => `
              <tr>
                <td style="width:40%;"><b>${m.label}:</b></td>
                <td class="font-semibold text-right">${m.value}</td>
              </tr>
            `).join('')}
          </table>
        </td>
      </tr>
      <tr>
        <td class="customer-block border-right no-border">
          <div class="font-bold primary-text" style="margin-bottom:5px;">BILL TO / CUSTOMER DETAILS</div>
          <div class="font-bold" style="font-size:12px;">${docData.customer}</div>
          ${docData.deliveryAddress ? `<div>${docData.deliveryAddress}</div>` : ''}
          ${docData.customerGst ? `<div><b>GSTIN:</b> ${docData.customerGst}</div>` : ''}
        </td>
        <td class="customer-block no-border">
          <div class="font-bold primary-text" style="margin-bottom:5px;">DISPATCH / SHIPPING DETAILS</div>
          ${docData.deliveryAddress ? `<div>${docData.deliveryAddress}</div>` : '<div>Same as Billing Address</div>'}
          ${docData.vehicleNo ? `<div><b>Vehicle No:</b> ${docData.vehicleNo}</div>` : ''}
          ${docData.driverName ? `<div><b>Driver:</b> ${docData.driverName}</div>` : ''}
          ${docData.lrNumber ? `<div><b>LR No:</b> ${docData.lrNumber}</div>` : ''}
        </td>
      </tr>
    </table>
  `;
}

export function renderBankQrSignFooter(company: CompanyConfig) {
  const qrSrc = b64ToSrc(company.qrCode);
  const signSrc = b64ToSrc(company.signature);
  
  return `
    <div class="footer-blocks">
      <div class="bank-block">
        <div class="font-bold primary-text" style="margin-bottom:5px;">BANK DETAILS</div>
        <table class="meta-table">
          <tr><td><b>Bank Name:</b></td><td>${company.bankName}</td></tr>
          <tr><td><b>Account Name:</b></td><td>${company.name}</td></tr>
          <tr><td><b>Account No:</b></td><td><span class="font-bold">${company.bankAccount}</span></td></tr>
          <tr><td><b>IFSC Code:</b></td><td><span class="font-bold">${company.bankIfsc}</span></td></tr>
          <tr><td><b>Branch:</b></td><td>${company.bankBranch}</td></tr>
        </table>
      </div>
      <div class="qr-block">
        <div class="font-bold primary-text" style="margin-bottom:5px;">SCAN TO PAY</div>
        ${qrSrc ? `<img src="${qrSrc}" class="qr-img" alt="QR Code"/>` : '<div style="height:70px; display:flex; align-items:center; justify-content:center; color:#ccc;">No QR Configured</div>'}
      </div>
      <div class="sign-block">
        ${signSrc ? `<img src="${signSrc}" class="sign-img" alt="Signature"/>` : '<div style="height:45px;"></div>'}
        <div class="sign-text">For ${company.name}</div>
      </div>
    </div>
  `;
}

export function renderTermsBlock(customTerms?: string) {
  const defaultTerms = `
    1. Goods once sold will not be taken back.<br/>
    2. Interest @ 24% p.a. will be charged if payment is not made within the stipulated time.<br/>
    3. Subject to jurisdiction of local courts only.<br/>
    4. E.& O.E.
  `;
  return `
    <div class="terms-block">
      <b>Terms & Conditions:</b><br/>
      ${(customTerms || defaultTerms).replace(/\n/g, '<br/>')}
    </div>
  `;
}
