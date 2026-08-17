/**
 * CommissionRuleFormModal — Create/Edit Commission Rule modal
 *
 * Single reusable modal for creating and editing commission rules.
 * Dynamic fields appear depending on selected calculation type.
 * Scope selector shows relevant fields per applicability.
 * Includes SlabEditor for slab-type rules and CommissionRulePreview for live preview.
 *
 * Architecture:
 *   - Fields are computed based on rule type and scope (no hardcoded field sets)
 *   - Validation reuses engine's validateCommissionRule (with one extra auto-fix)
 *   - Preview uses engine's calculateCommissionPreview (no duplicated calculation)
 *   - Save calls ChannelPartnerDomainService.createCommissionRule / updateCommissionRule
 */

import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Textarea } from '../ui/Input';
import { useAppStore } from '../../store/useAppStore';
import { ChannelPartnerDomainService } from '../../services/ChannelPartnerDomainService';
import { queryKeys } from '../../lib/queryKeys';
import { validateCommissionRule } from '../../lib/channelPartnerCommissionEngine';
import { logActivity } from '../../lib/workflow';
import { notifyRoleUsers } from '../../lib/notifications';
import { NotificationType } from '../../types';
import type { CommissionRule, CommissionRuleType, CommissionApplicability, CommissionSlab, PartnerTier } from '../../features/channel-partner/types';
import { SlabEditor } from './SlabEditor';
import { CommissionRulePreview } from './CommissionRulePreview';

interface CommissionRuleFormModalProps {
  open: boolean;
  onClose: () => void;
  rule?: CommissionRule | null; // null for create, rule for edit
  onSuccess?: () => void;
}

const RULE_TYPES: { label: string; value: CommissionRuleType }[] = [
  { label: 'Percentage (%)', value: 'percentage' },
  { label: 'Fixed (₹)', value: 'fixed' },
  { label: 'Per kW (₹/kW)', value: 'per_kw' },
  { label: 'Per Deal (₹)', value: 'per_deal' },
  { label: 'Slab (Tiered)', value: 'slab' },
];

const SCOPE_OPTIONS: { label: string; value: CommissionApplicability }[] = [
  { label: 'Default (All)', value: 'all' },
  { label: 'Partner Tier', value: 'partner_tier' },
  { label: 'Product Category', value: 'product_category' },
  { label: 'Location (State)', value: 'location' },
  { label: 'Specific Partner', value: 'partner' },
];

const TIER_OPTIONS: { label: string; value: PartnerTier }[] = [
  { label: 'Bronze', value: 'bronze' },
  { label: 'Silver', value: 'silver' },
  { label: 'Gold', value: 'gold' },
  { label: 'Platinum', value: 'platinum' },
];

const CATEGORY_OPTIONS = [
  { label: 'Residential', value: 'residential' },
  { label: 'Commercial', value: 'commercial' },
  { label: 'Industrial', value: 'industrial' },
];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Delhi',
];

function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

