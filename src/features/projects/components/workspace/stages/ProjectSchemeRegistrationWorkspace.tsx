/**
 * ProjectSchemeRegistrationWorkspace — the Registration stage's operational
 * workspace, embedded inside "Work on This Project" (the SchemeRegistration
 * stage between New and Survey; user-facing label exactly 'Registration' —
 * never "Vendor Lock" / "Portal Registration"). Built the same way
 * ProjectSubsidyWorkspace / ProjectNetMeteringWorkspace were: surfaces the
 * Vendor Lock / Scheme Registration system through its canonical workflow —
 * no parallel implementation, no second lifecycle.
 *
 * Data model: registrations live in the scheme_registrations collection
 * (features/scheme-registration/types.ts + services/schemeRegistrationWorkflow.ts)
 * with the authoritative 8-status machine (Draft → Submitted →
 * UnderVerification → VendorLocked → Completed; Rejected → Submitted;
 * Failed → Draft/Submitted; Cancelled; Admin-only audited reopen), portal
 * reference fields (applicationNumber/portalReference — manually recorded,
 * no external portal API), and the required-document checklist.
 *
 * Collection separation is a hard invariant: this is 'scheme_registrations'
 * (SREG-), NEVER the Loan Application 'registrations' (RG-) collection.
 *
 * Reuse discipline:
 *   - Creation → useCreateSchemeRegistration (Draft; §9.3 ownership guard;
 *     one active registration per project).
 *   - Status changes → useTransitionSchemeRegistration (canonical machine;
 *     statusHistory; actor/timestamps; §9.3 + permission enforcement).
 *   - Required documents → shared RegistrationRequiredDocuments (uploads land
 *     in the shared `documents` collection via caseDocuments.ts, case-scoped
 *     storage path, partnerId/stage stamped — no second document system).
 *   - Vendor Lock is irreversible — no unlock transition; a vendor selection
 *     + lock date is required before locking.
 *   - Survey gate lives in the Survey workflow service (scheduleSurvey) and
 *     is never duplicated in UI only.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BadgeCheck, Building2, Calendar, CheckCircle2, FileText, Lock, RotateCcw, XCircle,
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { FormSection, Input } from '../../../../../components/ui/Input';
import { getAll, fmtDateSafe } from '../../../../../lib/firestore';
import { COLLECTIONS } from '../../../../../lib/firebase';
import { queryKeys } from '../../../../../lib/queryKeys';
import { useAppStore } from '../../../../../store/useAppStore';
import { resolveCompatibleRole, usePermissions } from '../../../../../lib/permissions';
import {
  isPartnerSideTransition,
  SCHEME_REGISTRATION_TRANSITIONS,
  type SchemeRegistrationRecord,
  type SchemeRegistrationStatus,
  type SchemeRegistrationPortalType,
} from '../../../../scheme-registration/types';
import {
  useCreateSchemeRegistration,
  useReopenSchemeRegistration,
  useTransitionSchemeRegistration,
} from '../../../../scheme-registration/hooks/useSchemeRegistrations';
import {
  DISCOM_SUGGESTIONS,
  RegistrationRequiredDocuments,
  RegistrationTimeline,
  SCHEME_OPTIONS,
  SchemeRegistrationStatusBadge,
  schemeRegistrationStatusLabel,
  todayIsoDate,
} from '../../../../scheme-registration/components/registrationShared';
import type { ProjectStageWorkspaceProps } from './types';

const NEXT_ACTION_HINTS: Partial<Record<SchemeRegistrationStatus, string>> = {
  Draft: 'Submit the registration for verification (an application number or portal reference and the required documents are needed first).',
  Submitted: 'Awaiting staff verification.',
  UnderVerification: 'Awaiting the verification outcome — staff can lock the vendor or reject.',
  VendorLocked: 'Vendor is locked. The registration can be marked Completed once the portal filing is final.',
  Completed: 'Registration complete — a site Survey can now be scheduled for this project.',
  Rejected: 'The registration was rejected. Correct the issues and resubmit.',
  Failed: 'Verification failed. Retry or cancel the registration.',
  Cancelled: 'This registration was cancelled. A fresh registration can be filed for the project.',
};

function nextActionHint(status: SchemeRegistrationStatus): string | undefined {
  return NEXT_ACTION_HINTS[status];
}

/** Real Scheme Registration view — actual fields, status actions through the
 * canonical transition service, required documents, the registration's own
 * status timeline, and real rejection/failure banners. */
