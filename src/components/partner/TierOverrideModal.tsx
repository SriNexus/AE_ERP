/**
 * TierOverrideModal — Manual tier override dialog
 *
 * Allows admin to manually set a partner's tier with a reason.
 * Records the override in immutable tier history.
 */

import { useState, useEffect } from 'react';
import {
  Shield,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { manualTierOverride } from '../../lib/tierEvaluation';
import { TIER_LABELS, TIER_COLORS } from '../../lib/tierRules';
import type { PartnerTier, ChannelPartner } from '../../features/channel-partner/types';
import toast from 'react-hot-toast';

interface TierOverrideModalProps {
  open: boolean;
  onClose: () => void;
  partner: ChannelPartner | null;
  onApplied: () => void;
}

const TIER_OPTIONS: PartnerTier[] = ['bronze', 'silver', 'gold', 'platinum'];

export function TierOverrideModal({ open, onClose, partner, onApplied }: TierOverrideModalProps) {
  const [selectedTier, setSelectedTier] = useState<PartnerTier>('bronze');

  useEffect(() => {
    if (partner) setSelectedTier(partner.tier || 'bronze');
  }, [partner]);
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  if (!partner) return null;
  const p = partner;

  const currentTier = p.tier || 'bronze';
  const isSame = selectedTier === currentTier;
  const canSave = reason.trim().length >= 5 && !isSame;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await manualTierOverride(p.id, selectedTier, reason.trim(), { effectiveDate: effectiveDate ? new Date(effectiveDate).toISOString() : undefined });
      toast.success(`${p.firmName || p.contactPerson} tier overridden to ${TIER_LABELS[selectedTier]}`);
      onApplied();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to override tier');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="space-y-4 text-sm">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-500" />
          <span className="font-semibold text-[var(--color-text)]">Manual Tier Override</span>
        </div>

        {/* Partner info */}
        <div className="bg-[var(--color-bg-sunken)] rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold">{partner.firmName || partner.contactPerson}</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--color-text-muted)]">Current:</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TIER_COLORS[currentTier] || 'bg-gray-100 text-gray-600'}`}>
              {TIER_LABELS[currentTier]}
            </span>
          </div>
        </div>

        {/* Tier selection */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-muted)] mb-2 block">New Tier</label>
          <div className="grid grid-cols-2 gap-2">
            {TIER_OPTIONS.map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setSelectedTier(tier)}
                disabled={tier === currentTier}
                className={`p-3 rounded-lg text-center border transition-all ${
                  selectedTier === tier
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-2 ring-indigo-500/30'
                    : tier === currentTier
                    ? 'border-[var(--color-border)] opacity-50 cursor-not-allowed'
                    : 'border-[var(--color-border)] hover:border-indigo-300 hover:bg-indigo-50/50'
                }`}
              >
                <p className={`text-sm font-bold ${{
                  bronze: 'text-amber-600',
                  silver: 'text-gray-600',
                  gold: 'text-yellow-600',
                  platinum: 'text-indigo-600',
                }[tier]}`}>
                  {TIER_LABELS[tier]}
                </p>
              </button>
            ))}
          </div>
          {isSame && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1.5">
              <AlertTriangle className="h-3 w-3" />
              Select a different tier than the current one
            </p>
          )}
        </div>

        {/* Reason */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this override is necessary..."
            rows={3}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-indigo-500/40 resize-none"
          />
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
            {reason.length < 5 ? 'Minimum 5 characters' : `${reason.length} characters`}
          </p>
        </div>

        {/* Effective Date */}
        <div>
          <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">
            Effective Date
          </label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)]">
          <span className="text-[10px] text-[var(--color-text-muted)]">
            Override will be recorded as manual change
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || saving}
              loading={saving}
              icon={saving ? undefined : <CheckCircle2 className="h-3.5 w-3.5" />}
            >
              {saving ? 'Saving...' : `Override to ${TIER_LABELS[selectedTier]}`}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default TierOverrideModal;
