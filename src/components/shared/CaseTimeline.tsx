/**
 * CaseTimeline — Stage progression timeline for Case entities (Phase 0F)
 *
 * Uses CaseEngine for stage data and StageTimeline for rendering.
 * Features:
 * - Stage progression visualization (from CASE_STAGE_ORDER)
 * - QC → Installation rollback visibility
 * - Completion markers with check indicators
 * - Timeline badges (completed/current/upcoming)
 * - Current stage highlighting
 * - Estimated completion calculation
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Clock } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import {
  CASE_STAGE_ORDER,
  getStageIndex,
} from '../../engines/CaseEngine';
import { getOne } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { StageTimeline, resolveStageTimelineItems } from './StageTimeline';
import type { CaseStage } from '../../engines/CaseEngine';
import type { CaseRecord } from '../../types';
import type { StageTimelineItem } from './StageTimeline';

// ── Types ──────────────────────────────────────────────────

export interface CaseTimelineProps {
  caseId: string;
  companyId: string;
  caseRecord?: CaseRecord | null;
  stageHistory?: CaseRecord['stageHistory'];
  currentStage?: CaseStage;
  compact?: boolean;
  onStageClick?: (stage: CaseStage) => void;
  className?: string;
}

interface EstimatedCompletion {
  stage: string;
  estimatedDate: string;
  confidence: 'high' | 'medium' | 'low';
}

// ── Constants ──────────────────────────────────────────────

const STAGE_LABELS: Record<CaseStage, string> = {
  New: 'New', Survey: 'Site Survey', Engineering: 'Engineering Design',
  Quotation: 'Quotation', Order: 'Sales Order', Procurement: 'Procurement',
  Dispatch: 'Dispatch', Installation: 'Installation', QC: 'Quality Check',
  Commissioning: 'Commissioning', NetMetering: 'Net Metering',
  Subsidy: 'Subsidy Application', Handover: 'Project Handover',
  AMC: 'AMC Contract', Service: 'Service / Maintenance', Closure: 'Case Closure',
};

const STAGE_DESCRIPTIONS: Record<CaseStage, string> = {
  New: 'Case created and initialized', Survey: 'Site survey scheduled or completed',
  Engineering: 'System design and engineering', Quotation: 'Quotation prepared and sent',
  Order: 'Sales order confirmed', Procurement: 'Materials and equipment procurement',
  Dispatch: 'Materials dispatched to site', Installation: 'System installation in progress',
  QC: 'Quality check inspection', Commissioning: 'System commissioning and testing',
  NetMetering: 'Net metering application process', Subsidy: 'Subsidy application process',
  Handover: 'Project handover to customer', AMC: 'Annual maintenance contract active',
  Service: 'Service and maintenance phase', Closure: 'Case closed',
};

// ── Helpers ────────────────────────────────────────────────

function formatRelativeDays(isoDate: string): string {
  const diffDays = Math.round((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 0) return `${diffDays} days ago`;
  return `In ${Math.abs(diffDays)} days`;
}

function estimateCompletion(
  currentStage: CaseStage,
  stageHistory: CaseRecord['stageHistory'],
): EstimatedCompletion | null {
  if (!stageHistory || stageHistory.length < 2) return null;

  const sorted = [...stageHistory].sort(
    (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
  );
  if (sorted.length < 2) return null;

  let totalDays = 0;
  let transitions = 0;
  for (let i = 1; i < sorted.length; i++) {
    const days = (new Date(sorted[i].changedAt).getTime() - new Date(sorted[i - 1].changedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (days > 0 && days < 365) { totalDays += days; transitions++; }
  }
  if (transitions === 0) return null;

  const avgDaysPerStage = totalDays / transitions;
  const currentIdx = getStageIndex(currentStage);
  const remainingStages = CASE_STAGE_ORDER.length - 1 - currentIdx;
  if (remainingStages <= 0) return null;

  const estimatedDays = Math.round(avgDaysPerStage * remainingStages);
  const estimatedDate = new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000);
  return {
    stage: CASE_STAGE_ORDER[CASE_STAGE_ORDER.length - 1],
    estimatedDate: estimatedDate.toISOString().split('T')[0],
    confidence: transitions >= 3 ? 'high' : transitions >= 1 ? 'medium' : 'low',
  };
}

// ── Component ──────────────────────────────────────────────

export function CaseTimeline({
  caseId,
  companyId,
  caseRecord: propCaseRecord,
  stageHistory: propStageHistory,
  currentStage: propCurrentStage,
  compact = false,
  onStageClick,
  className,
}: CaseTimelineProps) {
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(propCaseRecord ?? null);
  const [loading, setLoading] = useState(!propCaseRecord);

  useEffect(() => {
    if (propCaseRecord) { setCaseRecord(propCaseRecord); setLoading(false); return; }
    if (!caseId || !companyId) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const record = await getOne<CaseRecord>(COLLECTIONS.CASES, caseId);
        if (!cancelled) { setCaseRecord(record); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [caseId, companyId, propCaseRecord]);

  const currentStage = propCurrentStage ?? (caseRecord?.currentStage as CaseStage) ?? 'New';
  const stageHistory = propStageHistory ?? caseRecord?.stageHistory ?? [];
  const caseStatus = caseRecord?.status ?? 'Active';

  const completedStages = useMemo(() => {
    const completed = new Set<CaseStage>();
    for (const entry of stageHistory) completed.add(entry.stage as CaseStage);
    return completed;
  }, [stageHistory]);

  const timelineItems: StageTimelineItem[] = useMemo(() => {
    const stageHistoryMap = new Map<string, string>();
    for (const entry of stageHistory) stageHistoryMap.set(entry.stage, entry.changedAt);

    return CASE_STAGE_ORDER.map((stage) => {
      const isCompleted = completedStages.has(stage);
      const isCurrent = stage === currentStage;
      const changedAt = stageHistoryMap.get(stage);

      let status: 'completed' | 'current' | 'upcoming' | 'blocked' | 'attention';
      if (isCurrent && caseStatus === 'Active') status = 'current';
      else if (isCompleted) status = 'completed';
      else if (caseStatus === 'Completed' || caseStatus === 'Archived')
        status = completedStages.has(stage) ? 'completed' : 'upcoming';
      else status = 'upcoming';

      const isQC = stage === 'QC';
      const isInstallation = stage === 'Installation';
      const hasQCFailRollback = isInstallation && completedStages.has('QC') && !completedStages.has('Installation');

      return {
        id: stage,
        title: STAGE_LABELS[stage],
        description: hasQCFailRollback ? 'QC failed — returned for rework'
          : changedAt ? formatRelativeDays(changedAt) : STAGE_DESCRIPTIONS[stage],
        status: hasQCFailRollback ? 'attention' : status,
        badge: isQC && completedStages.has('QC') && completedStages.has('Installation')
          ? <Badge variant="warning">QC Passed</Badge>
          : isQC && completedStages.has('QC') ? <Badge variant="success">QC Passed</Badge>
          : isCurrent ? <Badge variant="info">Current</Badge> : undefined,
        disabled: status === 'upcoming' || status === 'completed',
        onClick: () => onStageClick?.(stage),
      };
    });
  }, [currentStage, completedStages, stageHistory, caseStatus, onStageClick]);

  const { completedCount } = useMemo(
    () => resolveStageTimelineItems(timelineItems, currentStage),
    [timelineItems, currentStage],
  );

  const progressPercent = CASE_STAGE_ORDER.length > 0
    ? Math.round((completedCount / CASE_STAGE_ORDER.length) * 100) : 0;

  const estimatedCompletion = useMemo(
    () => estimateCompletion(currentStage, stageHistory),
    [currentStage, stageHistory],
  );

  if (loading) {
    return (
      <Card className={cn('p-4 animate-pulse', className)}>
        <div className="space-y-3">
          <div className="h-5 w-40 bg-[var(--color-bg-sunken)] rounded" />
          <div className="h-2 w-full bg-[var(--color-bg-sunken)] rounded" />
          <div className="flex gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 w-28 bg-[var(--color-bg-sunken)] rounded-xl" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!caseRecord && !propCaseRecord) {
    return (
      <Card className={cn('p-6', className)}>
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <Clock className="h-8 w-8 text-[var(--color-text-disabled)]" />
          <p className="text-sm text-[var(--color-text-muted)]">Case not found</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Case Progress</span>
            <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{completedCount}/{CASE_STAGE_ORDER.length} stages</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
            <div className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        {estimatedCompletion && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] text-[var(--color-text-muted)]">Est. completion</p>
            <p className="text-xs font-semibold text-[var(--color-text)]">{estimatedCompletion.estimatedDate}</p>
            <p className={cn('text-[10px]', estimatedCompletion.confidence === 'high' ? 'text-emerald-500' : estimatedCompletion.confidence === 'medium' ? 'text-amber-500' : 'text-slate-400')}>
              {estimatedCompletion.confidence} confidence
            </p>
          </div>
        )}
      </div>

      <StageTimeline
        stages={timelineItems}
        activeStageId={currentStage}
        orientation={compact ? 'vertical' : 'horizontal'}
        compact={compact}
        onStageClick={(stage) => onStageClick?.(stage.id as CaseStage)}
      />

      <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-bg-sunken)]">
          <Check className="h-3 w-3 text-emerald-500" /> {completedCount} completed
        </span>
        {currentStage && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
            <Circle className="h-3 w-3 fill-current" /> Current: {STAGE_LABELS[currentStage]}
          </span>
        )}
        {caseStatus === 'Active' && progressPercent < 100 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--color-bg-sunken)]">
            <Clock className="h-3 w-3" /> {CASE_STAGE_ORDER.length - completedCount} remaining
          </span>
        )}
        {caseStatus === 'Completed' && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" /> Case completed
          </span>
        )}
      </div>
    </div>
  );
}

export default CaseTimeline;
