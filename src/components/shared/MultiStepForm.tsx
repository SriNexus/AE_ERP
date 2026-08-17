import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { ChevronLeft, ChevronRight, CircleCheckBig } from 'lucide-react';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../../utils/cn';

export interface MultiStepFormStep {
  id: string;
  title: string;
  description?: string;
  optional?: boolean;
  content: ReactNode;
}

export interface MultiStepFormState {
  activeIndex: number;
  activeStep: MultiStepFormStep | null;
  completedCount: number;
  progressPercent: number;
}

export function resolveMultiStepFormState(steps: MultiStepFormStep[], activeStepId?: string): MultiStepFormState {
  const activeIndex = activeStepId ? steps.findIndex((step) => step.id === activeStepId) : 0;
  const resolvedIndex = activeIndex >= 0 ? activeIndex : 0;
  return {
    activeIndex: resolvedIndex,
    activeStep: steps[resolvedIndex] ?? null,
    completedCount: Math.max(0, resolvedIndex),
    progressPercent: steps.length ? Math.round((Math.max(0, resolvedIndex) / steps.length) * 100) : 0,
  };
}

export interface MultiStepFormProps {
  steps: MultiStepFormStep[];
  title?: string;
  subtitle?: string;
  activeStepId?: string;
  defaultStepId?: string;
  loading?: boolean;
  className?: string;
  onStepChange?: (stepId: string) => void;
  onCancel?: () => void;
  onSubmit?: () => void | Promise<void>;
  submitLabel?: string;
  cancelLabel?: string;
  footer?: ReactNode;
}

export function MultiStepForm({
  steps,
  title,
  subtitle,
  activeStepId,
  defaultStepId,
  loading = false,
  className,
  onStepChange,
  onCancel,
  onSubmit,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  footer,
}: MultiStepFormProps) {
  const defaultIndex = useMemo(() => {
    if (!defaultStepId) return 0;
    const index = steps.findIndex((step) => step.id === defaultStepId);
    return index >= 0 ? index : 0;
  }, [defaultStepId, steps]);
  const [internalStepId, setInternalStepId] = useState<string | undefined>(steps[defaultIndex]?.id);

  const resolved = resolveMultiStepFormState(steps, activeStepId ?? internalStepId);
  const activeStep = resolved.activeStep;
  const isControlled = Boolean(activeStepId);

  function changeStep(stepId: string) {
    if (!isControlled) {
      setInternalStepId(stepId);
    }
    onStepChange?.(stepId);
  }

  function goNext() {
    const next = steps[resolved.activeIndex + 1];
    if (next) changeStep(next.id);
  }

  function goPrev() {
    const prev = steps[resolved.activeIndex - 1];
    if (prev) changeStep(prev.id);
  }

  return (
    <Card className={cn('p-4', className)}>
      {(title || subtitle) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
          </div>
          <Badge variant="info">{resolved.progressPercent}%</Badge>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {steps.map((step, index) => {
          const active = index === resolved.activeIndex;
          const done = index < resolved.activeIndex;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => changeStep(step.id)}
              className={cn(
                'inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition',
                active
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-text)]'
                  : done
                    ? 'border-[var(--color-success)] bg-[var(--color-success-light)] text-[var(--color-success-text)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]'
              )}
            >
              {done ? <CircleCheckBig className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-current" />}
              <span className="truncate">{step.title}</span>
              {step.optional && <span className="text-[10px] uppercase tracking-wide">Optional</span>}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4">
        {activeStep?.description && <p className="mb-3 text-xs text-[var(--color-text-muted)]">{activeStep.description}</p>}
        <div>{activeStep?.content}</div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[var(--color-text-muted)]">
          Step {resolved.activeIndex + 1} of {steps.length}
        </div>
        <div className="flex flex-wrap gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </Button>
          )}
          <Button type="button" variant="outline" icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={goPrev} disabled={resolved.activeIndex === 0 || loading}>
            Back
          </Button>
          {resolved.activeIndex < steps.length - 1 ? (
            <Button type="button" icon={<ChevronRight className="h-3.5 w-3.5" />} onClick={goNext} disabled={loading}>
              Next
            </Button>
          ) : (
            <Button type="button" onClick={onSubmit} loading={loading}>
              {submitLabel}
            </Button>
          )}
        </div>
      </div>

      {footer && <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">{footer}</div>}
    </Card>
  );
}

