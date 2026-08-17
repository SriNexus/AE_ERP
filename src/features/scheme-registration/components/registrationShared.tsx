/**
 * registrationShared — shared presentational + document-upload pieces for the
 * Vendor Lock / Scheme Registration subsystem. Reused by the Project
 * Workspace Registration stage, the partner portal (My Registration) and the
 * mobile surfaces — no business logic is duplicated (all actions run through
 * the canonical hooks/service), and there is no second document system
 * (uploads land in the shared `documents` collection via caseDocuments.ts).
 *
 * Storage paths are case-scoped per spec §15:
 *   companies/{companyId}/cases/{caseId}/documents   (preferred)
 *   companies/{companyId}/projects/{projectId}/documents (fallback when the
 *   project has no caseId) — never a bare companies/{companyId} path.
 */
import { useRef, useState } from 'react';
import { FileCheck2, FileUp, Lock } from 'lucide-react';
import { uploadFile } from '../../../lib/storage';
import { createCaseDocument, useCaseDocuments } from '../../../lib/caseDocuments';
import { useAppStore } from '../../../store/useAppStore';
import { usePermissions } from '../../../lib/permissions';
import { cn } from '../../../utils/cn';
import { Button } from '../../../components/ui/Button';
import { fmtDateSafe } from '../../../lib/firestore';
import { useAttachRegistrationDocument } from '../hooks/useSchemeRegistrations';
import type {
  SchemeRegistrationRecord,
  SchemeRegistrationRequiredDocument,
  SchemeRegistrationStatusHistoryEntry,
} from '../types';
import type { ProjectRecord } from '../../projects/types';

export const SCHEME_REGISTRATION_STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  Submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  UnderVerification: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  VendorLocked: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  Completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  Rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  Cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  Failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function schemeRegistrationStatusLabel(status: string): string {
  if (status === 'UnderVerification') return 'Under Verification';
  if (status === 'VendorLocked') return 'Vendor Locked';
  return status;
}

/** Human next-action hint per status — shared by every surface (list page,
 * project workspace, portal, detail modal). Presentation-only: actions are
 * always gated by the canonical permission/transition contract. */
export function registrationNextActionHint(status: string): string {
  switch (status) {
    case 'Draft': return 'Partner to submit (application number + required documents)';
    case 'Submitted': return 'Manager verification / vendor lock';
    case 'UnderVerification': return 'Manager approve vendor lock or reject';
    case 'VendorLocked': return 'Complete once all required documents are linked';
    case 'Rejected': return 'Partner to resubmit with corrections';
    case 'Failed': return 'Partner to retry';
    case 'Completed': return 'Survey can be scheduled';
    case 'Cancelled': return 'Withdrawn — terminal';
    default: return '';
  }
}

export function SchemeRegistrationStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
      SCHEME_REGISTRATION_STATUS_COLORS[status] || 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
    )}>
      {schemeRegistrationStatusLabel(status)}
    </span>
  );
}

/** The registration's own status timeline — genuine domain history, shared by
 * every surface (project workspace, portal, mobile). */
export function RegistrationTimeline({ history }: { history?: SchemeRegistrationStatusHistoryEntry[] }) {
  if (!history || history.length === 0) {
    return <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">No status changes recorded yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      {[...history].reverse().map((entry, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-xs">
          <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full',
            ['Rejected', 'Failed', 'Cancelled'].includes(entry.status) ? 'bg-red-500'
              : ['VendorLocked', 'Completed'].includes(entry.status) ? 'bg-emerald-500'
              : entry.status === 'Reopened' ? 'bg-amber-500'
              : 'bg-[var(--color-primary)]')} />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-[var(--color-text)]">{schemeRegistrationStatusLabel(entry.status)}</p>
            {entry.note && <p className="text-[var(--color-text-muted)]">{entry.note}</p>}
            <p className="text-[10px] text-[var(--color-text-muted)]">
              {fmtDateSafe(entry.changedAt)} · {entry.changedByName || entry.changedBy || 'System'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Case-scoped storage path (spec §15). */
export function registrationStoragePath(companyId: string, project: { id: string; caseId?: string }): string {
  return project.caseId
    ? `companies/${companyId}/cases/${project.caseId}/documents`
    : `companies/${companyId}/projects/${project.id}/documents`;
}

/**
 * Required-document checklist (spec §15): shows each locked category with its
 * linked/uploaded state and (for permitted editors) an upload control. The
 * file lands in the shared `documents` collection (case-scoped path,
 * partnerId/stage stamped) and the registration's requiredDocuments entry is
 * linked via the canonical attachRegistrationDocument service — no second
 * document system, no ownership values from the client payload.
 */
export function RegistrationRequiredDocuments({
  registration,
  project,
}: {
  registration: SchemeRegistrationRecord;
  project?: ProjectRecord | null;
}) {
  const companyId = useAppStore((s) => s.activeCompanyId);
  const perms = usePermissions();
  const attachMutation = useAttachRegistrationDocument();
  const { data: allDocs = [] } = useCaseDocuments();
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const entries: SchemeRegistrationRequiredDocument[] = registration.requiredDocuments || [];
  const canEdit = perms.canEdit('scheme_registration');
  if (entries.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        No required documents configured for this registration.
      </p>
    );
  }

  async function handleUpload(entry: SchemeRegistrationRequiredDocument, file: File) {
    if (!file || !project) return;
    setUploadingCategory(entry.category);
    setError('');
    try {
      const url = await uploadFile(registrationStoragePath(companyId, project as { id: string; caseId?: string }), file);
      const doc = await createCaseDocument({
        projectId: project.id,
        caseId: (project as any).caseId,
        customerId: (project as any).customerId,
        leadId: (project as any).leadId,
        partnerId: registration.partnerId,
        partnerName: registration.partnerName,
        stage: 'SchemeRegistration',
        name: file.name,
        url,
        mimeType: file.type,
        size: file.size,
        label: entry.label,
        sourceEntityType: 'project',
      });
      attachMutation.mutate({
        id: registration.id,
        category: entry.category,
        documentId: doc.id,
        uploadedByName: useAppStore.getState().user?.name,
      });
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploadingCategory(null);
    }
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const linkedDoc = entry.documentId ? allDocs.find((d) => d.id === entry.documentId) : undefined;
        const isLinked = Boolean(entry.documentId && linkedDoc);
        return (
          <div key={entry.category} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {isLinked
                  ? <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  : <FileUp className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />}
                <p className="truncate text-xs font-medium text-[var(--color-text)]">{entry.label}</p>
                {entry.required && (
                  <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-600 dark:bg-red-900/30 dark:text-red-400">Required</span>
                )}
              </div>
              <p className="mt-0.5 pl-5 text-[10px] text-[var(--color-text-muted)]">
                {entry.documentId
                  ? `Linked · ${entry.uploadedByName || ''}${entry.uploadedAt ? ` · ${fmtDateSafe(entry.uploadedAt)}` : ''}`
                  : 'Not uploaded yet'}
              </p>
            </div>
            {canEdit && !isLinked && project && (
              <div className="flex items-center gap-2">
                <input
                  ref={(el) => { fileInputs.current[entry.category] = el; }}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload(entry, file);
                    e.target.value = '';
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  loading={uploadingCategory === entry.category}
                  onClick={() => fileInputs.current[entry.category]?.click()}
                >
                  Upload
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {registration.status === 'VendorLocked' && (
        <p className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
          <Lock className="h-3 w-3" /> Vendor locked — the document checklist is still editable until the registration is completed.
        </p>
      )}
    </div>
  );
}
