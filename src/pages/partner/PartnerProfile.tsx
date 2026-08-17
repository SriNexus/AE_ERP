/**
 * PartnerProfile — Partner Profile & Settings Workspace
 *
 * Two-column desktop layout:
 *   - Left: Business Details (editable: firmName, contactPerson, email, phone, alternatePhone, address)
 *   - Right: KYC Status Card (read-only: kycStatus, gstNumber, panNumber, kycDocuments)
 *   - Bottom: Bank Details (editable: bankDetails fields)
 *
 * On save, calls ChannelPartnerDomainService.update(partnerId, delta).
 * Partner cannot update: GST, PAN, commission config, account status.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { User, ShieldCheck, Building2, Banknote, MapPin, Save } from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAppStore } from '../../store/useAppStore';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import { ChannelPartnerDomainService } from '../../services/ChannelPartnerDomainService';
import { queryKeys } from '../../lib/queryKeys';
import type { ChannelPartner, PartnerAddress } from '../../features/channel-partner/types';
import toast from 'react-hot-toast';

// ── KYC Badge Styles ────────────────────────────────────────
const KYC_BADGE: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  pending:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  submitted:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  verified:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const KYC_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  pending:     'Pending',
  submitted:   'Submitted',
  verified:    'Verified',
  rejected:    'Rejected',
};

const PARTNER_STATUS_BADGE: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  active:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  suspended: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const PARTNER_STATUS_LABELS: Record<string, string> = {
  pending_approval: 'Pending Approval',
  active:   'Active',
  suspended: 'Suspended',
  inactive: 'Inactive',
};

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

function KYCStatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = KYC_BADGE[s] || 'bg-gray-100 text-gray-600';
  const label = KYC_LABELS[s] || s.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function PartnerStatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = PARTNER_STATUS_BADGE[s] || 'bg-gray-100 text-gray-600';
  const label = PARTNER_STATUS_LABELS[s] || s.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      {children}
    </div>
  );
}

function DetailField({ label, value, masked }: { label: string; value: string; masked?: boolean }) {
  const display = masked && value.length > 4
    ? 'XXXXXX' + value.slice(-4)
    : value || '—';
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-medium text-[var(--color-text)] break-words">{display}</p>
    </div>
  );
}

export default function PartnerProfile() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qc = useQueryClient();
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Form state ────────────────────────────────────────
  const [form, setForm] = useState({
    firmName: '',
    contactPerson: '',
    email: '',
    phone: '',
    alternatePhone: '',
    address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' } as PartnerAddress,
    bankDetails: {
      accountHolderName: '',
      accountNumber: '',
      ifscCode: '',
      bankName: '',
      branchName: '',
      accountType: 'savings' as 'savings' | 'current',
    },
  });

  const [dirty, setDirty] = useState(false);

  // Populate form when partner loads
  useEffect(() => {
    if (partner) {
      setForm({
        firmName: partner.firmName || '',
        contactPerson: partner.contactPerson || '',
        email: partner.email || '',
        phone: partner.phone || '',
        alternatePhone: partner.alternatePhone || '',
        address: {
          line1: partner.address?.line1 || '',
          line2: partner.address?.line2 || '',
          city: partner.address?.city || '',
          state: partner.address?.state || '',
          pincode: partner.address?.pincode || '',
          country: partner.address?.country || 'India',
        },
        bankDetails: {
          accountHolderName: partner.bankDetails?.accountHolderName || '',
          accountNumber: partner.bankDetails?.accountNumber || '',
          ifscCode: partner.bankDetails?.ifscCode || '',
          bankName: partner.bankDetails?.bankName || '',
          branchName: partner.bankDetails?.branchName || '',
          accountType: partner.bankDetails?.accountType || 'savings',
        },
      });
    }
  }, [partner]);

  // ── Save mutation ─────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!partner) throw new Error('No partner profile');
      const delta: Record<string, unknown> = {
        firmName: form.firmName,
        contactPerson: form.contactPerson,
        email: form.email,
        phone: form.phone,
        alternatePhone: form.alternatePhone || '',
        address: form.address,
        bankDetails: form.bankDetails,
      };
      await ChannelPartnerDomainService.update(partner.id, delta);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: companyKeys.partnersRoot });
      setDirty(false);
      toast.success('Profile updated successfully');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  }

  function updateAddressField(field: string, value: string) {
    setForm((prev) => ({
      ...prev,
      address: { ...prev.address, [field]: value },
    }));
    setDirty(true);
  }

  function updateBankField(field: string, value: string) {
    setForm((prev) => ({
      ...prev,
      bankDetails: { ...prev.bankDetails, [field]: value },
    }));
    setDirty(true);
  }

  if (!partner) {
    return (
      <PageShell
        title="My Profile"
        subtitle="Manage your business details and KYC"
        icon={<User className="h-5 w-5" />}
      >
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <User className="h-12 w-12 text-[var(--color-text-muted)] mb-4" />
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            {isLoading ? 'Loading...' : 'No Partner Profile'}
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isLoading ? 'Fetching your profile details.' : 'Your account isn\'t linked to a partner profile.'}
          </p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="My Profile"
      subtitle={`${partner.firmName || 'Partner'} · ${partner.contactPerson || ''}`}
      icon={<User className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            icon={<Save className="h-4 w-4" />}
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={!dirty}
          >
            Save Changes
          </Button>
        </div>
      }
    >
      {/* ── KPI-style status row ─────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-4 border-l-indigo-500 px-4 py-3">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Status</p>
          <div className="mt-1"><PartnerStatusBadge status={partner.status} /></div>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-4 border-l-emerald-500 px-4 py-3">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">KYC Status</p>
          <div className="mt-1"><KYCStatusBadge status={partner.kycStatus} /></div>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-4 border-l-amber-500 px-4 py-3">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Leads</p>
          <p className="text-xl font-extrabold text-[var(--color-text)] tabular-nums leading-tight mt-0.5">
            {partner.totalLeadsCreated || 0}
          </p>
        </div>
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-4 border-l-purple-500 px-4 py-3">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Conversion</p>
          <p className="text-xl font-extrabold text-[var(--color-text)] tabular-nums leading-tight mt-0.5">
            {(partner.conversionRate || 0).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* ── Two-column layout ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: Business Details (2/3) ──────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Business Details */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] p-6">
            <div className="flex items-center gap-2 mb-5">
              <Building2 className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-semibold text-[var(--color-text)]">Business Details</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Firm Name"
                value={form.firmName}
                onChange={(e) => updateField('firmName', e.target.value)}
                placeholder="Your firm name"
              />
              <Input
                label="Contact Person"
                value={form.contactPerson}
                onChange={(e) => updateField('contactPerson', e.target.value)}
                placeholder="Primary contact name"
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="email@example.com"
              />
              <Input
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="+91-9876543210"
              />
              <Input
                label="Alternate Phone"
                type="tel"
                value={form.alternatePhone}
                onChange={(e) => updateField('alternatePhone', e.target.value)}
                placeholder="+91-9876543210"
              />
            </div>
          </div>

          {/* Address */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] p-6">
            <div className="flex items-center gap-2 mb-5">
              <MapPin className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-semibold text-[var(--color-text)]">Address</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Address Line 1"
                  value={form.address.line1}
                  onChange={(e) => updateAddressField('line1', e.target.value)}
                  placeholder="Building, street, area"
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Address Line 2"
                  value={form.address.line2}
                  onChange={(e) => updateAddressField('line2', e.target.value)}
                  placeholder="Landmark, locality (optional)"
                />
              </div>
              <Input
                label="City"
                value={form.address.city}
                onChange={(e) => updateAddressField('city', e.target.value)}
                placeholder="City"
              />
              <FieldGroup label="State">
                <select
                  value={form.address.state}
                  onChange={(e) => updateAddressField('state', e.target.value)}
                  className="w-full h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)]"
                >
                  <option value="">Select state…</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </FieldGroup>
              <Input
                label="Pincode"
                value={form.address.pincode}
                onChange={(e) => updateAddressField('pincode', e.target.value)}
                placeholder="6-digit pincode"
              />
            </div>
          </div>

          {/* Bank Details */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] p-6">
            <div className="flex items-center gap-2 mb-5">
              <Banknote className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-semibold text-[var(--color-text)]">Bank Details</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Account Holder Name"
                value={form.bankDetails.accountHolderName}
                onChange={(e) => updateBankField('accountHolderName', e.target.value)}
                placeholder="Name as on bank account"
              />
              <Input
                label="Account Number"
                value={form.bankDetails.accountNumber}
                onChange={(e) => updateBankField('accountNumber', e.target.value)}
                placeholder="Bank account number"
              />
              <Input
                label="IFSC Code"
                value={form.bankDetails.ifscCode}
                onChange={(e) => updateBankField('ifscCode', e.target.value)}
                placeholder="e.g. HDFC0001234"
              />
              <Input
                label="Bank Name"
                value={form.bankDetails.bankName}
                onChange={(e) => updateBankField('bankName', e.target.value)}
                placeholder="e.g. HDFC Bank"
              />
              <Input
                label="Branch Name"
                value={form.bankDetails.branchName}
                onChange={(e) => updateBankField('branchName', e.target.value)}
                placeholder="Branch (optional)"
              />
              <FieldGroup label="Account Type">
                <select
                  value={form.bankDetails.accountType}
                  onChange={(e) => updateBankField('accountType', e.target.value as 'savings' | 'current')}
                  className="w-full h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)]"
                >
                  <option value="savings">Savings</option>
                  <option value="current">Current</option>
                </select>
              </FieldGroup>
              {partner.bankDetails?.verified && (
                <div className="sm:col-span-2 flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-4 w-4" />
                  Bank account verified
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: KYC Status Card (1/3) ─────────────────── */}
        <div className="space-y-6">
          {/* KYC Status */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] p-6">
            <div className="flex items-center gap-2 mb-5">
              <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" />
              <h3 className="font-semibold text-[var(--color-text)]">KYC Status</h3>
            </div>

            <div className="flex items-center justify-center mb-4">
              <div className={`h-16 w-16 rounded-full flex items-center justify-center ${
                partner.kycStatus === 'verified'
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                  : partner.kycStatus === 'rejected'
                    ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
              }`}>
                <ShieldCheck className="h-8 w-8" />
              </div>
            </div>

            <div className="text-center mb-4">
              <KYCStatusBadge status={partner.kycStatus} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {partner.kycStatus === 'verified'
                  ? 'Your KYC documents have been verified.'
                  : partner.kycStatus === 'rejected'
                    ? partner.kycRejectionReason || 'KYC was rejected. Please resubmit.'
                    : partner.kycStatus === 'submitted'
                      ? 'KYC documents submitted. Awaiting review.'
                      : 'Complete your KYC to start earning commissions.'}
              </p>
            </div>

            {partner.kycRejectionReason && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 px-4 py-2.5 mb-4 text-xs text-red-600 dark:text-red-400">
                <p className="font-semibold">Rejection Reason</p>
                <p>{partner.kycRejectionReason}</p>
              </div>
            )}

            <div className="space-y-3">
              <DetailField label="PAN Number" value={partner.panNumber || '—'} masked />
              <DetailField label="GST Number" value={partner.gstNumber || '—'} />
              <DetailField label="Submitted At" value={partner.kycSubmittedAt ? new Date(partner.kycSubmittedAt).toLocaleDateString('en-GB') : '—'} />
              {partner.kycVerifiedAt && (
                <DetailField label="Verified At" value={new Date(partner.kycVerifiedAt).toLocaleDateString('en-GB')} />
              )}
            </div>

            {/* Uploaded KYC Documents */}
            {partner.kycDocuments && partner.kycDocuments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                  Uploaded Documents
                </p>
                <ul className="space-y-1">
                  {partner.kycDocuments.map((doc, idx) => (
                    <li key={idx} className="text-xs text-[var(--color-text-muted)] flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
                      {doc}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Wallet Summary Mini */}
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] p-6">
            <h3 className="font-semibold text-[var(--color-text)] mb-3">Financial Summary</h3>
            <div className="space-y-3">
              <DetailField label="Wallet Balance" value={`₹${(partner.walletBalance || 0).toLocaleString('en-IN')}`} />
              <DetailField label="Pending Settlement" value={`₹${(partner.pendingBalance || 0).toLocaleString('en-IN')}`} />
              <DetailField label="Total Earned" value={`₹${(partner.totalCommissionEarned || 0).toLocaleString('en-IN')}`} />
              <DetailField label="Total Paid" value={`₹${(partner.totalCommissionPaid || 0).toLocaleString('en-IN')}`} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Sticky Save Bar (mobile) ──────────────────────── */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 lg:static lg:mt-6 bg-[var(--color-surface)] border-t border-[var(--color-border)] lg:border lg:rounded-2xl lg:shadow-[var(--shadow-enterprise-surface)] px-4 py-3 lg:p-4 flex items-center justify-between z-10">
          <span className="text-xs text-[var(--color-text-muted)] hidden sm:block">
            You have unsaved changes
          </span>
          <div className="flex items-center gap-2 w-full lg:w-auto justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (partner) {
                  setForm({
                    firmName: partner.firmName || '',
                    contactPerson: partner.contactPerson || '',
                    email: partner.email || '',
                    phone: partner.phone || '',
                    alternatePhone: partner.alternatePhone || '',
                    address: {
                      line1: partner.address?.line1 || '',
                      line2: partner.address?.line2 || '',
                      city: partner.address?.city || '',
                      state: partner.address?.state || '',
                      pincode: partner.address?.pincode || '',
                      country: partner.address?.country || 'India',
                    },
                    bankDetails: {
                      accountHolderName: partner.bankDetails?.accountHolderName || '',
                      accountNumber: partner.bankDetails?.accountNumber || '',
                      ifscCode: partner.bankDetails?.ifscCode || '',
                      bankName: partner.bankDetails?.bankName || '',
                      branchName: partner.bankDetails?.branchName || '',
                      accountType: partner.bankDetails?.accountType || 'savings',
                    },
                  });
                }
                setDirty(false);
              }}
            >
              Reset
            </Button>
            <Button
              size="sm"
              icon={<Save className="h-4 w-4" />}
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
            >
              Save Changes
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
