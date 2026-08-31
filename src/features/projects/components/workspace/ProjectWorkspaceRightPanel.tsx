/**
 * ProjectWorkspaceRightPanel — Project Workspace Right Panel: Project
 * Health → Quick Actions → Project Statistics → Linked Records, matching
 * Customer's "most important/actionable content first" ordering.
 *
 * Recent Activity was moved to the Center Panel's own secondary sections
 * (ProjectWorkspaceSections.tsx) — mirroring Customer Workspace's own
 * documented precedent of removing the Right Panel's Recent Activity once
 * the Center gained an equivalent peek, since two "what happened recently"
 * widgets on the same screen was real duplication with no distinguishing
 * purpose. Keeping the compact Linked Records widget here as well as the
 * fuller one in the Center matches that same precedent (Customer keeps
 * both forms too — a quick count-based glance here, full detail there).
 *
 * Linked Records reuses CustomerLinkedRecords verbatim, scoped to this
 * project's own linked customerId — not a parallel relationship system.
 * That component only ever depended on customerId/companyId props (never
 * anything Customer-specific internally), so passing the Project's own
 * linked customer's id is a genuine, correct reuse of the same customer
 * relationship graph, per the mission's explicit instruction — not a copy
 * of its markup.
 */
import { useState } from 'react';
import { Zap, User as UserIcon, Link2, Wrench, Plus } from 'lucide-react';
import { usePermissions } from '../../../../lib/permissions';
import { fmtDate } from '../../../../lib/firestore';
import { isProjectStageAtOrPast } from '../../../../lib/projectLifecycle';
import { useCreateServiceTicket } from '../../../service-tickets/hooks/useServiceTickets';
import type { ServiceTicketCreateInput } from '../../../../lib/serviceTicketWorkflow';
import { Modal } from '../../../../components/ui/Modal';
import { Input, Textarea } from '../../../../components/ui';
import CustomerLinkedRecords from '../../../customers/components/workspace/rightPanel/CustomerLinkedRecords';
import ProjectHealthCard from './rightPanel/ProjectHealthCard';
import type { ProjectRecord } from '../../types';

const ISSUE_TYPES = ['Warranty Claim', 'Fault Repair', 'Cleaning', 'Inspection', 'Performance Issue', 'Other'] as const;
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;

interface Props {
  project: ProjectRecord;
  companyId: string;
  customerName?: string;
  onViewCustomer?: () => void;
  onViewSourceLead?: () => void;
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[var(--color-text-muted)] shrink-0">{icon}</span>
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      </div>
      <div className="text-[12.5px] font-medium text-[var(--color-text)] truncate">{value}</div>
    </div>
  );
}

/** Same elevation model the equivalent Customer Workspace quick-action
 * button uses — a genuine (if subtle) layered shadow at rest, a fuller one
 * on hover alongside the lift, a flatter/tighter one on press. */
function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-2.5 text-center transition-all shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 hover:border-[var(--color-primary-muted)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.05)] active:translate-y-0 active:scale-[0.98] active:shadow-[0_1px_1px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1"
    >
      <span className="text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{icon}</span>
      <span className="text-[10px] font-semibold leading-tight text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{label}</span>
    </button>
  );
}

export default function ProjectWorkspaceRightPanel({ project, companyId, customerName, onViewCustomer, onViewSourceLead }: Props) {
  const perms = usePermissions();
  const canViewCustomers = perms.canView('customers');
  const canViewLeads = perms.canView('leads');
  const canCreateProjects = perms.canCreate('projects');
  const teamAssigned = [project.salesOwner, project.assignedSurveyor, project.assignedInstaller].filter(Boolean).length;

  // Service Ticket: only visible after project reaches Handover (completion)
  const isCompleted = isProjectStageAtOrPast(project.currentStage, 'Handover');
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketForm, setTicketForm] = useState<Partial<ServiceTicketCreateInput>>({});
  const createTicketMut = useCreateServiceTicket();

  function openTicketModal() {
    setTicketForm({
      projectId: project.id,
      projectName: project.projectId || project.id,
      customerId: project.customerId || '',
      customerName: customerName || '',
      issueType: 'Fault Repair',
      description: '',
      priority: 'Medium',
      notes: '',
    });
    setTicketModalOpen(true);
  }

  function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketForm.issueType || !ticketForm.description) return;
    createTicketMut.mutate(ticketForm as ServiceTicketCreateInput, {
      onSuccess: () => { setTicketModalOpen(false); setTicketForm({}); },
    });
  }

  const actionCount = [
    onViewCustomer && canViewCustomers,
    onViewSourceLead && canViewLeads,
    isCompleted && canCreateProjects,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col">
      <ProjectHealthCard project={project} />

      {actionCount > 0 && (
        <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
          <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            {onViewCustomer && canViewCustomers && (
              <ActionButton icon={<UserIcon className="h-4 w-4" />} label="View Customer" onClick={onViewCustomer} />
            )}
            {onViewSourceLead && canViewLeads && (
              <ActionButton icon={<Link2 className="h-4 w-4" />} label="View Source Lead" onClick={onViewSourceLead} />
            )}
            {isCompleted && canCreateProjects && (
              <ActionButton icon={<Wrench className="h-4 w-4" />} label="Service Ticket" onClick={openTicketModal} />
            )}
          </div>
        </div>
      )}

      {/* Project Statistics — deliberately does NOT repeat Capacity or Site
          Address (already shown once in the Header) — only genuinely
          Project-specific numbers not shown anywhere else yet. */}
      <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
        <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project Statistics</h3>
        <div className="space-y-2">
          <StatChip icon={<UserIcon className="h-3.5 w-3.5" />} label="Team Assigned" value={`${teamAssigned}/3 roles`} />
          <StatChip icon={<Zap className="h-3.5 w-3.5" />} label="Linked Quotations" value={String((project.linkedQuotationIds || []).length)} />
          <StatChip icon={<Zap className="h-3.5 w-3.5" />} label="Linked Orders" value={String((project.linkedOrderIds || []).length)} />
          <StatChip icon={<Zap className="h-3.5 w-3.5" />} label="Last Updated" value={fmtDate(project.updatedAt)} />
        </div>
      </div>

      <CustomerLinkedRecords customerId={project.customerId} companyId={companyId} />

      {/* Service Ticket creation modal — auto-fills project + customer context */}
      <Modal open={ticketModalOpen} onClose={() => setTicketModalOpen(false)} title="Raise Service Ticket" size="md">
        <form onSubmit={handleCreateTicket} className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            Project: {project.projectId || project.id} · Customer: {customerName || '—'}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Issue Type *</label>
              <select required value={ticketForm.issueType || ''} onChange={(e) => setTicketForm({ ...ticketForm, issueType: e.target.value })}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Priority *</label>
              <select required value={ticketForm.priority || 'Medium'} onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value as any })}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Description *</label>
            <textarea required value={ticketForm.description || ''} onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })} rows={3}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" placeholder="Describe the issue..." />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Assign Technician</label>
            <input value={ticketForm.assignedTechnicianName || ''} onChange={(e) => setTicketForm({ ...ticketForm, assignedTechnicianName: e.target.value })}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" placeholder="Technician name" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setTicketModalOpen(false)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]">Cancel</button>
            <button type="submit" disabled={createTicketMut.isPending}
              className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50">
              {createTicketMut.isPending ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
