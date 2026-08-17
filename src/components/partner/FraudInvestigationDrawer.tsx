/**
 * FraudInvestigationDrawer — Detail view & actions for a fraud investigation
 *
 * Displays:
 *   - Partner summary card
 *   - Risk score with visual indicator
 *   - Risk timeline (evaluation history)
 *   - Triggered rules with evidence
 *   - Investigation notes with add-note form
 *   - Actions: assign investigator, change status, add notes, re-run analysis
 *
 * Reuses existing modal/drawer patterns.
 * All mutations go through fraudDetection service layer.
 * No duplicate fraud logic.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpCircle,
  ArrowDownCircle,
  CheckCircle2,
  Clock,
  FileText,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  UserPlus,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge, statusBadge } from '../ui/Badge';
import { Input, Textarea, Select } from '../ui/Input';
import { updateInvestigation } from '../../lib/fraudDetection';
import { evaluatePartnerFraud } from '../../lib/fraudDetection';
import { getAll, resolveWriteCompanyId } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { createInvestigation } from '../../lib/fraudDetection';
import { fmtDate } from '../../lib/firestore';
import type {
  FraudInvestigation,
  InvestigationStatus,
  FraudEvaluation,
  FraudRiskLevel,
} from '../../features/channel-partner/types/fraud';
import { FRAUD_RULE_LABELS } from '../../features/channel-partner/types/fraud';

interface Props {
  investigation: FraudInvestigation | null;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_ACTIONS: { label: string; value: InvestigationStatus; color: string }[] = [
  { label: 'New', value: 'new', color: 'bg-blue-100 text-blue-700' },
  { label: 'Under Review', value: 'under_review', color: 'bg-amber-100 text-amber-700' },
  { label: 'Escalated', value: 'escalated', color: 'bg-red-100 text-red-700' },
  { label: 'Cleared', value: 'cleared', color: 'bg-emerald-100 text-emerald-700' },
  { label: 'Confirmed', value: 'confirmed', color: 'bg-purple-100 text-purple-700' },
];

export function FraudInvestigationDrawer({ investigation, onClose, onUpdated }: Props) {
  const user = useAppStore((s) => s.user);
  const companyId = resolveWriteCompanyId();

  const [noteText, setNoteText] = useState('');
  const [resolution, setResolution] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<InvestigationStatus | ''>('');
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [reEvaluation, setReEvaluation] = useState<FraudEvaluation | null>(null);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 120_000,
    enabled: !!investigation,
  });

  const adminUsers = useMemo(() =>
    (users as any[]).filter((u: any) => u.role === 'Admin' || u.role === 'Director'),
    [users],
  );

  // Reset state when investigation changes
  useEffect(() => {
    if (!investigation) return;
    setNoteText('');
    setResolution('');
    setSelectedStatus('');
    setAssigneeId(investigation.assignedTo || '');
    setAssigneeName(investigation.assignedToName || '');
    setReEvaluation(null);
  }, [investigation?.id]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Parameters<typeof updateInvestigation>[1]) => {
      if (!investigation) return;
      await updateInvestigation(investigation.id, updates);
    },
    onSuccess: () => {
      toast.success('Investigation updated');
      onUpdated();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update'),
  });

  const reEvaluateMutation = useMutation({
    mutationFn: async () => {
      if (!investigation) return null;
      const [leads, commissionRecords, walletTxns, auditLogs] = await Promise.all([
        getAll(COLLECTIONS.LEADS),
        getAll(COLLECTIONS.COMMISSION_RECORDS),
        getAll(COLLECTIONS.PARTNER_WALLET_TXNS),
        getAll(COLLECTIONS.AUDIT_LOGS),
      ]);
      const partners = await getAll<any>(COLLECTIONS.CHANNEL_PARTNERS);
      const partner = partners.find((p: any) => p.id === investigation.partnerId);

      return evaluatePartnerFraud(
        investigation.partnerId,
        investigation.partnerName || partner?.firmName || '',
        {
          leads,
          commissionRecords,
          walletTxns,
          tierHistory: partner?.tierHistory || [],
          auditLogs,
        },
      );
    },
    onSuccess: (result) => {
      if (result) setReEvaluation(result);
    },
    onError: (err: any) => toast.error(err?.message || 'Re-evaluation failed'),
  });

  function handleAssign() {
    if (!assigneeId) return;
    updateMutation.mutate({ assignedTo: assigneeId, assignedToName: assigneeName });
  }

  function handleStatusChange() {
    if (!selectedStatus) return;
    updateMutation.mutate({
      status: selectedStatus as InvestigationStatus,
      resolution: selectedStatus === 'cleared' || selectedStatus === 'confirmed' ? resolution : undefined,
    });
  }

  function handleAddNote() {
    if (!noteText.trim()) return;
    updateMutation.mutate({
      note: noteText.trim(),
      noteAuthor: user?.id || 'system',
      noteAuthorName: user?.name || 'System',
    });
    setNoteText('');
  }

  if (!investigation) return null;

  const triggeredRuleLabels = (investigation.triggeredRules || []).map((r) => ({
    ...r,
    label: FRAUD_RULE_LABELS[r.ruleType] || r.ruleType,
  }));

  return (
    <Modal
      open={!!investigation}
      onClose={onClose}
      title={`Investigation: ${investigation.partnerName || investigation.partnerId}`}
      size="full"
    >
      <div className="space-y-4 max-h-[80vh] overflow-y-auto">
        {/* Risk Score Header */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--color-bg-sunken)]">
          <div className={`h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold ${
            investigation.riskScore >= 70 ? 'bg-red-100 text-red-700' :
            investigation.riskScore >= 45 ? 'bg-orange-100 text-orange-700' :
            investigation.riskScore >= 20 ? 'bg-yellow-100 text-yellow-700' :
            'bg-emerald-100 text-emerald-700'
          }`}>
            {investigation.riskScore}
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold">Risk Score: {investigation.riskScore}/100</p>
            <Badge variant={
              investigation.riskLevel === 'critical' ? 'danger' :
              investigation.riskLevel === 'high' ? 'warning' :
              investigation.riskLevel === 'medium' ? 'info' : 'success'
            }>
              {investigation.riskLevel.charAt(0).toUpperCase() + investigation.riskLevel.slice(1)}
            </Badge>
            <div className="flex items-center gap-2 mt-1">
              {statusBadge(investigation.status.replace('_', ' '))}
              {investigation.assignedToName && (
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  Assigned: {investigation.assignedToName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Re-evaluation Results */}
        {reEvaluation && (
          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-800">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">Re-evaluation Results</span>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-2">
              <div className="text-center">
                <p className={`text-lg font-bold ${
                  reEvaluation.riskScore >= 70 ? 'text-red-600' :
                  reEvaluation.riskScore >= 45 ? 'text-orange-600' :
                  reEvaluation.riskScore >= 20 ? 'text-yellow-600' :
                  'text-emerald-600'
                }`}>{reEvaluation.riskScore}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">New Score</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{reEvaluation.triggeredCount}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">Rules Triggered</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{reEvaluation.recommendations.length}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">Recommendations</p>
              </div>
            </div>
            {reEvaluation.recommendations.length > 0 && (
              <ul className="space-y-1">
                {reEvaluation.recommendations.map((rec, i) => (
                  <li key={i} className="text-[10px] text-indigo-700 dark:text-indigo-300 flex items-start gap-1">
                    <span className="mt-0.5">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Triggered Rules */}
        <div className="p-4 rounded-xl border border-[var(--color-border)]">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
            Triggered Rules ({triggeredRuleLabels.length})
          </h3>
          <div className="space-y-2">
            {triggeredRuleLabels.map((rule, i) => (
              <div key={i} className="p-3 rounded-lg bg-[var(--color-bg-sunken)]">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`h-3.5 w-3.5 ${
                    rule.severity === 'critical' || rule.severity === 'high' ? 'text-red-500' : 'text-amber-500'
                  }`} />
                  <span className="text-xs font-semibold">{rule.label}</span>
                  <Badge variant={rule.severity === 'critical' ? 'danger' : rule.severity === 'high' ? 'warning' : 'info'}>
                    {rule.severity}
                  </Badge>
                  <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">+{rule.riskPoints} pts</span>
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{rule.explanation}</p>
                {rule.evidence.length > 0 && rule.evidence.some((e: string) => e !== 'Normal lead submission pattern' && e !== 'Normal commission distribution' && e !== 'Normal withdrawal pattern' && e !== 'Normal settlement success rate' && e !== 'Normal tier change pattern' && e !== 'Normal activity pattern') && (
                  <ul className="mt-1 space-y-0.5">
                    {rule.evidence.filter((e: string) => e !== 'Normal lead submission pattern' && e !== 'Normal commission distribution' && e !== 'Normal withdrawal pattern' && e !== 'Normal settlement success rate' && e !== 'Normal tier change pattern' && e !== 'Normal activity pattern').map((ev: string, j: number) => (
                      <li key={j} className="text-[9px] text-amber-700 dark:text-amber-300 flex items-start gap-1">
                        <span className="mt-0.5">→</span>
                        <span>{ev}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {triggeredRuleLabels.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">No rules triggered.</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Assign Investigator */}
          <div className="p-4 rounded-xl border border-[var(--color-border)]">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
              <UserPlus className="h-3.5 w-3.5 inline mr-1" />
              Assign Investigator
            </h3>
            <div className="flex gap-2">
              <select
                className="flex-1 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
                value={assigneeId}
                onChange={(e) => {
                  const u = adminUsers.find((a: any) => a.id === e.target.value);
                  setAssigneeId(e.target.value);
                  setAssigneeName(u?.name || u?.email || '');
                }}
              >
                <option value="">Select admin...</option>
                {adminUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name || u.email || u.id}</option>
                ))}
              </select>
              <Button size="xs" onClick={handleAssign} loading={updateMutation.isPending} disabled={!assigneeId}>
                Assign
              </Button>
            </div>
          </div>

          {/* Change Status */}
          <div className="p-4 rounded-xl border border-[var(--color-border)]">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
              <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
              Change Status
            </h3>
            <div className="space-y-2">
              <select
                className="w-full text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as InvestigationStatus)}
              >
                <option value="">Select status...</option>
                {STATUS_ACTIONS.map((sa) => (
                  <option key={sa.value} value={sa.value}>{sa.label}</option>
                ))}
              </select>
              {(selectedStatus === 'cleared' || selectedStatus === 'confirmed') && (
                <Textarea
                  placeholder="Resolution details..."
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={2}
                />
              )}
              <Button
                size="xs"
                className="w-full"
                onClick={handleStatusChange}
                loading={updateMutation.isPending}
                disabled={!selectedStatus}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>

        {/* Re-evaluate */}
        <div className="p-4 rounded-xl border border-[var(--color-border)]">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
            <RefreshCw className="h-3.5 w-3.5 inline mr-1" />
            Re-run Analysis
          </h3>
          <p className="text-[10px] text-[var(--color-text-muted)] mb-2">
            Re-evaluate this partner against current fraud rules with latest data.
          </p>
          <Button
            size="xs"
            icon={reEvaluateMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => reEvaluateMutation.mutate()}
            loading={reEvaluateMutation.isPending}
          >
            {reEvaluateMutation.isPending ? 'Analyzing...' : 'Re-run Analysis'}
          </Button>
        </div>

        {/* Investigation Notes */}
        <div className="p-4 rounded-xl border border-[var(--color-border)]">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
            <MessageCircle className="h-3.5 w-3.5 inline mr-1" />
            Investigation Notes
          </h3>
          <div className="space-y-2 max-h-[200px] overflow-y-auto mb-3">
            {investigation.notes && investigation.notes.length > 0 ? (
              [...investigation.notes].reverse().map((note) => (
                <div key={note.id} className="p-2.5 rounded-lg bg-[var(--color-bg-sunken)]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold">{note.createdByName || note.createdBy}</span>
                    <span className="text-[9px] text-[var(--color-text-muted)]">{fmtDate(note.createdAt)}</span>
                  </div>
                  <p className="text-xs">{note.text}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-[var(--color-text-muted)]">No notes yet.</p>
            )}
          </div>
          <div className="flex gap-2">
            <textarea
              className="flex-1 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 resize-none"
              placeholder="Add a note..."
              rows={2}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <Button size="xs" onClick={handleAddNote} loading={updateMutation.isPending} disabled={!noteText.trim()}>
              Add
            </Button>
          </div>
        </div>

        {/* Audit Info */}
        <div className="p-4 rounded-xl border border-[var(--color-border)]">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
            <FileText className="h-3.5 w-3.5 inline mr-1" />
            Audit Information
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-[10px] text-[var(--color-text-muted)]">Created</p>
              <p className="font-semibold">{investigation.createdAt ? fmtDate(investigation.createdAt) : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--color-text-muted)]">Updated</p>
              <p className="font-semibold">{investigation.updatedAt ? fmtDate(investigation.updatedAt) : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--color-text-muted)]">Created By</p>
              <p className="font-semibold">{investigation.createdBy || 'System'}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--color-text-muted)]">Resolved By</p>
              <p className="font-semibold">{investigation.resolvedBy || '—'}</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default FraudInvestigationDrawer;
