/**
 * ProjectSurveyWorkspace — the Survey stage's full operational workspace,
 * embedded inside "Work on This Project" (Project Workspace Stage Lifecycle
 * mission, Phase 3). Survey is the ONLY stage with a complete workspace in
 * this phase — the reference implementation the remaining 12 will follow.
 *
 * Reuse discipline (no parallel Survey system): this surfaces the EXISTING
 * Survey feature verbatim —
 *   - useSurveys() / useSurveyActions() (features/surveys/hooks/useSurveys.ts)
 *     are the exact hooks Surveys.tsx (list page) and
 *     MobileSurveyWorkspace.tsx already use — same scheduleSurvey/
 *     startSurvey/submitSurveyReport/approveSurvey/rejectSurvey business
 *     logic, same Firestore collection, same project stageHistory
 *     side-effects (approving a survey advances the Project to Engineering
 *     via the SAME surveyWorkflow.ts code, not a second copy).
 *   - <SurveyDetail> and <SurveyReportForm> are the exact components the
 *     list page's own modals render — reused here unmodified, not
 *     recreated, so a UI change to Survey only ever needs to happen once.
 *   - uploadSurveyPhotos() is the same storage helper (already Demo-Mode
 *     aware via firebaseEnv.isConfigured — no separate demo path needed
 *     here).
 *
 * Only new UI: a compact inline "Schedule Survey" form for when this
 * project has no survey yet (the list page's own schedule form, inlined
 * and pre-locked to this project instead of offering a project picker), and
 * the report form mounts in the SAME Modal presentation Surveys.tsx's own
 * popup used (a photo grid + GPS capture needs real room, which a narrow
 * accordion body doesn't have) — everything else defers straight to
 * SurveyDetail's own actions.
 *
 * Popup retirement: Surveys.tsx no longer opens SurveyDetail/SurveyReportForm
 * in a popup at all — clicking a survey row there now navigates here
 * instead (see openSurveyWorkspace() in pages/Surveys.tsx). This workspace
 * is what replaced it, so every capability that popup had (view/start/
 * report/GPS/submit/approve/reject) must work here — nothing lost.
 */
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../../../components/ui/Modal';
import { Button } from '../../../../../components/ui/Button';
import { Input, Select, Textarea } from '../../../../../components/ui/Input';
import { usePermissions } from '../../../../../lib/permissions';
import { useSurveyActions, useSurveys } from '../../../../surveys/hooks/useSurveys';
import { SurveyDetail } from '../../../../surveys/components/SurveyDetail';
import { SurveyReportForm } from '../../../../surveys/components/SurveyReportForm';
import { uploadSurveyPhotos } from '../../../../surveys/services/surveyStorage';
import type { SurveyPhoto, SurveyRecord } from '../../../../surveys/types';
import type { ProjectStageWorkspaceProps } from './types';

export default function ProjectSurveyWorkspace({ project, users }: ProjectStageWorkspaceProps) {
  const perms = usePermissions();
  const { data: surveys = [], isLoading } = useSurveys();
  const actions = useSurveyActions();

  const projectSurveys = useMemo(
    () => (surveys as SurveyRecord[])
      .filter((s) => s.projectId === project.id)
      .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime()),
    [surveys, project.id],
  );
  const latestSurvey = projectSurveys[0] || null;
  const surveyors = users.filter((u: any) => u.role === 'Surveyor');

  const [surveyorId, setSurveyorId] = useState(project.assignedSurveyor || '');
  const [scheduledDate, setScheduledDate] = useState('');
  const [notes, setNotes] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [photos, setPhotos] = useState<SurveyPhoto[]>([]);
  const [error, setError] = useState('');

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-lg bg-[var(--color-bg-sunken)]" />;
  }

  if (!latestSurvey) {
    return (
      <div className="space-y-3">
        {error && <p className="rounded-lg bg-[var(--color-danger-light)] p-2.5 text-xs text-[var(--color-danger-text)]">{error}</p>}
        <p className="text-xs text-[var(--color-text-muted)]">No survey has been scheduled for this project yet.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Surveyor"
            value={surveyorId}
            onChange={(e) => setSurveyorId(e.target.value)}
            options={[{ label: 'Select surveyor', value: '' }, ...surveyors.map((u: any) => ({ label: u.name || u.email, value: u.id }))]}
          />
          <Input label="Scheduled date and time" type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
        </div>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end">
          <Button
            size="sm"
            loading={actions.schedule.isPending}
            disabled={!perms.canCreate('surveys')}
            title={perms.canCreate('surveys') ? undefined : 'You do not have permission to schedule surveys'}
            onClick={() => actions.schedule.mutate(
              { projectId: project.id, surveyorId, scheduledDate, notes },
              { onSuccess: () => { setError(''); toast.success('Survey scheduled'); }, onError: (e: any) => setError(e.message) },
            )}
          >
            Schedule Survey
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-[var(--color-danger-light)] p-2.5 text-xs text-[var(--color-danger-text)]">{error}</p>}
      <SurveyDetail
        survey={latestSurvey}
        startLoading={actions.start.isPending}
        approveRejectLoading={actions.approve.isPending || actions.reject.isPending}
        onStart={() => actions.start.mutate(latestSurvey.id, {
          onSuccess: () => toast.success('Survey started'),
          onError: (e: any) => toast.error(e?.message || 'Failed to start survey'),
        })}
        onReport={() => setReportOpen(true)}
        onApprove={async (note) => {
          try {
            await actions.approve.mutateAsync({ id: latestSurvey.id, note });
            toast.success('Survey approved — engineering draft created');
          } catch (e: any) {
            toast.error(e?.message || 'Failed to approve survey');
          }
        }}
        onReject={async (reason) => {
          try {
            await actions.reject.mutateAsync({ id: latestSurvey.id, reason });
            toast.success('Survey rejected');
          } catch (e: any) {
            toast.error(e?.message || 'Failed to reject survey');
          }
        }}
      />
      <Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Complete survey report" size="xl">
        <SurveyReportForm
          photos={photos}
          loading={actions.submit.isPending}
          onPhotos={async (files) => {
            const uploaded = await uploadSurveyPhotos(latestSurvey.id, files);
            setPhotos((current) => [...current, ...uploaded]);
          }}
          onSubmit={(report) => actions.submit.mutate(
            { id: latestSurvey.id, report },
            {
              onSuccess: () => { setReportOpen(false); setPhotos([]); toast.success('Survey report submitted for approval'); },
              onError: (e: any) => setError(e.message),
            },
          )}
        />
      </Modal>
    </div>
  );
}
