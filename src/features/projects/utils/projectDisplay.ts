import type { ProjectRecord, ProjectStage } from '../types';
import type { ProjectSiteAddress } from '../../../types';

const STAGE_LABELS: Record<ProjectStage, string> = {
  New: 'New',
  // Phase 0 (Channel Partner): the user-facing stage label stays exactly
  // "Registration" (Vendor Lock / Portal Registration) — never "Vendor Lock",
  // "Scheme Registration", etc. (naming contract). The internal value
  // `SchemeRegistration` never leaks to the UI.
  SchemeRegistration: 'Registration',
  Survey: 'Survey',
  Engineering: 'Engineering',
  Quotation: 'Quotation',
  Order: 'Order',
  Procurement: 'Procurement',
  Dispatch: 'Dispatch',
  Installation: 'Installation',
  QC: 'QC',
  Commissioning: 'Commissioning',
  NetMetering: 'Net Metering',
  Subsidy: 'Subsidy',
  Handover: 'Handover',
  AMC: 'AMC',
  Service: 'Service',
  Monitoring: 'Monitoring',
  Archived: 'Archived',
};

export const PROJECT_STAGE_OPTIONS = [
  { label: 'All Stages', value: '' },
  ...Object.entries(STAGE_LABELS).map(([value, label]) => ({ label, value })),
];

export function projectStageLabel(stage?: string | null) {
  if (!stage) return '—';
  return STAGE_LABELS[stage as ProjectStage] ?? stage;
}

export function projectCustomerLabel(customer?: Record<string, unknown> | null) {
  if (!customer) return '—';
  const name = String(customer.name || customer.fullName || customer.contactPerson || customer.company || customer.companyName || '').trim();
  if (name) return name;
  return String(customer.customerId || customer.id || '—');
}

export function resolveProjectCustomerName(
  project: Record<string, unknown> | null | undefined,
  customers: Array<Record<string, unknown>>,
) {
  if (!project) return '';
  const customerId = String(project.customerId || '').trim();
  const customer = customers.find((candidate) =>
    String(candidate.id || candidate.customerId || '').trim() === customerId
  );
  const canonicalName = projectCustomerLabel(customer);
  if (canonicalName !== '—') return canonicalName;
  return String(project.customerName || project.customer || '').trim();
}
export function projectSiteAddressSummary(address?: ProjectSiteAddress | null) {
  if (!address) return '—';
  const parts = [
    address.line1,
    address.line2,
    address.landmark,
    address.city,
    address.district,
    address.state,
    address.pincode,
    address.country,
  ].map((part) => String(part || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

export function projectCapacityLabel(capacityKw?: number | string | null) {
  const value = Number(capacityKw || 0);
  if (!value) return '0 kW';
  return `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} kW`;
}

export function projectFormToAddress(address: ProjectSiteAddress): ProjectSiteAddress {
  return {
    line1: String(address.line1 || '').trim(),
    line2: String(address.line2 || '').trim(),
    landmark: String(address.landmark || '').trim(),
    city: String(address.city || '').trim(),
    district: String(address.district || '').trim(),
    state: String(address.state || '').trim(),
    pincode: String(address.pincode || '').trim(),
    country: String(address.country || 'India').trim() || 'India',
  };
}

export function projectLinkedCount(project?: ProjectRecord | null) {
  if (!project) return 0;
  return [
    ...(project.linkedQuotationIds || []),
    ...(project.linkedOrderIds || []),
    ...(project.linkedDispatchIds || []),
  ].filter(Boolean).length;
}

export function projectStageHistoryLabel(stage: string) {
  return projectStageLabel(stage);
}

