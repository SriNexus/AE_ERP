/**
 * SOLAR EPC QUOTATION / PROPOSAL GENERATOR — v3 (production)
 *
 * Design language (unchanged from v2, refined not replaced):
 *   dark navy/slate primary, restrained emerald accent, subtle amber accent,
 *   white/light surfaces, structured tables, numbered section labels,
 *   thin borders, subtle rounded corners, A4 print-ready.
 *
 * What changed vs v2:
 *   - Section numbers are computed dynamically from which optional
 *     sections actually have data (no hard-coded 01/05/08).
 *   - Pages are composed by a lightweight weight-based packer instead of
 *     a fixed page-per-section layout, so no page ever renders with a
 *     heading and a large empty area beneath it.
 *   - A Technical Specification / BOM section is derived from item
 *     `specs` / `description` fields already present on QuotationData —
 *     no new data is invented.
 *   - Card-heavy sections (subsidy, milestones, warranty, journey,
 *     references) are rendered as compact structured tables sharing one
 *     `.data-table` style, which reads as a business document rather
 *     than a set of marketing tiles and is far more print-safe.
 *   - Footer carries an accurate "Page X of Y" (computed from the real
 *     page count produced by this generator, not guessed).
 *
 * Public API is unchanged: generateQuotationHtml(data: QuotationData): string
 * All existing exported types are unchanged so calling code keeps working.
 */

import { b64ToSrc, numberToWords } from '../shared/utils';

// ─────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────

