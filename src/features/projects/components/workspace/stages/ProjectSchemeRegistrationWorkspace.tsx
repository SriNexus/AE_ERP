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
import { usePermissions } from '../../../../../lib/permissions';
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
  RegistrationRequiredDocuments,
  RegistrationTimeline,
  SchemeRegistrationStatusBadge,
  schemeRegistrationStatusLabel,
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
  const isAdmin = currentUser?.role === 'Admin';

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
 * the service from the Project chain — never from this form. */
function SchemeRegistrationForm({ project }: { project: any }) {
  const perms = usePermissions();
  const createMutation = useCreateSchemeRegistration();

  const [vendorName, setVendorName] = useState('');
  const [schemeName, setSchemeName] = useState('');
  const [portalType, setPortalType] = useState<SchemeRegistrationPortalType | ''>('');
  const [discom, setDiscom] = useState('');
  const [applicationNumber, setApplicationNumber] = useState('');
  const [portalReference, setPortalReference] = useState('');
  const [registrationDate, setRegistrationDate] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [notes, setNotes] = useState('');

  const canCreate = perms.canCreate('scheme_registration');

  function handleSubmit() {
    if (!canCreate || createMutation.isPending) return;
    if (!vendorName.trim()) { toast.error('Please enter the vendor name'); return; }
    if (applicantPhone && !/^\d{10}$/.test(applicantPhone.trim())) {
      toast.error('A valid 10-digit mobile number is required');
      return;
    }
    createMutation.mutate({
      projectId: project.id,
      vendorName: vendorName.trim(),
      schemeName: schemeName.trim() || undefined,
      portalType: portalType || undefined,
      discom: discom.trim() || undefined,
      applicationNumber: applicationNumber.trim() || undefined,
      portalReference: portalReference.trim() || undefined,
      registrationDate: registrationDate || undefined,
      applicantName: applicantName.trim() || undefined,
      applicantPhone: applicantPhone.trim() || undefined,
      applicantEmail: applicantEmail.trim() || undefined,
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
          File the scheme Registration for this project. Ownership flows from the project's partner chain; submitting it advances the project to the Registration stage and a Survey becomes schedulable once the registration is completed. Portal details are recorded manually (application number / portal reference).
        </p>
      </div>

      <FormSection title="Registration Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Vendor Name *" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor to be locked" />
          <Input label="Scheme Name" value={schemeName} onChange={(e) => setSchemeName(e.target.value)} placeholder="Government / financing scheme" />
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
          <Input label="DISCOM" value={discom} onChange={(e) => setDiscom(e.target.value)} placeholder="DISCOM name" />
          <Input label="Application Number" value={applicationNumber} onChange={(e) => setApplicationNumber(e.target.value)} placeholder="External portal application number" />
          <Input label="Portal Reference" value={portalReference} onChange={(e) => setPortalReference(e.target.value)} placeholder="Portal reference ID / URL" />
          <Input label="Registration Date" type="date" value={registrationDate} onChange={(e) => setRegistrationDate(e.target.value)} />
          <Input label="Applicant Name" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder="Applicant / customer name" />
          <Input label="Applicant Phone" value={applicantPhone} onChange={(e) => setApplicantPhone(e.target.value)} placeholder="10-digit mobile number" />
          <Input label="Applicant Email" value={applicantEmail} onChange={(e) => setApplicantEmail(e.target.value)} placeholder="Email address" />
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
export default function ProjectSchemeRegistrationWorkspace({ project }: ProjectStageWorkspaceProps) {
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
          <SchemeRegistrationForm project={project} />
        </div>
      )}
    </div>
  );
}
