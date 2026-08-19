// ═══════════════════════════════════════════════════════════
//  COMPANY CONFIG — Change these values to white-label the ERP
//  Supports multi-company: each company doc in Firestore has its own config
// ═══════════════════════════════════════════════════════════

import type { CompanyBusinessMode } from '../lib/companyBusinessMode';

export type CompanyConfig = {
  id: string;
  name: string;
  shortName: string;
  // Phase 1 (Multi-Tenant): FK to groups/{groupId} — the tenant boundary above
  // Company. Populated by the Phase 1 backfill for existing companies; new
  // companies receive it at write time via resolveWriteGroupId()/the write
  // helpers, never client-controlled. Optional here because pre-Phase-1
  // companies exist without it during the migration window (Master Plan §3.2:
  // "Required, Immutable after Phase 1 backfill completes").
  groupId?: string;
  companyCode: string;     // e.g. CGPL, STS
  tagline: string;
  /** Phase 1: which workflow(s) this company operates. Defaults to 'Both' for
   * records created before this field existed — see lib/companyBusinessMode.ts. */
  businessMode?: CompanyBusinessMode;
  logo?: string;           // Base64 compressed — full horizontal logo (expanded sidebar, documents)
  iconLogo?: string;       // Base64 compressed — compact square/circle icon (collapsed sidebar)
  qrCode?: string;         // Base64 compressed image
  signature?: string;      // Base64 compressed image
  address: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  phone: string;
  email: string;
  website?: string;
  gst: string;
  pan: string;
  cin?: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  bankBranch: string;
  currency: string;
  currencySymbol: string;
  timezone: string;
  fiscalYearStart: string; // MM-DD e.g. "04-01"
  invoicePrefix: string;
  orderPrefix: string;
  quotationPrefix: string;
  dispatchPrefix: string;
  primaryColor: string;    // hex
  accentColor: string;     // hex
  status: string;
};

// ─── DEFAULT COMPANY (replace with your company details) ───
export const DEFAULT_COMPANY: CompanyConfig = {
  id: 'default',
  name: 'Neozy',
  shortName: 'Neozy',
  companyCode: 'NEOZY',
  tagline: 'Neozy Business Operating System',
  address: '123, Industrial Area, Sector 5',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  phone: '+91-9800000000',
  email: 'info@neozy.com',
  website: 'www.neozy.com',
  gst: '27XXXXX0000X1ZX',
  pan: 'XXXXX0000X',
  cin: 'U99999MH2020PTC000000',
  bankName: 'HDFC Bank',
  bankAccount: '00000000000000',
  bankIfsc: 'HDFC0000000',
  bankBranch: 'Mumbai Main Branch',
  currency: 'INR',
  currencySymbol: '₹',
  timezone: 'Asia/Kolkata',
  fiscalYearStart: '04-01',
  invoicePrefix: 'INV',
  orderPrefix: 'ORD',
  quotationPrefix: 'QT',
  dispatchPrefix: 'DSP',
  primaryColor: '#4f46e5',
  accentColor: '#10b981',
  status: 'Active',
  businessMode: 'Both',
};

// ─── ROLES ─────────────────────────────────────────────────
export const ERP_ROLES = [
  'Admin',
  'Manager',
  'TL',
  'BDM',
  'BDE',
  'Sales',
  'Executive',
  'Surveyor',
  'Engineer',
  'InstallationLead',
  'ServiceTechnician',
  'ComplianceOfficer',
] as const;
export type ERPRole = typeof ERP_ROLES[number];

// ─── LEAD SOURCES ──────────────────────────────────────────
export const LEAD_SOURCES = ['Website', 'Referral', 'Cold Call', 'Social Media', 'Exhibition', 'Email', 'WhatsApp', 'Channel Partner', 'Other'];

// ─── LEAD STATUSES ────────────────────────────────────────
export const LEAD_STATUSES = ['New', 'Follow-up', 'Qualified', 'Converted', 'Lost'];

// ─── ORDER STATUSES ��──────────────────────────────────────
export const ORDER_STATUSES = ['Pending', 'Processing', 'Confirmed', 'Dispatched', 'Partial Dispatch', 'Delivered', 'Cancelled'];

// ─── PAYMENT STATUSES ─────────────────────────────────────
export const PAYMENT_STATUSES = ['Pending', 'Partial', 'Paid', 'Overdue', 'Refunded'];

// ─── DISPATCH STATUSES ────────────────────────────────────
export const DISPATCH_STATUSES = ['Pending Verification', 'Verified', 'Dispatched', 'In Transit', 'Delivered', 'Returned'];

// ─── UNITS ────────────────────────────────────────────────
export const UNITS = ['PCS', 'KG', 'LTR', 'MTR', 'BOX', 'SET', 'PAIR', 'ROLL', 'NOS', 'TON', 'KW', 'MW'];

// ─── PAYMENT MODES ────────────────────────────────────────
export const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'NEFT', 'RTGS', 'IMPS', 'DD'];

// ─── INDIAN STATES ────────────────────────────────────────
export const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
];
