/**
 * LeadWorkspace — Single Lead Operating Screen
 * Route: /leads/workspace/:leadId
 *
 * LAYOUT (Final Leads Workspace — Customer Workspace Design System
 * Replication mission: top navigation tabs retired):
 *   HEADER → BODY (25/55/20) → FOOTER
 * The Center column is the always-open Call Outcome card followed by
 * LeadWorkspaceSections — Documents/Follow-ups/Notes/Timeline/Communication
 * reorganized into peek/collapsed secondary sections below it, the same
 * "always-open primary workflow + secondary sections" philosophy the
 * Customer Workspace uses (see CustomerWorkspaceSections.tsx).
 *
 * Phase 1 — Business boundary enforced.
 * Removed: Tasks tab, proposal/negotiation statuses, customer-stage scoreLead
 * fields, mock tasks. The workspace is a pure Lead Processing Queue — no
 * customer-stage concepts.
 *
 * Only telecaller statuses: Interested, Need Follow-up, Qualified, Converted,
 * Rejected, Duplicate, Wrong Number.
 *
 * The page answers only four questions:
 *   LEFT:   Who is this lead?
 *   CENTER: What should I do now?
 *   RIGHT:  What is the current state?
 *   FOOTER: Where am I in today's queue?
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useLeads } from '../features/leads/hooks/useLeads';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { Modal } from '../components/ui/Modal';
import { Input, Select, Textarea } from '../components/ui/Input';
import { persistLeadWorkspace } from '../features/leads/components/workspace/LeadWorkspacePersistence';
import { statusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui';
import { EmptyState } from '../components/shared';
import { LeadWorkspaceProvider, useWorkspace, workspaceReducer } from '../features/leads/components/workspace/LeadWorkspaceEngine';
import { useDirtyNavigation } from '../hooks/useDirtyNavigation';
import LeadHealthCard from '../features/leads/components/workspace/LeadWorkspaceHealth';
import LeadWorkspaceConversionFlow from '../features/leads/components/workspace/LeadWorkspaceConversionFlow';
import LeadWorkspaceSections from '../features/leads/components/workspace/LeadWorkspaceSections';
import callOutcomeIllustration from '../assets/leads-workspace/call-outcome-illustration.png';
import { LeadDomainService } from '../services/LeadDomainService';
import {
  ArrowLeft, Phone, Mail, Building2,
  Calendar, Activity,
  CornerUpRight, UserCheck, Trash2,
  MessageCircle,
  User, ChevronLeft, ChevronRight, Save,
  Edit2, RefreshCw, X,
  Trophy, TrendingUp, XCircle,
  PhoneMissed, PhoneCall, Loader2,
} from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(value: unknown): string {
  if (!value) return '—';
  try { const d = value instanceof Date ? value : new Date(String(value)); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}
function daysAgoText(value: unknown): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(d); then.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86400000));
  if (days === 0) return 'Today'; if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
function isOverdue(value: unknown): boolean {
  if (!value) return false;
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

// Display labels for the Last Call Outcome card — mirrors the reducer's own
// internal STATUS_LABELS/REASON_LABELS (LeadWorkspaceEngine.tsx), kept local
// here since those aren't exported and this is purely display text.
const CONNECTED_STATUS_LABELS: Record<string, string> = {
  interested: 'Interested', qualified: 'Qualified', 'need-followup': 'Need Follow-up',
  converted: 'Converted', rejected: 'Rejected', duplicate: 'Duplicate', 'wrong-number': 'Wrong Number',
};
const NOT_CONNECTED_REASON_LABELS: Record<string, string> = {
  busy: 'Busy', 'switched-off': 'Switched Off', 'no-answer': 'No Answer',
  'not-reachable': 'Not Reachable', 'call-rejected': 'Call Rejected', 'invalid-number': 'Invalid Number',
};

/** Footer action button — deliberately mirrors the header's Call/WhatsApp/
 * Email chip language (rounded-lg, border, shadow-sm, hover background) so
 * the footer reads as the same product as the header, rather than adopting
 * the shared `Button` component's theme-token-driven look. Local to this
 * page only; the shared `Button` component elsewhere is untouched. */
