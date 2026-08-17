import { useNavigate } from 'react-router-dom';
import { ApprovalStepper, DocumentVault } from '../../../components/shared';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { usePermissions } from '../../../lib/permissions';
import type { EngineeringDesignRecord } from '../types';

export function EngineeringDesignDetail({ design, loading, onEdit, onSubmit, onApprove, onRevise }: {
  design: EngineeringDesignRecord;
  loading?: boolean;
  onEdit: () => void;
  onSubmit: () => void;
  onApprove: (note: string) => Promise<void>;
  onRevise: (reason: string) => Promise<void>;
}) {
  const perms = usePermissions();
  const navigate = useNavigate();
  const reviewStatus = design.status === 'Approved' ? 'approved' : design.status === 'InReview' ? 'pending' : design.status === 'Revised' ? 'changes_requested' : 'draft';
  return <div className="space-y-4">
    <Card className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--color-text)]">{design.designId}</p><p className="text-xs text-[var(--color-text-muted)]">Project {design.projectId} · Survey {design.surveyId}</p></div><Badge variant={design.status === 'Approved' ? 'success' : design.status === 'Revised' ? 'warning' : 'info'}>{design.status} · R{design.revisionNumber}</Badge></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-[var(--color-text-muted)]">Array</dt><dd>{design.panelCount} × {design.panelWattage} W</dd></div><div><dt className="text-xs text-[var(--color-text-muted)]">Capacity</dt><dd>{design.systemCapacityKw} kW</dd></div><div className="col-span-2"><dt className="text-xs text-[var(--color-text-muted)]">Inverter</dt><dd>{design.inverterSpec}</dd></div></dl>{design.surveySnapshot && <div className="mt-4 rounded-xl bg-[var(--color-bg-sunken)] p-3 text-xs text-[var(--color-text-secondary)]"><p className="font-semibold">Survey handoff</p><p className="mt-1">{design.surveySnapshot.roofType || 'Roof type not recorded'} · {design.surveySnapshot.roofAreaSqm || '—'} m² · {(design.surveySnapshot.photos ?? []).length} photos</p><p className="mt-1">{design.surveySnapshot.shadingNotes || 'No shading notes'}</p></div>}{design.revisionReason && <p className="mt-3 rounded-xl bg-[var(--color-warning-light)] p-3 text-sm text-[var(--color-warning-text)]">Revision requested: {design.revisionReason}</p>}<div className="mt-4 flex flex-wrap gap-2">{['Draft','Revised'].includes(design.status) && perms.canEdit('engineering') && <Button variant="outline" onClick={onEdit}>Edit design</Button>}{['Draft','Revised'].includes(design.status) && perms.canEdit('engineering') && <Button onClick={onSubmit} loading={loading}>Submit for review</Button>}{design.status === 'Approved' && <Button onClick={() => navigate(`/quotations?projectId=${encodeURIComponent(design.projectId)}&designId=${encodeURIComponent(design.id)}`)}>Use in quotation</Button>}</div></Card>
    <DocumentVault readOnly title="Engineering drawings" documents={(design.documents ?? []).map((document) => ({ id: document.id, name: document.name, url: document.url, type: document.contentType, size: document.size, uploadedAt: document.uploadedAt, category: document.category }))} />
    <ApprovalStepper title="Design approval" activeStepId="review" loading={loading} steps={[{ id: 'draft', title: 'Engineering design prepared', status: design.status === 'Draft' ? 'draft' : 'approved' }, { id: 'review', title: 'Engineering review', status: reviewStatus, note: design.approvalNote || design.revisionReason }]} onApprove={perms.canApprove('engineering') && design.status === 'InReview' ? (_step, note) => onApprove(note) : undefined} onReject={perms.canApprove('engineering') && design.status === 'InReview' ? (_step, reason) => onRevise(reason) : undefined} />
    {(design.revisionHistory ?? []).length > 0 && <Card className="p-4"><p className="text-sm font-semibold">Retained revisions</p><div className="mt-3 space-y-2">{design.revisionHistory.map((revision) => <div key={`${revision.revisionNumber}-${revision.retainedAt}`} className="rounded-xl bg-[var(--color-bg-sunken)] p-3 text-xs"><p className="font-semibold">Revision {revision.revisionNumber}</p><p>{revision.panelCount} × {revision.panelWattage} W · {revision.systemCapacityKw} kW</p><p className="text-[var(--color-text-muted)]">{revision.reason}</p></div>)}</div></Card>}
  </div>;
}
