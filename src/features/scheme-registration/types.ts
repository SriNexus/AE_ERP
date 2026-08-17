/**
 * scheme-registration/types — Vendor Lock / Scheme Registration (Channel
 * Partner) data contract.
 *
 * Collection separation (HARD INVARIANT):
 *   - Vendor Lock / Scheme Registration  →  COLLECTIONS.SCHEME_REGISTRATIONS
 *     = 'scheme_registrations'  (SREG- ids)
 *   - Loan Applications (bank financing) →  COLLECTIONS.LOAN_APPLICATIONS
 *     = 'registrations'  (RG- ids)
 * The two subsystems share nothing and must never be merged, renamed or
 * aliased. No loan fields (bankName, loanAmount, digitalSignStatus, …) are
 * copied here.
 *
 * Lifecycle position (Phase 0): SchemeRegistration sits between New and
 * Survey in PROJECT_STAGE_ORDER; its user-facing label is exactly
 * 'Registration' (never "Vendor Lock" / "Vendor Registration" / "Portal
 * Registration").
 *
 * Ownership (Phase 3/5 canonical chain): a registration belongs to the
 * Project and therefore to the Project's canonical partner ownership
 * (Partner → Lead.partnerId → Customer.partnerId → Project.partnerId).
 * partnerId/partnerName/userId/managerId are derived from the Project's
 * chain inside the workflow service — never accepted from a URL, form or
 * client payload.
 *
 * Status machine (authoritative — Vendor Lock spec §13, 8 statuses):
 *   Draft → Submitted → UnderVerification → VendorLocked → Completed
 *   Rejected → Submitted (resubmit); Failed → Draft/Submitted (retry);
 *   any pre-Completed → Cancelled; Admin-only audited reopen of
 *   Completed/VendorLocked → Submitted (adds a 'Reopened' history entry).
 *   Lock is also legal directly from Submitted (spec §13). There is
 *   intentionally NO 'Resubmitted'/'Retry' status — those are transitions.
 *
 * Survey gate (§17): a Survey may be scheduled only once the related
 * Registration is status ∈ {VendorLocked, Completed} AND the vendor-lock
 * data contract is complete (vendor selected + lock date recorded). A
 * project with NO registration record is unaffected (gate is vacuous).
 */

export type SchemeRegistrationStatus =
  | 'Draft'             // created, not yet submitted
  | 'Submitted'         // partner submitted for verification
  | 'UnderVerification' // staff verification in progress
  | 'VendorLocked'      // vendor selection locked (approval outcome)
  | 'Completed'         // registration finalized (survey gate opens)
  | 'Rejected'          // staff rejected with a reason
  | 'Cancelled'         // withdrawn (terminal)
  | 'Failed';           // verification failed (e.g. document mismatch)

/** statusHistory entries may carry the Admin-override marker 'Reopened'
 * (the record's own status returns to 'Submitted' — §13 reopen). */
export type SchemeRegistrationHistoryStatus = SchemeRegistrationStatus | 'Reopened';

export interface SchemeRegistrationRequiredDocument {
  category: string;
  label: string;
  required: boolean;
  /** Linked shared-document record id (caseDocuments.ts) once uploaded. */
  documentId?: string;
  uploadedByName?: string;
  uploadedAt?: string;
}

export interface SchemeRegistrationDocumentRef {
  documentId: string;
  category: string;
  uploadedByName?: string;
  uploadedAt?: string;
}

/** Portal discriminator (future-proof seam — §10/§11). The locked default is
 * the controlled MANUAL workflow: an authorized operator records the portal
 * result in Neozy; there is NO external portal API integration. */
export type SchemeRegistrationPortalType = 'pmsuryaghar' | 'discom' | 'vendor' | 'state' | 'other';

export interface SchemeRegistrationStatusHistoryEntry {
  status: SchemeRegistrationHistoryStatus;
  changedAt: string;
  changedBy: string; // authenticated user id — never a partner doc id/name
  changedByName?: string;
  note?: string;
}

