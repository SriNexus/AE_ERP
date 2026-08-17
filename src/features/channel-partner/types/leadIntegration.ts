/**
 * partnerLeadIntegration — Partner-Lead extension types
 *
 * These types extend the existing Lead entity with partner-specific fields.
 * They live in the channel-partner feature domain because they are
 * partner-specific, not lead-generic.
 *
 * The existing Lead module remains the single source of truth.
 * No parallel lead system is created — these are supplemental fields
 * that existing Leads can optionally carry.
 */

// ── Commission Status (state management only — no calculation) ──
export type CommissionStatus =
  | 'not_eligible'
  | 'eligible'
  | 'awaiting_installation'
  | 'ready'
  | 'generated'
  | 'approved'
  | 'paid'
  | 'voided';

export const COMMISSION_STATUSES: CommissionStatus[] = [
  'not_eligible',
  'eligible',
  'awaiting_installation',
  'ready',
  'generated',
  'approved',
  'paid',
  'voided',
];

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  not_eligible: 'Not Eligible',
  eligible: 'Eligible',
  awaiting_installation: 'Awaiting Installation',
  ready: 'Ready',
  generated: 'Generated',
  approved: 'Approved',
  paid: 'Paid',
  voided: 'Voided',
};

// ── Installation Status ─────────────────────────────────────
export type InstallationStatus =
  | 'pending'
  | 'survey'
  | 'survey_completed'
  | 'approved'
  | 'material_ready'
  | 'installation_scheduled'
  | 'installation_complete'
  | 'inspection'
  | 'closed';

export const INSTALLATION_STATUSES: InstallationStatus[] = [
  'pending',
  'survey',
  'survey_completed',
  'approved',
  'material_ready',
  'installation_scheduled',
  'installation_complete',
  'inspection',
  'closed',
];

export const INSTALLATION_STATUS_LABELS: Record<InstallationStatus, string> = {
  pending: 'Pending',
  survey: 'Survey',
  survey_completed: 'Survey Completed',
  approved: 'Approved',
  material_ready: 'Material Ready',
  installation_scheduled: 'Installation Scheduled',
  installation_complete: 'Installation Complete',
  inspection: 'Inspection',
  closed: 'Closed',
};

// ── Documentation Status ────────────────────────────────────
export type DocumentationStatus =
  | 'not_required'
  | 'pending'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'resubmitted';

export const DOCUMENTATION_STATUSES: DocumentationStatus[] = [
  'not_required',
  'pending',
  'submitted',
  'verified',
  'rejected',
  'resubmitted',
];

export const DOCUMENTATION_STATUS_LABELS: Record<DocumentationStatus, string> = {
  not_required: 'Not Required',
  pending: 'Pending',
  submitted: 'Submitted',
  verified: 'Verified',
  rejected: 'Rejected',
  resubmitted: 'Resubmitted',
};

// ── Payout Status ────────────────────────────────────────────
export type PayoutStatus =
  | 'pending'
  | 'approved'
  | 'paid'
  | 'rejected';

export const PAYOUT_STATUSES: PayoutStatus[] = [
  'pending',
  'approved',
  'paid',
  'rejected',
];

// ── Partner Lead Extension Fields ────────────────────────────
// These are the fields added to a Lead document when a partner is involved.
// They are optional — most leads will not have them.
export interface PartnerLeadFields {
  /** The Channel Partner's document ID */
  partnerId?: string;
  /** The partner's firm name (denormalized for display) */
  partnerName?: string;
  /** Which commission rule applies to this lead */
  partnerCommissionRuleId?: string;
  /** User-facing commission status */
  commissionStatus?: CommissionStatus;
  /** Installation progress tracking */
  installationStatus?: InstallationStatus;
  /** Document collection tracking */
  documentationStatus?: DocumentationStatus;
  /** Payout tracking */
  payoutStatus?: PayoutStatus;
  /** When commission was generated (placeholder — no calculation yet) */
  commissionGeneratedAt?: string;
  /** Amount of commission (placeholder — no calculation yet) */
  commissionAmount?: number;
  /** When installation was completed */
  installationCompletedAt?: string;
  /** Notes from partner about this lead */
  partnerNotes?: string;
  /** List of required document types */
  requiredDocuments?: string[];
  /** List of uploaded document names */
  uploadedDocuments?: string[];
  /** Document verification results */
  documentVerifications?: DocumentVerification[];
}

export interface DocumentVerification {
  documentName: string;
  status: 'pending' | 'verified' | 'rejected';
  verifiedBy?: string;
  verifiedAt?: string;
  rejectionReason?: string;
}

// ── Status style maps (for UI badges) ───────────────────────
export const COMMISSION_STATUS_STYLES: Record<string, string> = {
  not_eligible: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
  eligible: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  awaiting_installation: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  ready: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  generated: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
  approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  paid: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  voided: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

export const INSTALLATION_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  survey: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  survey_completed: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
  approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  material_ready: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  installation_scheduled: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  installation_complete: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  inspection: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  closed: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
};

export const DOCUMENTATION_STATUS_STYLES: Record<string, string> = {
  not_required: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  submitted: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  verified: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  resubmitted: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
};
