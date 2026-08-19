/**
 * backupStatus.ts — Backup-status KPI contract (Phase 7, Master Plan §12.5).
 *
 * `backup_metadata/{id}` is written ONLY by the backup automation's
 * service-account identity (scripts/record-backup-status.cjs via the Admin
 * SDK) — no client SDK may create/update/delete it (firestore.rules). This
 * module is the single, testable place that turns the raw collection into an
 * honest KPI: it must never report "healthy" when no real backup has
 * completed, and must distinguish a genuinely recent success from a
 * successful-but-stale one (a backup that stopped running silently looks
 * identical to "no news is good news" unless age is checked).
 *
 * RPO is 24h (Master Plan §12.6, nightly export cadence). STALE_THRESHOLD_MS
 * is 2x RPO — one missed nightly run is tolerated without alarm (transient
 * infra hiccups), two is a real signal the automation stopped working.
 */

export interface BackupMetadataDoc {
  id: string;
  startedAt?: string;
  completedAt?: string;
  status?: 'Running' | 'Success' | 'Failed' | string;
  exportUri?: string;
  sizeBytes?: number;
  errorMessage?: string;
  triggeredBy?: 'scheduled' | 'manual' | string;
}

export const BACKUP_METADATA_COLLECTION = 'backup_metadata';

export const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 2x the 24h RPO

export type BackupHealthState = 'never' | 'running' | 'success' | 'stale' | 'failed';

export interface BackupHealth {
  state: BackupHealthState;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'default';
  /** Age of the latest completed/started event, in milliseconds — undefined when there is no event to age. */
  ageMs?: number;
  latest?: BackupMetadataDoc;
}

/**
 * Picks the most recent backup_metadata document by timestamp (startedAt,
 * falling back to the deterministic `{yyyyMMdd-HHmm}` id which sorts
 * chronologically as a string) — never assumes array order.
 */
export function selectLatestBackup(docs: BackupMetadataDoc[]): BackupMetadataDoc | undefined {
  if (!docs || docs.length === 0) return undefined;
  return [...docs].sort((a, b) => {
    const ta = new Date(a.startedAt || '').getTime();
    const tb = new Date(b.startedAt || '').getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return String(b.id).localeCompare(String(a.id));
  })[0];
}

/**
 * Classifies backup health from the latest document. `now` is injectable for
 * deterministic testing.
 */
export function classifyBackupStatus(docs: BackupMetadataDoc[], now: number = Date.now()): BackupHealth {
  const latest = selectLatestBackup(docs);

  if (!latest) {
    return { state: 'never', label: 'Never backed up', tone: 'danger' };
  }

  if (latest.status === 'Failed') {
    return { state: 'failed', label: 'Failed', tone: 'danger', latest };
  }

  if (latest.status === 'Running') {
    return { state: 'running', label: 'Running', tone: 'info', latest };
  }

  if (latest.status === 'Success') {
    const referenceTime = latest.completedAt || latest.startedAt;
    const ageMs = referenceTime ? now - new Date(referenceTime).getTime() : undefined;
    if (ageMs === undefined || Number.isNaN(ageMs)) {
      // A "Success" document with no usable timestamp is not trustworthy
      // evidence of a recent backup — do not claim health without a real age.
      return { state: 'stale', label: 'Success (age unknown)', tone: 'warning', latest };
    }
    if (ageMs > STALE_THRESHOLD_MS) {
      return { state: 'stale', label: 'Stale', tone: 'warning', ageMs, latest };
    }
    return { state: 'success', label: 'Healthy', tone: 'success', ageMs, latest };
  }

  // Unknown/unexpected status value — fail closed to a visible warning
  // rather than silently reporting healthy.
  return { state: 'stale', label: `Unknown (${latest.status})`, tone: 'warning', latest };
}

export function formatAge(ageMs: number | undefined): string {
  if (ageMs === undefined || Number.isNaN(ageMs)) return '';
  const hours = ageMs / (60 * 60 * 1000);
  if (hours < 1) return `${Math.max(0, Math.round(ageMs / 60000))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
