/**
 * Phase 12 (DEFECT-002, Master Plan "Performance Hardening") — MobileAuditWorkspace
 * previously fetched the ENTIRE audit_logs collection via an unbounded
 * getAll(COLLECTIONS.AUDIT_LOGS) just to render a 50-row recent-activity
 * list and a "total logs" count. Fixed to a recency-ordered, limit(200)
 * bounded query plus a countDocumentsSafe()-based total, reusing the
 * composite index already declared for audit_logs in firestore.indexes.json
 * (companyId, isDeleted, createdAt DESC).
 *
 * Source-text analysis, matching the repository's established convention for
 * this component tier (see customerWorkspace.test.ts) — there is no
 * @testing-library/react dependency in this repository, so full render
 * testing isn't available without adding new test infrastructure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '../MobileAuditWorkspace.tsx'), 'utf-8');

describe('MobileAuditWorkspace — bounded audit_logs query (Phase 12, DEFECT-002)', () => {
  it('no longer calls getAll(COLLECTIONS.AUDIT_LOGS) with zero constraints (the previous unbounded full-collection fetch)', () => {
    expect(source).not.toMatch(/getAll<any>\(COLLECTIONS\.AUDIT_LOGS\)(?!\s*,)/);
  });

  it('bounds the recent-activity query with isDeleted/orderBy/limit', () => {
    expect(source).toMatch(/where\(\s*['"]isDeleted['"]\s*,\s*['"]==['"]\s*,\s*false\s*\)/);
    expect(source).toMatch(/orderBy\(\s*['"]createdAt['"]\s*,\s*['"]desc['"]\s*\)/);
    expect(source).toMatch(/limitQuery\(\s*200\s*\)/);
  });

  it('the "total logs" stat comes from countDocumentsSafe(), not logs?.length on the full fetch', () => {
    expect(source).toContain('countDocumentsSafe(');
    expect(source).not.toContain('{logs?.length || 0} total logs');
    expect(source).toContain('{totalLogs} total logs');
  });
});
