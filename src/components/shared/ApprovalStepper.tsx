import { useMemo, useState } from 'react';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Input';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';

export type ApprovalStepStatus = 'draft' | 'pending' | 'in_review' | 'approved' | 'rejected' | 'changes_requested' | 'skipped';

export interface ApprovalStep {
  id: string;
  title: string;
  status?: ApprovalStepStatus;
  description?: string;
  note?: string;
  reviewer?: string;
  reviewedAt?: string;
}

export interface ApprovalStepperSnapshot {
  activeIndex: number;
  completedCount: number;
  activeStep?: ApprovalStep;
}

export function resolveApprovalStepperState(steps: ApprovalStep[], activeStepId?: string): ApprovalStepperSnapshot {
  const activeIndex = activeStepId ? steps.findIndex((step) => step.id === activeStepId) : steps.findIndex((step) => step.status === 'pending' || step.status === 'in_review' || step.status === 'draft');
  const normalizedActiveIndex = activeIndex >= 0 ? activeIndex : Math.max(0, steps.length - 1);
  return {
    activeIndex: normalizedActiveIndex,
    completedCount: steps.filter((step, index) => index < normalizedActiveIndex && (step.status === 'approved' || step.status === 'skipped')).length,
    activeStep: steps[normalizedActiveIndex],
  };
}

function statusVariant(status?: ApprovalStepStatus) {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'changes_requested':
      return 'warning';
    case 'in_review':
      return 'info';
    case 'skipped':
      return 'gray';
    case 'pending':
    case 'draft':
    default:
      return 'default';
  }
}

export interface ApprovalStepperProps {
  steps: ApprovalStep[];
  activeStepId?: string;
  title?: string;
  loading?: boolean;
  allowComment?: boolean;
  onApprove?: (step: ApprovalStep, comment: string) => void | Promise<void>;
  onReject?: (step: ApprovalStep, comment: string) => void | Promise<void>;
  onComment?: (step: ApprovalStep, comment: string) => void | Promise<void>;
  className?: string;
}

export function ApprovalStepper({
  steps,
  activeStepId,
  title = 'Approval Steps',
  loading = false,
  allowComment = true,
  onApprove,
  onReject,
  onComment,
  className,
}: ApprovalStepperProps) {
  const [comment, setComment] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const snapshot = useMemo(() => resolveApprovalStepperState(steps, activeStepId), [activeStepId, steps]);
  const activeStep = snapshot.activeStep;

  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{snapshot.completedCount} of {steps.length} completed</p>
        </div>
        <Badge variant="info">{activeStep?.status || 'pending'}</Badge>
      </div>

      <div className="mt-4 space-y-3" role="list" aria-label={title}>
        {steps.map((step, index) => (
          <div
            key={step.id}
            role="listitem"
            aria-current={index === snapshot.activeIndex ? 'step' : undefined}
            className={cn(
              'rounded-2xl border px-4 py-3',
              index === snapshot.activeIndex
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]/30'
                : 'border-[var(--color-border)] bg-[var(--color-surface)]'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">{step.title}</p>
                {step.description && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{step.description}</p>}
              </div>
              <Badge variant={statusVariant(step.status)}>{step.status || 'draft'}</Badge>
            </div>
            {step.note && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{step.note}</p>}
          </div>
        ))}
      </div>

      {activeStep && (onApprove || onReject || onComment) && (
        <div className="mt-4 space-y-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Current Step</p>
              <p className="text-xs text-[var(--color-text-muted)]">{activeStep.title}</p>
            </div>
            <Badge variant={statusVariant(activeStep.status)}>{activeStep.status || 'draft'}</Badge>
          </div>

          {allowComment && (
            <Textarea
              label="Comment"
              placeholder="Add approval notes or rejection reason"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {onComment && (
              <Button
                type="button"
                variant="outline"
                loading={loading}
                onClick={() => onComment(activeStep, comment)}
              >
                Save Comment
              </Button>
            )}
            {onReject && (
              <Button
                type="button"
                variant="danger"
                loading={loading}
                onClick={() => {
                  setRejectionReason(comment);
                  setRejectOpen(true);
                }}
              >
                Reject
              </Button>
            )}
            {onApprove && (
              <Button
                type="button"
                variant="success"
                loading={loading}
                onClick={() => onApprove(activeStep, comment)}
              >
                Approve
              </Button>
            )}
          </div>
        </div>
      )}

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject ${activeStep?.title || 'approval step'}`}
        size="sm"
      >
        <div className="space-y-4">
          <Textarea
            label="Rejection reason"
            placeholder="Explain why this step is being rejected"
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={loading}
              disabled={!rejectionReason.trim()}
              onClick={async () => {
                if (!activeStep || !onReject || !rejectionReason.trim()) return;
                await onReject(activeStep, rejectionReason.trim());
                setRejectOpen(false);
                setRejectionReason('');
              }}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
