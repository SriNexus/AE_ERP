/**
 * PartnerMobileProfileWorkspace — Mobile Profile View/Edit for Partner Portal
 *
 * Follows the same patterns as PartnerMobileWalletWorkspace and
 * PartnerMobileDocumentsWorkspace. Provides a scrollable profile view
 * with editable business details, address, bank details, and a read-only
 * KYC status summary.
 *
 * On save, calls ChannelPartnerDomainService.update(partnerId, delta).
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Building2, MapPin, Banknote, Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import { ChannelPartnerDomainService } from '../../../services/ChannelPartnerDomainService';
import { queryKeys } from '../../../lib/queryKeys';
import type { ChannelPartner } from '../../../features/channel-partner/types';
import toast from 'react-hot-toast';

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

function KYCPill({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = KYC_BADGE[s] || 'bg-gray-100 text-gray-600';
  const label = KYC_LABELS[s] || s.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function FormSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[var(--color-primary)]">{icon}</span>
        <h3 className="font-semibold text-sm text-[var(--color-text)]">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function PartnerMobileProfileWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qc = useQueryClient();
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  const { data: partnerSelf, isLoading, refetch } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  const [form, setForm] = useState({
    firmName: '',
    contactPerson: '',
    email: '',
    phone: '',
    alternatePhone: '',
    address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
    bankDetails: {
      accountHolderName: '',
      accountNumber: '',
      ifscCode: '',
      bankName: '',
      branchName: '',
      accountType: 'savings' as 'savings' | 'current',
      verified: false,
    },
  });

  const [dirty, setDirty] = useState(false);

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
          verified: partner.bankDetails?.verified || false,
        },
      });
    }
  }, [partner]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!partner) throw new Error('No partner profile');
      await ChannelPartnerDomainService.update(partner.id, {
        firmName: form.firmName,
        contactPerson: form.contactPerson,
        email: form.email,
        phone: form.phone,
        alternatePhone: form.alternatePhone || '',
        address: form.address,
        bankDetails: form.bankDetails,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: companyKeys.partnersRoot });
      setDirty(false);
      toast.success('Profile updated');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function resetForm() {
    if (partner) {
      setForm({
        firmName: partner.firmName || '',
        contactPerson: partner.contactPerson || '',
        email: partner.email || '',
        phone: partner.phone || '',
        alternatePhone: partner.alternatePhone || '',
        address: { line1: partner.address?.line1 || '', line2: partner.address?.line2 || '', city: partner.address?.city || '', state: partner.address?.state || '', pincode: partner.address?.pincode || '', country: partner.address?.country || 'India' },
        bankDetails: { accountHolderName: partner.bankDetails?.accountHolderName || '', accountNumber: partner.bankDetails?.accountNumber || '', ifscCode: partner.bankDetails?.ifscCode || '', bankName: partner.bankDetails?.bankName || '', branchName: partner.bankDetails?.branchName || '', accountType: partner.bankDetails?.accountType || 'savings', verified: partner.bankDetails?.verified || false },
      });
    }
    setDirty(false);
  }

  if (!partner) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">
          {isLoading ? 'Loading...' : 'No Partner Profile'}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {isLoading ? 'Fetching your profile.' : 'Your account isn\'t linked to a partner profile.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold text-[var(--color-text)]">My Profile</h1>
          <p className="text-xs text-[var(--color-text-muted)]">{partner.firmName || 'Partner'}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* ── KYC Status Banner ──────────────────────────────── */}
      <div className="px-4 mb-3">
        <div className={`rounded-xl border p-4 flex items-center gap-3 ${
          partner.kycStatus === 'verified'
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700'
            : partner.kycStatus === 'rejected'
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
              : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'
        }`}>
          <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
            partner.kycStatus === 'verified' ? 'bg-emerald-200 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300'
            : partner.kycStatus === 'rejected' ? 'bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-300'
            : 'bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300'
          }`}>
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm text-[var(--color-text)]">KYC</p>
              <KYCPill status={partner.kycStatus} />
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {partner.kycStatus === 'verified' ? 'All documents verified'
              : partner.kycStatus === 'rejected' ? (partner.kycRejectionReason || 'Documents rejected')
              : 'Complete your KYC verification'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Scrollable Form ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-3">
        {/* Business Details */}
        <FormSection icon={<Building2 className="h-4 w-4" />} title="Business Details">
          <Input label="Firm Name" value={form.firmName} onChange={(e) => { setForm((p) => ({ ...p, firmName: e.target.value })); setDirty(true); }} placeholder="Your firm name" />
          <Input label="Contact Person" value={form.contactPerson} onChange={(e) => { setForm((p) => ({ ...p, contactPerson: e.target.value })); setDirty(true); }} placeholder="Primary contact" />
          <Input label="Email" type="email" value={form.email} onChange={(e) => { setForm((p) => ({ ...p, email: e.target.value })); setDirty(true); }} placeholder="email@example.com" />
          <Input label="Phone" type="tel" value={form.phone} onChange={(e) => { setForm((p) => ({ ...p, phone: e.target.value })); setDirty(true); }} placeholder="+91-9876543210" />
          <Input label="Alt. Phone" type="tel" value={form.alternatePhone} onChange={(e) => { setForm((p) => ({ ...p, alternatePhone: e.target.value })); setDirty(true); }} placeholder="+91-9876543210" />
        </FormSection>

        {/* Address */}
        <FormSection icon={<MapPin className="h-4 w-4" />} title="Address">
          <Input label="Address Line 1" value={form.address.line1} onChange={(e) => { setForm((p) => ({ ...p, address: { ...p.address, line1: e.target.value } })); setDirty(true); }} placeholder="Building, street" />
          <Input label="Address Line 2" value={form.address.line2} onChange={(e) => { setForm((p) => ({ ...p, address: { ...p.address, line2: e.target.value } })); setDirty(true); }} placeholder="Landmark (optional)" />
          <div className="grid grid-cols-2 gap-2">
            <Input label="City" value={form.address.city} onChange={(e) => { setForm((p) => ({ ...p, address: { ...p.address, city: e.target.value } })); setDirty(true); }} placeholder="City" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">State</p>
              <select value={form.address.state} onChange={(e) => { setForm((p) => ({ ...p, address: { ...p.address, state: e.target.value } })); setDirty(true); }}
                className="w-full h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)]">
                <option value="">State…</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <Input label="Pincode" value={form.address.pincode} onChange={(e) => { setForm((p) => ({ ...p, address: { ...p.address, pincode: e.target.value } })); setDirty(true); }} placeholder="6-digit pincode" />
        </FormSection>

        {/* Bank Details */}
        <FormSection icon={<Banknote className="h-4 w-4" />} title="Bank Details">
          <Input label="Account Holder" value={form.bankDetails.accountHolderName} onChange={(e) => { setForm((p) => ({ ...p, bankDetails: { ...p.bankDetails, accountHolderName: e.target.value } })); setDirty(true); }} placeholder="Name on account" />
          <Input label="Account Number" value={form.bankDetails.accountNumber} onChange={(e) => { setForm((p) => ({ ...p, bankDetails: { ...p.bankDetails, accountNumber: e.target.value } })); setDirty(true); }} placeholder="Account number" />
          <div className="grid grid-cols-2 gap-2">
            <Input label="IFSC Code" value={form.bankDetails.ifscCode} onChange={(e) => { setForm((p) => ({ ...p, bankDetails: { ...p.bankDetails, ifscCode: e.target.value } })); setDirty(true); }} placeholder="HDFC0001234" />
            <Input label="Bank Name" value={form.bankDetails.bankName} onChange={(e) => { setForm((p) => ({ ...p, bankDetails: { ...p.bankDetails, bankName: e.target.value } })); setDirty(true); }} placeholder="HDFC Bank" />
          </div>
        </FormSection>

        {/* KYC Detail */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" />
            <h3 className="font-semibold text-sm text-[var(--color-text)]">KYC Information</h3>
          </div>
          <div className="text-xs text-[var(--color-text-muted)] space-y-1.5">
            <p><span className="font-medium text-[var(--color-text)]">PAN:</span> {partner.panNumber ? 'XXXXXX' + partner.panNumber.slice(-4) : '—'}</p>
            <p><span className="font-medium text-[var(--color-text)]">GST:</span> {partner.gstNumber || '—'}</p>
            {partner.kycSubmittedAt && <p><span className="font-medium text-[var(--color-text)]">Submitted:</span> {new Date(partner.kycSubmittedAt).toLocaleDateString('en-GB')}</p>}
            {partner.kycVerifiedAt && <p><span className="font-medium text-[var(--color-text)]">Verified:</span> {new Date(partner.kycVerifiedAt).toLocaleDateString('en-GB')}</p>}
            {partner.kycDocuments && partner.kycDocuments.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--color-border-subtle)]">
                <p className="font-medium text-[var(--color-text)] mb-1">Uploaded Documents:</p>
                <ul className="list-disc list-inside">
                  {partner.kycDocuments.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky Save Bar ────────────────────────────────── */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] px-4 py-3 flex items-center gap-2 z-10">
          <Button variant="outline" size="sm" onClick={resetForm} className="flex-1">
            Reset
          </Button>
          <Button
            size="sm"
            icon={<Save className="h-4 w-4" />}
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            className="flex-1"
          >
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}

export default PartnerMobileProfileWorkspace;