function SchemeRegistrationView({
  record,
  project,
}: {
  record: SchemeRegistrationRecord;
  project: any;
}) {
  const perms = usePermissions();
  const currentUser = useAppStore((s) => s.user);
  const transitionMutation = useTransitionSchemeRegistration();
  const reopenMutation = useReopenSchemeRegistration();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [lockOpen, setLockOpen] = useState(false);
  const [vendorName, setVendorName] = useState(record.vendorName || '');
  const [failOpen, setFailOpen] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [applicationNumber, setApplicationNumber] = useState(record.applicationNumber || '');
  const [portalReference, setPortalReference] = useState(record.portalReference || '');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState('');

  const nextStatuses = SCHEME_REGISTRATION_TRANSITIONS[record.status] || [];
  const canApprove = perms.canApprove('scheme_registration');
  const canEdit = perms.canEdit('scheme_registration');
  // Admin-tier (Admin / Group Admin / 'Management' alias — canonical alias
  // table, matching the reopenSchemeRegistration service gate). 'Manager'/'TL'
  // stay excluded from the audited reopen override.
  const isAdmin = currentUser?.isSuperAdmin === true || resolveCompatibleRole(currentUser?.role) === 'Admin';

  function handleTransition(next: SchemeRegistrationStatus) {
    if (transitionMutation.isPending) return;
    if (next === 'Rejected') {
      if (!rejectionReason.trim()) { toast.error('Rejection reason is required'); return; }
      transitionMutation.mutate({ id: record.id, status: next, options: { rejectionReason: rejectionReason.trim() } });
      setRejectOpen(false);
      setRejectionReason('');
      return;
    }
    if (next === 'VendorLocked') {
      if (lockOpen) {
        if (!vendorName.trim() && !record.vendorId) { toast.error('Select a vendor before locking'); return; }
        transitionMutation.mutate({
          id: record.id,
          status: next,
          options: { vendorName: vendorName.trim() || undefined },
        });
        setLockOpen(false);
      } else {
        setLockOpen(true);
      }
      return;
    }
    if (next === 'Failed') {
      if (failOpen) {
        transitionMutation.mutate({
          id: record.id,
          status: next,
          options: { failureReason: failureReason.trim() || undefined },
        });
        setFailOpen(false);
        setFailureReason('');
      } else {
        setFailOpen(true);
      }
      return;
    }
    if (next === 'Cancelled') {
      if (cancelOpen) {
        if (!cancelNote.trim()) { toast.error('Cancellation note is required'); return; }
        transitionMutation.mutate({ id: record.id, status: next, options: { note: cancelNote.trim() } });
        setCancelOpen(false);
        setCancelNote('');
      } else {
        setCancelOpen(true);
      }
      return;
    }
    if (next === 'Submitted') {
      if (submitOpen) {
        transitionMutation.mutate({
          id: record.id,
          status: next,
          options: {
            applicationNumber: applicationNumber.trim() || undefined,
            portalReference: portalReference.trim() || undefined,
          },
        });
        setSubmitOpen(false);
      } else {
        setSubmitOpen(true);
      }
      return;
    }
    transitionMutation.mutate({ id: record.id, status: next, options: {} });
  }

  const staffActions = nextStatuses.filter((s) => ['UnderVerification', 'VendorLocked', 'Completed', 'Rejected', 'Failed'].includes(s));
  // Partner actions are filtered by the canonical transition PAIRS (e.g. a
  // partner can never cancel a Rejected/Failed record — only resubmit/retry),
  // never by target-set membership alone.
  const partnerActions = nextStatuses.filter((s) => isPartnerSideTransition(record.status, s));
  const canReopen = isAdmin && canApprove && (record.status === 'Completed' || record.status === 'VendorLocked');

  function partnerActionLabel(next: SchemeRegistrationStatus): string {
    if (next === 'Submitted') return record.status === 'Rejected' ? 'Resubmit' : record.status === 'Failed' ? 'Retry & Submit' : 'Submit for Verification';
    if (next === 'Draft') return 'Retry (Fresh Draft)';
    return 'Cancel Registration';
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{record.id.slice(-8)}</span>
            <SchemeRegistrationStatusBadge status={record.status} />
            {record.status === 'VendorLocked' && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                <Lock className="h-2.5 w-2.5" />Vendor Locked
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{record.vendorName || record.vendorId || 'No vendor selected'}</span>
            {record.schemeName && <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{record.schemeName}</span>}
            <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />Created {fmtDateSafe(record.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Real registration fields */}
      <FormSection title="Registration Overview">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Partner</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{record.partnerName || record.partnerId || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Applicant</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{record.applicantName || record.customerName || '—'}</p>
            {(record.applicantPhone || record.applicantEmail || record.customerPhone) && (
              <p className="text-[10px] text-[var(--color-text-muted)]">
                {[record.applicantPhone || record.customerPhone, record.applicantEmail].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</p>
            <p className="mt-0.5"><SchemeRegistrationStatusBadge status={record.status} /></p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Application / Portal Ref</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {[record.applicationNumber, record.portalReference].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / DISCOM</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {[record.schemeName, record.discom].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Responsible Operator</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{record.responsibleUserName || record.responsibleUserId || '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Vendor Locked</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {record.vendorLockDate || record.vendorLockedAt ? fmtDateSafe(record.vendorLockDate || record.vendorLockedAt) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Completed</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">
              {record.completedAt ? fmtDateSafe(record.completedAt) : '—'}
            </p>
          </div>
        </div>
        {record.rejectionReason && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/10">
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Rejected {record.rejectedAt ? `· ${fmtDateSafe(record.rejectedAt)}` : ''}</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{record.rejectionReason}</p>
          </div>
        )}
        {record.failureReason && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/10">
            <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">Verification failed {record.failedAt ? `· ${fmtDateSafe(record.failedAt)}` : ''}</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{record.failureReason}</p>
          </div>
        )}
      </FormSection>

      {/* Operational status actions — canonical transition service */}
      {(staffActions.length > 0 || partnerActions.length > 0 || canReopen) && (
        <FormSection title="Status Actions">
          <div className="flex flex-wrap items-center gap-2">
            {staffActions.map((next) => {
              if (!canApprove) return null;
              if (next === 'Rejected') {
                return (
                  <div key={next} className="flex flex-wrap items-center gap-2">
                    {rejectOpen ? (
                      <>
                        <input
                          type="text"
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          placeholder="Rejection reason *"
                          className="h-8 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => handleTransition(next)} loading={transitionMutation.isPending}>
                          Confirm Reject
                        </Button>
                        <button type="button" onClick={() => setRejectOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => setRejectOpen(true)}>
                        Reject Registration
                      </Button>
                    )}
                  </div>
                );
              }
              if (next === 'VendorLocked') {
                return (
                  <div key={next} className="flex flex-wrap items-center gap-2">
                    {lockOpen ? (
                      <>
                        <input
                          type="text"
                          value={vendorName}
                          onChange={(e) => setVendorName(e.target.value)}
                          placeholder="Vendor name (locked) *"
                          className="h-8 w-52 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <Button size="sm" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>
                          Confirm Vendor Lock
                        </Button>
                        <button type="button" onClick={() => setLockOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                      </>
                    ) : (
                      <Button size="sm" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>
                        Verify &amp; Lock Vendor
                      </Button>
                    )}
                  </div>
                );
              }
              if (next === 'Failed') {
                return (
                  <div key={next} className="flex flex-wrap items-center gap-2">
                    {failOpen ? (
                      <>
                        <input
                          type="text"
                          value={failureReason}
                          onChange={(e) => setFailureReason(e.target.value)}
                          placeholder="Failure reason"
                          className="h-8 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => handleTransition(next)} loading={transitionMutation.isPending}>
                          Confirm Failure
                        </Button>
                        <button type="button" onClick={() => setFailOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setFailOpen(true)}>Mark Failed</Button>
                    )}
                  </div>
                );
              }
              return (
                <Button
                  key={next}
                  size="sm"
                  loading={transitionMutation.isPending}
                  onClick={() => handleTransition(next)}
                >
                  {next === 'UnderVerification' ? 'Start Verification' : next === 'Completed' ? 'Mark Completed' : `Mark ${schemeRegistrationStatusLabel(next)}`}
                </Button>
              );
            })}
            {partnerActions.map((next) => {
              if (!canEdit) return null;
              if (next === 'Submitted') {
                return (
                  <div key={next} className="flex flex-wrap items-center gap-2">
                    {submitOpen ? (
                      <>
                        <input
                          type="text"
                          value={applicationNumber}
                          onChange={(e) => setApplicationNumber(e.target.value)}
                          placeholder="Application number"
                          className="h-8 w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <input
                          type="text"
                          value={portalReference}
                          onChange={(e) => setPortalReference(e.target.value)}
                          placeholder="Portal reference"
                          className="h-8 w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <Button size="sm" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>
                          Confirm Submit
                        </Button>
                        <button type="button" onClick={() => setSubmitOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                      </>
                    ) : (
                      <Button size="sm" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>
                        {partnerActionLabel(next)}
                      </Button>
                    )}
                  </div>
                );
              }
              if (next === 'Cancelled') {
                return (
                  <div key={next} className="flex flex-wrap items-center gap-2">
                    {cancelOpen ? (
                      <>
                        <input
                          type="text"
                          value={cancelNote}
                          onChange={(e) => setCancelNote(e.target.value)}
                          placeholder="Cancellation note *"
                          className="h-8 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" onClick={() => handleTransition(next)} loading={transitionMutation.isPending}>
                          Confirm Cancel
                        </Button>
                        <button type="button" onClick={() => setCancelOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>Cancel Registration</Button>
                    )}
                  </div>
                );
              }
              return (
                <Button
                  key={next}
                  size="sm"
                  variant="secondary"
                  loading={transitionMutation.isPending}
                  onClick={() => handleTransition(next)}
                >
                  {partnerActionLabel(next)}
                </Button>
              );
            })}
            {canReopen && (
              <div key="reopen" className="flex flex-wrap items-center gap-2">
                {reopenOpen ? (
                  <>
                    <input
                      type="text"
                      value={reopenNote}
                      onChange={(e) => setReopenNote(e.target.value)}
                      placeholder="Reopen reason (audit) *"
                      className="h-8 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                    />
                    <Button size="sm" variant="outline" className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-900/30" loading={reopenMutation.isPending}
                      onClick={() => {
                        if (!reopenNote.trim()) { toast.error('A reopen reason is required for the audit trail'); return; }
                        reopenMutation.mutate({ id: record.id, note: reopenNote.trim() });
                        setReopenOpen(false);
                        setReopenNote('');
                      }}>
                      Confirm Reopen
                    </Button>
                    <button type="button" onClick={() => setReopenOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setReopenOpen(true)}>
                    Reopen (Admin)
                  </Button>
                )}
              </div>
            )}
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            Status changes run through the canonical transition service. Vendor Lock is irreversible — once locked, the vendor selection cannot be changed. Only an Admin can reopen a completed registration (audited).
          </p>
        </FormSection>
      )}

      {/* Required documents — shared checklist + case-scoped upload */}
      <FormSection title="Required Documents">
        <RegistrationRequiredDocuments registration={record} project={project} />
      </FormSection>

      {/* Next action */}
      {nextActionHint(record.status) && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-text)]">Next: </span>{nextActionHint(record.status)}
        </div>
      )}

      {/* Survey gate hint — the actual gate is enforced in the Survey workflow service */}
      {(record.status === 'VendorLocked' || record.status === 'Completed') && (
        <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/10 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Registration {record.status.toLowerCase()}. A site Survey can now be scheduled for this project.</span>
        </div>
      )}
      {record.status === 'Rejected' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>This registration was rejected. The owning partner can correct and resubmit it.</span>
        </div>
      )}

      {/* The registration's own status timeline — genuine domain history */}
      <FormSection title="Status Timeline">
        <RegistrationTimeline history={record.statusHistory} />
      </FormSection>

      {record.notes && (
        <FormSection title="Registration Notes">
          <p className="text-xs text-[var(--color-text)]">{record.notes}</p>
        </FormSection>
      )}
    </div>
  );
}

/** Create the Scheme Registration draft — pre-scoped to this project. Calls
 * the canonical useCreateSchemeRegistration hook exactly like the portal's
 * create surface will. Ownership (partnerId/partnerName) is derived inside
 * the service from the Project chain — never from this form. Applicant +
 * vendor + customer fields are PRE-FILLED from the existing Lead → Customer →
 * Project → Company chain (the service re-derives them authoritatively too);
 * the operator only fills genuinely new portal data. */
function SchemeRegistrationForm({ project, customer }: { project: any; customer?: any }) {
  const perms = usePermissions();
  const createMutation = useCreateSchemeRegistration();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);

  // Vendor = the company that files the registration on the portal (the EPC
  // firm registers ITSELF). Derived from the project's own company — never a
  // manual company/vendor pick. Read from the already-loaded companies cache
  // (companies_global, populated at boot) so no extra round-trip; the service
  // re-derives it authoritatively on write regardless.
  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ['companies_global'],
    queryFn: () => getAll(COLLECTIONS.COMPANIES, []),
    staleTime: 1000 * 60 * 30,
  });
  const derivedVendorName = useMemo(() => {
    const cid = String(project?.companyId || activeCompanyId || '');
    const co = (companies as any[]).find((c) => c?.id === cid) || (companies as any[])[0];
    return String(co?.name ?? co?.companyName ?? co?.legalName ?? '').trim();
  }, [companies, project?.companyId, activeCompanyId]);

  // Everything the ERP already knows — pre-filled, still editable.
  const knownApplicantName = String(
    customer?.name ?? customer?.fullName ?? customer?.contactPerson ?? (project as any)?.customerName ?? '',
  ).trim();
  const knownApplicantPhone = String(
    customer?.phone ?? customer?.mobile ?? customer?.businessPhone ?? (project as any)?.customerPhone ?? '',
  ).trim();
  const knownApplicantEmail = String(customer?.email ?? customer?.businessEmail ?? '').trim();
  const knownDiscom = String(
    customer?.discom ?? customer?.discomName ?? project?.siteAddress?.discom ?? '',
  ).trim();

  // All "known from the ERP" fields use the controlled-with-fallback pattern
  // (empty local state = "use the known value") — the customer/company records
  // load async, so a plain useState(known) initializer would lock in '' on the
  // first render before they arrive. The displayed value is `state || known`;
  // an explicit edit sets state and wins from then on.
  const [vendorName, setVendorName] = useState('');
  const [scheme, setScheme] = useState('');
  const [customScheme, setCustomScheme] = useState('');
  const [portalType, setPortalType] = useState<SchemeRegistrationPortalType | ''>('');
  const [discom, setDiscom] = useState('');
  const [registrationDate, setRegistrationDate] = useState(todayIsoDate());
  const [applicantName, setApplicantName] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [notes, setNotes] = useState('');

  const effectiveVendor = (vendorName.trim() || derivedVendorName).trim();
  const effectiveDiscom = discom.trim() || knownDiscom;
  const effectiveApplicantName = applicantName.trim() || knownApplicantName;
  const effectiveApplicantPhone = applicantPhone.trim() || knownApplicantPhone;
  const effectiveApplicantEmail = applicantEmail.trim() || knownApplicantEmail;
  const schemeName = scheme === '__other__' ? customScheme.trim() : scheme.trim();

  const canCreate = perms.canCreate('scheme_registration');

  function handleSubmit() {
    if (!canCreate || createMutation.isPending) return;
    if (effectiveApplicantPhone && !/^\d{10}$/.test(effectiveApplicantPhone)) {
      toast.error('A valid 10-digit mobile number is required');
      return;
    }
    createMutation.mutate({
      projectId: project.id,
      // Vendor is auto-derived (company) — sent only when the operator typed
      // an override; the service fills the company name otherwise.
      vendorName: vendorName.trim() || undefined,
      schemeName: schemeName || undefined,
      portalType: portalType || undefined,
      discom: effectiveDiscom || undefined,
      registrationDate: registrationDate || undefined,
      applicantName: effectiveApplicantName || undefined,
      applicantPhone: effectiveApplicantPhone || undefined,
      applicantEmail: effectiveApplicantEmail || undefined,
      notes: notes.trim() || undefined,
    });
  }

  if (!canCreate) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          No scheme registration has been created for this project yet. You do not have permission to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          <BadgeCheck className="h-3.5 w-3.5" /> No registration filed yet — {project.projectId || project.id}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          Applicant, vendor and customer details are pre-filled from this project's Lead → Customer → Company chain. This starts an internal record — the actual scheme registration happens on the government/DISCOM portal; the application number and portal reference are recorded once you submit for verification, after the portal has actually issued them.
        </p>
      </div>

      <FormSection title="Registration Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Vendor — auto-derived from the registering company. Editable on
              the right, matching the app's existing "value + inline edit"
              field pattern. Not required: the service fills the company name. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Vendor (registering company)</label>
            <div className="flex items-center gap-1.5">
              <input
                value={vendorName || derivedVendorName}
                onChange={(e) => setVendorName(e.target.value)}
                placeholder={derivedVendorName || 'Derived from your company'}
                className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
              {vendorName.trim() && vendorName.trim() !== derivedVendorName && (
                <button type="button" title="Reset to company" onClick={() => setVendorName('')} className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]">
                  Reset
                </button>
              )}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)]">Auto-derived from your authorized company{effectiveVendor ? ` — ${effectiveVendor}` : ''}.</p>
          </div>

          {/* Scheme — selectable pick-list (with a free-text "Other"). */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Scheme</label>
            <select
              value={scheme}
              onChange={(e) => setScheme(e.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            >
              <option value="">Select scheme…</option>
              {SCHEME_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value="__other__">Other (type below)</option>
            </select>
            {scheme === '__other__' && (
              <Input label="" value={customScheme} onChange={(e) => setCustomScheme(e.target.value)} placeholder="Scheme name" />
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Portal Type</label>
            <select
              value={portalType}
              onChange={(e) => setPortalType(e.target.value as SchemeRegistrationPortalType | '')}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            >
              <option value="">Not specified</option>
              <option value="pmsuryaghar">PM Surya Ghar</option>
              <option value="discom">DISCOM</option>
              <option value="vendor">Vendor</option>
              <option value="state">State scheme</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* DISCOM — free text with an autocomplete list of common utilities;
              pre-filled from the customer where the ERP already has it. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">DISCOM</label>
            <input
              list="scheme-reg-discom-list"
              value={discom || knownDiscom}
              onChange={(e) => setDiscom(e.target.value)}
              placeholder="Power distribution utility"
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <datalist id="scheme-reg-discom-list">
              {DISCOM_SUGGESTIONS.map((d) => <option key={d} value={d} />)}
            </datalist>
          </div>

          {/* Registration Date — native calendar (compact, current month,
              today one-click); defaults to today, with an explicit reset. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Registration Date</label>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={registrationDate}
                max={todayIsoDate()}
                onChange={(e) => setRegistrationDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              />
              <button type="button" onClick={() => setRegistrationDate(todayIsoDate())} className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-[10px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                Today
              </button>
            </div>
          </div>

          <Input label="Applicant Name" value={applicantName || knownApplicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder="Applicant / customer name" />
          <Input label="Applicant Phone" value={applicantPhone || knownApplicantPhone} onChange={(e) => setApplicantPhone(e.target.value)} placeholder="10-digit mobile number" />
          <Input label="Applicant Email" value={applicantEmail || knownApplicantEmail} onChange={(e) => setApplicantEmail(e.target.value)} placeholder="Email address" />
        </div>
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes about the registration" />
      </FormSection>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" loading={createMutation.isPending} onClick={handleSubmit}>
          Create Registration Draft
        </Button>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          Creates a Draft registration — submit it for verification from the record view.
        </span>
      </div>
    </div>
  );
}

/** The real Registration state for one project — create form when no record
 * exists yet, record view after; a cancelled registration re-opens the create
 * form (a fresh draft can be filed). One active registration per project. */
export default function ProjectSchemeRegistrationWorkspace({ project, customer }: ProjectStageWorkspaceProps) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: keys.schemeRegistrationsAll,
    queryFn: () => getAll(COLLECTIONS.SCHEME_REGISTRATIONS),
    staleTime: 15_000,
  });

  const projectRegistrations = useMemo(
    () => (registrations as SchemeRegistrationRecord[])
      .filter((r) => r.projectId === project.id && !r.isDeleted)
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)),
    [registrations, project.id],
  );

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  const latest = projectRegistrations[0];
  // The canonical machine models correction as transitions, not new records:
  // Rejected → Submitted and Failed → Draft/Submitted act on the EXISTING
  // record, so the create form is only offered when no record exists at all
  // or the latest one is Cancelled (the one terminal state with no forward
  // path). This keeps exactly one live registration per project — never a
  // second record that could shadow an older VendorLocked/Completed one in
  // the Survey gate.
  const showCreateForm = !latest || latest.status === 'Cancelled';

  return (
    <div className="space-y-3">
      {latest ? <SchemeRegistrationView record={latest} project={project} /> : null}
      {showCreateForm && (
        <div className={latest ? 'rounded-lg border border-[var(--color-border-subtle)] p-3' : ''}>
          <SchemeRegistrationForm project={project} customer={customer} />
        </div>
      )}
    </div>
  );
}
