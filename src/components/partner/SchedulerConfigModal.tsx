/**
 * SchedulerConfigModal — Auto Settlement Scheduler Configuration
 *
 * Allows admins to configure and preview auto-settlement scheduling.
 * Service-based only — no cron. Execution is manual via Preview → Execute.
 * Reuses existing settlement engine (no duplicated logic).
 */

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Calendar,
  Clock,
  PlayCircle,
  RefreshCw,
  Settings,
  Eye,
  CheckCircle2,
  AlertTriangle,
  History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  loadSchedulerConfig,
  saveSchedulerConfig,
  previewNextRun,
  executeSchedulerRun,
  DEFAULT_SCHEDULER_CONFIG,
  type SchedulerConfig,
  type SettlementMode,
  type PartnerFilterType,
} from '../../lib/autoSettlementScheduler';
import { fmtDate, fmtCurrency } from '../../lib/firestore';
import { SchedulerHistoryModal } from './SchedulerHistoryModal';

interface SchedulerConfigModalProps {
  open: boolean;
  onClose: () => void;
}

export function SchedulerConfigModal({ open, onClose }: SchedulerConfigModalProps) {
  const [config, setConfig] = useState<SchedulerConfig>({ ...DEFAULT_SCHEDULER_CONFIG });
  const [preview, setPreview] = useState<{ eligibleCount: number; eligibleAmount: number; partnersInvolved: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  // Load config on open
  useEffect(() => {
    if (open) {
      setLoading(true);
      loadSchedulerConfig().then((cfg) => {
        setConfig(cfg);
        setLoading(false);
      }).catch(() => {
        setLoading(false);
      });
    }
  }, [open]);

  // Preview
  const previewMutation = useMutation({
    mutationFn: async () => {
      return previewNextRun(config);
    },
    onSuccess: (data) => {
      setPreview(data);
      toast.success(`Preview: ${data.eligibleCount} eligible commissions found`);
    },
    onError: (err: any) => toast.error(err?.message || 'Preview failed'),
  });

  // Save config
  const saveMutation = useMutation({
    mutationFn: async () => saveSchedulerConfig(config),
    onSuccess: () => toast.success('Scheduler configuration saved'),
    onError: (err: any) => toast.error(err?.message || 'Failed to save'),
  });

  // Execute run
  const executeMutation = useMutation({
    mutationFn: async () => executeSchedulerRun(config),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Run complete: ${result.batchesCreated} batches, ₹${result.totalSettled.toLocaleString('en-IN')} settled`);
      } else {
        toast.error(`Run completed with ${result.errors.length} error(s)`);
      }
    },
    onError: (err: any) => toast.error(err?.message || 'Execution failed'),
  });

  const running = previewMutation.isPending || executeMutation.isPending;

  function update<K extends keyof SchedulerConfig>(key: K, value: SchedulerConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }));
    setPreview(null);
  }

  if (loading) {
    return (
      <Modal open={open} onClose={onClose} size="md">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" />
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--color-text)]">Auto Settlement Scheduler</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Configure automatic settlement of partner commissions</p>
          </div>
        </div>

        {/* Status */}
        {config.lastRunAt && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-sunken)] rounded-xl px-3 py-2">
            <Clock className="h-3.5 w-3.5" />
            Last run: {fmtDate(config.lastRunAt)} · {config.totalRuns} run(s) · ₹{config.totalSettledAmount.toLocaleString('en-IN')} settled
          </div>
        )}

        {/* Configuration */}
        <div className="space-y-4">
          {/* Enabled toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-border)] text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <span className="text-sm font-semibold text-[var(--color-text)]">Enable Auto Settlement</span>
              <p className="text-[10px] text-[var(--color-text-muted)]">When enabled, settlement runs can be triggered manually or automatically</p>
            </div>
          </label>

          {/* Settlement Day */}
          <div>
            <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">Settlement Day (1–28)</label>
            <input
              type="number"
              min={1}
              max={28}
              value={config.settlementDay}
              onChange={(e) => update('settlementDay', Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
              disabled={!config.enabled}
              className="w-20 text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)] disabled:opacity-50"
            />
          </div>

          {/* Settlement Mode */}
          <div>
            <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">Settlement Mode</label>
            <select
              value={config.mode}
              onChange={(e) => update('mode', e.target.value as SettlementMode)}
              disabled={!config.enabled}
              className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)] disabled:opacity-50"
            >
              <option value="manual">Manual (button-triggered)</option>
              <option value="automatic">Automatic (runs on settlement day)</option>
            </select>
          </div>

          {/* Partner Filter */}
          <div>
            <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">Partner Filter</label>
            <select
              value={config.partnerFilter}
              onChange={(e) => update('partnerFilter', e.target.value as PartnerFilterType)}
              disabled={!config.enabled}
              className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)] disabled:opacity-50"
            >
              <option value="all">All Partners</option>
              <option value="tier">By Tier</option>
              <option value="location">By Location</option>
            </select>
          </div>

          {/* Tier/Location conditional fields */}
          {config.partnerFilter === 'tier' && (
            <div>
              <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">Partner Tier</label>
              <select
                value={config.partnerTier || 'bronze'}
                onChange={(e) => update('partnerTier', e.target.value)}
                disabled={!config.enabled}
                className="text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)] disabled:opacity-50"
              >
                <option value="bronze">Bronze</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="platinum">Platinum</option>
              </select>
            </div>
          )}

          {config.partnerFilter === 'location' && (
            <div>
              <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">Location/State</label>
              <input
                type="text"
                value={config.locationState || ''}
                onChange={(e) => update('locationState', e.target.value)}
                disabled={!config.enabled}
                placeholder="e.g., Maharashtra"
                className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)] disabled:opacity-50"
              />
            </div>
          )}

          {/* Minimum Commission */}
          <div>
            <label className="block text-[10px] font-semibold uppercase text-[var(--color-text-muted)] mb-1">Minimum Commission Amount (₹)</label>
            <input
              type="number"
              min={0}
              value={config.minCommissionAmount}
              onChange={(e) => update('minCommissionAmount', Math.max(0, Number(e.target.value) || 0))}
              disabled={!config.enabled}
              className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-1.5 bg-[var(--color-bg-elevated)] text-[var(--color-text)] disabled:opacity-50"
            />
          </div>

          {/* Include Pending */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includePending}
              onChange={(e) => update('includePending', e.target.checked)}
              disabled={!config.enabled}
              className="h-4 w-4 rounded border-[var(--color-border)] text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
            <div>
              <span className="text-sm font-semibold text-[var(--color-text)]">Include Pending Commissions</span>
              <p className="text-[10px] text-[var(--color-text-muted)]">When enabled, approved + pending commissions are included</p>
            </div>
          </label>
        </div>

        {/* Preview results */}
        {preview !== null && (
          <div className="grid grid-cols-3 gap-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
            <div className="text-center">
              <p className="text-lg font-bold text-indigo-600">{preview.eligibleCount}</p>
              <p className="text-[10px] font-medium text-indigo-700">Eligible Commissions</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-indigo-600">{fmtCurrency(preview.eligibleAmount)}</p>
              <p className="text-[10px] font-medium text-indigo-700">Total Amount</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-indigo-600">{preview.partnersInvolved}</p>
              <p className="text-[10px] font-medium text-indigo-700">Partners</p>
            </div>
          </div>
        )}

        {/* Error summary */}
        {executeMutation.data && executeMutation.data.errors.length > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-bold text-red-700">Errors ({executeMutation.data.errors.length})</span>
            </div>
            <ul className="text-[10px] text-red-600 space-y-0.5">
              {executeMutation.data.errors.slice(0, 3).map((err: string, i: number) => (
                <li key={i}>{err}</li>
              ))}
              {executeMutation.data.errors.length > 3 && (
                <li className="text-red-400">...and {executeMutation.data.errors.length - 3} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Success summary */}
        {executeMutation.data && executeMutation.data.batchesCreated > 0 && executeMutation.data.errors.length === 0 && (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <div>
              <p className="text-sm font-bold text-emerald-700">Run completed successfully</p>
              <p className="text-xs text-emerald-600">
                {executeMutation.data.batchesCreated} batches processed, ₹{executeMutation.data.totalSettled.toLocaleString('en-IN')} settled
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)]">
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<History className="h-3.5 w-3.5" />}
              onClick={() => setShowHistory(true)}
            >
              History
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Eye className="h-3.5 w-3.5" />}
              onClick={() => previewMutation.mutate()}
              loading={previewMutation.isPending}
              disabled={!config.enabled}
            >
              Preview Next Run
            </Button>
            <Button
              size="sm"
              icon={<Settings className="h-3.5 w-3.5" />}
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
            >
              Save Config
            </Button>
            <Button
              size="sm"
              icon={<PlayCircle className="h-3.5 w-3.5" />}
              onClick={() => executeMutation.mutate()}
              loading={executeMutation.isPending}
              disabled={!config.enabled}
              variant={config.enabled ? 'primary' : 'outline'}
            >
              Execute Now
            </Button>
          </div>
        </div>
      </div>

      {/* ── Scheduler History Modal ───────────────────────── */}
      <SchedulerHistoryModal
        open={showHistory}
        onClose={() => setShowHistory(false)}
      />
    </Modal>
  );
}

export default SchedulerConfigModal;
