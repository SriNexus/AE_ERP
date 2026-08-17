export type GstPartyInput = {
  gstin?: string;
  state?: string;
  stateCode?: string;
};

export type GstInvoiceItemInput = {
  productId?: string;
  product?: string;
  description?: string;
  hsn?: string;
  hsnCode?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  rate?: number;
  discount?: number;
  tax?: number;
};

export type GstPartyResolution = {
  gstin: string;
  stateCode: string;
  stateName: string;
  source: 'gstin' | 'stateCode' | 'stateName';
};

export type GstLineBreakdown = {
  productId?: string;
  product?: string;
  description?: string;
  hsn: string;
  quantity: number;
  rate: number;
  taxableValue: number;
  taxRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  lineTotal: number;
};

export type GstInvoiceBreakdown = {
  sameState: boolean;
  company: GstPartyResolution;
  customer: GstPartyResolution;
  placeOfSupply: string;
  subtotal: number;
  totalTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  lines: GstLineBreakdown[];
};

export class GstCalculationError extends Error {
  readonly code = 'GST_CALCULATION_ERROR';
}

const GST_STATE_CODE_TO_NAME: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

const STATE_NAME_TO_CODE: Record<string, string> = Object.entries(GST_STATE_CODE_TO_NAME).reduce((acc, [code, name]) => {
  acc[normalizeStateKey(name)] = code;
  return acc;
}, {} as Record<string, string>);