export interface SchemeRegistrationRecord {
  id: string; // SREG-...
  registrationId: string; // SREG-... (mirror of id, matching ERP conventions)
  projectId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  leadId?: string;
  caseId?: string;
  companyId: string;
  // ── Canonical ownership — derived from the Project chain (§9.3) ──
  partnerId?: string;    // channel_partners doc id
  partnerName?: string;
  managerId?: string;    // partner's TL/Manager user id (team visibility)
  userId?: string;       // partner's linked users doc id (notification recipient)
  // ── Vendor Lock / Portal data (manual recording — §10/§11) ──
  vendorId?: string;     // locked vendor (vendor_lock is irreversible)
  vendorName?: string;
  schemeName?: string;
  portalType?: SchemeRegistrationPortalType;
  discom?: string;
  applicationNumber?: string; // external portal application number (manual)
  portalReference?: string;   // external portal reference ID / URL (manual)
  registrationDate?: string;  // date the portal registration was filed
  applicantName?: string;
  applicantPhone?: string;
  applicantEmail?: string;
  notes?: string;
  responsibleUserId?: string;  // who performed the portal operation
  responsibleUserName?: string;
  requiredDocuments?: SchemeRegistrationRequiredDocument[];
  documents?: SchemeRegistrationDocumentRef[];
  // ── Status machine state ──
  status: SchemeRegistrationStatus;
  statusHistory: SchemeRegistrationStatusHistoryEntry[];
  submittedAt?: string;
  submittedBy?: string;
  verificationStartedAt?: string;
  verificationStartedBy?: string;
  vendorLockDate?: string;  // business date the vendor lock was confirmed
  vendorLockedAt?: string;
  vendorLockedBy?: string;
  completedAt?: string;
  completedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  failedAt?: string;
  failureReason?: string;
  retriedAt?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  createdAt: string;
  createdBy: string;
  createdByName?: string;
  updatedAt: string;
  updatedBy: string;
  isDeleted?: boolean;
}

export interface SchemeRegistrationCreateInput {
  projectId: string;
  vendorId?: string;
  vendorName?: string;
  schemeName?: string;
  portalType?: SchemeRegistrationPortalType;
  discom?: string;
  applicationNumber?: string;
  portalReference?: string;
  registrationDate?: string;
  applicantName?: string;
  applicantPhone?: string;
  applicantEmail?: string;
  notes?: string;
}

export interface SchemeRegistrationTransitionOptions {
  note?: string;
  rejectionReason?: string;
  failureReason?: string;
  vendorId?: string;
  vendorName?: string;
  vendorLockDate?: string;
  /** Manual portal submission data (recorded, never a fake API call). */
  applicationNumber?: string;
  portalReference?: string;
}

/**
 * Canonical transition map — the ONLY legal transitions. Statuses not listed
 * here are terminal (Completed / Cancelled). Rejection must happen during
 * Submitted/UnderVerification; Vendor Lock is irreversible (VendorLocked →
 * Completed only — a rejection can never unlock a locked vendor). Admin
 * reopen of Completed/VendorLocked → Submitted is handled by the dedicated
 * reopenSchemeRegistration() workflow function (audited), not this map.
 */
export const SCHEME_REGISTRATION_TRANSITIONS: Record<SchemeRegistrationStatus, SchemeRegistrationStatus[]> = {
  Draft: ['Submitted', 'Cancelled', 'Failed'],
  Submitted: ['UnderVerification', 'VendorLocked', 'Rejected', 'Cancelled', 'Failed'],
  UnderVerification: ['VendorLocked', 'Rejected'],
  VendorLocked: ['Completed'],
  Completed: [],
  Rejected: ['Submitted', 'Cancelled'],
  Cancelled: [],
  Failed: ['Draft', 'Submitted', 'Cancelled'],
};