function FooterActionButton({
  icon, children, onClick, disabled, loading, title, tone = 'neutral', dataTour,
}: {
  icon: React.ReactNode; children?: React.ReactNode; onClick?: () => void;
  disabled?: boolean; loading?: boolean; title?: string; tone?: 'neutral' | 'primary';
  /** Stable identifier for the interactive tutorial system. */
  dataTour?: string;
}) {
  const tone_cls = tone === 'primary'
    ? 'border-transparent bg-[var(--color-primary)] text-white shadow-[var(--color-primary-muted)] hover:bg-[var(--color-primary-hover)] hover:shadow-md'
    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)]';
  return (
    <button
      type="button"
      title={title}
      data-tour={dataTour}
      disabled={disabled || loading}
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-semibold shadow-sm transition-all',
        'hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none',
        tone_cls,
      ].join(' ')}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function WorkspaceContent() {
  const navigate = useNavigate();
  const { leadId = '' } = useParams<{ leadId: string }>();
  const { data: leads = [], isLoading } = useLeads();
  const { state: wsState, dispatch } = useWorkspace();

  // `lead` is looked up against the full, unfiltered list so a direct link to
  // an already-converted lead still resolves (e.g. from Cases/Customer "View
  // Lead" links). The processing QUEUE, however, must never include converted
  // leads — a converted lead has left the Lead lifecycle and lives in the
  // Customer module now, so Previous/Next/queue-count must exclude it.
  const lead = useMemo(() => (leads as any[]).find((l: any) => l.id === leadId) || null, [leadId, leads]);
  const queueLeads = useMemo(() => (leads as any[]).filter((l: any) => l.status !== 'Converted'), [leads]);
  const currentIndex = useMemo(() => queueLeads.findIndex((l: any) => l.id === leadId), [leadId, queueLeads]);
  const nextLead = useMemo(() => currentIndex >= 0 && currentIndex < queueLeads.length - 1 ? queueLeads[currentIndex + 1] : null, [currentIndex, queueLeads]);
  const prevLead = useMemo(() => currentIndex > 0 ? queueLeads[currentIndex - 1] : null, [currentIndex, queueLeads]);

  const [callLogStarted, setCallLogStarted] = useState(false);
  const activityLog = useMemo(() => [...(lead?.activityLog || [])].reverse(), [lead]);

  // ── Inline edit state ────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const [editSaving, setEditSaving] = useState(false);
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const editKeys = useMemo(() => queryKeys.forCompany(activeCompanyId), [activeCompanyId]);
  const user = useCurrentUser();

  // ── Center Workspace persistence ──────────────────────
  const [saving, setSaving] = useState(false);
  const dirty = wsState.hasUnsaved;
  // ── Multi-user safety: conflict detection (see effect below) ──
  const loadedUpdatedAtRef = useRef<string | null>(null);
  const [conflictPending, setConflictPending] = useState(false);
  const lastLeadIdRef = useRef<string | null>(null);

  // ── (Documents handled by LeadWorkspaceDocumentsSection) ─

  const startEditing = useCallback(() => {
    if (!lead) return;
    setEditForm({
      name: lead.name || '',
      phone: lead.phone || '',
      altName: lead.altName || '',
      altMobile: lead.altMobile || '',
      email: lead.email || '',
      city: lead.city || '',
      source: lead.source || '',
      status: lead.status || 'New',
      assignedToName: lead.assignedToName || lead.assigned_t || '',
      next_date: (lead.next_date && typeof lead.next_date === 'object' && typeof lead.next_date.toDate === 'function') ? lead.next_date.toDate().toISOString().slice(0, 10) : (lead.next_date || ''),
      notes: lead.notes || '',
    });
    setIsEditing(true);
  }, [lead]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditForm({});
  }, []);

  const handleSaveFields = useCallback(async () => {
    if (!lead?.id) return;
    setEditSaving(true);
    try {
      await LeadDomainService.update(lead.id, editForm);
      toast.success('Lead updated');
      setIsEditing(false);
      setEditForm({});
      qc.invalidateQueries({ queryKey: editKeys.leadsRoot });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update lead');
    } finally {
      setEditSaving(false);
    }
  }, [lead, editForm, qc]);

  const editField = useCallback((field: string, value: string) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleDocsSaved = useCallback(() => {
    qc.invalidateQueries({ queryKey: editKeys.leadsRoot });
  }, [qc, editKeys.leadsRoot]);



  // ── Phase 7: Queue engine state ─────────────────────────
  const isCurrentComplete = useMemo(() =>
    wsState.connectedStatus === 'converted' ||
    wsState.connectedStatus === 'rejected' ||
    wsState.connectedStatus === 'duplicate' ||
    wsState.connectedStatus === 'wrong-number' ||
    wsState.notConnectedReason === 'invalid-number',
  [wsState.connectedStatus, wsState.notConnectedReason]);

  // ── Synced state from context ───────────────────────────
  const currentStatus = wsState.connectedStatus ? (
    wsState.connectedStatus === 'interested' ? 'Interested' :
    wsState.connectedStatus === 'qualified' ? 'Qualified' :
    wsState.connectedStatus === 'need-followup' ? 'Follow-up' :
    wsState.connectedStatus === 'converted' ? 'Converted' :
    wsState.connectedStatus === 'rejected' ? 'Rejected' :
    wsState.connectedStatus === 'duplicate' ? 'Duplicate' :
    wsState.connectedStatus === 'wrong-number' ? 'Wrong Number' : lead?.status || 'New'
  ) : wsState.notConnectedReason === 'invalid-number' ? 'Lost' : lead?.status || 'New';

  const activeCallsMade = wsState.callsMade + (activityLog.filter((l: any) => l.type === 'Follow-up').length || 0);
  const wsTimeline = wsState.timeline;

  const nextFollowup = useMemo(() => {
    if (wsState.followupDate) return { date: fmtDate(wsState.followupDate), overdue: false };
    if (lead?.next_date) return { date: fmtDate(lead.next_date), overdue: isOverdue(lead.next_date) };
    return null;
  }, [wsState.followupDate, lead]);

  // ── Last recorded call attempt (persisted, authoritative) — the source
  // for both the Step-0 contextual message and the Last Call Outcome card.
  const lastCallAttempt = useMemo(() => {
    const attempts = Array.isArray(lead?.callAttempts) ? lead.callAttempts : [];
    return attempts.length ? attempts[attempts.length - 1] : null;
  }, [lead]);

  // ── Right Panel "Last Call Outcome" — compact, at-a-glance state summary.
  // Renders nothing until a real call attempt has been saved (no placeholder
  // clutter for a brand-new lead).
  const lastOutcomeInfo = useMemo(() => {
    if (!lastCallAttempt) return null;
    const connected = lastCallAttempt.outcome === 'connected';
    const label = connected
      ? (CONNECTED_STATUS_LABELS[lastCallAttempt.connectedStatus || ''] || 'Connected')
      : (NOT_CONNECTED_REASON_LABELS[lastCallAttempt.notConnectedReason || ''] || 'Not Connected');
    return {
      connected,
      label,
      timestamp: lastCallAttempt.timestamp,
      operatorName: lastCallAttempt.operatorName,
      showFollowup: connected && lastCallAttempt.connectedStatus === 'need-followup',
    };
  }, [lastCallAttempt]);

  // ── Step-0 message — only the generic "make the first call" line for a
  // genuinely untouched New lead; every other state gets a message describing
  // what actually happened, so the operator understands the situation without
  // opening Timeline or Notes.
  const stepZeroMessage = useMemo(() => {
    if ((!lead?.status || lead.status === 'New') && activeCallsMade === 0) {
      return 'Make the first call to connect with this lead.';
    }
    if (lastCallAttempt?.outcome === 'connected') {
      switch (lastCallAttempt.connectedStatus) {
        case 'interested': return 'Lead showed interest during the last call — continue the conversation.';
        case 'qualified': return 'Lead has been qualified — ready to move toward conversion.';
        case 'need-followup':
          return nextFollowup?.overdue
            ? `Follow-up was due ${nextFollowup.date} and is now overdue — reach out again.`
            : nextFollowup?.date
              ? `Waiting for the scheduled follow-up on ${nextFollowup.date}.`
              : 'A follow-up is scheduled for this lead.';
        case 'converted': return 'This lead has already been converted to a customer.';
        case 'rejected': return 'Lead was marked Rejected in the last call.';
        case 'duplicate': return 'Lead was flagged as a Duplicate in the last call.';
        case 'wrong-number': return 'Last call reached a Wrong Number — verify the contact details before trying again.';
        default: return 'Lead was connected during the last call.';
      }
    }
    if (lastCallAttempt?.outcome === 'not-connected') {
      switch (lastCallAttempt.notConnectedReason) {
        case 'busy': return 'Customer was Busy during the last attempt — try again later.';
        case 'switched-off': return "Customer's phone was Switched Off on the last attempt.";
        case 'no-answer': return 'No answer on the last call attempt.';
        case 'not-reachable': return 'Customer was Not Reachable on the last attempt.';
        case 'call-rejected': return 'Customer rejected the last call.';
        case 'invalid-number': return 'This number appears to be invalid — the lead was marked Lost.';
        default: return 'The last call attempt did not connect.';
      }
    }
    // No recorded attempt on file (e.g. status set via bulk action/import)
    // — fall back to the lead's own status field.
    if (lead?.status === 'Lost') return 'This lead is marked as Lost.';
    if (lead?.status === 'Converted') return 'This lead has already been converted to a customer.';
    if (lead?.status === 'Follow-up') return nextFollowup?.overdue ? 'Follow-up is overdue — reach out again.' : 'Waiting for the scheduled follow-up.';
    if (lead?.status === 'Qualified') return 'Lead has been qualified — ready to move toward conversion.';
    if (activeCallsMade > 0) return 'This lead has been contacted before — log the next call outcome.';
    return 'Make the first call to connect with this lead.';
  }, [lead?.status, activeCallsMade, lastCallAttempt, nextFollowup]);

  // ── Operational metrics ─────────────────────────────────
  const daysSinceCreation = lead?.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000)) : 0;
  const openFollowups = activityLog.filter((l: any) => l.type === 'Follow-up').length || 0;

  // ── Lead Score — engagement/quality signal for this lead specifically
  // (distinct from any Customer-lifecycle score). Computed from real signals:
  // call engagement, current outcome/status, overdue follow-up, and staleness
  // (created long ago with zero contact). Always a real value — never null.
  const leadScore = useMemo(() => {
    let s = 50;
    if (activeCallsMade > 0) s += Math.min(20, activeCallsMade * 5);
    if (wsState.connectedStatus === 'interested' || wsState.connectedStatus === 'qualified') s += 20;
    if (wsState.connectedStatus === 'converted') s += 30;
    if (wsState.connectedStatus === 'wrong-number' || wsState.notConnectedReason === 'invalid-number') s -= 40;
    if (nextFollowup?.overdue) s -= 15;
    if (daysSinceCreation > 14 && activeCallsMade === 0) s -= 20;
    s = Math.max(0, Math.min(100, s));
    const band = s >= 70 ? 'hot' : s >= 40 ? 'warm' : 'cold';
    return { score: s, band };
  }, [activeCallsMade, wsState.connectedStatus, wsState.notConnectedReason, nextFollowup, daysSinceCreation]);

  // ── Queue: is current lead already completed? ───────────
  const currentLeadCompleted = wsState.completedLeadIds.includes(leadId);

  // ── Save handler — validates, persists, syncs queue, marks clean ──
  // `force`: bypasses the multi-user conflict check (used only after the
  // operator explicitly confirms "Save Anyway" on the conflict modal below).
  const handleSave = useCallback(async (force = false): Promise<boolean> => {
    if (!lead?.id || saving) return false;

    // Multi-user safety: if this lead's `updatedAt` has moved since it was
    // first loaded into this workspace session, someone else has written to
    // it in the meantime. Rather than silently overwrite their change, stop
    // and let the operator choose to reload or knowingly proceed.
    if (!force && loadedUpdatedAtRef.current !== null) {
      const currentUpdatedAt = lead.updatedAt ? String(lead.updatedAt) : '';
      if (currentUpdatedAt !== loadedUpdatedAtRef.current) {
        setConflictPending(true);
        return false;
      }
    }

    setSaving(true);
    try {
      // Validate: a scheduled follow-up must have a date
      if (wsState.connectedStatus === 'need-followup' && !wsState.followupDate) {
        toast.error('Select a follow-up date first');
        return false;
      }

      // Commit the call attempt NOW — this is the only place a call attempt
      // becomes real. Selecting Connected/Not Connected/status/reason only
      // staged a pending selection; nothing was recorded until this Save.
      // workspaceReducer is called directly (synchronously) so the freshly
      // committed attempt is included in *this* save's Firestore write —
      // dispatch() alone wouldn't apply until the next render, which would
      // be one save too late.
      let effectiveState = wsState;
      if (wsState.outcome && !wsState.outcomeCommitted) {
        const commitAction = {
          type: 'COMMIT_CALL_ATTEMPT' as const,
          payload: { operatorId: user.id, operatorName: user.name, previousAttemptCount: (lead.callAttempts?.length as number) || 0 },
        };
        effectiveState = workspaceReducer(wsState, commitAction);
        dispatch(commitAction);
      }

      // Persist workspace state → lead (reuses LeadDomainService + logActivity)
      const changed = await persistLeadWorkspace(lead, effectiveState, user);
      if (changed) {
        qc.invalidateQueries({ queryKey: editKeys.leadsRoot });
      }
      // This save just became the new baseline — update the conflict-check
      // reference so the NEXT save doesn't flag this operator's own write.
      loadedUpdatedAtRef.current = new Date().toISOString();

      dispatch({ type: 'MARK_CLEAN' });
      dispatch({ type: 'SET_LAST_ACTION', payload: 'Saved' });

      // Queue synchronization — complete the lead when the outcome is terminal
      if (isCurrentComplete) {
        const outcome = wsState.connectedStatus === 'converted' ? 'converted'
          : wsState.connectedStatus === 'rejected' ? 'rejected'
          : wsState.connectedStatus === 'duplicate' ? 'duplicate'
          : wsState.connectedStatus === 'wrong-number' ? 'wrong-number'
          : 'lost';
        dispatch({ type: 'COMPLETE_LEAD', payload: { leadId, outcome } });
      }

      toast.success('Saved Successfully');
      return true;
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save changes');
      return false;
    } finally {
      setSaving(false);
    }
  }, [lead, wsState, user, saving, qc, editKeys.leadsRoot, dispatch, isCurrentComplete, leadId]);

  const handleSaveAndNext = useCallback(async () => {
    if (!nextLead) return;
    const ok = await handleSave();
    if (ok && nextLead) {
      navigate(`/leads/workspace/${encodeURIComponent(nextLead.id)}`);
    }
  }, [handleSave, nextLead, navigate]);

  // ── Guarded navigation — never lose unsaved work silently ──
  // Shared with Customer Workspace (Phase 5) via useDirtyNavigation — see
  // src/hooks/useDirtyNavigation.ts. Behavior is unchanged from the previous
  // inline implementation: same state shape, same handler bodies, same
  // sequencing, just relocated so both workspaces use one implementation
  // instead of two copies of the same logic (Master Plan-mandated extraction).
  const handleWorkspaceDiscard = useCallback(() => {
    dispatch({ type: 'RESET_WORKSPACE' });
    setCallLogStarted(false);
    setIsEditing(false);
    setEditForm({});
    toast('Changes Discarded');
  }, [dispatch]);

  const {
    pendingNav, requestNavigation, setPendingNav,
    guardSave: handleGuardSave, guardDiscard: handleGuardDiscard, guardCancel: handleGuardCancel,
  } = useDirtyNavigation({ dirty, onSave: handleSave, onDiscard: handleWorkspaceDiscard });

  // ── Keyboard shortcuts ─────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Never hijack keys while the operator is typing inside an input,
    // textarea, select, or content-editable region.
    const target = e.target as HTMLElement | null;
    const isTyping = !!target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' || target.isContentEditable
    );
    if (isTyping) return;
    if (e.altKey && e.key === 's') { e.preventDefault(); void handleSave(); }
    if (e.altKey && e.key === 'n') { e.preventDefault(); void handleSaveAndNext(); }
    if (e.altKey && e.key === 'p') { e.preventDefault(); if (prevLead) requestNavigation(`/leads/workspace/${encodeURIComponent(prevLead.id)}`); }
    if (e.key === 'Escape') { e.preventDefault(); dispatch({ type: 'RESET_OUTCOME' }); }
  }, [nextLead, prevLead, dispatch, handleSave, handleSaveAndNext, requestNavigation]);

  useEffect(() => { document.addEventListener('keydown', handleKeyDown); return () => document.removeEventListener('keydown', handleKeyDown); }, [handleKeyDown]);

  // ── Per-lead isolation: every lead owns an independent workspace ──
  // When the route's leadId changes, wipe all per-lead UI state but preserve
  // the session queue counters (RESET_WORKSPACE keeps completedLeadIds etc.).
  useEffect(() => {
    if (lastLeadIdRef.current === leadId) return;
    lastLeadIdRef.current = leadId;
    dispatch({ type: 'RESET_WORKSPACE' });
    setCallLogStarted(false);
    setIsEditing(false);
    setEditForm({});
    setPendingNav(null);
    loadedUpdatedAtRef.current = null;
    setConflictPending(false);
  }, [leadId, dispatch]);

  // ── Multi-user safety: remember what `updatedAt` looked like the moment
  // this lead's data first became available in this workspace session. Set
  // once per lead (not on every background refetch), so a later Save can
  // detect whether someone else has written to this lead since this operator
  // started editing it — without needing a full optimistic-concurrency
  // system, this alone stops the most common silent-overwrite case.
  useEffect(() => {
    if (!lead?.id || loadedUpdatedAtRef.current !== null) return;
    loadedUpdatedAtRef.current = lead.updatedAt ? String(lead.updatedAt) : '';
  }, [lead]);

  // ── Browser close / refresh guard when dirty ───────────
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── In-app navigation guard: intercept anchor clicks (breadcrumb,
  //    sidebar, other routes) while the workspace is dirty, and instead
  //    surface the Save / Discard / Cancel dialog. Also catches browser
  //    back/forward via popstate (re-push current URL and open dialog). ──
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('/') || anchor.hasAttribute('download') || anchor.getAttribute('target') === '_blank') return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNav(href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const workspaceUrl = window.location.href;
    const onPopState = () => {
      const target = window.location.pathname + window.location.search;
      window.history.pushState(window.history.state, '', workspaceUrl);
      setPendingNav(target);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dirty]);

  // ── Merged timeline ─────────────────────────────────────
  const mergedTimeline = useMemo(() => {
    const entries = [...wsTimeline, ...activityLog.map((l: any) => ({ id: l.id, time: '', type: l.type, desc: l.desc, userName: l.userName }))];
    return { entries, annotations: [] };
  }, [wsTimeline, activityLog]);

  // ── Tab counts ──────────────────────────────────────────
  const followupCount = activityLog.filter((l: any) => l.type === 'Follow-up').length;

  // ── QUEUE EMPTY STATE ───────────────────────────────────
  const totalLeads = queueLeads.length;
  const remainingLeads = totalLeads - wsState.completedLeadIds.length;
  const queueIsEmpty = totalLeads > 0 && remainingLeads <= 0;

  if (queueIsEmpty && wsState.completedLeadIds.includes(leadId)) {
    const todayCalls = wsState.callsMade;
    return (
      <div className="-m-5 flex h-full min-h-0 flex-col items-center justify-center bg-[var(--color-bg)] p-12" style={{ height: 'calc(100% + 2.5rem)' }}>
        <div className="mx-auto max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-900/10 shadow-lg shadow-emerald-500/10">
            <Trophy className="h-10 w-10 text-emerald-500" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-[var(--color-text)]">Queue Completed</h2>
          <p className="mb-10 text-sm text-[var(--color-text-muted)]">
            You have processed all assigned leads. Great work!
          </p>
          <div className="mb-10 grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition-shadow hover:shadow-md">
              <Phone className="mx-auto mb-2 h-6 w-6 text-blue-500" />
              <p className="text-2xl font-bold text-[var(--color-text)]">{todayCalls}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Calls Made</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition-shadow hover:shadow-md">
              <TrendingUp className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
              <p className="text-2xl font-bold text-[var(--color-text)]">{wsState.convertedToday}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Conversions</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition-shadow hover:shadow-md">
              <Calendar className="mx-auto mb-2 h-6 w-6 text-amber-500" />
              <p className="text-2xl font-bold text-[var(--color-text)]">{openFollowups}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Follow-ups</p>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm transition-shadow hover:shadow-md">
              <XCircle className="mx-auto mb-2 h-6 w-6 text-red-400" />
              <p className="text-2xl font-bold text-[var(--color-text)]">{wsState.lostToday}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Lost</p>
            </div>
          </div>
          <div className="flex gap-4 justify-center">
            <Link to="/leads"><Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />}>Return to Leads</Button></Link>
            <Button
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => {
                // Real refresh: refetch the leads list (picks up anything
                // newly assigned/created since this session started) and
                // start a fresh queue-counting session, then return to the list.
                qc.invalidateQueries({ queryKey: editKeys.leadsRoot });
                dispatch({ type: 'RESET_QUEUE_SESSION' });
                navigate('/leads');
              }}
            >
              Refresh Queue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="-m-5 p-2 flex h-full min-h-0 animate-pulse flex-col gap-2 overflow-hidden bg-[var(--color-bg)]" style={{ height: 'calc(100% + 2.5rem)' }}>
        <div className="flex shrink-0 items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-6 py-4">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-bg-sunken)]" />
          <div className="h-10 w-10 rounded-full bg-[var(--color-bg-sunken)]" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-48 rounded-md bg-[var(--color-bg-sunken)]" />
            <div className="h-3 w-64 rounded-md bg-[var(--color-bg-sunken)]" />
          </div>
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-8 w-20 rounded-lg bg-[var(--color-bg-sunken)]" />)}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
          <div className="w-[25%] shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-5 space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-[var(--color-bg-sunken)]" />)}
          </div>
          <div className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-6 space-y-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-32 rounded-2xl bg-[var(--color-bg-sunken)]" />)}
          </div>
          <div className="w-[19%] shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-3 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-[var(--color-bg-sunken)]" />)}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-6 py-3">
          <div className="flex gap-3">
            <div className="h-8 w-24 rounded-lg bg-[var(--color-bg-sunken)]" />
            <div className="h-8 w-32 rounded-lg bg-[var(--color-bg-sunken)]" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-24 rounded-lg bg-[var(--color-bg-sunken)]" />
            <div className="h-8 w-20 rounded-lg bg-[var(--color-bg-sunken)]" />
            <div className="h-8 w-28 rounded-lg bg-[var(--color-bg-sunken)]" />
          </div>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="-m-5 flex h-full min-h-0 items-center justify-center p-8" style={{ height: 'calc(100% + 2.5rem)' }}>
        <EmptyState title="Lead not found" description="The lead does not exist or is outside your visibility scope."
          action={<Link to="/leads"><Button variant="outline" icon={<ArrowLeft className="h-4 w-4" />}>Back to Leads</Button></Link>} />
      </div>
    );
  }

  // ── Left panel content ──────────────────────────────────
  // ── Left Panel: permanent — always Lead Information, regardless of the
  // active tab (Documents moved to its own tab). Only the Center panel below
  // changes per tab.
  const leftContent = (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Lead Information</h3>
              {isEditing ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleSaveFields}
                    disabled={editSaving}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" /> {editSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEditing}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={startEditing}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-primary-text)] hover:bg-[var(--color-primary-light)] transition-colors"
                  title="Edit lead"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* ── Editable Fields — Customer Workspace UX Parity mission:
                same premium shared Input/Select/Textarea components
                CustomerWorkspaceEditor.tsx uses, instead of the old bespoke
                inline-label EditInfoRow. Save/Cancel wiring, dirty-field
                tracking, and LeadDomainService.update() persistence are
                completely unchanged — only the field presentation moved. ── */}
            {isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <Input label="Full Name" required disabled={editSaving} value={editForm.name || ''} onChange={(e) => editField('name', e.target.value)} />
                  <Input label="Phone" required disabled={editSaving} value={editForm.phone || ''} onChange={(e) => editField('phone', e.target.value)} />
                  <Input label="Email" type="email" disabled={editSaving} value={editForm.email || ''} onChange={(e) => editField('email', e.target.value)} />
                  {/* Alternate Name/Number — secondary contact info, matching
                      Customer Workspace's own placement (right after the
                      primary Name/Phone/Email fields, not required). */}
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Alternate Name" disabled={editSaving} value={editForm.altName || ''} onChange={(e) => editField('altName', e.target.value)} placeholder="Optional" />
                    <Input label="Alternate Number" disabled={editSaving} value={editForm.altMobile || ''} onChange={(e) => editField('altMobile', e.target.value)} placeholder="Optional" />
                  </div>
                  <Input label="City" disabled={editSaving} value={editForm.city || ''} onChange={(e) => editField('city', e.target.value)} />
                  <Select
                    label="Source" disabled={editSaving} value={editForm.source || ''}
                    onChange={(e) => editField('source', e.target.value)}
                    options={['Website', 'Referral', 'Social Media', 'Walk-in', 'Phone Inquiry', 'Partner', 'Campaign', 'Other'].map((o) => ({ label: o, value: o }))}
                  />
                  <Select
                    label="Status" disabled={editSaving} value={editForm.status || ''}
                    onChange={(e) => editField('status', e.target.value)}
                    options={['New', 'Interested', 'Need Follow-up', 'Qualified', 'Converted', 'Rejected', 'Duplicate', 'Wrong Number'].map((o) => ({ label: o, value: o }))}
                  />
                  <Input label="Assigned To" disabled={editSaving} value={editForm.assignedToName || ''} onChange={(e) => editField('assignedToName', e.target.value)} />
                  <Input label="Next Follow-up" type="date" disabled={editSaving} value={editForm.next_date || ''} onChange={(e) => editField('next_date', e.target.value)} />
                  <Textarea label="Notes" disabled={editSaving} value={editForm.notes || ''} onChange={(e) => editField('notes', e.target.value)} rows={3} />
                </div>
              </div>
            ) : (
              <div>
                <InfoRow label="Full Name" value={lead.name || '—'} />
                <InfoRow label="Phone" value={lead.phone || '—'} />
                {(lead.altName || lead.altMobile) && (
                  <InfoRow label="Alternate Contact" value={[lead.altName, lead.altMobile].filter(Boolean).join(' · ')} />
                )}
                <InfoRow label="Email" value={lead.email || '—'} />
                <InfoRow label="City" value={lead.city || '—'} />
                <InfoRow label="Source" value={lead.source || '—'} />
                <InfoRow label="Status" value={lead.status || 'New'} />
                <InfoRow label="Assigned To" value={lead.assignedToName || lead.assigned_t || 'Unassigned'} />
                <InfoRow label="Created By" value={lead.createdByName || 'System'} />
                <InfoRow label="Created Date" value={fmtDate(lead.createdAt)} />
                <InfoRow label="Next Follow-up" value={fmtDate(lead.next_date)} />
                {lead.notes && <InfoRow label="Notes" value={lead.notes} />}
              </div>
            )}
          </div>
  );

  // ── Center panel content ─────────────────────────────────
  // Final Leads Workspace — Customer Workspace Design System Replication
  // mission: the old tab-switched content (Overview/Documents/Follow-ups/
  // Notes/Timeline/Communication as six separate "pages") is retired. The
  // Call Outcome card is now always open, with everything the other five
  // tabs used to show reorganized into LeadWorkspaceSections' secondary
  // sections directly below it — the same "always-open primary workflow +
  // peek/collapsed secondary sections" philosophy the Customer Workspace
  // already uses, replicated here with Lead's own components/data.
  const centerContent = (
          <div className="space-y-3">
            {/* ── SINGLE PROGRESSIVE CALL OUTCOME CARD ─────────────
                Final Leads Workspace — Customer Workspace Design System
                Replication mission: this card was cramped (p-2 ≈ 8px on
                every side) with its header/Reset button reading as loosely
                placed rather than intentional. Fixed by: borrowing the same
                header treatment the Customer Workspace's own primary card
                ("Work on This Customer") uses — a proper text-sm/font-
                semibold title, a header-bottom divider, and generous padding
                (left specifically ~3x the old value, since that's where the
                text content anchors). A restrained hover-lift (translate +
                shadow) matches the same interaction language every Customer
                Workspace card now uses.

                Leads Workspace — Final Changes Only mission: the illustration
                used to live INSIDE the Step-0 body only, sharing a grid row
                with the text+button block — its fixed w-64 width forced that
                row (and so the whole card) to be at least as tall as the
                image's own aspect-ratio-driven height, even though the text
                itself needed much less room, and left a wide dead gap
                between the two. It's now a full-height right rail spanning
                the whole card — header included, not a separate header/
                container of its own (the same "illustration rail, 2px inset
                from the outer edges, content starts where it ends" pattern
                StageCard already uses elsewhere in this codebase, mirrored
                to the right side) — but still shown ONLY for the default
                Step-0 state, not persistently: the moment the operator
                clicks "Add Call Log" (or the card is in any other active
                state), the image goes away and the content column reclaims
                the full card width, exactly like before this mission. This
                decouples the image's height from the Step-0 row's own
                content height, which is what naturally makes THAT state
                ~15-20% shorter, not any content being compressed or hidden. */}
            <div data-tour="lead-ws-call-outcome" className="flex overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="min-w-0 flex-1 pl-6 pr-5 pt-5 pb-5">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border-subtle)]">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)]">
                      <Phone className="h-3.5 w-3.5 text-[var(--color-primary-text)]" />
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--color-text)]">Call Outcome</h3>
                  </div>
                  {callLogStarted && (
                    <button
                      onClick={() => { setCallLogStarted(false); dispatch({ type: 'RESET_OUTCOME' }); }}
                      className="inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[10px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 dark:hover:bg-red-900/20"
                    >
                      <X className="h-3 w-3" /> Reset
                    </button>
                  )}
                </div>

                {/* ── Step 0: Guided empty state + primary action ── */}
                {!callLogStarted && (
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{stepZeroMessage}</p>
                    <button
                      onClick={() => setCallLogStarted(true)}
                      data-tour="lead-ws-add-call-log"
                      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-[var(--color-primary-muted)] transition-all hover:bg-[var(--color-primary-hover)] hover:shadow-md"
                    >
                      <PhoneCall className="h-4 w-4" />
                      <span>Add Call Log</span>
                    </button>
                  </div>
                )}

                {/* ── Step 1: Choose outcome — two large actions ── */}
              {callLogStarted && !wsState.outcome && (
                <div data-tour="lead-ws-outcome-options" className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => dispatch({ type: 'SET_OUTCOME', payload: 'connected' })}
                    className="group flex flex-col items-center gap-2 rounded-2xl border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-6 text-sm font-semibold text-[var(--color-text)] transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-lg hover:shadow-emerald-500/10 dark:hover:border-emerald-700 dark:hover:bg-emerald-900/20"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 transition-transform group-hover:scale-110 dark:bg-emerald-900/30">
                      <Phone className="h-5 w-5" />
                    </span>
                    Connected
                  </button>
                  <button
                    onClick={() => dispatch({ type: 'SET_OUTCOME', payload: 'not-connected' })}
                    className="group flex flex-col items-center gap-2 rounded-2xl border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-6 text-sm font-semibold text-[var(--color-text)] transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 hover:shadow-lg hover:shadow-amber-500/10 dark:hover:border-amber-700 dark:hover:bg-amber-900/20"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500 transition-transform group-hover:scale-110 dark:bg-amber-900/30">
                      <PhoneMissed className="h-5 w-5" />
                    </span>
                    Not Connected
                  </button>
                </div>
              )}

              {/* ── Outcome selected: badge + change link ──────── */}
              {callLogStarted && wsState.outcome && (
                <div className="flex items-center gap-3 mb-5">
                  <span className={[
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold shadow-sm',
                    wsState.outcome === 'connected'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800',
                  ].join(' ')}>
                    <span className={['h-2 w-2 rounded-full', wsState.outcome === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'].join(' ')} />
                    {wsState.outcome === 'connected' ? 'Connected' : 'Not Connected'}
                  </span>
                  <button
                    onClick={() => dispatch({ type: 'SET_OUTCOME', payload: null })}
                    className="text-[11px] font-medium text-[var(--color-text-muted)] underline decoration-dashed underline-offset-2 hover:text-[var(--color-text-secondary)] transition-colors"
                  >
                    Change outcome
                  </button>
                </div>
              )}

              {/* ══════════════════════════════════════════════════
                  CONNECTED FLOW — inside the same card
                 ══════════════════════════════════════════════════ */}
              {callLogStarted && wsState.outcome === 'connected' && !wsState.connectedStatus && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'interested', label: 'Interested' },
                    { id: 'need-followup', label: 'Need Follow-up' },
                    { id: 'qualified', label: 'Qualified' },
                    { id: 'converted', label: 'Converted' },
                    { id: 'rejected', label: 'Rejected' },
                    { id: 'duplicate', label: 'Duplicate' },
                    { id: 'wrong-number', label: 'Wrong Number' },
                  ].map(({ id, label }) => (
                    <button key={id}
                      onClick={() => dispatch({ type: 'SET_CONNECTED_STATUS', payload: id as import('../features/leads/components/workspace/LeadWorkspaceDefs').ConnectedStatus })}
                      className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-xs font-semibold text-[var(--color-text)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]/30 transition-all"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Need Follow-up — Date + Time only ──────────── */}
              {callLogStarted && wsState.outcome === 'connected' && wsState.connectedStatus === 'need-followup' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Date</p>
                    <input type="date" value={wsState.followupDate} onChange={e => dispatch({ type: 'SET_FOLLOWUP_DATE', payload: e.target.value })}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Time</p>
                    <input type="time" value={wsState.followupTime} onChange={e => dispatch({ type: 'SET_FOLLOWUP_TIME', payload: e.target.value })}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
              )}

              {/* ── Converted — Conversion Flow inline ────────── */}
              {callLogStarted && wsState.outcome === 'connected' && wsState.connectedStatus === 'converted' && (
                <LeadWorkspaceConversionFlow lead={lead} nextLeadId={nextLead?.id} />
              )}

              {/* ══════════════════════════════════════════════════
                  NOT CONNECTED FLOW — inside the same card
                 ══════════════════════════════════════════════════ */}
              {callLogStarted && wsState.outcome === 'not-connected' && !wsState.notConnectedReason && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'busy', label: 'Busy' },
                    { id: 'switched-off', label: 'Switched Off' },
                    { id: 'no-answer', label: 'No Answer' },
                    { id: 'not-reachable', label: 'Not Reachable' },
                    { id: 'call-rejected', label: 'Call Rejected' },
                    { id: 'invalid-number', label: 'Invalid Number' },
                  ].map(({ id, label }) => (
                    <button key={id}
                      onClick={() => dispatch({ type: 'SET_NOT_CONNECTED_REASON', payload: id as import('../features/leads/components/workspace/LeadWorkspaceDefs').NotConnectedReason })}
                      className="rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-xs font-semibold text-[var(--color-text)] hover:border-amber-300 hover:bg-amber-50 dark:hover:border-amber-700 dark:hover:bg-amber-900/20 transition-all"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Not Connected — retry: Date + Time only ──── */}
              {callLogStarted && wsState.outcome === 'not-connected' && ['busy', 'switched-off', 'no-answer', 'not-reachable'].includes(wsState.notConnectedReason || '') && (
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Retry Date</p>
                    <input type="date" value={wsState.followupDate} onChange={e => dispatch({ type: 'SET_FOLLOWUP_DATE', payload: e.target.value })}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Retry Time</p>
                    <input type="time" value={wsState.followupTime} onChange={e => dispatch({ type: 'SET_FOLLOWUP_TIME', payload: e.target.value })}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
              )}

              {/* ── Not Connected — terminal: call-rejected / invalid-number ── */}
              {callLogStarted && wsState.outcome === 'not-connected' && ['call-rejected', 'invalid-number'].includes(wsState.notConnectedReason || '') && (
                <div className="mt-5 flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                    {wsState.notConnectedReason === 'invalid-number' ? 'Lead will be marked as Lost' : 'Call was rejected by customer'}
                  </p>
                </div>
              )}
              </div>

              {/* ── Default-state-only illustration rail — the rightmost 30%
                  of the whole card (header included), 2px inset from the
                  outer top/right/bottom edges, content starting exactly
                  where it ends on the left. Shown ONLY for the default
                  (Step-0, before "Add Call Log" is clicked) state — the
                  moment the operator starts logging a call (or the workspace
                  has any other active state on this center panel), the
                  image goes away and the content column reclaims the full
                  card width; it is not a persistent decoration across every
                  step. Not a separate header/container either way — same
                  flex row as the content column above, no gap between them.
                  Hidden below `sm` too, matching the previous illustration's
                  own responsive behavior. ── */}
              {!callLogStarted && (
                <div className="hidden w-[30%] shrink-0 self-stretch p-0.5 sm:block">
                  <div className="flex h-full w-full items-center justify-center">
                    <img
                      src={callOutcomeIllustration}
                      alt="Call Outcome Illustration"
                      draggable={false}
                      className="h-full w-full object-contain select-none pointer-events-none"
                    />
                  </div>
                </div>
              )}
            </div>

            <LeadWorkspaceSections
              lead={lead}
              activityLog={activityLog}
              nextFollowup={nextFollowup}
              followupCount={followupCount}
              mergedTimeline={mergedTimeline}
              activeCompanyId={activeCompanyId}
              onDocsSaved={handleDocsSaved}
            />
          </div>
  );

  return (
    // `-m-5` cancels the shared `.app-shell__main` 1.25rem outer padding on
    // every side (this workspace is a full operating screen, not a centered
    // content page — see file header); `p-1` re-adds a 4px safety gutter.
    // Height must be explicitly grown by 2x the cancelled padding because,
    // unlike width (auto-width self-compensates for negative margins),
    // `h-full` resolves to a fixed pixel height that negative margins alone
    // don't expand.
    <div className="-m-5 p-2 flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)]" style={{ height: 'calc(100% + 2.5rem)' }}>
      {/* ── HEADER — Left/Center/Right/Header Surface Unification mission:
          every major workspace surface (Header/Left/Center/Right/Footer)
          now shares the same rounded-xl/border/shadow-sm treatment, matching
          CustomerWorkspace.tsx exactly, instead of flush single-side
          border-b/border-r/border-l dividers with no radius/shadow — see
          that file's own comment for the full rationale. ────────────── */}
      <div data-tour="lead-ws-header" className="flex shrink-0 items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-6 py-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-lg font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)]">
          {(lead.name || '?')[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="truncate text-xl font-bold text-[var(--color-text)]">{lead.name || 'Unnamed'}</h1>
            <span data-interactive data-tour="lead-ws-status" key={currentStatus}>{statusBadge(currentStatus)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {lead.phone && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</span>}
            {lead.email && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1 hidden sm:flex"><Mail className="h-3 w-3" />{lead.email}</span>}
            {lead.city && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><Building2 className="h-3 w-3" />{lead.city}</span>}
            <span className="h-3 w-px bg-[var(--color-border-subtle)] hidden sm:block" />
            {lead.source && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><Activity className="h-3 w-3" />{lead.source}</span>}
            {lead.assignedToName && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><User className="h-3 w-3" />{lead.assignedToName}</span>}
            {lead.createdByName && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1 hidden lg:flex"><User className="h-3 w-3" />Created: {lead.createdByName}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a href={`tel:${lead.phone}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm">
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
          <a href={`https://wa.me/${String(lead.phone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:border-emerald-700 dark:hover:text-emerald-400 transition-colors shadow-sm">
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
          {lead.email && (
            <a href={`mailto:${lead.email}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:border-blue-700 dark:hover:text-blue-400 transition-colors shadow-sm">
              <Mail className="h-3.5 w-3.5" /> Email
            </a>
          )}
          <button
            onClick={() => requestNavigation('/leads')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 sm:px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm"
            title="Back to Leads"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Leads</span>
          </button>
        </div>
      </div>

      {/* ── BODY (Left 25% — unchanged — / Center flex-1 remainder / Right
          19% — Leads Workspace Final Changes mission: now exactly matching
          Customer Workspace's own right panel width, its source of truth,
          instead of the previously narrower 15%. Center absorbs the
          difference automatically since it has no fixed width of its own. */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        <div className="w-[25%] shrink-0 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-5">
          {leftContent}
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4">
          {centerContent}
        </main>
        <div className="w-[19%] shrink-0 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          {/* ── Lead Status — removed (queue info lives in footer) ── */}
          {/* ── Lead Health ──────────────────────────────────── */}
          <LeadHealthCard
            score={leadScore}
            totalFollowups={openFollowups}
            daysSinceContact={daysAgoText(lead.updatedAt || lead.createdAt) || '—'}
            callsMade={activeCallsMade}
            daysOpen={daysSinceCreation}
          />
          {/* ── Last Call Outcome — compact "what happened last time"
              summary, so the current state reads at a glance without
              opening Timeline or Notes. Hidden entirely until a real call
              attempt has been saved. ── */}
          {lastOutcomeInfo && (
            <div className="border-b border-[var(--color-border-subtle)] px-4 py-4">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Last Call Outcome</h3>
              <div className={[
                'rounded-xl border p-3',
                lastOutcomeInfo.connected
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/10'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10',
              ].join(' ')}>
                <div className="flex items-center gap-1.5">
                  <span className={['h-2 w-2 shrink-0 rounded-full', lastOutcomeInfo.connected ? 'bg-emerald-500' : 'bg-amber-500'].join(' ')} />
                  <span className="text-[11px] font-bold text-[var(--color-text)]">{lastOutcomeInfo.connected ? 'Connected' : 'Not Connected'}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">· {lastOutcomeInfo.label}</span>
                </div>
                {lastOutcomeInfo.showFollowup && nextFollowup && (
                  <p className="mt-1.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
                    {nextFollowup.overdue ? `Follow-up overdue — was due ${nextFollowup.date}` : `Next follow-up: ${nextFollowup.date}`}
                  </p>
                )}
                <p className="mt-1.5 text-[9px] text-[var(--color-text-muted)]">
                  {daysAgoText(lastOutcomeInfo.timestamp) || fmtDate(lastOutcomeInfo.timestamp)}{lastOutcomeInfo.operatorName ? ` · ${lastOutcomeInfo.operatorName}` : ''}
                </p>
              </div>
            </div>
          )}
          {/* ── Quick Actions ── Center workspace launchers — Customer +
              Lead Workspace UX Parity mission: compact icon-over-label
              tiles (same Call/WhatsApp/Email chip language as the header),
              2-column grid, sized for the 15% Right Panel. ── */}
          <div className="border-b border-[var(--color-border-subtle)] px-4 py-4">
            <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={lead.status === 'Converted'}
                onClick={() => {
                  setCallLogStarted(true);
                  dispatch({ type: 'SET_OUTCOME', payload: 'connected' });
                  dispatch({ type: 'SET_CONNECTED_STATUS', payload: 'converted' });
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-primary-muted)] bg-[var(--color-primary-light)]/50 px-1.5 py-2.5 text-center shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-0.5 hover:bg-[var(--color-primary-light)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.05)] active:translate-y-0 active:scale-[0.98] active:shadow-[0_1px_1px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)]"
              >
                <UserCheck className="h-4 w-4 text-[var(--color-primary-text)]" />
                <span className="text-[10px] font-semibold leading-tight text-[var(--color-primary-text)]">Convert</span>
              </button>
              <button
                onClick={() => {
                  setCallLogStarted(true);
                  dispatch({ type: 'SET_OUTCOME', payload: 'connected' });
                  dispatch({ type: 'SET_CONNECTED_STATUS', payload: 'qualified' });
                  dispatch({ type: 'SET_NOTES', payload: `Transfer: reassign to new salesperson` });
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-2.5 text-center shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.05)] active:translate-y-0 active:scale-[0.98] active:shadow-[0_1px_1px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
              >
                <CornerUpRight className="h-4 w-4 text-[var(--color-text-secondary)]" />
                <span className="text-[10px] font-semibold leading-tight text-[var(--color-text-secondary)]">Transfer</span>
              </button>
              <button
                onClick={() => {
                  setCallLogStarted(true);
                  dispatch({ type: 'SET_OUTCOME', payload: 'connected' });
                  dispatch({ type: 'SET_CONNECTED_STATUS', payload: 'need-followup' });
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-2.5 text-center shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.05)] active:translate-y-0 active:scale-[0.98] active:shadow-[0_1px_1px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
              >
                <Calendar className="h-4 w-4 text-[var(--color-text-secondary)]" />
                <span className="text-[10px] font-semibold leading-tight text-[var(--color-text-secondary)]">Follow-up</span>
              </button>
              <button
                disabled={lead.status === 'Lost' || lead.status === 'Converted'}
                onClick={() => {
                  setCallLogStarted(true);
                  dispatch({ type: 'SET_OUTCOME', payload: 'not-connected' });
                  dispatch({ type: 'SET_NOT_CONNECTED_REASON', payload: 'invalid-number' });
                }}
                className="flex flex-col items-center justify-center gap-1 rounded-lg border border-red-200 bg-[var(--color-surface)] px-1.5 py-2.5 text-center shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-0.5 hover:bg-red-50 hover:shadow-[0_6px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.05)] active:translate-y-0 active:scale-[0.98] active:shadow-[0_1px_1px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 dark:border-red-800 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)]"
              >
                <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                <span className="text-[10px] font-semibold leading-tight text-red-600 dark:text-red-400">Mark Lost</span>
              </button>
            </div>
          </div>
          {/* ── Recent Activity ──────────────────────────────── */}
          <div className="px-4 py-4">
            <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Recent Activity</h3>
            {wsTimeline.length > 0 ? (
              <div className="space-y-2">
                {wsTimeline.slice(-8).reverse().map((entry: any, idx: number) => (
                  <div key={entry.id || idx} className="flex items-start gap-2">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-[var(--color-text)]">{entry.desc || entry.type || 'Activity'}</p>
                      <p className="text-[9px] text-[var(--color-text-muted)]">{entry.time || daysAgoText(entry.date)}</p>
                    </div>
                  </div>
                ))}
                {wsTimeline.length > 8 && (
                  <p className="text-[10px] font-medium text-[var(--color-text-muted)] mt-1">+{wsTimeline.length - 8} more entries</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Activity className="h-5 w-5 text-[var(--color-text-disabled)]" />
                <p className="text-[11px] text-[var(--color-text-muted)]">No activity yet</p>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── FOOTER ── Production ERP Operator Toolbar ────── */}
      <div className="flex shrink-0 items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-4 py-0.5">
        {/* LEFT: Previous / Next always visible */}
        <div className="flex items-center gap-2">
          <FooterActionButton icon={<ChevronLeft className="h-4 w-4" />}
            disabled={!prevLead}
            onClick={() => { if (prevLead) requestNavigation(`/leads/workspace/${encodeURIComponent(prevLead.id)}`); }}
            title="Alt+P">Previous</FooterActionButton>
          <FooterActionButton icon={<ChevronRight className="h-4 w-4" />}
            disabled={!nextLead}
            onClick={() => { if (nextLead) requestNavigation(`/leads/workspace/${encodeURIComponent(nextLead.id)}`); }}
            title="Alt+N">Next</FooterActionButton>
        </div>

        {/* CENTER: Queue Progress — compact */}
        <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--color-text-muted)]">
          <div className="flex items-center gap-2">
            <div className="w-16 h-1 rounded-full bg-[var(--color-bg-sunken)] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700 ease-out"
                style={{ width: totalLeads > 0 ? `${Math.round((wsState.completedLeadIds.length / totalLeads) * 100)}%` : '0%' }} />
            </div>
            <span className="font-semibold">{wsState.completedToday}/{totalLeads}</span>
          </div>
          <span className="hidden sm:inline">Lead <span className="font-semibold text-[var(--color-text)]">{currentIndex + 1}</span> of {totalLeads}</span>
        </div>

        {/* RIGHT: Save / Save & Next — only when unsaved */}
        <div className="flex items-center gap-2">
          {wsState.hasUnsaved ? (
            <>
              <FooterActionButton tone="primary" icon={<Save className="h-4 w-4" />} title="Alt+S" dataTour="lead-ws-save"
                loading={saving}
                disabled={saving}
                onClick={() => void handleSave()}>Save</FooterActionButton>
              <FooterActionButton tone="primary" icon={<ChevronRight className="h-4 w-4" />}
                loading={saving}
                disabled={!nextLead || currentLeadCompleted || saving}
                onClick={() => void handleSaveAndNext()}
                title="Alt+N">Save &amp; Next</FooterActionButton>
            </>
          ) : (
            <span className="text-[10px] text-[var(--color-text-muted)] opacity-60">Alt+S · Alt+N</span>
          )}
        </div>
      </div>

      {/* ── Unsaved Changes guard modal ─────────────────── */}
      <Modal open={!!pendingNav} onClose={handleGuardCancel} title="Unsaved Changes" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">
          You have unsaved changes. Save them before leaving, or discard them.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleGuardCancel}>Cancel</Button>
          <Button variant="danger" size="sm" loading={saving} disabled={saving} onClick={() => void handleGuardDiscard()}>
            Discard
          </Button>
          <Button size="sm" loading={saving} disabled={saving} onClick={() => void handleGuardSave()}>
            Save
          </Button>
        </div>
      </Modal>

      {/* ── Multi-user conflict modal ─────────────────────
          Shown when this lead was changed by someone else since it was
          loaded into this workspace. Never silently overwritten. ── */}
      <Modal open={conflictPending} onClose={() => setConflictPending(false)} title="This Lead Was Updated By Someone Else" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Another user has saved changes to this lead since you opened it. Saving now would overwrite their update.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setConflictPending(false)}>Cancel</Button>
          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => {
              setConflictPending(false);
              qc.invalidateQueries({ queryKey: editKeys.leadsRoot });
              dispatch({ type: 'RESET_WORKSPACE' });
              loadedUpdatedAtRef.current = null;
              toast('Reloaded the latest version of this lead');
            }}
          >
            Reload Latest
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={saving}
            disabled={saving}
            onClick={() => { setConflictPending(false); void handleSave(true); }}
          >
            Save Anyway
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Export wrapper ─────────────────────────────────────────────────────────
export default function LeadWorkspace() {
  return (
    <LeadWorkspaceProvider>
      <WorkspaceContent />
    </LeadWorkspaceProvider>
  );
}

// ── Sub-panel components ────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-2 gap-3 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <span className="text-[12px] font-medium text-[var(--color-text)] break-words leading-5">{value}</span>
    </div>
  );
}

