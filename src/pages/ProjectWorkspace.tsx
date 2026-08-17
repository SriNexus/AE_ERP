/**
 * ProjectWorkspace — Individual project workspace page at /projects/:id
 *
 * Project Workspace UI Structure mission: rebuilt from the old generic
 * shared-workspace-shell + tab-config architecture into an exact structural
 * replica of the finalized Customer/Leads Workspace design system — same
 * outer -m-5/p-2/gap-2 wrapper, same rounded-xl/border/shadow-sm surface
 * treatment on Header/Left/Center/Right, same 25% / remainder / 19% panel
 * sizing (Leads Workspace's own finalized Left Panel width and Customer
 * Workspace's own finalized Right Panel width — the two established
 * source-of-truth reference widths this whole ERP now shares, not a new
 * invented ratio).
 *
 * The old page-width tab bar (the shared workspace shell's own tab-config
 * dispatch — Overview/Tasks/Notes/Activity/Documents/History/Linked
 * Records/Permissions/Disposable) is retired from this page, matching Customer/
 * Leads Workspace's own tabless "always-open primary card" architecture —
 * not deleted from the codebase (ProjectOverview.tsx / workspaceConfig.tsx
 * remain untouched, simply unmounted here, in case a later phase reuses
 * pieces of them for the Center Panel's real implementation).
 *
 * Center Panel was intentionally minimal in an earlier phase — just a
 * "Work on This Project" card shell, no real workflow actions. No Footer
 * either (not part of this phase's scope — Previous/Next queue navigation
 * and any Save behavior would need their own design pass, not assumed here).
 *
 * No Project business logic, data model, permissions, or routes were
 * changed — this is a structural/visual rebuild only.
 *
 * Phase 2 Completion & Structure Fix mission: added Documents (the same
 * shared DocumentManager Customer/Lead already wrap, via a new adapter —
 * see ProjectWorkspaceDocumentsSection.tsx), redesigned the Left Panel
 * (ProjectWorkspaceLeftPanel/ProjectContextPanel), and brought the Right
 * Panel up to Customer/Leads' operational depth (Health/Quick Actions/
 * Statistics/Linked Records).
 *
 * Left Panel feedback pass: Edit is now an INLINE panel swap (the same
 * interaction Lead Workspace's own Left Panel already uses — editForm
 * state + Save/Cancel buttons, persisted via the EXISTING useSaveProject/
 * updateProject mutation), replacing the earlier popup-modal edit.
 * Documents/Activity/Notes/Linked Records were consolidated into
 * ProjectWorkspaceSections.tsx (the same PeekCard/CollapsedRow shell
 * Customer/Lead Workspace's own secondary sections use — see
 * components/shared/WorkspaceSectionCards.tsx), mounted below "Work on
 * This Project".
 *
 * Project Workspace Stage Lifecycle mission (Phase 3): "Work on This
 * Project" is no longer a placeholder — it now hosts the real 13-stage
 * lifecycle as an accordion (ProjectWorkOnThisProject.tsx), sourced from
 * the EXISTING resolveProjectWorkspaceStages() engine
 * (src/hooks/useProjectStage.ts), not a reimplemented lifecycle. Only the
 * Survey stage has a complete operational workspace this phase (see
 * features/projects/components/workspace/stages/) — the reference
 * implementation the remaining 12 will follow one at a time.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/shared';
import { getAll, getOne } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { queryKeys } from '../lib/queryKeys';
import { useAppStore } from '../store/useAppStore';
import { usePermissions } from '../lib/permissions';
import { useProjects, useSaveProject } from '../features/projects/hooks/useProjects';
import { PROJECT_FORM_DEFAULT, type ProjectFormValues, type ProjectSiteAddress } from '../features/projects/types';
import ProjectWorkspaceHeader from '../features/projects/components/workspace/ProjectWorkspaceHeader';
import ProjectWorkspaceLeftPanel from '../features/projects/components/workspace/ProjectWorkspaceLeftPanel';
import ProjectWorkOnThisProject from '../features/projects/components/workspace/ProjectWorkOnThisProject';
import ProjectWorkspaceSections from '../features/projects/components/workspace/ProjectWorkspaceSections';
import ProjectWorkspaceRightPanel from '../features/projects/components/workspace/ProjectWorkspaceRightPanel';

export default function ProjectWorkspace() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const perms = usePermissions();
  const { id = '' } = useParams();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const projectsQuery = useProjects();
  const project = useMemo(
    () => (projectsQuery.data || []).find((item) => item.id === id || item.projectId === id) || null,
    [id, projectsQuery.data]
  );

  // Same query-keyed lookup the old page used — a Project has no name/
  // phone/email of its own, so the linked Customer's identity fields are
  // fetched once here for the Header/Left/Right panels to share (React
  // Query dedups by key, no per-panel refetch).
  const customerQuery = useQuery({
    queryKey: [...keys.customersRoot, 'project-workspace', project?.customerId],
    queryFn: () => getOne<Record<string, unknown>>(COLLECTIONS.CUSTOMERS, project!.customerId),
    enabled: Boolean(project?.customerId),
    staleTime: 60_000,
  });

  // Same 'users' query key CustomerWorkspaceEditor.tsx's own salesperson
  // dropdown already uses (React Query dedups) — needed here for the Left
  // Panel's Team phone-number lookup and the Right Panel's Recent Activity
  // changedBy→name resolution. Both are real cross-references against
  // already-existing data, not fabricated.
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    staleTime: 300_000,
  });
  const users = usersQuery.data || [];

  const customer = customerQuery.data as any;
  const customerName = customer ? String(customer.name || customer.fullName || customer.contactPerson || '') || undefined : undefined;
  const customerPhone = customer ? String(customer.phone || customer.mobile || customer.businessPhone || '') || undefined : undefined;
  const customerEmail = customer ? String(customer.email || customer.businessEmail || '') || undefined : undefined;
  // Project Type is a real field on the Project record itself (Residential/
  // Commercial/Industrial) — not derived from the linked Customer.
  const projectType = project?.projectType || undefined;

  const canEditProject = perms.canEdit('projects');
  const tabPermissions = { canView: true, canCreate: perms.canCreate('projects'), canEdit: canEditProject, canDelete: perms.canDelete('projects') };

  // ── Edit — inline panel swap, the same interaction Lead Workspace's own
  // Left Panel already uses (editForm state + Save/Cancel), persisted via
  // the EXISTING useSaveProject/updateProject mutation — the same one
  // Projects.tsx's list page already uses, not a new save path. Called
  // unconditionally (before the loading/not-found early returns) so hook
  // order stays stable. ──
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [editForm, setEditForm] = useState<ProjectFormValues>(PROJECT_FORM_DEFAULT);
  const saveProjectMut = useSaveProject(project?.id || null, () => {
    void qc.invalidateQueries({ queryKey: keys.projectsRoot });
    setIsEditingProject(false);
  });

  function seedEditForm(p: NonNullable<typeof project>): ProjectFormValues {
    return {
      customerId: p.customerId || '',
      leadId: p.leadId || '',
      capacityKw: String(p.capacityKw ?? ''),
      projectType: p.projectType || '',
      salesOwner: p.salesOwner || '',
      assignedSurveyor: p.assignedSurveyor || '',
      assignedInstaller: p.assignedInstaller || '',
      notes: p.notes || '',
      siteAddress: {
        line1: p.siteAddress?.line1 || '',
        line2: p.siteAddress?.line2 || '',
        landmark: p.siteAddress?.landmark || '',
        city: p.siteAddress?.city || '',
        district: p.siteAddress?.district || '',
        state: p.siteAddress?.state || '',
        pincode: p.siteAddress?.pincode || '',
        country: p.siteAddress?.country || 'India',
      },
    };
  }

  function startEditProject() {
    if (!project) return;
    setEditForm(seedEditForm(project));
    setIsEditingProject(true);
  }

  function cancelEditProject() {
    setIsEditingProject(false);
  }

  function saveEditProject() {
    if (saveProjectMut.isPending) return;
    saveProjectMut.mutate(editForm);
  }

  function editField(field: keyof ProjectFormValues, value: string) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  function editAddressField(field: keyof ProjectSiteAddress, value: string) {
    setEditForm((prev) => ({ ...prev, siteAddress: { ...prev.siteAddress, [field]: value } }));
  }

  const handleDocsSaved = () => {
    void qc.invalidateQueries({ queryKey: keys.projectsRoot });
  };

  if (projectsQuery.isLoading) {
    return (
      <div className="-m-5 p-2 flex h-full min-h-0 animate-pulse flex-col gap-2 overflow-hidden bg-[var(--color-bg)]" style={{ height: 'calc(100% + 2.5rem)' }}>
        <div className="flex shrink-0 items-center gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-6 py-4">
          <div className="h-12 w-12 shrink-0 rounded-full bg-[var(--color-bg-sunken)]" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-48 rounded-md bg-[var(--color-bg-sunken)]" />
            <div className="h-3 w-64 rounded-md bg-[var(--color-bg-sunken)]" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
          <div className="w-[25%] shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-8 rounded-lg bg-[var(--color-bg-sunken)]" />)}
          </div>
          <div className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4">
            <div className="h-32 rounded-2xl bg-[var(--color-bg-sunken)]" />
          </div>
          <div className="w-[19%] shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4 space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-[var(--color-bg-sunken)]" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return <EmptyState title="Project not found" description="The project does not exist or is outside your visibility scope." action={<Link to="/projects"><Button variant="outline">Back to Projects</Button></Link>} />;
  }

  const onViewCustomer = project.customerId ? () => navigate(`/customers/${encodeURIComponent(project.customerId)}`) : undefined;
  const onViewSourceLead = project.leadId ? () => navigate(`/leads/workspace/${encodeURIComponent(project.leadId as string)}`) : undefined;

  return (
    <div className="-m-5 p-2 flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)]" style={{ height: 'calc(100% + 2.5rem)' }}>
      <ProjectWorkspaceHeader
        project={project}
        customerName={customerName}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        onViewCustomer={onViewCustomer}
        onBack={() => navigate('/projects')}
      />

      {/* ── BODY (Left 25% / Center remainder / Right 19% — see file
          comment for why these two widths, not a new invented ratio) ── */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden">
        <div className="w-[25%] shrink-0 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4">
          <ProjectWorkspaceLeftPanel
            project={project}
            customerName={customerName}
            projectType={projectType}
            users={users}
            canEdit={canEditProject}
            isEditing={isEditingProject}
            editForm={editForm}
            saving={saveProjectMut.isPending}
            onStartEdit={startEditProject}
            onCancelEdit={cancelEditProject}
            onSaveEdit={saveEditProject}
            onFieldChange={editField}
            onAddressFieldChange={editAddressField}
          />
        </div>

        {/* Center Panel — "Work on This Project" is now the Project's real
            operational command center (Project Workspace Stage Lifecycle
            mission): all 13 real lifecycle stages, one expanded at a time,
            Survey fully implemented (see ProjectWorkOnThisProject.tsx).
            ProjectWorkspaceSections (Documents/Activity/Notes/Linked
            Records) stays mounted immediately below it, unchanged. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              <ProjectWorkOnThisProject
                key={project.id}
                project={project}
                customer={customer}
                users={users}
                canEditProject={canEditProject}
              />

              <ProjectWorkspaceSections
                project={project}
                customer={customer}
                users={users}
                activeCompanyId={activeCompanyId}
                canEditProject={canEditProject}
                permissions={tabPermissions}
                onDocsSaved={handleDocsSaved}
              />
            </div>
          </div>
        </div>

        <div className="w-[19%] shrink-0 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <ProjectWorkspaceRightPanel
            project={project}
            companyId={activeCompanyId}
            onViewCustomer={onViewCustomer}
            onViewSourceLead={onViewSourceLead}
          />
        </div>
      </div>
    </div>
  );
}