function normalizeStateKey(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeGstin(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function getStateCodeFromGstin(gstin: unknown): string | null {
  const normalized = normalizeGstin(gstin);
  if (!/^\d{2}[A-Z0-9]{13}$/.test(normalized)) return null;
  const code = normalized.slice(0, 2);
  return GST_STATE_CODE_TO_NAME[code] ? code : null;
}

/**
 * Default demo/fallback state for when GST data is unavailable.
 */
const DEMO_FALLBACK_STATE = { code: '09', state: 'Uttar Pradesh' } as const;

/**
 * Log a GST resolution warning (only once per unique message).
 */
const GST_WARNINGS = new Set<string>();
function gstWarn(message: string) {
  if (GST_WARNINGS.has(message)) return;
  GST_WARNINGS.add(message);
  console.warn(`[GST] ${message}`);
}

export function resolvePartyState(party: GstPartyInput): GstPartyResolution {
  const gstin = normalizeGstin(party.gstin);
  const gstinStateCode = getStateCodeFromGstin(gstin);
  if (gstinStateCode) {
    return {
      gstin,
      stateCode: gstinStateCode,
      stateName: GST_STATE_CODE_TO_NAME[gstinStateCode],
      source: 'gstin',
    };
  }

  const explicitStateCode = normalizeGstin(party.stateCode);
  if (/^\d{2}$/.test(explicitStateCode) && GST_STATE_CODE_TO_NAME[explicitStateCode]) {
    return {
      gstin,
      stateCode: explicitStateCode,
      stateName: GST_STATE_CODE_TO_NAME[explicitStateCode],
      source: 'stateCode',
    };
  }

  const normalizedState = normalizeStateKey(party.state);
  const stateCode = STATE_NAME_TO_CODE[normalizedState];
  if (stateCode) {
    return {
      gstin,
      stateCode,
      stateName: GST_STATE_CODE_TO_NAME[stateCode],
      source: 'stateName',
    };
  }

  // ── Fallback: missing/invalid GSTIN or state — warn instead of crash ──
  gstWarn(
    `Unable to resolve GST state from GSTIN="${party.gstin || ''}" state="${party.state || ''}". Using fallback state "${DEMO_FALLBACK_STATE.state}".`
  );

  return {
    gstin,
    stateCode: DEMO_FALLBACK_STATE.code,
    stateName: DEMO_FALLBACK_STATE.state,
    source: 'stateCode',
  };
}

function resolveLineValue(item: GstInvoiceItemInput) {
  const quantity = Number(item.qty ?? item.quantity ?? 0);
  const rate = Number(item.price ?? item.rate ?? 0);
  const discount = Number(item.discount ?? 0);

  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new GstCalculationError(`Invalid quantity for item ${item.productId || item.product || item.description || 'unknown'}`);
  }
  if (!Number.isFinite(rate) || rate < 0) {
    throw new GstCalculationError(`Invalid rate for item ${item.productId || item.product || item.description || 'unknown'}`);
  }
  if (!Number.isFinite(discount) || discount < 0) {
    throw new GstCalculationError(`Invalid discount for item ${item.productId || item.product || item.description || 'unknown'}`);
  }

  const taxableValue = Math.max(0, roundMoney((quantity * rate) - discount));
  const taxRate = Math.max(0, Number(item.tax ?? 0) || 0);
  const totalTax = roundMoney((taxableValue * taxRate) / 100);

  return {
    quantity,
    rate,
    taxableValue,
    taxRate,
    totalTax,
  };
}

function splitTax(totalTax: number) {
  const cgst = roundMoney(totalTax / 2);
  const sgst = roundMoney(totalTax - cgst);
  return { cgst, sgst, igst: 0 };
}

export function calculateGstBreakdown(
  items: GstInvoiceItemInput[],
  company: GstPartyInput,
  customer: GstPartyInput
): GstInvoiceBreakdown {
  if (!Array.isArray(items)) {
    throw new GstCalculationError('GST calculation requires an item array');
  }

  const companyState = resolvePartyState(company);
  const customerState = resolvePartyState(customer);
  const sameState = companyState.stateCode === customerState.stateCode;
  const placeOfSupply = customerState.stateName || companyState.stateName;

  const lines = items.map((item) => {
    const resolved = resolveLineValue(item);
    const hsn = String(item.hsn ?? item.hsnCode ?? '').trim();
    const totalTax = resolved.totalTax;
    const taxSplit = sameState ? splitTax(totalTax) : { cgst: 0, sgst: 0, igst: totalTax };
    return {
      productId: item.productId,
      product: item.product,
      description: item.description,
      hsn,
      quantity: resolved.quantity,
      rate: resolved.rate,
      taxableValue: resolved.taxableValue,
      taxRate: resolved.taxRate,
      cgstRate: sameState ? roundMoney(resolved.taxRate / 2) : 0,
      sgstRate: sameState ? roundMoney(resolved.taxRate / 2) : 0,
      igstRate: sameState ? 0 : roundMoney(resolved.taxRate),
      cgst: taxSplit.cgst,
      sgst: taxSplit.sgst,
      igst: taxSplit.igst,
      totalTax,
      lineTotal: roundMoney(resolved.taxableValue + totalTax),
    } satisfies GstLineBreakdown;
  });

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.taxableValue, 0));
  const totalTax = roundMoney(lines.reduce((sum, line) => sum + line.totalTax, 0));
  const cgst = roundMoney(lines.reduce((sum, line) => sum + line.cgst, 0));
  const sgst = roundMoney(lines.reduce((sum, line) => sum + line.sgst, 0));
  const igst = roundMoney(lines.reduce((sum, line) => sum + line.igst, 0));

  return {
    sameState,
    company: companyState,
    customer: customerState,
    placeOfSupply,
    subtotal,
    totalTax,
    cgst,
    sgst,
    igst,
    grandTotal: roundMoney(subtotal + totalTax),
    lines,
  };
}

export function getFiscalYearLabel(date = new Date(), fiscalYearStart = '04-01') {
  const [startMonthRaw, startDayRaw] = fiscalYearStart.split('-').map((part) => Number(part));
  const startMonth = Number.isFinite(startMonthRaw) && startMonthRaw >= 1 && startMonthRaw <= 12 ? startMonthRaw : 4;
  const startDay = Number.isFinite(startDayRaw) && startDayRaw >= 1 && startDayRaw <= 31 ? startDayRaw : 1;
  const year = date.getFullYear();
  const fiscalStart = new Date(year, startMonth - 1, startDay);
  const startYear = date >= fiscalStart ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
}

