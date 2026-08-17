/**
 * PartnerRegistrationDetailModal — partner-facing Registration detail. The
 * partner sees their OWN registration only (the page already filtered by the
 * canonical partnerId — never from the URL). Actions are restricted to the
 * partner-side transitions (submit / resubmit / retry / cancel-before-
 * submission) through useTransitionSchemeRegistration; the service enforces
 * the machine + §9.3 ownership. Staff actions are never offered here.
 */
import { useState } from 'react';
import { BadgeCheck, Building2, Calendar, FileText, Lock, XCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { fmtDateSafe } from '../../lib/firestore';
import { useAppStore } from '../../store/useAppStore';
import { usePermissions } from '../../lib/permissions';
import { useTransitionSchemeRegistration } from '../../features/scheme-registration/hooks/useSchemeRegistrations';
import { isPartnerSideTransition, SCHEME_REGISTRATION_TRANSITIONS } from '../../features/scheme-registration/types';
import type { SchemeRegistrationRecord, SchemeRegistrationStatus } from '../../features/scheme-registration/types';
import {
  RegistrationRequiredDocuments,
  RegistrationTimeline,
  SchemeRegistrationStatusBadge,
} from '../../features/scheme-registration/components/registrationShared';

export function PartnerRegistrationDetailModal({
  registration,
  project,
  open,
  onClose,
}: {
  registration: SchemeRegistrationRecord | null;
  project: any | null;
  open: boolean;
  onClose: () => void;
}) {
  const perms = usePermissions();
  const transitionMutation = useTransitionSchemeRegistration();
  const currentUser = useAppStore((s) => s.user);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [applicationNumber, setApplicationNumber] = useState(registration?.applicationNumber || '');
  const [portalReference, setPortalReference] = useState(registration?.portalReference || '');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelNote, setCancelNote] = useState('');

  if (!registration) return null;
  const record = registration;
  const canEdit = perms.canEdit('scheme_registration');
  const nextStatuses = SCHEME_REGISTRATION_TRANSITIONS[record.status] || [];
  // Partner actions are filtered by the canonical transition PAIRS — a
  // partner can never cancel a Rejected/Failed record, only resubmit/retry.
  const partnerActions = nextStatuses.filter((s) => isPartnerSideTransition(record.status, s));

  function partnerActionLabel(next: SchemeRegistrationStatus): string {
    if (next === 'Submitted') return record.status === 'Rejected' ? 'Resubmit' : record.status === 'Failed' ? 'Retry & Submit' : 'Submit for Verification';
    if (next === 'Draft') return 'Retry (Fresh Draft)';
    return 'Cancel Registration';
  }

  function handleTransition(next: SchemeRegistrationStatus) {
    if (transitionMutation.isPending) return;
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
    if (next === 'Cancelled') {
      if (cancelOpen) {
        if (!cancelNote.trim()) return;
        transitionMutation.mutate({ id: record.id, status: next, options: { note: cancelNote.trim() } });
        setCancelOpen(false);
        setCancelNote('');
      } else {
        setCancelOpen(true);
      }
      return;
    }
    transitionMutation.mutate({ id: record.id, status: next, options: {} });
  }

  return (
    <Modal open={open} onClose={onClose} size="2xl" title={`Registration ${record.registrationId}`}>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-xs font-medium text-[var(--color-text-muted)]">#{record.registrationId}</span>
            <SchemeRegistrationStatusBadge status={record.status} />
            {record.status === 'VendorLocked' && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                <Lock className="h-2.5 w-2.5" />Vendor Locked
              </span>
            )}
          </div>
          <span className="text-[11px] text-[var(--color-text-muted)]">Project {project?.name || project?.projectId || record.projectId}</span>
        </div>

        {/* Key portal fields */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { label: 'Vendor', value: record.vendorName || record.vendorId || '—' },
            { label: 'Scheme / DISCOM', value: [record.schemeName, record.discom].filter(Boolean).join(' · ') || '—' },
            { label: 'Application / Portal Ref', value: [record.applicationNumber, record.portalReference].filter(Boolean).join(' · ') || '—' },
            { label: 'Responsible Operator', value: record.responsibleUserName || record.responsibleUserId || '—' },
            { label: 'Vendor Locked', value: record.vendorLockDate || record.vendorLockedAt ? fmtDateSafe(record.vendorLockDate || record.vendorLockedAt) : '—' },
            { label: 'Created', value: fmtDateSafe(record.createdAt) },
          ].map((f) => (
            <div key={f.label} className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{f.label}</p>
              <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text)]">{f.value}</p>
            </div>
          ))}
        </div>

        {/* Rejection / failure banners */}
        {record.rejectionReason && (
          <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-300">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-semibold">Rejected {record.rejectedAt ? `· ${fmtDateSafe(record.rejectedAt)}` : ''}</p>
              <p>{record.rejectionReason}</p>
            </div>
          </div>
        )}
        {record.failureReason && (
          <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/10 dark:text-red-300">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-semibold">Verification failed {record.failedAt ? `· ${fmtDateSafe(record.failedAt)}` : ''}</p>
              <p>{record.failureReason}</p>
            </div>
          </div>
        )}

        {/* Partner-side status actions */}
        {partnerActions.length > 0 && canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {partnerActions.map((next) => {
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
                          className="h-8 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <input
                          type="text"
                          value={portalReference}
                          onChange={(e) => setPortalReference(e.target.value)}
                          placeholder="Portal reference"
                          className="h-8 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                        />
                        <Button size="sm" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>Confirm Submit</Button>
                        <button type="button" onClick={() => setSubmitOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                      </>
                    ) : (
                      <Button size="sm" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>{partnerActionLabel(next)}</Button>
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
                        <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/30" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>Confirm Cancel</Button>
                        <button type="button" onClick={() => setCancelOpen(false)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">Cancel</button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>Cancel Registration</Button>
                    )}
                  </div>
                );
              }
              return (
                <Button key={next} size="sm" variant="secondary" loading={transitionMutation.isPending} onClick={() => handleTransition(next)}>
                  {partnerActionLabel(next)}
                </Button>
              );
            })}
            <span className="text-[10px] text-[var(--color-text-muted)]">
              Actions run through the canonical workflow — {currentUser?.name || 'you'} are recorded as the actor.
            </span>
          </div>
        )}

        {/* Required documents — shared checklist + case-scoped upload */}
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            <FileText className="h-3.5 w-3.5" /> Required Documents
          </p>
          <RegistrationRequiredDocuments registration={record} project={project} />
        </div>

        {/* Timeline */}
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            <Calendar className="h-3.5 w-3.5" /> Status Timeline
          </p>
          <RegistrationTimeline history={record.statusHistory} />
        </div>

        {record.notes && (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</p>
            <p className="mt-0.5 flex items-start gap-1 text-xs text-[var(--color-text)]"><Building2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />{record.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
