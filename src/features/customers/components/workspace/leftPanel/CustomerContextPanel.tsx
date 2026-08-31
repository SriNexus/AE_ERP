/**
 * CustomerContextPanel — Left Panel's permanent Customer Information content.
 *
 * Presentation follows the finalized Leads Workspace Left Panel's row-wise,
 * compact InfoRow style: a fixed-width label column on the left, value on
 * the right, separated by subtle bottom borders. No grouped clusters, no
 * icon-led rows — just clean label → value rows for every field.
 *
 * B2B/B2C-aware: different fields shown per customer type, but the
 * presentation is identical.
 *
 * Field names match the real create forms and the Workspace's own edit fields.
 * Status is deliberately NOT repeated here — the Header is authoritative.
 * Aadhaar number is not displayed (PII).
 */
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

interface Props {
  customer: any;
}

export interface CustomerContextFields {
  isB2B: boolean;
  name: string;
  phone: string;
  email: string;
  caseId?: string;
  sourceLeadId?: string;
  addressLine?: string;
  status: string;
  assignedToName: string;
}

/** Pure B2B/B2C-aware field resolution — unit-testable without rendering. */
export function resolveCustomerContextFields(customer: any): CustomerContextFields {
  const isB2B = (customer?.type || 'B2B') === 'B2B';
  return {
    isB2B,
    name: customer?.contactPerson || customer?.fullName || customer?.name || '—',
    phone: customer?.businessPhone || customer?.mobile || customer?.phone || '—',
    email: customer?.businessEmail || customer?.email || '—',
    caseId: customer?.caseId || customer?.linkedCaseId || undefined,
    sourceLeadId: customer?.leadId || customer?.sourceLeadId || undefined,
    addressLine: customer?.address
      ? `${customer.address}${customer.city ? `, ${customer.city}` : ''}${customer.state ? `, ${customer.state}` : ''}`
      : (customer?.city && customer?.state ? `${customer.city}, ${customer.state}` : (customer?.city || customer?.state || undefined)),
    status: customer?.status || 'Active',
    assignedToName: customer?.assignedToName || 'Unassigned',
  };
}

/** Row-wise label → value row — matches the Lead workspace's InfoRow exactly:
 * fixed 100px label column, flexible value, subtle bottom border. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '' || value === '—') return null;
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-2 gap-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <span className="text-[12px] font-medium text-[var(--color-text)] break-words leading-5">{value}</span>
    </div>
  );
}

/** Row with a clickable link value — for source lead / case navigation. */
function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-2 gap-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <a
        href={href}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline leading-5"
      >
        {label === 'Source Lead' ? 'View source lead' : label}
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}

export default function CustomerContextPanel({ customer }: Props) {
  const { isB2B, phone, email, caseId, sourceLeadId, assignedToName, addressLine } = resolveCustomerContextFields(customer);

  return (
    <div>
      {/* B2B fields */}
      {isB2B && (
        <>
          <InfoRow label="Company" value={customer.companyName || customer.company} />
          <InfoRow label="Contact" value={customer.contactPerson || customer.name} />
          <InfoRow label="GST" value={customer.gst || customer.gstin} />
          <InfoRow label="Industry" value={customer.industryType} />
        </>
      )}

      {/* B2C fields */}
      {!isB2B && (
        <>
          <InfoRow label="Full Name" value={customer.fullName || customer.name} />
          {customer.propertyType && <InfoRow label="Property" value={customer.propertyType} />}
          {customer.projectType && <InfoRow label="Project Type" value={customer.projectType} />}
          {customer.sanctionLoad && <InfoRow label="Sanction Load" value={`${customer.sanctionLoad} sanctioned`} />}
          {customer.roofType && <InfoRow label="Roof Type" value={customer.roofType} />}
          {customer.monthlyBillAmount && <InfoRow label="Monthly Bill" value={`₹${customer.monthlyBillAmount}`} />}
        </>
      )}

      {/* Common fields */}
      <InfoRow label="Phone" value={phone !== '—' ? phone : undefined} />
      <InfoRow label="Email" value={email !== '—' ? email : undefined} />
      {(customer.altName || customer.altMobile) && (
        <InfoRow label="Alt Contact" value={[customer.altName, customer.altMobile].filter(Boolean).join(' · ')} />
      )}
      <InfoRow label="Address" value={addressLine} />
      <InfoRow label="Assigned To" value={assignedToName !== 'Unassigned' ? assignedToName : undefined} />
      {customer.notes && <InfoRow label="Notes" value={customer.notes} />}

      {/* Source links */}
      {caseId && <LinkRow label="Case" href={`/cases/${encodeURIComponent(caseId)}`} />}
      {sourceLeadId && <LinkRow label="Source Lead" href={`/leads/workspace/${encodeURIComponent(sourceLeadId)}`} />}

      {/* Tags */}
      {!!customer.tags?.length && (
        <div className="flex flex-wrap gap-1 pt-2">
          {customer.tags.map((tag: string) => (
            <span key={tag} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