/** Partner-side transition pairs (spec §13): submit (Draft → Submitted),
 * withdraw BEFORE submission (Draft → Cancelled), resubmit after rejection
 * (Rejected → Submitted), retry after failure (Failed → Draft/Submitted). A
 * partner can NEVER cancel once submitted, and never performs staff targets. */
export const PARTNER_SIDE_TRANSITION_PAIRS: ReadonlyArray<readonly [SchemeRegistrationStatus, SchemeRegistrationStatus]> = [
  ['Draft', 'Submitted'],    // submit for verification
  ['Draft', 'Cancelled'],    // withdraw (only before submission)
  ['Rejected', 'Submitted'], // resubmit after rejection
  ['Failed', 'Draft'],       // retry (fresh draft)
  ['Failed', 'Submitted'],   // retry (straight resubmit)
];

/** Partner-side transition TARGET statuses (used by UI action filtering). */
export const PARTNER_SIDE_TRANSITIONS: ReadonlySet<SchemeRegistrationStatus> = new Set([
  'Submitted', 'Cancelled', 'Draft',
]);

/** Staff-only transition targets (require the 'approve' action). */
export const STAFF_APPROVE_TRANSITIONS: ReadonlySet<SchemeRegistrationStatus> = new Set([
  'UnderVerification', 'VendorLocked', 'Completed', 'Rejected', 'Failed',
]);

export function isValidSchemeRegistrationTransition(
  from: SchemeRegistrationStatus,
  to: SchemeRegistrationStatus,
): boolean {
  return SCHEME_REGISTRATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isPartnerSideTransition(
  from: SchemeRegistrationStatus,
  to: SchemeRegistrationStatus,
): boolean {
  return PARTNER_SIDE_TRANSITION_PAIRS.some(([a, b]) => a === from && b === to);
}

/** Locked required-document categories (spec §15 — the MECHANISM is locked;
 * the exact scheme-specific checklist is a BUSINESS DECISION REQUIRED item,
 * preserved here as the optional 'scheme_forms' entry). */
export const SCHEME_REGISTRATION_REQUIRED_DOCUMENTS: ReadonlyArray<{ category: string; label: string; required: boolean }> = [
  { category: 'customer_identity', label: 'Customer identity / address proof', required: true },
  { category: 'premises_proof', label: 'Premises ownership / occupancy proof', required: true },
  { category: 'site_photos', label: 'Site photos', required: true },
  { category: 'scheme_forms', label: 'Scheme-specific forms', required: false },
];

/** A Completed transition (and the submit precondition) require every
 * `required: true` checklist entry to carry a linked documentId. */
export function allRequiredDocumentsLinked(
  requiredDocuments?: SchemeRegistrationRequiredDocument[] | null,
): boolean {
  return (requiredDocuments ?? []).every((d) => !d.required || Boolean(d.documentId));
}

/** Vendor-lock data contract (§17): vendor selected + lock date recorded. */
export function isVendorLockDataComplete(
  record?: Pick<SchemeRegistrationRecord, 'vendorId' | 'vendorName' | 'vendorLockDate' | 'vendorLockedAt'> | null,
): boolean {
  if (!record) return true;
  return Boolean(record.vendorId || record.vendorName)
    && Boolean(record.vendorLockDate || record.vendorLockedAt);
}

/** Survey gate (spec §17): a Survey may be scheduled only once the related
 * Registration is VendorLocked or Completed WITH the vendor-lock data
 * contract satisfied. A project with NO registration record is unaffected
 * (gate is vacuous — existing non-partner flows keep working). */
export function isSurveyGateSatisfied(
  status: SchemeRegistrationStatus | undefined | null,
  record?: Pick<SchemeRegistrationRecord, 'vendorId' | 'vendorName' | 'vendorLockDate' | 'vendorLockedAt'> | null,
): boolean {
  if (!status) return true;
  if (status === 'Completed') return true;
  if (status === 'VendorLocked') return isVendorLockDataComplete(record);
  return false;
}
