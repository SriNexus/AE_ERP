/**
 * CustomerContextPanel — Left Panel's permanent Customer Information content
 * (Left Panel/Tabs/Documents/Footer UI standardization mission).
 *
 * B2B/C2C-aware identity, contact, and business context. Every field here is
 * read directly from the already-loaded `customer` object — no additional
 * query. Field names match the real create forms in `CustomersWorkspace.tsx`
 * (B2B_FORM0 / B2C_FORM0) and the Workspace's own edit fields
 * (CustomerWorkspaceEditor.tsx / CUSTOMER_DRAFT_FIELDS):
 *   B2B: company, companyName, gst, contactPerson, businessPhone, businessEmail, industryType
 *   B2C: fullName, mobile, email, roofType, sanctionLoad, monthlyBillAmount, propertyType, projectType
 *   Common: address, city, state, assignedToName, notes, tags, caseId, leadId,
 *     altName/altMobile (Alternate Name/Number — secondary contact, both types)
 *
 * Premium UX Redesign mission: replaces the old flat `label ........ value`
 * row ledger (one full-width bordered row per field, uppercase label column,
 * every field weighted identically) with grouped, scannable clusters —
 * Business/Identity, Contact, Location, Ownership, Source, Note — so the
 * panel reads in 2-3 seconds instead of as a form to proofread. Field
 * resolution (`resolveCustomerContextFields`) is unchanged; only the
 * rendering shape changed. Status is deliberately NOT repeated here — the
 * Header is this workspace's one authoritative place for customer status,
 * and re-showing it here would recreate the same duplicate-signal problem
 * the Header itself was just fixed for.
 *
 * Aadhaar number itself is deliberately not displayed here (PII) — only
 * whether an Aadhaar document is on file, which the Documents section already
 * conveys. This is a display choice, not an invented field.
 */
import { useNavigate } from 'react-router-dom';
import { Phone, Mail, MapPin, User, FileText, ArrowUpRight } from 'lucide-react';

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

/** Pure B2B/B2C-aware field resolution — unit-testable without rendering,
 * mirroring resolveCustomerHeaderFields (Phase 1). Field names verified
 * against B2B_FORM0/B2C_FORM0 in CustomersWorkspace.tsx. */
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

function Cluster({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Icon-led compact row — replaces the old label-column/value-column pair
 * with a single inline line; the icon carries the category, so most rows
 * need no visible label at all. */
function IconRow({ icon, value, hint }: { icon: React.ReactNode; value: React.ReactNode; hint?: string }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[var(--color-text-muted)]">{icon}</span>
      <span className="min-w-0 flex-1 text-[12.5px] font-medium text-[var(--color-text)] break-words leading-5">
        {value}
        {hint && <span className="ml-1.5 text-[10px] font-normal text-[var(--color-text-muted)]">{hint}</span>}
      </span>
    </div>
  );
}

function LinkRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 text-left text-[12.5px] font-medium text-[var(--color-primary)] hover:underline"
    >
      <span className="shrink-0 text-[var(--color-text-muted)]">{icon}</span>
      <span className="flex-1">{label}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0" />
    </button>
  );
}

export default function CustomerContextPanel({ customer }: Props) {
  const navigate = useNavigate();
  const { isB2B, phone, email, caseId, sourceLeadId, assignedToName, addressLine } = resolveCustomerContextFields(customer);

  return (
    <div className="divide-y divide-[var(--color-border-subtle)] [&>*+*]:mt-4 [&>*+*]:pt-4">
      <Cluster label={isB2B ? 'Business' : 'Identity'}>
        {isB2B ? (
          <>
            <p className="text-[13px] font-bold text-[var(--color-text)] leading-tight">{customer.companyName || customer.company || '—'}</p>
            {(customer.contactPerson || customer.name) && (
              <p className="text-[11px] text-[var(--color-text-muted)]">{customer.contactPerson || customer.name}</p>
            )}
            {(customer.gst || customer.gstin) && <IconRow icon={<FileText className="h-3 w-3" />} value={customer.gst || customer.gstin} hint="GST" />}
            {customer.industryType && <IconRow icon={<FileText className="h-3 w-3" />} value={customer.industryType} hint="Industry" />}
          </>
        ) : (
          <>
            <p className="text-[13px] font-bold text-[var(--color-text)] leading-tight">{customer.fullName || customer.name || '—'}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
              {customer.propertyType && <span>{customer.propertyType}</span>}
              {customer.projectType && <span>{customer.projectType}</span>}
              {customer.sanctionLoad && <span>{customer.sanctionLoad} sanctioned</span>}
              {customer.roofType && <span>{customer.roofType} roof</span>}
            </div>
            {customer.monthlyBillAmount && <IconRow icon={<FileText className="h-3 w-3" />} value={`₹${customer.monthlyBillAmount}`} hint="Avg. monthly bill" />}
          </>
        )}
      </Cluster>

      <Cluster label="Contact">
        <IconRow icon={<Phone className="h-3 w-3" />} value={phone !== '—' ? phone : undefined} />
        <IconRow icon={<Mail className="h-3 w-3" />} value={email !== '—' ? email : undefined} />
        {/* Alternate contact — secondary info, one combined row (name and/or
            number, whichever is on file), never its own cluster, so it
            never creates empty visual space when neither is set. */}
        {(customer.altName || customer.altMobile) && (
          <IconRow
            icon={<Phone className="h-3 w-3" />}
            value={[customer.altName, customer.altMobile].filter(Boolean).join(' · ')}
            hint="Alt"
          />
        )}
      </Cluster>

      {addressLine && (
        <Cluster label={isB2B ? 'Location' : 'Site Address'}>
          <IconRow icon={<MapPin className="h-3 w-3" />} value={addressLine} />
        </Cluster>
      )}

      <Cluster label="Ownership">
        <IconRow icon={<User className="h-3 w-3" />} value={assignedToName} />
      </Cluster>

      {(caseId || sourceLeadId) && (
        <Cluster label="Source">
          {caseId && <LinkRow icon={<FileText className="h-3 w-3" />} label={`Case ${caseId}`} onClick={() => navigate(`/cases/${encodeURIComponent(caseId)}`)} />}
          {sourceLeadId && <LinkRow icon={<FileText className="h-3 w-3" />} label="View source lead" onClick={() => navigate(`/leads/workspace/${encodeURIComponent(sourceLeadId)}`)} />}
        </Cluster>
      )}

      {customer.notes && (
        <Cluster label="Note">
          <p className="text-[12px] text-[var(--color-text-secondary)] leading-5 whitespace-pre-wrap">{customer.notes}</p>
        </Cluster>
      )}

      {!!customer.tags?.length && (
        <div className="flex flex-wrap gap-1 pt-1">
          {customer.tags.map((tag: string) => (
            <span key={tag} className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
