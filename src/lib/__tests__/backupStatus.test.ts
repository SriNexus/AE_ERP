import { describe, expect, it } from 'vitest';
import { classifyBackupStatus, formatAge, selectLatestBackup, STALE_THRESHOLD_MS, type BackupMetadataDoc } from '../backupStatus';

/**
 * backupStatus.test.ts — Phase 7 (Master Plan §12.5) permanent unit coverage
 * for the Platform Dashboard backup-status KPI's classification contract.
 * Pure-function tests (no Firestore/emulator dependency) — the rules-layer
 * boundary (who may read/write backup_metadata) is covered separately in
 * multiTenantSecurity.emulator.test.ts's Phase 7 describe block.
 */

const NOW = new Date('2026-08-18T12:00:00.000Z').getTime();

describe('selectLatestBackup', () => {
  it('returns undefined for an empty list', () => {
    expect(selectLatestBackup([])).toBeUndefined();
  });

  it('picks the most recent by startedAt', () => {
    const docs: BackupMetadataDoc[] = [
      { id: '20260101-0000', status: 'Success', startedAt: '2026-01-01T00:00:00.000Z' },
      { id: '20260817-0115', status: 'Success', startedAt: '2026-08-17T01:15:00.000Z' },
      { id: '20260601-0000', status: 'Success', startedAt: '2026-06-01T00:00:00.000Z' },
    ];
    expect(selectLatestBackup(docs)?.id).toBe('20260817-0115');
  });

  it('falls back to id ordering when startedAt is missing/unparseable', () => {
    const docs: BackupMetadataDoc[] = [
      { id: '20260101-0000', status: 'Running' },
      { id: '20260817-0115', status: 'Running' },
    ];
    expect(selectLatestBackup(docs)?.id).toBe('20260817-0115');
  });
});

describe('classifyBackupStatus', () => {
  it('reports "never" with no backup_metadata records at all — never a bare healthy default', () => {
    const health = classifyBackupStatus([], NOW);
    expect(health.state).toBe('never');
    expect(health.tone).toBe('danger');
    expect(health.latest).toBeUndefined();
  });

  it('reports "failed" for the latest doc having status Failed, even if an older Success exists', () => {
    const docs: BackupMetadataDoc[] = [
      { id: '20260817-0000', status: 'Success', startedAt: '2026-08-17T00:00:00.000Z', completedAt: '2026-08-17T00:05:00.000Z' },
      { id: '20260818-0115', status: 'Failed', startedAt: '2026-08-18T01:15:00.000Z', errorMessage: 'gcloud export failed' },
    ];
    const health = classifyBackupStatus(docs, NOW);
    expect(health.state).toBe('failed');
    expect(health.tone).toBe('danger');
  });

  it('reports "running" while the latest export is in progress', () => {
    const docs: BackupMetadataDoc[] = [{ id: '20260818-1200', status: 'Running', startedAt: '2026-08-18T11:59:00.000Z' }];
    const health = classifyBackupStatus(docs, NOW);
    expect(health.state).toBe('running');
    expect(health.tone).toBe('info');
  });

  it('reports "success" for a completed backup within the stale threshold', () => {
    const docs: BackupMetadataDoc[] = [{
      id: '20260818-0115', status: 'Success',
      startedAt: '2026-08-18T01:15:00.000Z', completedAt: '2026-08-18T01:20:00.000Z',
    }];
    const health = classifyBackupStatus(docs, NOW);
    expect(health.state).toBe('success');
    expect(health.tone).toBe('success');
    expect(health.ageMs).toBeCloseTo(NOW - new Date('2026-08-18T01:20:00.000Z').getTime(), -2);
  });

  it('reports "stale" once the latest success is older than 2x the 24h RPO, even though status says Success', () => {
    const staleCompletedAt = new Date(NOW - STALE_THRESHOLD_MS - 60_000).toISOString();
    const docs: BackupMetadataDoc[] = [{ id: '20260810-0000', status: 'Success', startedAt: staleCompletedAt, completedAt: staleCompletedAt }];
    const health = classifyBackupStatus(docs, NOW);
    expect(health.state).toBe('stale');
    expect(health.tone).toBe('warning');
  });

  it('does not claim healthy for a Success doc with no usable timestamp', () => {
    const docs: BackupMetadataDoc[] = [{ id: 'weird-doc', status: 'Success' }];
    const health = classifyBackupStatus(docs, NOW);
    expect(health.state).toBe('stale');
    expect(health.tone).toBe('warning');
  });

  it('fails closed (warning, not success) for an unrecognized status value', () => {
    const docs: BackupMetadataDoc[] = [{ id: 'x', status: 'Corrupted' as any, startedAt: new Date(NOW).toISOString() }];
    const health = classifyBackupStatus(docs, NOW);
    expect(health.state).toBe('stale');
    expect(health.tone).toBe('warning');
  });
});

describe('formatAge', () => {
  it('formats sub-hour ages in minutes', () => {
    expect(formatAge(5 * 60_000)).toBe('5m ago');
  });
  it('formats sub-2-day ages in hours', () => {
    expect(formatAge(6 * 60 * 60_000)).toBe('6h ago');
  });
  it('formats multi-day ages in days', () => {
    expect(formatAge(4 * 24 * 60 * 60_000)).toBe('4d ago');
  });
  it('returns empty string for undefined', () => {
    expect(formatAge(undefined)).toBe('');
  });
});