export function CommissionRuleFormModal({ open, onClose, rule, onSuccess }: CommissionRuleFormModalProps) {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const user = useAppStore((s) => s.user);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const queryClient = useQueryClient();
  const isEdit = Boolean(rule);

  // ── Form state ─────────────────────────────────────────
  const [name, setName] = useState(rule?.name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [type, setType] = useState<CommissionRuleType>(rule?.type || 'per_kw');
  const [value, setValue] = useState(rule?.value?.toString() || '');
  const [applicableTo, setApplicableTo] = useState<CommissionApplicability>(rule?.applicableTo || 'all');
  const [partnerTier, setPartnerTier] = useState(rule?.partnerTier || 'silver');
  const [productCategory, setProductCategory] = useState(rule?.productCategoryId || '');
  const [locationState, setLocationState] = useState(rule?.locationStates?.[0] || '');
  const [slabs, setSlabs] = useState<CommissionSlab[]>(rule?.slabs || []);
  const [minAmount, setMinAmount] = useState(rule?.minAmount?.toString() || '');
  const [maxAmount, setMaxAmount] = useState(rule?.maxAmount?.toString() || '');
  const [effectiveFrom, setEffectiveFrom] = useState(rule?.effectiveFrom?.split('T')[0] || todayString());
  const [effectiveTo, setEffectiveTo] = useState(rule?.effectiveTo?.split('T')[0] || '');
  const [priority, setPriority] = useState(rule?.priority?.toString() || '1');
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [showPreview, setShowPreview] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [dealValue, setDealValue] = useState('500000');
  const [systemSizeKW, setSystemSizeKW] = useState('5');

  // ── Build the current rule object for validation/preview ──
  const currentRule = useMemo((): Partial<CommissionRule> => ({
    name: name || 'Unnamed Rule',
    description,
    type,
    isActive,
    value: Number(value) || 0,
    minAmount: minAmount ? Number(minAmount) : undefined,
    maxAmount: maxAmount ? Number(maxAmount) : undefined,
    applicableTo,
    partnerTier: applicableTo === 'partner_tier' ? partnerTier as PartnerTier : undefined,
    productCategoryId: applicableTo === 'product_category' ? productCategory : undefined,
    locationStates: applicableTo === 'location' && locationState ? [locationState] : undefined,
    slabs: type === 'slab' ? slabs : undefined,
    effectiveFrom,
    effectiveTo: effectiveTo || undefined,
    priority: Number(priority) || 1,
  }), [name, description, type, isActive, value, minAmount, maxAmount, applicableTo, partnerTier, productCategory, locationState, slabs, effectiveFrom, effectiveTo, priority]);

  // ── Validation using engine ────────────────────────────
  const engineErrors = useMemo(() => {
    const ruleWithDefaults = { ...currentRule, isActive: true } as CommissionRule;
    return validateCommissionRule(ruleWithDefaults);
  }, [currentRule]);

  // ── Save mutation ──────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      setValidationErrors([]);

      // Basic client-side validation
      const errs: string[] = [];
      if (!name.trim()) errs.push('Rule name is required');
      if (!value || Number(value) <= 0) errs.push('Value must be greater than zero');
      if (type === 'percentage' && Number(value) > 100) errs.push('Percentage cannot exceed 100%');
      if (!effectiveFrom) errs.push('Effective from date is required');

      // Engine validation
      for (const ev of engineErrors) {
        errs.push(ev.message);
      }

      // Slab validation
      if (type === 'slab') {
        if (!slabs || slabs.length === 0) errs.push('At least one slab is required');
      }

      if (errs.length > 0) {
        setValidationErrors(errs);
        throw new Error(errs[0]);
      }

      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        isActive,
        value: Number(value),
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
        applicableTo,
        partnerTier: applicableTo === 'partner_tier' ? partnerTier : undefined,
        productCategoryId: applicableTo === 'product_category' ? productCategory : undefined,
        locationStates: applicableTo === 'location' && locationState ? [locationState] : undefined,
        slabs: type === 'slab' ? slabs : undefined,
        effectiveFrom,
        effectiveTo: effectiveTo || undefined,
        priority: Number(priority) || 1,
        companyId: activeCompanyId,
        updatedBy: user?.id || 'system',
        ...(rule?.id ? {} : { createdBy: user?.id || 'system' }),
      };

      const isUpdate = Boolean(rule?.id);
      if (rule?.id) {
        await ChannelPartnerDomainService.updateCommissionRule(rule.id, payload);
      } else {
        await ChannelPartnerDomainService.createCommissionRule(payload);
      }

      // Activity logging
      const actionLabel = isUpdate ? `Commission rule "${name}" edited` : `Commission rule "${name}" created`;
      await logActivity('Commission Rules', isUpdate ? 'Edited' : 'Created', rule?.id || 'new', {
        entityName: name,
        actionLabel,
        type,
        applicableTo,
        priority: Number(priority) || 1,
      });

      // Notify admins
      void notifyRoleUsers(
        ['Admin'],
        NotificationType.SETTLEMENT_COMPLETED,
        isUpdate ? 'Commission rule updated' : 'Commission rule created',
        `Rule "${name}" has been ${isUpdate ? 'updated' : 'created'}. Type: ${type}, Scope: ${applicableTo}`,
        'commission_rule',
        rule?.id || 'new',
        activeCompanyId,
      ).catch(() => {});
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Commission rule updated' : 'Commission rule created');
      queryClient.invalidateQueries({ queryKey: companyKeys.commissionRules });
      if (onSuccess) onSuccess();
      handleClose();
    },
    onError: (err: any) => {
      if (err?.message && !err.message.includes('is required') && !err.message.includes('greater than') && !err.message.includes('exceed')) {
        toast.error(err?.message || 'Failed to save commission rule');
      }
    },
  });

  function handleClose() {
    setValidationErrors([]);
    onClose();
  }

  const needsValue = type !== 'slab';
  const canPreview = Boolean(name && (type !== 'slab' ? value && Number(value) > 0 : slabs.length > 0));

  return (
    <Modal open={open} onClose={handleClose} title={isEdit ? 'Edit Commission Rule' : 'Create Commission Rule'} size="lg">
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        {/* ── Rule Name ──────────────────────────────────── */}
        <Input
          label="Rule Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Standard Per KW Commission"
          required
        />
        <Textarea
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of when this rule applies..."
          rows={2}
        />

        {/* ── Calculation Type ───────────────────────────── */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
            Calculation Type
          </p>
          <div className="flex flex-wrap gap-2">
            {RULE_TYPES.map((rt) => (
              <button
                key={rt.value}
                type="button"
                onClick={() => { setType(rt.value); if (rt.value !== 'slab') setSlabs([]); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  type === rt.value
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-text)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'
                }`}
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Value / Dynamic fields ─────────────────────── */}
        {type === 'percentage' && (
          <Input
            label="Commission Percentage (%)"
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g., 5"
            required
          />
        )}
        {type === 'fixed' && (
          <Input
            label="Fixed Amount (₹)"
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g., 5000"
            required
          />
        )}
        {type === 'per_kw' && (
          <Input
            label="Rate per kW (₹)"
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g., 500"
            required
          />
        )}
        {type === 'per_deal' && (
          <Input
            label="Amount per Deal (₹)"
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g., 2500"
            required
          />
        )}
        {type === 'slab' && (
          <SlabEditor
            slabs={slabs}
            onChange={setSlabs}
          />
        )}

        {/* ── Scope / Applicability ──────────────────────── */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
            Applicability Scope
          </p>
          <div className="flex flex-wrap gap-2">
            {SCOPE_OPTIONS.map((so) => (
              <button
                key={so.value}
                type="button"
                onClick={() => setApplicableTo(so.value)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  applicableTo === so.value
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-text)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]'
                }`}
              >
                {so.label}
              </button>
            ))}
          </div>

          {/* Scope-specific fields */}
          {applicableTo === 'partner_tier' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {TIER_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPartnerTier(t.value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                    partnerTier === t.value
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {applicableTo === 'product_category' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setProductCategory(c.value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                    productCategory === c.value
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {applicableTo === 'location' && (
            <div className="mt-3">
              <select
                value={locationState}
                onChange={(e) => setLocationState(e.target.value)}
                className="w-full text-xs border border-[var(--color-border)] rounded-lg px-3 py-2 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              >
                <option value="">Select state...</option>
                {INDIAN_STATES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ── Min/Max Caps ───────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Minimum Deal Value (₹)"
            type="number"
            min={0}
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="0 = No minimum"
          />
          <Input
            label="Maximum Cap (₹)"
            type="number"
            min={0}
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="0 = No cap"
          />
        </div>

        {/* ── Effective Dates ────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Effective From"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
          />
          <Input
            label="Effective To (optional)"
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
          />
        </div>

        {/* ── Priority + Active ──────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Priority (higher = preferred)"
            type="number"
            min={0}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
          <div className="flex items-center gap-3 pt-6">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-1 peer-focus:ring-[var(--color-primary)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--color-primary)]"></div>
              <span className="ml-3 text-xs font-medium text-[var(--color-text)]">Active</span>
            </label>
          </div>
        </div>

        {/* ── Preview Toggle ─────────────────────────────── */}
        {canPreview && (
          <div>
            <Button
              variant="outline"
              size="sm"
              icon={showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </Button>

            {showPreview && (
              <div className="mt-3">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <Input label="Deal Value (₹)" type="number" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
                  <Input label="System Size (kW)" type="number" value={systemSizeKW} onChange={(e) => setSystemSizeKW(e.target.value)} />
                </div>
                <CommissionRulePreview
                  rule={currentRule as CommissionRule}
                  dealValue={Number(dealValue) || 0}
                  systemSizeKW={Number(systemSizeKW) || 0}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Validation errors ──────────────────────────── */}
        {(validationErrors.length > 0 || engineErrors.length > 0) && (
          <div className="space-y-1.5">
            {[...new Set([...validationErrors, ...engineErrors.map((e) => e.message)])].map((err, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <span className="text-xs text-red-600 dark:text-red-400">{err}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Actions ────────────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
          <Button variant="outline" onClick={handleClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            icon={<Save className="h-4 w-4" />}
          >
            {isEdit ? 'Update Rule' : 'Create Rule'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default CommissionRuleFormModal;
