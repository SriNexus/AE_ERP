/**
 * Channel Partner — Shared Constants
 *
 * Centralized constants for the Channel Partner module.
 * Follows the same pattern as src/config/company.ts and src/constants/index.ts.
 */

// ── Status Options ────────────────────────────────────────────

export const PARTNER_STATUSES = [
  'pending_approval',
  'active',
  'suspended',
  'inactive',
] as const;

export const PARTNER_STATUS_OPTIONS = PARTNER_STATUSES.map((s) => ({
  label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  value: s,
}));

export const KYC_STATUSES = [
  'not_started',
  'pending',
  'submitted',
  'verified',
  'rejected',
] as const;

export const KYC_STATUS_OPTIONS = KYC_STATUSES.map((s) => ({
  label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  value: s,
}));

// ── Commission Types ──────────────────────────────────────────

export const COMMISSION_RULE_TYPES = [
  'percentage',
  'fixed',
  'per_kw',
  'per_deal',
  'slab',
] as const;

export const COMMISSION_RULE_TYPE_OPTIONS = COMMISSION_RULE_TYPES.map((t) => ({
  label: t === 'per_kw' ? 'Per KW'
       : t === 'per_deal' ? 'Per Deal'
       : t.charAt(0).toUpperCase() + t.slice(1),
  value: t,
}));

export const COMMISSION_APPLICABILITY_OPTIONS = [
  { label: 'All Partners', value: 'all' },
  { label: 'Specific Partner', value: 'partner' },
  { label: 'Partner Tier', value: 'partner_tier' },
  { label: 'Product Category', value: 'product_category' },
  { label: 'Location', value: 'location' },
];

export const PARTNER_TIER_OPTIONS = [
  { label: 'Bronze', value: 'bronze' },
  { label: 'Silver', value: 'silver' },
  { label: 'Gold', value: 'gold' },
  { label: 'Platinum', value: 'platinum' },
];

// ── Commission Status ─────────────────────────────────────────

export const COMMISSION_STATUSES = [
  'pending',
  'calculated',
  'approved',
  'paid',
  'voided',
] as const;

export const COMMISSION_STATUS_OPTIONS = COMMISSION_STATUSES.map((s) => ({
  label: s.charAt(0).toUpperCase() + s.slice(1),
  value: s,
}));

// ── Wallet & Withdrawal ────────────────────────────────────────

export const WITHDRAWAL_STATUSES = [
  'pending',
  'approved',
  'paid',
  'rejected',
] as const;

export const WITHDRAWAL_STATUS_OPTIONS = WITHDRAWAL_STATUSES.map((s) => ({
  label: s.charAt(0).toUpperCase() + s.slice(1),
  value: s,
}));

export const PAYMENT_METHOD_OPTIONS = [
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Cheque', value: 'cheque' },
  { label: 'Cash', value: 'cash' },
  { label: 'UPI', value: 'upi' },
];

// ── Form Defaults ─────────────────────────────────────────────

export const PARTNER_FORM_DEFAULT = {
  firmName: '',
  contactPerson: '',
  email: '',
  phone: '',
  alternatePhone: '',
  address: {
    line1: '',
    line2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India',
  },
  gstNumber: '',
  panNumber: '',
  notes: '',
  tags: [],
  defaultCommissionType: '' as string,
  defaultCommissionValue: 0,
};

export type PartnerForm = typeof PARTNER_FORM_DEFAULT;

export const COMMISSION_RULE_FORM_DEFAULT = {
  name: '',
  description: '',
  type: 'percentage' as const,
  isActive: true,
  value: 0,
  minAmount: 0,
  maxAmount: 0,
  applicableTo: 'all' as const,
  applicableIds: [] as string[],
  minSystemSizeKW: 0,
  maxSystemSizeKW: 0,
  priority: 0,
  effectiveFrom: '',
  effectiveTo: '',
};

export type CommissionRuleForm = typeof COMMISSION_RULE_FORM_DEFAULT;
