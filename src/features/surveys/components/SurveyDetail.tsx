import { ApprovalStepper } from '../../../components/shared/ApprovalStepper';
import { DocumentVault } from '../../../components/shared/DocumentVault';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { usePermissions } from '../../../lib/permissions';
import type { SurveyRecord } from '../types';

export function SurveyDetail({ survey, onStart, onReport, onApprove, onReject, startLoading, approveRejectLoading }: {
  survey: SurveyRecord;
  onStart: () => void;
  onReport: () => void;
  onApprove: (note: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  /** Scoped to the Start action only, so clicking Approve/Reject doesn't
   * also light up an unrelated button (and vice versa). */
  startLoading?: boolean;
  approveRejectLoading?: boolean;
}) {
  const perms = usePermissions();
  const approval = survey.approvalStatus === 'Approved' ? 'approved' : survey.approvalStatus === 'Rejected' ? 'rejected' : survey.approvalStatus === 'Pending' ? 'pending' : 'draft';
  return <div className="space-y-4">
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--color-text)]">{survey.surveyId}</p><p className="text-xs text-[var(--color-text-muted)]">Project {survey.projectId}</p></div><Badge variant={survey.status === 'Completed' ? 'success' : survey.status === 'Rejected' ? 'danger' : 'info'}>{survey.status}</Badge></div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-[var(--color-text-muted)]">Scheduled</dt><dd>{new Date(survey.scheduledDate).toLocaleString()}</dd></div><div><dt className="text-xs text-[var(--color-text-muted)]">Surveyor</dt><dd>{survey.surveyorId}</dd></div><div><dt className="text-xs text-[var(--color-text-muted)]">Roof</dt><dd>{survey.roofType || '—'}</dd></div><div><dt className="text-xs text-[var(--color-text-muted)]">Area</dt><dd>{survey.roofAreaSqm ? `${survey.roofAreaSqm} m²` : '—'}</dd></div></dl>
      {survey.rejectionReason && <p className="mt-3 rounded-xl bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger-text)]">{survey.rejectionReason}</p>}
      {survey.engineeringDesignId && <a className="mt-3 block rounded-xl bg-[var(--color-success-light)] p-3 text-sm font-semibold text-[var(--color-success-text)]" href={`/engineering-designs?projectId=${encodeURIComponent(survey.projectId)}&open=${encodeURIComponent(survey.engineeringDesignId)}`}>Engineering draft {survey.engineeringDesignId} created →</a>}
      <div className="mt-4 flex gap-2">{survey.status === 'Scheduled' && perms.canEdit('surveys') && <Button onClick={onStart} loading={startLoading}>Start survey</Button>}{['Scheduled','InProgress','Rejected'].includes(survey.status) && perms.canEdit('surveys') && <Button variant="outline" onClick={onReport}>Complete report</Button>}</div>
    </Card>
    <DocumentVault readOnly title="Survey documents" documents={survey.photos.map((p) => ({ id: p.id, name: p.name, url: p.url, type: p.contentType, size: p.size, uploadedAt: p.capturedAt }))} />
    <ApprovalStepper title="Survey approval" steps={[{ id: 'report', title: 'Survey report submitted', status: survey.status === 'Completed' || survey.approvalStatus === 'Approved' ? 'approved' : 'draft' }, { id: 'review', title: 'Engineering review', status: approval, note: survey.approvalNote || survey.rejectionReason }]} activeStepId="review" loading={approveRejectLoading} onApprove={perms.canApprove('surveys') && survey.approvalStatus === 'Pending' ? (_step, note) => onApprove(note) : undefined} onReject={perms.canApprove('surveys') && survey.approvalStatus === 'Pending' ? (_step, reason) => onReject(reason) : undefined} />
  </div>;
}
