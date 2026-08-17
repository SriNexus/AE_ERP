import { describe, expect, it } from 'vitest';

import { resolveApprovalStepperState } from '../ApprovalStepper';
import { formatVaultFileSize, normalizeVaultDocuments } from '../DocumentVault';
import { buildScheduleCalendarState } from '../ScheduleCalendar';
import { resolveStageTimelineItems } from '../StageTimeline';
import { resolveMultiStepFormState } from '../MultiStepForm';

describe('StageTimeline helpers', () => {
  it('derives completed and current stages from the active stage', () => {
    const result = resolveStageTimelineItems([
      { id: 'survey', title: 'Survey' },
      { id: 'engineering', title: 'Engineering' },
      { id: 'qc', title: 'QC' },
    ], 'engineering');

    expect(result.activeIndex).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.items[0]?.resolvedStatus).toBe('completed');
    expect(result.items[1]?.resolvedStatus).toBe('current');
    expect(result.items[2]?.resolvedStatus).toBe('upcoming');
  });
});

describe('ApprovalStepper helpers', () => {
  it('identifies the first actionable step', () => {
    const result = resolveApprovalStepperState([
      { id: 'survey', title: 'Survey', status: 'approved' },
      { id: 'engineering', title: 'Engineering', status: 'in_review' },
      { id: 'qc', title: 'QC', status: 'pending' },
    ]);

    expect(result.activeIndex).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.activeStep?.id).toBe('engineering');
  });
});

describe('MultiStepForm helpers', () => {
  it('returns the active step and progress', () => {
    const result = resolveMultiStepFormState([
      { id: 'basics', title: 'Basics', content: 'A' },
      { id: 'address', title: 'Address', content: 'B' },
      { id: 'review', title: 'Review', content: 'C' },
    ], 'address');

    expect(result.activeIndex).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.progressPercent).toBe(33);
  });
});

describe('DocumentVault helpers', () => {
  it('formats file sizes and sorts newest documents first', () => {
    expect(formatVaultFileSize(1024 * 1024)).toBe('1 MB');
    expect(formatVaultFileSize(1024)).toBe('1 KB');

    const docs = normalizeVaultDocuments([
      { id: 'old', name: 'Old', uploadedAt: '2024-01-01T00:00:00.000Z' },
      { id: 'new', name: 'New', uploadedAt: '2025-01-01T00:00:00.000Z' },
    ]);

    expect(docs.map((doc) => doc.id)).toEqual(['new', 'old']);
  });
});

describe('ScheduleCalendar helpers', () => {
  it('builds a monthly calendar matrix with events attached to matching days', () => {
    const result = buildScheduleCalendarState(new Date('2026-07-10T00:00:00.000Z'), [
      { id: 'evt-1', title: 'Inspection', date: '2026-07-10T09:00:00.000Z' },
    ]);

    const matchingDay = result.days.flat().find((day) => (
      day.date.getFullYear() === 2026 && day.date.getMonth() === 6 && day.date.getDate() === 10
    ));
    expect(matchingDay?.events).toHaveLength(1);
    expect(result.monthLabel).toContain('July 2026');
  });
});
