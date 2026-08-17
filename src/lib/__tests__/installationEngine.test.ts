import { describe, it, expect } from 'vitest';
import {
  INSTALLATION_STAGES,
  stageIndex,
  stageLabel,
  stageBadgeColor,
  calculateCompletion,
  nextStage,
  previousStage,
  stageProgress,
  isInstallationDelayed,
  delayDays,
  isValidInstallation,
} from '../installationEngine';

// ═══════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════
describe('INSTALLATION_STAGES', () => {
  it('has exactly 10 stages', () => {
    expect(INSTALLATION_STAGES.length).toBe(10);
  });

  it('starts with lead_approved and ends with completed', () => {
    expect(INSTALLATION_STAGES[0]).toBe('lead_approved');
    expect(INSTALLATION_STAGES[INSTALLATION_STAGES.length - 1]).toBe('completed');
  });
});

// ═══════════════════════════════════════════════════════════
//  stageIndex
// ═══════════════════════════════════════════════════════════
describe('stageIndex', () => {
  it('returns 0 for lead_approved', () => expect(stageIndex('lead_approved')).toBe(0));
  it('returns 5 for installation_started', () => expect(stageIndex('installation_started')).toBe(5));
  it('returns 9 for completed', () => expect(stageIndex('completed')).toBe(9));
  it('returns -1 for unknown stage', () => expect(stageIndex('unknown_stage')).toBe(-1));
});

// ═══════════════════════════════════════════════════════════
//  stageLabel
// ═══════════════════════════════════════════════════════════
describe('stageLabel', () => {
  it('returns correct labels for all stages', () => {
    expect(stageLabel('lead_approved')).toBe('Lead Approved');
    expect(stageLabel('survey_scheduled')).toBe('Survey Scheduled');
    expect(stageLabel('survey_completed')).toBe('Survey Completed');
    expect(stageLabel('material_ordered')).toBe('Material Ordered');
    expect(stageLabel('material_delivered')).toBe('Material Delivered');
    expect(stageLabel('installation_started')).toBe('Installation Started');
    expect(stageLabel('installation_in_progress')).toBe('Installation In Progress');
    expect(stageLabel('quality_inspection')).toBe('Quality Inspection');
    expect(stageLabel('customer_handover')).toBe('Customer Handover');
    expect(stageLabel('completed')).toBe('Completed');
  });

  it('returns "Not Started" for undefined stage', () => {
    expect(stageLabel(undefined)).toBe('Not Started');
  });

  it('falls back to title-cased string for unknown stage', () => {
    expect(stageLabel('pending_review')).toBe('Pending Review');
  });
});

// ═══════════════════════════════════════════════════════════
//  stageBadgeColor
// ═══════════════════════════════════════════════════════════
describe('stageBadgeColor', () => {
  it('returns color class for all stages', () => {
    expect(stageBadgeColor('lead_approved')).toContain('bg-blue');
    expect(stageBadgeColor('completed')).toContain('bg-green');
  });

  it('returns fallback for undefined stage', () => {
    const color = stageBadgeColor(undefined);
    expect(color).toContain('bg-gray');
  });

  it('returns fallback for unknown stage', () => {
    const color = stageBadgeColor('unknown_stage');
    expect(color).toContain('bg-gray');
  });
});

