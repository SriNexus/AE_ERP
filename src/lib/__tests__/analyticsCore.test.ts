import { describe, it, expect } from 'vitest';
import {
  safeDate,
  dateMs,
  daysBetween,
  safeNumber,
  startOfDay,
  startOfMonth,
  monthKey,
  inRange,
  buildMonthBuckets,
  countProjectsByStage,
  getStageColor,
  PROJECT_STAGE_DASHBOARD_ORDER,
  STAGE_COLORS,
} from '../analyticsCore';

describe('safeDate', () => {
  it('returns null for null/undefined', () => {
    expect(safeDate(null)).toBeNull();
    expect(safeDate(undefined)).toBeNull();
  });

  it('parses ISO string', () => {
    const d = safeDate('2026-07-11T12:00:00.000Z');
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toContain('2026-07-11');
  });

  it('returns null for invalid string', () => {
    expect(safeDate('not-a-date')).toBeNull();
  });

  it('parses Date object', () => {
    const now = new Date();
    expect(safeDate(now)).toBe(now);
  });

  it('parses Firestore-like Timestamp with toDate()', () => {
    const ts = { toDate: () => new Date('2026-01-01') };
    const d = safeDate(ts);
    expect(d!.getFullYear()).toBe(2026);
  });

  it('parses unix seconds object', () => {
    const ts = { seconds: 1704067200 }; // 2024-01-01
    const d = safeDate(ts);
    expect(d!.getFullYear()).toBe(2024);
  });
});

describe('dateMs', () => {
  it('returns 0 for null', () => {
    expect(dateMs(null)).toBe(0);
  });

  it('returns timestamp for valid date', () => {
    const d = new Date('2026-07-11');
    expect(dateMs(d)).toBe(d.getTime());
  });
});

describe('daysBetween', () => {
  it('computes correct days', () => {
    const a = new Date('2026-01-01');
    const b = new Date('2026-01-11');
    expect(daysBetween(a, b)).toBe(10);
  });

  it('returns 0 for same day', () => {
    const a = new Date('2026-01-01');
    expect(daysBetween(a, a)).toBe(0);
  });

  it('returns 0 for reversed dates', () => {
    const a = new Date('2026-01-11');
    const b = new Date('2026-01-01');
    expect(daysBetween(a, b)).toBe(0);
  });
});

describe('safeNumber', () => {
  it('returns number as-is', () => {
    expect(safeNumber(42)).toBe(42);
  });

  it('parses string number', () => {
    expect(safeNumber('100')).toBe(100);
  });

  it('returns 0 for NaN', () => {
    expect(safeNumber(NaN)).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(safeNumber(null)).toBe(0);
  });
});

describe('startOfDay', () => {
  it('resets time to midnight', () => {
    const d = startOfDay(new Date('2026-07-11T14:30:00'));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe('startOfMonth', () => {
  it('resets to first day of month', () => {
    const d = startOfMonth(new Date('2026-07-15'));
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('monthKey', () => {
  it('returns short month name', () => {
    const d = new Date('2026-07-01');
    expect(monthKey(d)).toBe('Jul');
  });
});

describe('inRange', () => {
  it('returns true for value within range', () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-12-31');
    expect(inRange('2026-06-15', from, to)).toBe(true);
  });

  it('returns false for value outside range', () => {
    const from = new Date('2026-06-01');
    const to = new Date('2026-06-30');
    expect(inRange('2026-07-01', from, to)).toBe(false);
  });
});

describe('buildMonthBuckets', () => {
  it('creates correct number of buckets', () => {
    const buckets = buildMonthBuckets(3);
    expect(Object.keys(buckets)).toHaveLength(3);
  });

  it('initializes with zero values', () => {
    const buckets = buildMonthBuckets(1);
    const key = Object.keys(buckets)[0];
    expect(buckets[key]).toEqual({ month: key, orders: 0, revenue: 0 });
  });
});

describe('PROJECT_STAGE_DASHBOARD_ORDER', () => {
  it('includes all expected stages', () => {
    expect(PROJECT_STAGE_DASHBOARD_ORDER).toContain('New');
    expect(PROJECT_STAGE_DASHBOARD_ORDER).toContain('Archived');
    expect(PROJECT_STAGE_DASHBOARD_ORDER).toContain('Installation');
    expect(PROJECT_STAGE_DASHBOARD_ORDER).toContain('QC');
    expect(PROJECT_STAGE_DASHBOARD_ORDER).toContain('Commissioning');
    expect(PROJECT_STAGE_DASHBOARD_ORDER).toContain('Monitoring');
  });
});

describe('STAGE_COLORS', () => {
  it('includes all dashboard stages', () => {
    expect(STAGE_COLORS).toHaveProperty('New');
    expect(STAGE_COLORS).toHaveProperty('Archived');
  });
});

describe('getStageColor', () => {
  it('returns color for known stage', () => {
    expect(getStageColor('New')).toBe('#6366f1');
  });

  it('returns default for unknown stage', () => {
    expect(getStageColor('Custom')).toBe('#6366f1');
  });
});

describe('countProjectsByStage', () => {
  it('counts projects by stage', () => {
    const result = countProjectsByStage([
      { currentStage: 'New' },
      { currentStage: 'Survey' },
      { currentStage: 'Survey' },
      { currentStage: 'Archived' },
    ]);
    expect(result.get('New')).toBe(1);
    expect(result.get('Survey')).toBe(2);
    expect(result.get('Archived')).toBe(1);
  });

  it('skips deleted projects', () => {
    const result = countProjectsByStage([
      { currentStage: 'New' },
      { currentStage: 'Survey', isDeleted: true },
    ]);
    expect(result.get('New')).toBe(1);
    expect(result.get('Survey')).toBe(0);
  });

  it('includes all stages from PROJECT_STAGE_DASHBOARD_ORDER', () => {
    const result = countProjectsByStage([]);
    expect(result.size).toBe(PROJECT_STAGE_DASHBOARD_ORDER.length);
  });

  it('defaults missing stage to New', () => {
    const result = countProjectsByStage([
      {},
      { currentStage: null },
      { currentStage: '' },
    ]);
    expect(result.get('New')).toBe(3);
  });
});
