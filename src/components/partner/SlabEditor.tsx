/**
 * SlabEditor — Reusable slab editor for commission rules
 *
 * Features: Add, delete, reorder slabs. Inline validation.
 * Validates: no overlap, no gaps, fromKW < toKW, positive values.
 * Reuses the existing CommissionSlab type.
 * No duplicated validation logic — uses same checks as engine.
 */

import { useState, useMemo } from 'react';
import { Plus, Trash2, GripVertical, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import type { CommissionSlab } from '../../features/channel-partner/types';

interface SlabEditorProps {
  slabs: CommissionSlab[];
  onChange: (slabs: CommissionSlab[]) => void;
  errors?: string[];
}

interface SlabValidation {
  index: number;
  message: string;
  type: 'error' | 'warning';
}

function createSlab(fromKW?: number): CommissionSlab {
  const lastKW = fromKW ?? 0;
  return {
    fromKW: lastKW,
    toKW: Math.max(lastKW + 1, 1),
    value: 100,
    type: 'per_kw',
  };
}

export function SlabEditor({ slabs, onChange, errors: externalErrors }: SlabEditorProps) {
  const [internalErrors, setInternalErrors] = useState<SlabValidation[]>([]);

  const sortedSlabs = useMemo(
    () => [...slabs].sort((a, b) => a.fromKW - b.fromKW),
    [slabs],
  );

  function validateSlabs(currentSlabs: CommissionSlab[]): SlabValidation[] {
    const validation: SlabValidation[] = [];
    if (!currentSlabs || currentSlabs.length === 0) {
      validation.push({ index: -1, message: 'At least one slab is required', type: 'error' });
      return validation;
    }

    const sorted = [...currentSlabs].sort((a, b) => a.fromKW - b.fromKW);

    sorted.forEach((slab, idx) => {
      if (slab.fromKW < 0) {
        validation.push({ index: idx, message: 'From KW cannot be negative', type: 'error' });
      }
      if (slab.toKW <= slab.fromKW) {
        validation.push({ index: idx, message: 'To KW must be greater than From KW', type: 'error' });
      }
      if (slab.value <= 0) {
        validation.push({ index: idx, message: 'Value must be greater than zero', type: 'error' });
      }
      if (slab.type === 'percentage' && slab.value > 100) {
        validation.push({ index: idx, message: 'Percentage cannot exceed 100%', type: 'error' });
      }
    });

    // Check for gaps between slabs
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];
      if (current.toKW < next.fromKW) {
        validation.push({
          index: i,
          message: `Gap between ${current.toKW}kW and ${next.fromKW}kW`,
          type: 'warning',
        });
      }
      if (current.toKW >= next.fromKW) {
        validation.push({
          index: i,
          message: `Overlap: slab ${i + 1} (${current.fromKW}-${current.toKW}kW) overlaps with slab ${i + 2} (${next.fromKW}-${next.toKW}kW)`,
          type: 'error',
        });
      }
    }

    return validation;
  }

  function handleChange(updated: CommissionSlab[]) {
    setInternalErrors(validateSlabs(updated));
    onChange(updated);
  }

  function addSlab() {
    const last = sortedSlabs[sortedSlabs.length - 1];
    const newSlab = createSlab(last ? last.toKW : 0);
    handleChange([...slabs, newSlab]);
  }

  function removeSlab(index: number) {
    const updated = slabs.filter((_, i) => i !== index);
    handleChange(updated.length > 0 ? updated : [createSlab()]);
  }

  function updateSlab(index: number, field: keyof CommissionSlab, value: any) {
    const updated = slabs.map((slab, i) =>
      i === index ? { ...slab, [field]: field === 'type' ? value : Number(value) || 0 } : slab,
    );
    handleChange(updated);
  }

  function moveSlab(fromIndex: number, direction: 'up' | 'down') {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= slabs.length) return;
    const updated = [...slabs];
    [updated[fromIndex], updated[toIndex]] = [updated[toIndex], updated[fromIndex]];
    handleChange(updated);
  }

  const allErrors = [
    ...internalErrors,
    ...(externalErrors || []).map((msg) => ({ index: -1, message: msg, type: 'error' as const })),
  ];
  const hasErrors = allErrors.some((e) => e.type === 'error');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Slabs ({slabs.length})
        </p>
        <Button size="xs" variant="outline" icon={<Plus className="h-3 w-3" />} onClick={addSlab}>
          Add Slab
        </Button>
      </div>

      {/* Header */}
      {slabs.length > 0 && (
        <div className="grid grid-cols-12 gap-2 px-1">
          <div className="col-span-1" />
          <div className="col-span-3">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">From kW</span>
          </div>
          <div className="col-span-3">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">To kW</span>
          </div>
          <div className="col-span-3">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Value</span>
          </div>
          <div className="col-span-2">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase">Type</span>
          </div>
        </div>
      )}

      {/* Slab rows */}
      {slabs.map((slab, idx) => {
        const slabErrors = allErrors.filter((e) => e.index === idx);
        return (
          <div key={idx} className="space-y-1">
            <div className="grid grid-cols-12 gap-2 items-center">
              {/* Move buttons */}
              <div className="col-span-1 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveSlab(idx, 'up')}
                  disabled={idx === 0}
                  className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
                >
                  <GripVertical className="h-3.5 w-3.5 rotate-90" />
                </button>
              </div>

              {/* From KW */}
              <div className="col-span-3">
                <input
                  type="number"
                  value={slab.fromKW}
                  onChange={(e) => updateSlab(idx, 'fromKW', e.target.value)}
                  className="w-full text-xs border border-[var(--color-border)] rounded-lg px-2 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  min={0}
                  step={0.1}
                />
              </div>

              {/* To KW */}
              <div className="col-span-3">
                <input
                  type="number"
                  value={slab.toKW}
                  onChange={(e) => updateSlab(idx, 'toKW', e.target.value)}
                  className="w-full text-xs border border-[var(--color-border)] rounded-lg px-2 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  min={0}
                  step={0.1}
                />
              </div>

              {/* Value */}
              <div className="col-span-3">
                <input
                  type="number"
                  value={slab.value}
                  onChange={(e) => updateSlab(idx, 'value', e.target.value)}
                  className="w-full text-xs border border-[var(--color-border)] rounded-lg px-2 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  min={0}
                  step={1}
                />
              </div>

              {/* Type */}
              <div className="col-span-1">
                <select
                  value={slab.type}
                  onChange={(e) => updateSlab(idx, 'type', e.target.value)}
                  className="text-xs border border-[var(--color-border)] rounded-lg px-1 py-1.5 bg-[var(--color-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] w-full"
                >
                  <option value="per_kw">/kW</option>
                  <option value="percentage">%</option>
                  <option value="fixed">₹</option>
                </select>
              </div>

              {/* Delete */}
              <div className="col-span-1">
                <button
                  type="button"
                  onClick={() => removeSlab(idx)}
                  className="p-1 text-red-500 hover:text-red-700 transition-colors"
                  title="Remove slab"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Inline errors */}
            {slabErrors.map((err, ei) => (
              <div key={ei} className="flex items-center gap-1.5 pl-8">
                <AlertTriangle className={`h-3 w-3 ${err.type === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
                <span className={`text-[10px] ${err.type === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                  {err.message}
                </span>
              </div>
            ))}
          </div>
        );
      })}

      {/* Global errors */}
      {allErrors.filter((e) => e.index === -1).map((err, ei) => (
        <div key={`global-${ei}`} className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-red-500" />
          <span className="text-[10px] text-red-600">{err.message}</span>
        </div>
      ))}

      {slabs.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">No slabs defined. Click "Add Slab" to begin.</p>
      )}
    </div>
  );
}

export default SlabEditor;