// ═══════════════════════════════════════════════════════════
//  calculateCompletion
// ═══════════════════════════════════════════════════════════
describe('calculateCompletion', () => {
  it('returns 0 for undefined stage', () => {
    expect(calculateCompletion(undefined)).toBe(0);
  });

  it('returns 0 for lead_approved', () => {
    expect(calculateCompletion('lead_approved')).toBe(0);
  });

  it('returns ~44% for installation_started (5/9)', () => {
    // 5 out of 9 steps done = ~56... actually let me calculate:
    // idx=5, total stages=10, so (5/9)*100 = 55.56 → 56
    expect(calculateCompletion('installation_started')).toBe(56);
  });

  it('returns 100 for completed', () => {
    expect(calculateCompletion('completed')).toBe(100);
  });

  it('returns 0 for unknown stage', () => {
    expect(calculateCompletion('unknown_stage')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  nextStage
// ═══════════════════════════════════════════════════════════
describe('nextStage', () => {
  it('returns lead_approved for undefined', () => {
    expect(nextStage(undefined)).toBe('lead_approved');
  });

  it('returns survey_scheduled after lead_approved', () => {
    expect(nextStage('lead_approved')).toBe('survey_scheduled');
  });

  it('returns null for completed (last stage)', () => {
    expect(nextStage('completed')).toBeNull();
  });

  it('returns null for unknown stage', () => {
    expect(nextStage('unknown')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
//  previousStage
// ═══════════════════════════════════════════════════════════
describe('previousStage', () => {
  it('returns null for undefined', () => {
    expect(previousStage(undefined)).toBeNull();
  });

  it('returns null for lead_approved (first stage)', () => {
    expect(previousStage('lead_approved')).toBeNull();
  });

  it('returns customer_handover before completed', () => {
    expect(previousStage('completed')).toBe('customer_handover');
  });
});

// ═══════════════════════════════════════════════════════════
//  stageProgress
// ═══════════════════════════════════════════════════════════
describe('stageProgress', () => {
  it('returns correct progress for lead_approved', () => {
    const p = stageProgress('lead_approved');
    expect(p.currentIndex).toBe(0);
    expect(p.totalStages).toBe(10);
    expect(p.completionPct).toBe(0);
    expect(p.isCompleted).toBe(false);
  });

  it('returns correct progress for completed', () => {
    const p = stageProgress('completed');
    expect(p.currentIndex).toBe(9);
    expect(p.completionPct).toBe(100);
    expect(p.isCompleted).toBe(true);
  });

  it('handles undefined stage', () => {
    const p = stageProgress(undefined);
    expect(p.currentIndex).toBe(0);
    expect(p.completionPct).toBe(0);
    expect(p.isCompleted).toBe(false);
  });

  it('handles mid-stage correctly', () => {
    const p = stageProgress('quality_inspection');
    expect(p.currentIndex).toBe(7);
    expect(p.completionPct).toBe(78); // (7/9)*100 ≈ 78
    expect(p.isCompleted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  isInstallationDelayed
// ═══════════════════════════════════════════════════════════
describe('isInstallationDelayed', () => {
  it('returns false for undefined status', () => {
    expect(isInstallationDelayed(undefined)).toBe(false);
  });

  it('returns false for completed installations', () => {
    expect(isInstallationDelayed('completed', '2025-01-01')).toBe(false);
  });

  it('returns true when past expected completion date', () => {
    const pastDate = new Date(Date.now() - 86400000 * 10).toISOString();
    expect(isInstallationDelayed('installation_in_progress', pastDate)).toBe(true);
  });

  it('returns false when before expected completion date', () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    expect(isInstallationDelayed('installation_in_progress', futureDate)).toBe(false);
  });

  it('returns true when past scheduled date for early stages', () => {
    const pastDate = new Date(Date.now() - 86400000 * 5).toISOString();
    expect(isInstallationDelayed('survey_scheduled', null, pastDate)).toBe(true);
  });

  it('returns false when no dates provided', () => {
    expect(isInstallationDelayed('installation_in_progress', null, null)).toBe(false);
  });

  it('returns false for invalid date string', () => {
    expect(isInstallationDelayed('installation_in_progress', 'invalid-date', null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
//  delayDays
// ═══════════════════════════════════════════════════════════
describe('delayDays', () => {
  it('returns 0 for non-delayed installation', () => {
    expect(delayDays('completed', '2025-01-01', null)).toBe(0);
  });

  it('returns positive days for delayed installation', () => {
    const pastDate = new Date(Date.now() - 86400000 * 10).toISOString();
    const days = delayDays('installation_in_progress', pastDate, null);
    expect(days).toBeGreaterThanOrEqual(10);
  });

  it('returns 0 when no installation status', () => {
    expect(delayDays(undefined, null, null)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  isValidInstallation
// ═══════════════════════════════════════════════════════════
describe('isValidInstallation', () => {
  it('returns true for a lead with valid installation status', () => {
    expect(isValidInstallation({ installationStatus: 'installation_in_progress', isDeleted: false })).toBe(true);
  });

  it('returns false for a lead with pending status', () => {
    expect(isValidInstallation({ installationStatus: 'pending', isDeleted: false })).toBe(false);
  });

  it('returns false for a deleted lead', () => {
    expect(isValidInstallation({ installationStatus: 'installation_in_progress', isDeleted: true })).toBe(false);
  });

  it('returns false for a null lead', () => {
    expect(isValidInstallation(null)).toBe(false);
  });

  it('returns false for a lead without installationStatus', () => {
    expect(isValidInstallation({ name: 'test', isDeleted: false })).toBe(false);
  });
});