function n(v: any, dec = 2): string {
  return (parseFloat(v) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtDate(val?: string): string {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  } catch {
    return val;
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC TYPES (unchanged — do not break existing callers)
// ─────────────────────────────────────────────────────────────

export type Subsidy = {
  name: string;
  authority?: string;
  amount: number;
  note?: string;
  expectedDisbursalDays?: string;
};

export type PaymentMilestone = {
  stage: string;
  amount: number;
  percentage?: number;
  note?: string;
};

export type ScopeParty = 'company' | 'client' | 'shared' | '-';

export type ScopeRow = {
  category?: string;
  item: string;
  design?: ScopeParty;
  supply?: ScopeParty;
  installation?: ScopeParty;
};

export type WarrantyTier = {
  label: string;
  years: number;
  detail?: string;
};

export type SystemWarranty = {
  tiers: WarrantyTier[];
  exclusions?: string[];
};

export type ProcessStep = {
  step: number;
  title: string;
  detail?: string;
};

export type ReferenceProject = {
  clientLabel: string;
  capacity: string;
  type?: string;
  location?: string;
};

export type QuotationData = {
  id: string;
  refNo?: string;
  date: string;
  validUntil?: string;
  validityDays?: number;
  customer: string;
  customerAddress?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerGst?: string;
  customerState?: string;
  systemSizeKw?: number;
  acSizeKw?: number;
  items: Array<{
    product: string;
    description?: string;
    hsn?: string;
    qty: number;
    unit?: string;
    price: number;
    tax: number;
    discount?: number;
    warranty?: string;
    specs?: string;
  }>;
  subtotal: number;
  taxTotal: number;
  discount?: number;
  specialDiscount?: number;
  total: number;
  subsidies?: Subsidy[];
  netEffectivePrice?: number;
  paymentMilestones?: PaymentMilestone[];
  scopeMatrix?: ScopeRow[];
  systemWarranty?: SystemWarranty;
  processSteps?: ProcessStep[];
  referenceProjects?: ReferenceProject[];
  notes?: string;
  terms?: string;
  deliveryTimeline?: string;
  installationCharges?: number;
  transportCharges?: number;
  company: {
    name: string;
    shortName?: string;
    tagline?: string;
    address: string;
    phone: string;
    email: string;
    gstin: string;
    cin?: string;
    pan?: string;
    bankName?: string;
    bankAccount?: string;
    bankIfsc?: string;
    bankBranch?: string;
    logo?: string;
    qr?: string;
    signature?: string;
    website?: string;
    rankingLine?: string;
  };
};

// ─────────────────────────────────────────────────────────────
// INTERNAL TYPES (this file only)
// ─────────────────────────────────────────────────────────────

type SectionDef = {
  id: string;
  title: string;
  body: string;
  weight: number;        // rough content-density units, used to pack pages
  forceOwnPage?: boolean; // section is large/central enough to always start a fresh page
  tight?: boolean;        // short, single-block section — safe to keep together on one page
};

type NumberedSection = SectionDef & { number: number };

// ─────────────────────────────────────────────────────────────
// SMALL RENDER HELPERS
// ─────────────────────────────────────────────────────────────

function scopeBadge(v?: ScopeParty): string {
  if (!v || v === '-') return `<span class="badge badge-na">—</span>`;
  if (v === 'company') return `<span class="badge badge-company">Company</span>`;
  if (v === 'client') return `<span class="badge badge-client">Client</span>`;
  return `<span class="badge badge-shared">Shared</span>`;
}

/** Generic structured table used by every non-commercial, non-scope section. */
function dataTable(headers: string[], rows: string[][], rightAlignCols: number[] = []): string {
  const thead = headers
    .map((h, i) => `<th${rightAlignCols.includes(i) ? ' class="tr"' : ''}>${h}</th>`)
    .join('');
  const tbody = rows
    .map(r => `<tr>${r.map((c, i) => `<td${rightAlignCols.includes(i) ? ' class="tr"' : ''}>${c}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="data-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function statBlock(label: string, value: string): string {
  return `<div class="stat-block"><div class="stat-val">${value}</div><div class="stat-lbl">${label}</div></div>`;
}

function sectionWrapper(s: NumberedSection): string {
  return `<div class="section-block${s.tight ? ' tight' : ''}">
    <div class="section-label"><span class="label-num">${String(s.number).padStart(2, '0')}</span> ${s.title}</div>
    ${s.body}
  </div>`;
}

// ─────────────────────────────────────────────────────────────
// SECTION BUILDERS — each returns null when there is nothing
// meaningful to show, so the section is simply omitted rather
// than rendered as an empty/placeholder block.
// ─────────────────────────────────────────────────────────────

function buildCommercialSection(data: QuotationData): SectionDef {
  const { items, subtotal, taxTotal, discount, specialDiscount, total, installationCharges, transportCharges, deliveryTimeline } = data;

  const gstEffectiveRate = subtotal > 0 ? ((taxTotal / subtotal) * 100).toFixed(1) : '0';
  const amountInWords = numberToWords(Math.round(total));

  const itemRows = items.map((item, idx) => {
    const lineTotal = item.qty * item.price;
    return `
      <tr>
        <td class="tc idx-cell">${String(idx + 1).padStart(2, '0')}</td>
        <td class="item-cell">
          <div class="item-name">${item.product}</div>
          ${item.specs ? `<div class="item-meta">${item.specs.replace(/\n/g, '<br/>')}</div>` : ''}
          ${item.description ? `<div class="item-desc">${item.description}</div>` : ''}
          ${item.hsn ? `<div class="item-hsn">HSN/SAC ${item.hsn}</div>` : ''}
        </td>
        <td class="tc">${item.qty} ${item.unit || 'Nos'}</td>
        <td class="tr">₹${n(item.price)}</td>
        <td class="tc">${item.tax}%</td>
        <td class="tr bold">₹${n(lineTotal)}</td>
      </tr>`;
  }).join('');

  const extraRows = [
    installationCharges
      ? `<tr><td class="tc idx-cell">—</td><td class="item-cell"><div class="item-name">Installation &amp; Commissioning Charges</div></td><td class="tc">—</td><td class="tr">—</td><td class="tc">—</td><td class="tr bold">₹${n(installationCharges)}</td></tr>`
      : '',
    transportCharges
      ? `<tr><td class="tc idx-cell">—</td><td class="item-cell"><div class="item-name">Transportation Charges</div></td><td class="tc">—</td><td class="tr">—</td><td class="tc">—</td><td class="tr bold">₹${n(transportCharges)}</td></tr>`
      : '',
  ].join('');

  const body = `
    <table class="data-table offer-table" cellpadding="0" cellspacing="0">
      <thead>
        <tr><th>#</th><th style="text-align:left;">Item Description</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr>
      </thead>
      <tbody>
        ${itemRows}
        ${extraRows}
      </tbody>
    </table>
    <div class="totals-strip">
      <div class="row subtotal"><span>Subtotal (Before Tax)</span><span>₹${n(subtotal)}</span></div>
      <div class="row gst"><span>GST @ ${gstEffectiveRate}%</span><span>₹${n(taxTotal)}</span></div>
      ${(specialDiscount || 0) > 0 ? `<div class="row discount"><span>Special Discount</span><span>− ₹${n(specialDiscount || 0)}</span></div>` : ''}
      ${(discount || 0) > 0 ? `<div class="row discount"><span>Discount</span><span>− ₹${n(discount || 0)}</span></div>` : ''}
      <div class="row grand"><span>Grand Total (Incl. GST)</span><span>₹${n(total)}</span></div>
    </div>
    <div class="words-strip">${amountInWords}</div>
    ${deliveryTimeline ? `<p class="meta-line"><strong>Delivery Timeline:</strong> ${deliveryTimeline}</p>` : ''}
  `;

  // Fixed baseline weight — this section is the commercial core of the
  // document and is always given a page of its own.
  const weight = 12 + Math.max(0, items.length - 6) * 1.2;

  return { id: 'commercial', title: 'Techno-Commercial Offer', body, weight, forceOwnPage: true };
}

function buildSubsidySection(data: QuotationData): SectionDef | null {
  const { subsidies, total, netEffectivePrice, company } = data;
  if (!subsidies || subsidies.length === 0) return null;

  const subsidyTotal = subsidies.reduce((sum, s) => sum + (s.amount || 0), 0);
  const netEffective = netEffectivePrice ?? (total - subsidyTotal);

  const rows = subsidies.map(s => [
    `<div class="item-name">${s.name}</div>`,
    s.authority || '—',
    s.note || '—',
    s.expectedDisbursalDays || '—',
    `₹${n(s.amount, 0)}`,
  ]);

  const body = `
    ${dataTable(['Subsidy', 'Authority', 'Eligibility / Note', 'Expected Disbursal', 'Amount'], rows, [4])}
    <div class="net-effective-bar">
      <div class="net-row"><span>Amount Payable to ${company.shortName || company.name}</span><span>₹${n(total, 0)}</span></div>
      <div class="net-row muted"><span>Government Subsidy (reimbursed separately)</span><span>− ₹${n(subsidyTotal, 0)}</span></div>
      <div class="net-row grand"><span>Net Effective Cost to Customer</span><span>₹${n(netEffective, 0)}</span></div>
    </div>
    <p class="fine-print">Government subsidy is disbursed by the respective authority directly to the customer after commissioning and net-metering approval. It is a separate reimbursement, not a discount applied by ${company.shortName || company.name} at the time of billing.</p>
  `;

  return { id: 'subsidy', title: 'Government Subsidy Benefit', body, weight: 3 + subsidies.length * 1.3, tight: true };
}

function buildMilestonesSection(data: QuotationData): SectionDef | null {
  const { paymentMilestones, total } = data;
  if (!paymentMilestones || paymentMilestones.length === 0) return null;

  const rows = paymentMilestones.map((m, idx) => [
    `<span class="badge badge-company">${idx + 1}</span>`,
    `<div class="item-name">${m.stage}</div>${m.note ? `<div class="item-meta">${m.note}</div>` : ''}`,
    m.percentage != null ? `${m.percentage}%` : '—',
    `₹${n(m.amount, 0)}`,
  ]);

  const milestoneTotal = paymentMilestones.reduce((s, m) => s + (m.amount || 0), 0);
  const mismatch = Math.abs(milestoneTotal - total) > 1;

  const body = `
    ${dataTable(['#', 'Stage', '%', 'Amount'], rows, [3])}
    <div class="milestone-total-row">
      <span>Total Amount Payable</span>
      <span>₹${n(milestoneTotal, 0)}</span>
    </div>
    ${mismatch ? `<p class="fine-print discrepancy">Note: the sum of payment milestones (₹${n(milestoneTotal, 0)}) differs from the quotation grand total (₹${n(total, 0)}). Please verify before sending this quotation to the customer.</p>` : ''}
  `;

  return { id: 'milestones', title: 'Payment Milestones', body, weight: 2 + paymentMilestones.length, tight: true };
}

function buildTechnicalSpecSection(data: QuotationData): SectionDef | null {
  const rows = data.items
    .filter(it => it.specs || it.description)
    .map((it, idx) => [
      String(idx + 1).padStart(2, '0'),
      `<div class="item-name">${it.product}</div>`,
      [it.specs, it.description].filter(Boolean).join(' — ').replace(/\n/g, '<br/>'),
      `${it.qty} ${it.unit || 'Nos'}`,
    ]);

  if (rows.length === 0) return null;

  const body = dataTable(['#', 'Component', 'Specification', 'Qty'], rows, []);
  return { id: 'techspec', title: 'Technical Specification / System Configuration', body, weight: 2 + rows.length, tight: rows.length <= 6 };
}

function buildScopeSection(data: QuotationData): SectionDef | null {
  const { scopeMatrix } = data;
  if (!scopeMatrix || scopeMatrix.length === 0) return null;

  let lastCategory = '';
  let categoryCount = 0;
  const rowsHtml = scopeMatrix.map(row => {
    let categoryRow = '';
    if (row.category && row.category !== lastCategory) {
      lastCategory = row.category;
      categoryCount += 1;
      categoryRow = `<tr class="scope-cat-row"><td colspan="4">${row.category}</td></tr>`;
    }
    return `${categoryRow}
      <tr>
        <td class="scope-item">${row.item}</td>
        <td class="tc">${scopeBadge(row.design)}</td>
        <td class="tc">${scopeBadge(row.supply)}</td>
        <td class="tc">${scopeBadge(row.installation)}</td>
      </tr>`;
  }).join('');

  const body = `
    <table class="data-table scope-table">
      <thead>
        <tr><th style="text-align:left;">Item</th><th>Design</th><th>Supply</th><th>Installation</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="scope-legend">
      <span class="badge badge-company">Company</span> Company's responsibility &nbsp;&nbsp;
      <span class="badge badge-client">Client</span> Customer's responsibility &nbsp;&nbsp;
      <span class="badge badge-shared">Shared</span> Jointly coordinated
    </div>
  `;

  const weight = 3 + scopeMatrix.length * 0.6 + categoryCount * 0.5;
  return { id: 'scope', title: 'Scope of Work', body, weight, forceOwnPage: scopeMatrix.length > 10 };
}

function buildWarrantySection(data: QuotationData): SectionDef | null {
  const { systemWarranty, items } = data;

  if (systemWarranty && systemWarranty.tiers.length) {
    const rows = systemWarranty.tiers.map(t => [
      `<div class="item-name">${t.label}</div>`,
      `${t.years} ${t.years === 1 ? 'Year' : 'Years'}`,
      t.detail || '—',
    ]);
    const exclusions = (systemWarranty.exclusions || []).map(e => `<p>⊘ ${e}</p>`).join('');
    const body = `
      ${dataTable(['Warranty Category', 'Duration', 'Details'], rows, [])}
      ${exclusions ? `<div class="sub-section">Exclusions</div><div class="bullet-section exclusions">${exclusions}</div>` : ''}
    `;
    return { id: 'warranty', title: 'Warranty', body, weight: 2 + systemWarranty.tiers.length + (systemWarranty.exclusions?.length || 0) * 0.4, tight: true };
  }

  // Fallback: item-level warranty strings, if any were supplied.
  const itemWarranties = items.filter(it => it.warranty);
  if (itemWarranties.length) {
    const rows = itemWarranties.map(it => [`<div class="item-name">${it.product}</div>`, it.warranty as string]);
    const body = dataTable(['Item', 'Warranty'], rows, []);
    return { id: 'warranty', title: 'Warranty', body, weight: 2 + itemWarranties.length, tight: true };
  }

  return null;
}

function buildJourneySection(data: QuotationData): SectionDef | null {
  const { processSteps } = data;
  if (!processSteps || processSteps.length === 0) return null;

  const rows = processSteps
    .slice()
    .sort((a, b) => a.step - b.step)
    .map(p => [
      `<span class="badge badge-company">${p.step}</span>`,
      `<div class="item-name">${p.title}</div>${p.detail ? `<div class="item-meta">${p.detail}</div>` : ''}`,
    ]);

  const body = dataTable(['#', 'Step'], rows, []);
  return { id: 'journey', title: 'Installation Journey', body, weight: 2 + processSteps.length * 0.6, tight: true };
}

function buildReferencesSection(data: QuotationData): SectionDef | null {
  const { referenceProjects } = data;
  if (!referenceProjects || referenceProjects.length === 0) return null;

  const rows = referenceProjects.map(r => [
    r.capacity,
    r.type || '—',
    r.clientLabel,
    r.location || '—',
  ]);

  const body = dataTable(['Capacity', 'Type', 'Client', 'Location'], rows, []);
  return { id: 'references', title: 'Reference Projects', body, weight: 2 + referenceProjects.length * 0.6, tight: true };
}

function buildPaymentTermsSection(data: QuotationData): SectionDef {
  const { terms, company } = data;

  const termsHtml = terms
    ? terms.replace(/\n/g, '<br/>').split('<br/>').map(t => t.trim() ? `<p>${t}</p>` : '').join('')
    : `<p>Payment terms to be confirmed at the time of order.</p>`;

  const hasBank = !!(company.bankName || company.bankAccount || company.bankIfsc || company.bankBranch);
  const bankRows: string[][] = [];
  if (company.bankName) bankRows.push(['Account Name', company.name]);
  if (company.bankName) bankRows.push(['Bank', company.bankName]);
  if (company.bankAccount) bankRows.push(['Account Number', company.bankAccount]);
  if (company.bankIfsc) bankRows.push(['IFSC Code', company.bankIfsc]);
  if (company.bankBranch) bankRows.push(['Branch', company.bankBranch]);

  const body = `
    <div class="sub-section">Payment Terms</div>
    <div class="bullet-section">${termsHtml}</div>
    ${hasBank ? `<div class="sub-section">Bank Details</div>${dataTable(['Field', 'Detail'], bankRows, [])}` : ''}
  `;

  return { id: 'paymentterms', title: 'Payment Terms & Bank Details', body, weight: hasBank ? 4 : 3, tight: true };
}

// ─────────────────────────────────────────────────────────────
// PAGE COMPOSITION — greedy weight-based packer.
// Sections are visited in a fixed logical order; each is added to
// the current page unless it would overflow the page's weight
// budget or is flagged forceOwnPage, in which case a new page
// starts. This keeps small, related sections together (e.g.
// subsidy + milestones, warranty + journey, references + payment
// terms) while letting genuinely large sections (commercial offer,
// long scope matrices) occupy the space they need.
// ─────────────────────────────────────────────────────────────

const PAGE_WEIGHT_BUDGET = 11;

function packSections(sections: NumberedSection[]): NumberedSection[][] {
  const pages: NumberedSection[][] = [];
  let current: NumberedSection[] = [];
  let currentWeight = 0;

  for (const section of sections) {
    const wouldOverflow = currentWeight + section.weight > PAGE_WEIGHT_BUDGET;
    if (current.length && (wouldOverflow || section.forceOwnPage)) {
      pages.push(current);
      current = [];
      currentWeight = 0;
    }
    current.push(section);
    currentWeight += section.weight;
    if (section.forceOwnPage) {
      pages.push(current);
      current = [];
      currentWeight = 0;
    }
  }
  if (current.length) pages.push(current);
  return pages;
}

// ─────────────────────────────────────────────────────────────
// COVER SNAPSHOT — an "at a glance" strip built entirely from
// fields already present on QuotationData. Exists so the cover
// page communicates real information instead of sitting mostly
// empty when the hero/client-strip content is short. Nothing here
// is invented: a column only appears when the underlying data
// exists, and every line is a direct read of supplied fields.
// ─────────────────────────────────────────────────────────────

function buildCoverSnapshot(data: QuotationData): string | null {
  type Col = { label: string; lines: string[] };
  const cols: Col[] = [];

  if (data.items && data.items.length) {
    cols.push({
      label: "What's Included",
      lines: data.items.slice(0, 6).map(it => it.product),
    });
  }

  if (data.subsidies && data.subsidies.length) {
    const subsidyTotal = data.subsidies.reduce((s, x) => s + (x.amount || 0), 0);
    const net = data.netEffectivePrice ?? (data.total - subsidyTotal);
    cols.push({
      label: 'Investment After Subsidy',
      lines: [
        `Net Effective Cost: ₹${n(net, 0)}`,
        `Total Subsidy Benefit: ₹${n(subsidyTotal, 0)}`,
      ],
    });
  }

  if (data.systemWarranty && data.systemWarranty.tiers.length) {
    cols.push({
      label: 'Warranty Coverage',
      lines: data.systemWarranty.tiers.slice(0, 4).map(t => `${t.label}: ${t.years} Yr`),
    });
  } else {
    const itemWarranties = data.items.filter(it => it.warranty);
    if (itemWarranties.length) {
      cols.push({
        label: 'Warranty Coverage',
        lines: itemWarranties.slice(0, 4).map(it => `${it.product}: ${it.warranty}`),
      });
    }
  }

  if (data.paymentMilestones && data.paymentMilestones.length) {
    cols.push({
      label: `${data.paymentMilestones.length}-Stage Payment Plan`,
      lines: data.paymentMilestones.map(m => m.stage),
    });
  }

  if (cols.length < 4 && data.referenceProjects && data.referenceProjects.length) {
    cols.push({
      label: 'Track Record',
      lines: [`${data.referenceProjects.length} reference project${data.referenceProjects.length > 1 ? 's' : ''} included in this proposal`],
    });
  }

  if (cols.length < 4 && data.company.rankingLine) {
    cols.push({ label: 'About Us', lines: [data.company.rankingLine] });
  }

  if (cols.length === 0) return null;

  const colsHtml = cols
    .slice(0, 4)
    .map(c => `
      <div class="snapshot-col">
        <div class="snapshot-label">${c.label}</div>
        ${c.lines.map(l => `<div class="snapshot-line">${l}</div>`).join('')}
      </div>`)
    .join('');

  return `<div class="snapshot-grid">${colsHtml}</div>`;
}

// ─────────────────────────────────────────────────────────────
// PAGE-LEVEL RENDERERS
// ─────────────────────────────────────────────────────────────

function renderHeader(company: QuotationData['company']): string {
  const hasLogo = !!(company.logo && company.logo.length > 100);
  const logoSrc = hasLogo ? b64ToSrc(company.logo) : '';
  return `
    <table class="header-table" cellpadding="0" cellspacing="0">
      <tr>
        <td class="logo-cell">
          ${hasLogo
            ? `<img src="${logoSrc}" alt="Logo" style="max-width:110px;max-height:48px;display:block;" />`
            : `<div class="logo-fallback">${company.shortName || company.name}</div>`
          }
          <div class="company-name-strap">${company.name.toUpperCase()}</div>
          ${company.tagline ? `<div class="company-tagline">${company.tagline}</div>` : ''}
        </td>
        <td class="contact-cell">
          ${company.cin ? `<div>CIN&nbsp; ${company.cin}</div>` : ''}
          <div>GSTIN&nbsp; ${company.gstin}</div>
          <div>${company.phone} &nbsp;·&nbsp; ${company.email}</div>
        </td>
      </tr>
    </table>
    <div class="accent-bar"></div>
  `;
}

function renderRefBar(data: QuotationData): string {
  return `<div class="ref-bar"><span>Ref No: ${data.refNo || data.id}</span><span>Date: ${fmtDate(data.date)}</span></div>`;
}

function renderFooter(company: QuotationData['company'], pageNum: number, totalPages: number): string {
  return `
    <div class="footer">
      <span class="footer-addr">${company.address}${company.website ? ` &nbsp;·&nbsp; ${company.website}` : ''}</span>
      <span class="footer-page">Page ${pageNum} of ${totalPages}</span>
    </div>
  `;
}

function renderCoverPage(data: QuotationData, pageNum: number, totalPages: number): string {
  const { customer, customerAddress, customerPhone, refNo, id, date, validUntil, validityDays, systemSizeKw, acSizeKw, total, notes, company } = data;

  return `
  <div class="page">
    ${renderHeader(company)}
    <div class="hero">
      <div class="hero-eyebrow">Solar EPC &nbsp;·&nbsp; Techno-Commercial Proposal</div>
      <div class="hero-title">Solar <span>Proposal</span></div>
      <div class="hero-sub">Prepared for ${customer}${systemSizeKw ? `, covering a ${systemSizeKw} kW rooftop solar installation` : ''}. This document sets out the technical configuration, commercial pricing, applicable subsidy, scope of work and warranty terms.</div>
      <div class="hero-stats">
        ${systemSizeKw ? statBlock('System Size', `${systemSizeKw} kW`) : ''}
        ${acSizeKw ? statBlock('AC Capacity', `${acSizeKw} kW`) : ''}
        ${statBlock('Quotation Value', `₹${n(total, 0)}`)}
      </div>
    </div>
    <div class="client-strip">
      <div class="client-field"><div class="lbl">Prepared For</div><div class="val">${customer}</div></div>
      ${customerPhone ? `<div class="client-field"><div class="lbl">Phone</div><div class="val">${customerPhone}</div></div>` : ''}
      ${customerAddress ? `<div class="client-field"><div class="lbl">Location</div><div class="val">${customerAddress}</div></div>` : ''}
      <div class="client-field"><div class="lbl">Ref No.</div><div class="val">${refNo || id}</div></div>
      <div class="client-field"><div class="lbl">Date</div><div class="val">${fmtDate(date)}</div></div>
      ${validUntil || validityDays ? `<div class="client-field"><div class="lbl">Valid Until</div><div class="val">${validUntil ? fmtDate(validUntil) : `${validityDays} days from date`}</div></div>` : ''}
    </div>
    ${buildCoverSnapshot(data) || ''}
    ${notes ? `<div class="content" style="padding-top:14px;padding-bottom:0;"><p class="meta-line"><strong>Notes:</strong> ${notes}</p></div>` : ''}
    <div class="spacer"></div>
    ${renderFooter(company, pageNum, totalPages)}
  </div>`;
}

function renderContentPage(sectionsHtml: string, data: QuotationData, pageNum: number, totalPages: number): string {
  return `
  <div class="page">
    ${renderHeader(data.company)}
    ${renderRefBar(data)}
    <div class="content">
      ${sectionsHtml}
    </div>
    ${renderFooter(data.company, pageNum, totalPages)}
  </div>`;
}

function renderAcceptancePage(data: QuotationData, pageNum: number, totalPages: number): string {
  const { customer, customerAddress, refNo, id, date, total, validUntil, company } = data;
  const hasSig = !!(company.signature && company.signature.length > 100);
  const hasQr = !!(company.qr && company.qr.length > 100);
  const sigSrc = hasSig ? b64ToSrc(company.signature) : '';
  const qrSrc = hasQr ? b64ToSrc(company.qr) : '';

  return `
  <div class="page" style="page-break-after: avoid; break-after: auto;">
    ${renderHeader(company)}
    ${renderRefBar(data)}
    <div class="content">
      <div class="acceptance-box">
        <div class="acceptance-title">Acceptance of Quotation</div>
        <div class="acceptance-sub">Confirming offer from ${company.name}</div>
        <div class="acceptance-body">
          <p>
            <strong>${customer.toUpperCase()}</strong>${customerAddress ? `, residing at / having office at ${customerAddress},` : ''}
            confirms acceptance of reference no. <strong>${refNo || id}</strong> dated <strong>${fmtDate(date)}</strong>
            at <strong>₹${n(total)}/-</strong> including GST, from <strong>${company.name}</strong>, as per the terms &amp; conditions,
            scope of work, payment milestones and warranty clauses stated in this document.
          </p>
          <br/>
          <p>I/We confirm that the specifications and components listed in this quotation are acceptable and agree to proceed on this basis.</p>
        </div>
        <div class="sig-area">
          <div class="sig-block">
            ${hasSig ? `<img src="${sigSrc}" style="max-width:130px;max-height:56px;display:block;margin:0 auto 8px;" alt="Authorized Signature"/>` : `<div style="height:56px;"></div>`}
            <div class="sig-line">For ${company.name}<br/>Authorised Signatory</div>
          </div>
          <div class="sig-block">
            <div style="height:56px;border-bottom:1.5px solid var(--ink);margin-bottom:6px;"></div>
            <div class="sig-line">Customer Signature<br/>${customer}</div>
          </div>
        </div>
        ${hasQr ? `<div style="margin-top:18px;text-align:center;"><img src="${qrSrc}" style="width:72px;height:72px;" alt="QR"/><div class="fine-print" style="text-align:center;">Scan to Pay</div></div>` : ''}
      </div>
      <p class="fine-print" style="text-align:center;margin-top:12px;">
        This quotation is computer generated${validUntil ? ` and valid until ${fmtDate(validUntil)}` : ''}. For queries: ${company.phone} | ${company.email}
      </p>
    </div>
    ${renderFooter(company, pageNum, totalPages)}
  </div>`;
}

// ─────────────────────────────────────────────────────────────
// MAIN GENERATOR
// ─────────────────────────────────────────────────────────────

export function generateQuotationHtml(data: QuotationData): string {
  const requiredText = (value: unknown, label: string): string => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) throw new Error(`Quotation document requires ${label}.`);
    return normalized;
  };
  requiredText(data.customer, 'a customer name');
  const company = { ...data.company, name: requiredText(data.company?.name, 'a company name') };
  const workingData: QuotationData = { ...data, company };

  // Build every optional/mandatory section, drop the ones with nothing to show.
  const rawSections: Array<SectionDef | null> = [
    buildCommercialSection(workingData),
    buildSubsidySection(workingData),
    buildMilestonesSection(workingData),
    buildTechnicalSpecSection(workingData),
    buildScopeSection(workingData),
    buildWarrantySection(workingData),
    buildJourneySection(workingData),
    buildReferencesSection(workingData),
    buildPaymentTermsSection(workingData),
  ];

  // Dynamic numbering: only sections that actually render get a number,
  // assigned in document order with no gaps.
  let counter = 0;
  const numberedSections: NumberedSection[] = rawSections
    .filter((s): s is SectionDef => s !== null)
    .map(s => ({ ...s, number: ++counter }));

  // Pack sections into pages so related short sections share a page and
  // no page is left mostly empty.
  const groups = packSections(numberedSections);
  const bodyPagesHtml = groups.map(group => group.map(sectionWrapper).join(''));

  const totalPages = bodyPagesHtml.length + 2; // cover + acceptance

  const pages: string[] = [];
  pages.push(renderCoverPage(workingData, 1, totalPages));
  bodyPagesHtml.forEach((html, idx) => pages.push(renderContentPage(html, workingData, idx + 2, totalPages)));
  pages.push(renderAcceptancePage(workingData, totalPages, totalPages));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Quotation ${workingData.id} — ${workingData.customer}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4 portrait; margin: 0; }
  :root {
    --ink: #0f172a;
    --slate: #1e293b;
    --slate-soft: #475569;
    --paper: #ffffff;
    --surface: #f8fafc;
    --surface-alt: #f1f5f9;
    --accent: #059669;
    --accent-soft: #d1fae5;
    --amber: #b45309;
    --amber-soft: #fef3c7;
    --line: #e2e8f0;
  }
  html, body { width: 210mm; }
  html {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 9.5pt;
    color: var(--ink);
    background: var(--paper);
    margin: 0 auto;
  }
  img { max-width: 100%; }
  table { width:100%; border-collapse: collapse; }

  .page {
    width: 210mm;
    min-height: 297mm;
    position: relative;
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .page:last-child { page-break-after: avoid; break-after: auto; }
  .content { padding: 18px 26px; flex: 1; }
  .spacer { flex: 1; }

  /* Header */
  .header-table { width:100%; }
  .logo-cell { padding: 14px 26px 8px; vertical-align: middle; }
  .logo-fallback { font-size:17pt; font-weight:800; color: var(--ink); letter-spacing: -0.3px; }
  .company-name-strap { font-size:7pt; font-weight:700; color: var(--slate-soft); margin-top:3px; letter-spacing:1.2px; }
  .company-tagline { font-size:7.3pt; color: var(--accent); margin-top:2px; font-weight:600; }
  .contact-cell { padding: 14px 26px 8px; text-align:right; vertical-align:middle; font-size:7.8pt; line-height:1.6; color: var(--slate-soft); }
  .accent-bar { height: 3px; background: linear-gradient(90deg, var(--ink) 0%, var(--accent) 55%, var(--amber) 100%); }

  /* Ref bar */
  .ref-bar { display:flex; justify-content:space-between; padding:8px 26px; font-size:7.8pt; font-weight:700; color: var(--slate-soft); background: var(--surface-alt); border-bottom: 1px solid var(--line); letter-spacing: 0.4px; }

  /* Hero (cover) — subtle CSS-only solar-grid motif, single restrained accent glow */
  .hero {
    background-color: var(--ink);
    background-image:
      linear-gradient(135deg, rgba(5,150,105,0.16), transparent 55%),
      repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 26px),
      repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 26px);
    color: #fff;
    padding: 34px 32px 30px;
  }
  .hero-eyebrow { font-size:7.8pt; letter-spacing:2.5px; color: #6ee7b7; font-weight:700; text-transform:uppercase; }
  .hero-title { font-size: 24pt; font-weight:800; letter-spacing:-0.4px; margin-top:8px; line-height:1.1; }
  .hero-title span { color: #6ee7b7; }
  .hero-sub { font-size:9pt; color:#cbd5e1; margin-top:10px; max-width: 82%; line-height:1.55; }
  .hero-stats { display:flex; gap: 22px; margin-top: 20px; }
  .stat-block { border-left: 2px solid rgba(255,255,255,0.25); padding-left: 12px; }
  .stat-block:first-child { border-left: none; padding-left: 0; }
  .stat-val { font-size:14pt; font-weight:800; color:#fff; }
  .stat-lbl { font-size:7pt; color:#94a3b8; text-transform:uppercase; letter-spacing:0.8px; margin-top:2px; }

  .client-strip {
    background: var(--surface);
    border-bottom: 1px solid var(--line);
    padding: 12px 26px;
    display:flex; justify-content:space-between; flex-wrap:wrap; gap: 5px 26px;
  }
  .client-field .lbl { font-size:6.8pt; text-transform:uppercase; letter-spacing:0.8px; color: var(--slate-soft); }
  .client-field .val { font-size:9pt; font-weight:700; color: var(--ink); margin-top:1px; }

  .snapshot-grid { display:flex; gap: 22px; padding: 16px 26px 20px; border-bottom: 1px solid var(--line); }
  .snapshot-col { flex:1; border-left: 2px solid var(--line); padding-left: 12px; }
  .snapshot-col:first-child { border-left: none; padding-left: 0; }
  .snapshot-label { font-size:6.8pt; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color: var(--accent); margin-bottom:6px; }
  .snapshot-line { font-size:8.2pt; color: var(--ink); line-height:1.6; }

  /* Section labels */
  .section-label { display:flex; align-items:center; gap:9px; font-size:11pt; font-weight:800; color: var(--ink); margin: 0 0 10px; break-after: avoid-page; page-break-after: avoid; }
  .label-num { font-size:8pt; font-weight:800; color:#fff; background: var(--ink); border-radius: 4px; padding: 2px 7px; }
  .section-block { margin-bottom: 20px; }
  .section-block.tight { break-inside: avoid-page; page-break-inside: avoid; }
  .section-block:last-child { margin-bottom: 0; }
  .sub-section { font-size:8.8pt; font-weight:700; color: var(--ink); margin:12px 0 6px; text-transform:uppercase; letter-spacing:0.4px; }
  .meta-line { font-size:8.3pt; color:#475569; margin-top:8px; }

  /* Generic data table — used by subsidy, milestones, tech-spec, warranty, journey, references, bank details */
  .data-table { font-size:8.6pt; border: 1px solid var(--line); }
  .data-table th { background: var(--ink); color:#fff; padding:7px 8px; font-size:7.4pt; text-transform:uppercase; letter-spacing:0.4px; font-weight:700; text-align:center; }
  .data-table th:first-child { text-align:left; padding-left:10px; }
  .data-table td { border-bottom: 1px solid var(--line); vertical-align:top; padding: 7px 8px; page-break-inside: avoid; break-inside: avoid-page; }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table tr:nth-child(even) td { background: var(--surface); }
  .idx-cell { text-align:center; color: var(--slate-soft); font-weight:700; }
  .item-cell, .item-cell + td { padding-left:10px !important; }
  .item-name { font-weight:700; color: var(--ink); }
  .item-meta { color:#64748b; font-size:7.6pt; margin-top:2px; }
  .item-desc { color:#64748b; font-size:7.6pt; font-style:italic; margin-top:2px; }
  .item-hsn { color:#94a3b8; font-size:7pt; margin-top:2px; }
  .tc { text-align:center; } .tr { text-align:right; } .bold { font-weight:700; }

  /* Commercial offer specifics */
  .offer-table tr { page-break-inside: avoid; break-inside: avoid-page; }
  .totals-strip { border: 1px solid var(--line); border-top:none; }
  .totals-strip .row { display:flex; justify-content:space-between; padding:7px 12px; font-size:8.8pt; border-bottom: 1px solid var(--line); }
  .totals-strip .row.subtotal { background: var(--surface); font-weight:700; }
  .totals-strip .row.gst { background: var(--amber-soft); font-weight:700; color:#78350f; }
  .totals-strip .row.discount { background: var(--accent-soft); font-weight:700; color:#065f46; }
  .totals-strip .row.grand { background: var(--ink); color:#fff; font-size:11pt; font-weight:800; border:none; }
  .words-strip { text-align:center; font-size:7.8pt; font-style:italic; color: var(--slate-soft); padding:7px; background: var(--surface); border: 1px solid var(--line); border-top:none; }

  /* Subsidy net-effective block */
  .net-effective-bar { margin-top:12px; border:1.5px solid var(--ink); border-radius:8px; overflow:hidden; page-break-inside: avoid; break-inside: avoid-page; }
  .net-row { display:flex; justify-content:space-between; padding:8px 14px; font-size:8.6pt; }
  .net-row.muted { color: var(--accent); background:#fff; border-top:1px dashed var(--line); }
  .net-row.grand { background: var(--ink); color:#fff; font-weight:800; font-size:11pt; }
  .fine-print { font-size:7pt; color:#94a3b8; margin-top:7px; line-height:1.45; }
  .fine-print.discrepancy { color:#b45309; font-weight:600; }

  /* Payment milestones */
  .milestone-total-row { display:flex; justify-content:space-between; margin-top:6px; padding:8px 12px; background: var(--ink); color:#fff; border-radius:6px; font-weight:800; font-size:9pt; }

  /* Scope matrix */
  .scope-item { color: var(--ink); }
  .scope-cat-row td { background: var(--ink); color:#fff; font-weight:700; font-size:7.4pt; text-transform:uppercase; letter-spacing:0.4px; padding:6px 10px; text-align:left; }
  .badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:7pt; font-weight:700; }
  .badge-company { background: var(--ink); color:#fff; }
  .badge-client { background: var(--amber-soft); color:#78350f; }
  .badge-shared { background: var(--accent-soft); color:#065f46; }
  .badge-na { background: var(--surface-alt); color:#cbd5e1; }
  .scope-legend { font-size:7.2pt; color: var(--slate-soft); margin-top:8px; }

  .bullet-section p { margin:3px 0; font-size:8.6pt; line-height:1.55; }
  .exclusions p { color: var(--slate-soft); font-size:7.8pt; }

  /* Acceptance */
  .acceptance-box { border:1.5px solid var(--ink); border-radius:10px; padding:22px; page-break-inside: avoid; break-inside: avoid-page; }
  .acceptance-title { font-size:14pt; font-weight:800; text-align:center; }
  .acceptance-sub { text-align:center; font-size:9pt; color: var(--slate-soft); margin-top:4px; margin-bottom:16px; }
  .acceptance-body { font-size:9pt; line-height:1.75; text-align:justify; color: var(--slate); }
  .sig-area { margin-top:50px; display:flex; justify-content:space-between; }
  .sig-block { text-align:center; width:44%; }
  .sig-line { border-top:1.5px solid var(--ink); padding-top:6px; font-weight:700; font-size:8.6pt; }

  .footer { background: var(--ink); color:#94a3b8; padding:8px 26px; font-size:7pt; display:flex; justify-content:space-between; }

  @media print {
    .page { break-inside: avoid; }
  }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}