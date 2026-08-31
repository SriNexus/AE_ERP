/**
 * ProjectContextPanel — Left Panel's permanent Project Information content
 * (Project Workspace Phase 2 Completion & Structure Fix mission — full
 * information-hierarchy redesign, replacing the earlier structure-only
 * pass's flatter cluster set).
 *
 * Read-only display — editing happens via the Left Panel wrapper's Edit
 * button, which opens the existing Project edit flow (ProjectForm +
 * useSaveProject, the same modal Projects.tsx's own list page already
 * uses) rather than an inline draft model invented for this pass.
 *
 * Redundancy fix: Capacity is already shown in the Header (capacity chip)
 * and isn't repeated here. The complete Project address IS shown below
 * (Survey Final Production Fix mission — the Header intentionally stays
 * city-only, but the detailed Project Information panel needs the full
 * registered address, reusing projectSiteAddressSummary(), the same
 * formatter ProjectDetailModal's own Site Address card already uses).
 *
 * "Address" (this Project's own registered address) and "Surveyed
 * Location" (where a Survey's GPS was actually captured) are deliberately
 * separate clusters below — related concepts, never conflated or
 * overwriting one another.
 *
 * Project Type (Residential/Commercial/Industrial) is a real field on the
 * Project record itself (project.projectType) — passed in as a prop by the
 * page (sourced directly from project.projectType, not derived from the
 * linked Customer).
 *
 * Team section resolves each assigned person's phone number via the
 * already-fetched `users` list (COLLECTIONS.USERS — the same collection
 * CustomerWorkspaceEditor.tsx's own salesperson dropdown already queries),
 * matched by name since Project only stores plain name strings for
 * assignedSurveyor/assignedInstaller/salesOwner (no id field exists to join
 * on). When no match is found, the phone action is simply omitted — never
 * a fabricated number.
 */
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { projectSiteAddressSummary } from '../../utils/projectDisplay';
import { useUserNameResolver } from '../../../../hooks/useUserNameResolver';
import type { ProjectRecord } from '../../types';

interface Props {
  project: ProjectRecord;
  customerName?: string;
  projectType?: string;
  users: any[];
  customer?: Record<string, unknown> | null;
}

/** Row-wise label → value — matches the Lead/Customer workspace InfoRow. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '' || value === '—') return null;
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-2 gap-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <span className="text-[12px] font-medium text-[var(--color-text)] break-words leading-5">{value}</span>
    </div>
  );
}

/** Row with a clickable link value. */
function LinkRow({ label, displayText, href }: { label: string; displayText?: string; href: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-2 gap-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <a
        href={href}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline leading-5"
      >
        {displayText || label}
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}



function customerField(customer: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!customer) return '';
  for (const key of keys) {
    const val = String(customer[key] || '').trim();
    if (val) return val;
  }
  return '';
}

export default function ProjectContextPanel({ project, customerName, projectType, users, customer }: Props) {
  const navigate = useNavigate();
  const resolveUserName = useUserNameResolver();

  const custPhone = customerField(customer, ['phone', 'mobile', 'businessPhone']);
  const custEmail = customerField(customer, ['email', 'businessEmail']);
  const custAddress = customerField(customer, ['address']);
  const custCity = customerField(customer, ['city']);
  const custState = customerField(customer, ['state']);
  const custType = customerField(customer, ['type']);
  const custCompany = customerField(customer, ['company', 'companyName']);
  const custGst = customerField(customer, ['gst']);

  return (
    <div>
      {/* ── PROJECT INFORMATION ── */}
      <InfoRow label="Project ID" value={project.projectId || project.id} />
      <InfoRow label="Type" value={projectType} />
      <InfoRow label="Capacity" value={project.capacityKw ? `${project.capacityKw} kW` : undefined} />
      <InfoRow label="Address" value={projectSiteAddressSummary(project.siteAddress) !== '—' ? projectSiteAddressSummary(project.siteAddress) : undefined} />
      <InfoRow label="Sales Owner" value={resolveUserName(project.salesOwner)} />
      <InfoRow label="Surveyor" value={resolveUserName(project.assignedSurveyor)} />
      <InfoRow label="Installer" value={resolveUserName(project.assignedInstaller)} />
      {project.siteAddress?.latitude != null && project.siteAddress?.longitude != null && (
        <div className="grid grid-cols-[100px_1fr] items-start py-2 gap-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">GPS</span>
          <a
            href={`https://www.google.com/maps?q=${project.siteAddress.latitude},${project.siteAddress.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline leading-5"
          >
            {project.siteAddress.latitude.toFixed(5)}, {project.siteAddress.longitude.toFixed(5)}
            <ArrowUpRight className="h-3 w-3 shrink-0" />
          </a>
        </div>
      )}
      <InfoRow label="Notes" value={project.notes} />
      {project.leadId && (
        <div className="grid grid-cols-[100px_1fr] items-start py-2 gap-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">Source</span>
          <a
            href={`/leads/workspace/${encodeURIComponent(project.leadId as string)}`}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-primary)] hover:underline leading-5"
          >
            View source lead
            <ArrowUpRight className="h-3 w-3 shrink-0" />
          </a>
        </div>
      )}

      {/* ── CUSTOMER INFORMATION ── */}
      {customerName && (
        <>
          <h4 className="mt-5 mb-1 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1">Customer Information</h4>
          <LinkRow label="Customer" displayText={customerName} href={`/customers/${encodeURIComponent(project.customerId)}`} />
          {custType && <InfoRow label="Type" value={custType} />}
          {custCompany && <InfoRow label="Company" value={custCompany} />}
          {custPhone && <InfoRow label="Phone" value={custPhone} />}
          {custEmail && <InfoRow label="Email" value={custEmail} />}
          {(custAddress || custCity) && (
            <InfoRow label="Address" value={[custAddress, [custCity, custState].filter(Boolean).join(', ')].filter(Boolean).join(', ') || undefined} />
          )}
          {custGst && <InfoRow label="GST" value={custGst} />}
        </>
      )}
    </div>
  );
}
