/**
 * ProjectEngineeringWorkspace — the Engineering stage's full operational
 * workspace, embedded inside "Work on This Project" (Card 2 — Engineering
 * mission). Built the same way ProjectSurveyWorkspace.tsx was: surfaces the
 * EXISTING Engineering system verbatim, no parallel implementation.
 *
 * Reuse discipline:
 *   - useEngineeringDesigns()/useEngineeringActions() (features/engineering/
 *     hooks/useEngineeringDesigns.ts) are the exact hooks the global
 *     EngineeringDesigns.tsx page already uses — same createDesign/
 *     updateDesign/submitForReview/approveDesign/requestDesignRevision
 *     business logic, same Firestore collection, same project
 *     stageHistory side-effect (approving a design advances the Project to
 *     Quotation via the SAME engineeringWorkflow.ts code, not a second copy).
 *   - <EngineeringDesignDetail> and <EngineeringDesignForm> are the exact
 *     components the global page's own modals render — reused here
 *     unmodified.
 *
 * No duplicate Engineering submission: a design is auto-created (Draft,
 * survey data already snapshotted in) the moment its Survey is approved —
 * see approveSurvey() -> createEngineeringDraftFromSurvey() in
 * surveyWorkflow.ts. This workspace never offers a second "create design"
 * action for a project that already has one; if a project reaches the
 * Engineering stage with no design yet (a genuine data gap, not the normal
 * path), it says so plainly rather than inventing a duplicate creation
 * flow — the correct fix for that gap is upstream, at Survey approval.
 *
 * Same error-surfacing fix already applied to Survey: Submit/Approve/
 * Revise are wrapped so a failure (e.g. a permission mismatch) is always
 * visible via toast, never silently swallowed.
 */
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../../../components/ui/Modal';
import { useEngineeringActions, useEngineeringDesigns } from '../../../../engineering/hooks/useEngineeringDesigns';
import { EngineeringDesignDetail } from '../../../../engineering/components/EngineeringDesignDetail';
import { EngineeringDesignForm } from '../../../../engineering/components/EngineeringDesignForm';
import type { DesignUpdateInput, EngineeringDesignRecord } from '../../../../engineering/types';
import { useSurveys } from '../../../../surveys/hooks/useSurveys';
import type { SurveyRecord } from '../../../../surveys/types';
import type { ProjectStageWorkspaceProps } from './types';

export default function ProjectEngineeringWorkspace({ project, users }: ProjectStageWorkspaceProps) {
  const { data: designs = [], isLoading } = useEngineeringDesigns();
  const { data: surveys = [] } = useSurveys();
  const actions = useEngineeringActions();
  const [formOpen, setFormOpen] = useState(false);

  const projectDesigns = useMemo(
    () => (designs as EngineeringDesignRecord[])
      .filter((d) => d.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()),
    [designs, project.id],
  );
  const latestDesign = projectDesigns[0] || null;

  const projectSurveys = useMemo(
    () => (surveys as SurveyRecord[]).filter((s) => s.projectId === project.id),
    [surveys, project.id],
  );
  const designers = users.filter((u: any) => u.role === 'Engineer');

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  if (!latestDesign) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        No engineering design yet. A design is created automatically once the linked Survey is approved.
      </p>
    );
  }

  function handleUpdate(input: DesignUpdateInput) {
    if (!latestDesign) return;
    actions.update.mutate(
      { id: latestDesign.id, input },
      {
        onSuccess: () => { setFormOpen(false); toast.success('Engineering design updated'); },
        onError: (e: any) => toast.error(e?.message || 'Failed to update design'),
      },
    );
  }

  return (
    <div className="space-y-3">
      <EngineeringDesignDetail
        design={latestDesign}
        loading={actions.submit.isPending || actions.approve.isPending || actions.revise.isPending}
        onEdit={() => setFormOpen(true)}
        onSubmit={() => actions.submit.mutate(latestDesign.id, {
          onSuccess: () => toast.success('Design submitted for review'),
          onError: (e: any) => toast.error(e?.message || 'Failed to submit design'),
        })}
        onApprove={async (note) => {
          try {
            await actions.approve.mutateAsync({ id: latestDesign.id, note });
            toast.success('Engineering design approved');
          } catch (e: any) {
            toast.error(e?.message || 'Failed to approve design');
          }
        }}
        onRevise={async (reason) => {
          try {
            await actions.revise.mutateAsync({ id: latestDesign.id, reason });
            toast.success('Revision requested');
          } catch (e: any) {
            toast.error(e?.message || 'Failed to request revision');
          }
        }}
      />
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={`Revise ${latestDesign.designId}`} size="xl">
        <EngineeringDesignForm
          surveys={projectSurveys}
          designers={designers}
          initial={latestDesign}
          onSubmit={handleUpdate}
          onCancel={() => setFormOpen(false)}
          loading={actions.update.isPending}
        />
      </Modal>
    </div>
  );
}
