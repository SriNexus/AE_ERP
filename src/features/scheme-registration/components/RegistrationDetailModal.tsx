/**
 * RegistrationDetailModal — role-aware Registration (Vendor Lock / Scheme
 * Registration) detail surface for the standalone Registration list
 * (VL-9/VL-10).
 *
 * Shows the full record context (application/portal reference, scheme, DISCOM,
 * vendor-lock info, customer/project/partner, responsible operator), the
 * canonical status timeline, the required-document checklist and ONLY the
 * status actions the authenticated role may legally perform:
 *
 *   - Partner (self record)   → partner-side transitions only (submit /
 *     withdraw-before-submit / resubmit / retry) — identical contract to the
 *     Partner Portal.
 *   - Manager / TL            → team records + approval/vendor-lock/reject/
 *     fail/complete (the 'approve' permission), plus staff cancel.
 *   - Director / Management   → READ-ONLY — no action buttons (the service
 *     boundary rejects any mutation attempt regardless).
 *   - Admin                   → full permitted controls + audited reopen of
 *     Completed/VendorLocked.
 *
 * No business logic lives here — every mutation runs through the canonical
 * useTransitionSchemeRegistration / useReopenSchemeRegistration hooks (which
 * call the schemeRegistrationWorkflow service). Ownership is NEVER taken from
 * the URL or the client payload; the data layer already scoped the record.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, CalendarClock, FileText, FolderKanban, Lock, User, Users, X } from 'lucide-react';

import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, fmtDateSafe } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { isPartnerPortalUser, usePermissions } from '../../../lib/permissions';
import { cn } from '../../../utils/cn';
import { Button } from '../../../components/ui/Button';
import {
  useReopenSchemeRegistration,
  useTransitionSchemeRegistration,
} from '../hooks/useSchemeRegistrations';
import {
  isPartnerSideTransition,
  SCHEME_REGISTRATION_TRANSITIONS,
  STAFF_APPROVE_TRANSITIONS,
  type SchemeRegistrationRecord,
  type SchemeRegistrationStatus,
} from '../types';
import {
  registrationNextActionHint,
  RegistrationRequiredDocuments,
  RegistrationTimeline,
  SchemeRegistrationStatusBadge,
} from './registrationShared';
import type { ProjectRecord } from '../../projects/types';

export function RegistrationDetailModal({
  registration,
  project,
  onClose,
  onChanged,
}: {
  registration: SchemeRegistrationRecord;
  project?: ProjectRecord | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const user = useAppStore((s) => s.user);
  const navigate = useNavigate();
  const perms = usePermissions();
  const transitionMutation = useTransitionSchemeRegistration();
  const reopenMutation = useReopenSchemeRegistration();

  const { data: vendors = [] } = useQuery({
    queryKey: keys.vendors,
    queryFn: () => getAll(COLLECTIONS.VENDORS),
    staleTime: 60_000,
  });

  const [pending, setPending] = useState<SchemeRegistrationStatus | null>(null);
  const [appNo, setAppNo] = useState(registration.applicationNumber || '');
  const [portalRef, setPortalRef] = useState(registration.portalReference || '');
  const [vendorId, setVendorId] = useState(registration.vendorId || '');
  const [vendorName, setVendorName] = useState(registration.vendorName || '');
  const [vendorLockDate, setVendorLockDate] = useState(registration.vendorLockDate || '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reopenNote, setReopenNote] = useState('');

  const isAdmin = user?.role === 'Admin';
  const isPartnerActor = isPartnerPortalUser(user?.role, user?.isSuperAdmin);
  const canEdit = perms.canEdit('scheme_registration');
  const canApprove = perms.canApprove('scheme_registration');

  const nextStatuses = useMemo(() => SCHEME_REGISTRATION_TRANSITIONS[registration.status] || [], [registration.status]);

  const partnerActions = nextStatuses.filter((s) => isPartnerSideTransition(registration.status, s));
  const staffApproveActions = nextStatuses.filter((s) => STAFF_APPROVE_TRANSITIONS.has(s));
  const staffEditActions = nextStatuses.filter((s) => !STAFF_APPROVE_TRANSITIONS.has(s) && s !== 'Submitted' && s !== 'Draft');
  const canReopen = isAdmin && canApprove && (registration.status === 'Completed' || registration.status === 'VendorLocked');

  function execute() {
    if (!pending) return;
    const options: Record<string, string> = {};
    if (pending === 'Submitted') {
      options.applicationNumber = appNo.trim();
      options.portalReference = portalRef.trim();
    }
    if (pending === 'VendorLocked') {
      options.vendorId = vendorId;
      options.vendorName = vendorName.trim();
      options.vendorLockDate = vendorLockDate;
    }
    if (pending === 'Rejected') options.rejectionReason = reason.trim();
    if (pending === 'Failed') options.failureReason = reason.trim();
    if (pending === 'Cancelled') options.note = note.trim();
    transitionMutation.mutate(
      { id: registration.id, status: pending, options },
      {
        onSuccess: () => {
          setPending(null);
          setReason(''); setNote('');
          onChanged?.();
        },
      },
    );
  }

  function executeReopen() {
    if (!reopenNote.trim()) return;
    reopenMutation.mutate(
      { id: registration.id, note: reopenNote.trim() },
      { onSuccess: () => { setReopenNote(''); onChanged?.(); } },
    );
  }

  const info: Array<[string, React.ReactNode]> = [
    ['Application Number', <span key="a" className="font-mono">{registration.applicationNumber || '—'}</span>],
    ['Portal Reference', <span key="p" className="font-mono">{registration.portalReference || '—'}</span>],
    ['Portal Type', registration.portalType ? <span key="pt" className="capitalize">{registration.portalType}</span> : '—'],
    ['DISCOM', registration.discom || '—'],
    ['Scheme', registration.schemeName || '—'],
    ['Vendor', registration.vendorName || '—'],
    ['Vendor Lock Date', registration.vendorLockDate ? fmtDateSafe(registration.vendorLockDate) : '—'],
    ['Registration Date', registration.registrationDate ? fmtDateSafe(registration.registrationDate) : '—'],
    ['Customer', registration.customerName || '—'],
    ['Partner', registration.partnerName || '—'],
    ['Project', project?.projectId || registration.projectId],
    ['Responsible Operator', registration.responsibleUserName || registration.responsibleUserId || '—'],
    ['Submitted', registration.submittedAt ? fmtDateSafe(registration.submittedAt) : '—'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--color-text)]">Registration</h3>
              <span className="font-mono text-xs text-[var(--color-text-muted)]">{registration.registrationId}</span>
              <SchemeRegistrationStatusBadge status={registration.status} />
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Next action: {registrationNextActionHint(registration.status)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-sunken)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Context */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3 sm:grid-cols-3">
            {info.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
                <p className="truncate text-xs text-[var(--color-text)]">{value}</p>
              </div>
            ))}
          </div>

          {(registration.rejectionReason || registration.failureReason) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {registration.rejectionReason && <p><span className="font-semibold">Rejection reason:</span> {registration.rejectionReason}</p>}
              {registration.failureReason && <p><span className="font-semibold">Failure reason:</span> {registration.failureReason}</p>}
            </div>
          )}

          {/* Required documents */}
          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <FileText className="h-3.5 w-3.5 text-[var(--color-text-muted)]" /> Required Documents
            </h4>
            <RegistrationRequiredDocuments registration={registration} project={project} />
          </section>

          {/* Timeline */}
          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <CalendarClock className="h-3.5 w-3.5 text-[var(--color-text-muted)]" /> Status Timeline
            </h4>
            <RegistrationTimeline history={registration.statusHistory} />
          </section>

          {/* Actions */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <User className="h-3.5 w-3.5 text-[var(--color-text-muted)]" /> Actions
            </h4>

            {/* Staff: approval / verification actions */}
            {!isPartnerActor && staffApproveActions.length > 0 && canApprove && (
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Staff verification & approval</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {staffApproveActions.map((target) => (
                    <Button key={target} size="sm"
                      variant={target === 'Rejected' || target === 'Failed' ? 'outline' : 'primary'}
                      className={target === 'Rejected' || target === 'Failed' ? 'text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-950/40' : ''}
                      onClick={() => { setPending(target); setReason(''); setNote(''); }}>
                      {target === 'UnderVerification' ? 'Start Verification' : target === 'VendorLocked' ? 'Vendor Lock' : target === 'Completed' ? 'Complete' : target}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Staff: edit-type targets (e.g. cancel a submitted registration) */}
            {!isPartnerActor && staffEditActions.length > 0 && canEdit && (
              <div className="flex flex-wrap items-center gap-1.5">
                {staffEditActions.map((target) => (
                  <Button key={target} size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-950/40"
                    onClick={() => { setPending(target); setNote(''); }}>
                    {target} Registration
                  </Button>
                ))}
              </div>
            )}

            {/* Partner-side transitions (self records — e.g. a partner reaching this surface) */}
            {isPartnerActor && partnerActions.length > 0 && canEdit && (
              <div className="flex flex-wrap items-center gap-1.5">
                {partnerActions.map((target) => (
                  <Button key={target} size="sm" variant="outline"
                    onClick={() => { setPending(target); setReason(''); setNote(''); }}>
                    {target === 'Submitted' ? 'Submit' : target === 'Cancelled' ? 'Withdraw' : target === 'Draft' ? 'Retry (Draft)' : 'Resubmit'}
                  </Button>
                ))}
              </div>
            )}

            {/* Admin reopen */}
            {canReopen && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/20">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Admin override</p>
                <div className="flex items-center gap-2">
                  <input value={reopenNote} onChange={(e) => setReopenNote(e.target.value)}
                    placeholder="Reopen reason (audit trail) *"
                    className="h-8 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                  <Button size="sm" loading={reopenMutation.isPending} disabled={!reopenNote.trim()}
                    onClick={executeReopen} className="bg-amber-600 hover:bg-amber-700">Reopen</Button>
                </div>
              </div>
            )}

            {/* Read-only notice */}
            {!canEdit && !canApprove && (
              <p className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <Lock className="h-3 w-3" /> Read-only — this role does not hold Registration edit/approval permissions.
              </p>
            )}
          </section>
        </div>

        {/* Action form */}
        {pending && (
          <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-5 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
              <Building2 className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              {pending === 'Submitted' ? 'Submit Registration' : pending === 'VendorLocked' ? 'Vendor Lock' : pending === 'Rejected' ? 'Reject Registration' : pending === 'Failed' ? 'Mark Failed' : pending === 'Cancelled' ? 'Cancel Registration' : `${pending} Registration`}
            </p>
            <div className="space-y-2">
              {pending === 'Submitted' && (
                <div className="grid grid-cols-2 gap-2">
                  <input value={appNo} onChange={(e) => setAppNo(e.target.value)} placeholder="Application number"
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                  <input value={portalRef} onChange={(e) => setPortalRef(e.target.value)} placeholder="Portal reference"
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                </div>
              )}
              {pending === 'VendorLocked' && (
                <div className="grid grid-cols-2 gap-2">
                  <select value={vendorId}
                    onChange={(e) => { const id = e.target.value; setVendorId(id); const v = (vendors as any[]).find((x) => x.id === id || x.vendorId === id); if (v) setVendorName(v.vendorName || v.name || id); }}
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                    <option value="">Select vendor...</option>
                    {(vendors as any[]).map((v) => (
                      <option key={v.id} value={v.id}>{v.vendorName || v.name || v.id}</option>
                    ))}
                  </select>
                  <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor name (or pick above)"
                    className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                  <input type="date" value={vendorLockDate} onChange={(e) => setVendorLockDate(e.target.value)}
                    className="col-span-2 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                </div>
              )}
              {(pending === 'Rejected' || pending === 'Failed') && (
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={pending === 'Rejected' ? 'Rejection reason *' : 'Failure reason *'}
                  className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              )}
              {pending === 'Cancelled' && (
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cancellation note *"
                  className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              )}
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
                <Button size="sm" loading={transitionMutation.isPending}
                  disabled={pending === 'VendorLocked' ? (!(vendorName.trim() || vendorId)) : false}
                  className={cn(pending === 'Rejected' || pending === 'Failed' ? 'bg-red-600 hover:bg-red-700' : '')}
                  onClick={execute}>
                  Confirm {pending === 'VendorLocked' ? 'Lock' : pending}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
          <p className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
            <Users className="h-3 w-3" /> Owner: {registration.partnerName || 'Internal'}
          </p>
          <Button size="sm" variant="outline" icon={<FolderKanban className="h-3 w-3" />}
            onClick={() => { onClose(); if (project) navigate(`/projects/${project.id}`); }}>
            Open Project
          </Button>
        </div>
      </div>
    </div>
  );
}
