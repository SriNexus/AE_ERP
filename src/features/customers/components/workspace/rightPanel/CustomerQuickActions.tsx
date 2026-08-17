/**
 * CustomerQuickActions — Right Panel widget (Phase 4).
 *
 * Critical architectural rule: the remaining creation button (B2C-only:
 * Create Project) sets/triggers the EXISTING CustomerCenterPanel workflow
 * state (via the `workflow` prop — the same useCustomerCenterWorkflow hook
 * instance the Center Panel itself renders from) rather than implementing a
 * second, competing creation flow — it calls the exact same goToProject
 * function CustomerB2CWorkflowCards' own button calls. Final UI Cleanup
 * mission removed the B2B creation pair and the B2C quotation button
 * entirely (not relocated); a later pass also retired this panel's own
 * bank loan-application creation shortcut (it stays fully available from the
 * Center Panel's own "Work on This Customer" card — the shortcut here was
 * redundant, not the only path to it) — see below.
 *
 * B2C: Project is one-time (B2C Project Timeline & Workspace UX
 * Specification mission) — once a Project already exists, this Quick Action
 * hides (`hasProject`), matching CustomerB2CWorkflowCards' own per-card
 * gating exactly.
 *
 * Every other action reuses an existing capability rather than inventing
 * one: Schedule Follow-up reuses CustomerFollowupModal + createFollowup()
 * (the same modal/mutation CustomersWorkspace.tsx's own Follow-up action
 * uses — see followupWorkflow.ts). Create Task calls taskEngine.createTask()
 * directly (the same function UniversalTasksTab's own AddTaskForm calls).
 * Add Note writes via CustomerDomainService.update(customer.id, { notes })
 * — the exact same `customer.notes` field the Left Panel's Edit Customer /
 * Notes textarea reads and writes (CustomerWorkspaceEditor.tsx), just via
 * the Tier B immediate-write path instead of the Tier A staged draft — no
 * second note system, no duplicated data.
 *
 * Final UI Cleanup mission: the B2B order-creation pair and the B2C
 * quotation button, plus Call/WhatsApp/Email, were removed from this panel
 * entirely (not relocated — Header still has its own Call/WhatsApp/Email
 * buttons, unaffected).
 *
 * Permission strings were verified against lib/permissions.ts's real Module
 * union before use — note 'tasks' is NOT a valid Module, so Create Task is
 * gated on canCreate('customers'), matching how UniversalTasksTab's own
 * "Add task" button is gated (tabPermissions.canCreate, itself
 * perms.canCreate('customers')) rather than a nonexistent 'tasks' module.
 */
import { useState, useEffect } from 'react';
import { HardHat, CalendarClock, ListPlus, StickyNote, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../../../../components/ui/Modal';
import { Button } from '../../../../../components/ui/Button';
import { Input, Select, Textarea } from '../../../../../components/ui/Input';
import { usePermissions } from '../../../../../lib/permissions';
import { taskEngine } from '../../../../../engines/TaskEngine';
import { CustomerDomainService } from '../../../../../services/CustomerDomainService';
import { CustomerFollowupModal } from '../../CustomerFollowupModal';
import { createFollowup } from '../../../services/followupWorkflow';
import type { CustomerCenterWorkflow } from '../../../hooks/useCustomerCenterWorkflow';

interface Props {
  customer: any;
  isB2B: boolean;
  /** B2C one-time-project lifecycle: once a Project already exists, this
   * Quick Action hides. Always `false` for B2B (irrelevant there). */
  hasProject?: boolean;
  companyId: string;
  workflow: CustomerCenterWorkflow;
  sourceLeadId?: string;
  onViewSourceLead?: () => void;
  createdById: string;
  createdByName: string;
}

/** Compact premium action tile — Customer + Lead Workspace UX Parity
 * mission: replaces the old full-width row with a 2-column grid of
 * icon-over-label tiles, the same "Call/WhatsApp/Email chip" visual
 * language (bordered, rounded, shadow-sm) scaled down to fit the Right
 * Panel and stay legible with the action name always visible.
 *
 * Final Customer Module Polish mission: refined the elevation model into a
 * genuine physical-depth read rather than a flat hover/active toggle — a
 * real (if subtle) layered shadow at rest, a fuller one on hover alongside
 * the existing lift, and a flatter, tighter one on press (matched with a
 * small scale-down, the same active:scale-[0.98] convention the workflow
 * cards' own CreateActionButton uses, for a consistent feel across the
 * whole Customer module). Deliberately restrained — no glossy highlight, no
 * exaggerated 3D, just three believable depth states. No new colors —
 * everything reuses the same --color-primary-* tokens the rest of the
 * workspace already uses for "actionable" affordances. */
function ActionButton({ icon, label, onClick, disabled, href, external }: {
  icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; href?: string; external?: boolean;
}) {
  const className = [
    'group flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-2.5 text-center transition-all',
    'shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)]',
    'hover:-translate-y-0.5 hover:border-[var(--color-primary-muted)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.05)]',
    'active:translate-y-0 active:scale-[0.98] active:shadow-[0_1px_1px_rgba(0,0,0,0.04)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1',
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-[var(--color-border)] disabled:hover:shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)]',
  ].join(' ');
  const content = (
    <>
      <span className="text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{icon}</span>
      <span className="text-[10px] font-semibold leading-tight text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{label}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} className={className}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  );
}

function NoteModal({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: any }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(customer?.notes || '');

  useEffect(() => {
    if (open) setNote(customer?.notes || '');
  }, [open, customer]);

  const save = useMutation({
    mutationFn: () => CustomerDomainService.update(customer.id, { notes: note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Note saved');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Note for ${customer?.name || customer?.fullName || ''}`} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} rows={5} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save Note</Button>
        </div>
      </form>
    </Modal>
  );
}

function QuickTaskModal({ open, onClose, customer, companyId, createdById, createdByName }: {
  open: boolean; onClose: () => void; customer: any; companyId: string; createdById: string; createdByName: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');

  const save = useMutation({
    mutationFn: () => taskEngine.createTask({
      title: title.trim(), assigneeId: createdById, assigneeName: createdByName, priority,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      linkedEntityId: customer.id, linkedEntityType: 'customers', companyId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-left-panel-tasks', customer.id] });
      toast.success('Task created');
      setTitle('');
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error('Task title required');
    save.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={`New Task for ${customer?.name || customer?.fullName || ''}`} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Task Title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" autoFocus />
        <Select
          label="Priority" value={priority}
          onChange={(e) => setPriority(e.target.value as any)}
          options={[{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }, { label: 'Critical', value: 'critical' }]}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Create Task</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CustomerQuickActions({ customer, isB2B, hasProject = false, companyId, workflow, sourceLeadId, onViewSourceLead, createdById, createdByName }: Props) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const [showFollowup, setShowFollowup] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);

  const canCreateProjects = perms.canCreate('projects');
  const canScheduleFollowup = perms.canEdit('customers');
  const canCreateTask = perms.canCreate('customers');
  const canEditNote = perms.canEdit('customers');
  const canViewLeads = perms.canView('leads');

  const addFollowup = useMutation({
    mutationFn: (args: { customerId: string; note: string; next: string; existingLog: any[] }) =>
      createFollowup({ ...args, createdById, createdByName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Follow-up added');
      setShowFollowup(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
      <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Quick Actions</h3>
      <div className="grid grid-cols-2 gap-2">
        {!isB2B && !hasProject && (
          <ActionButton icon={<HardHat className="h-4 w-4" />} label="Create Project" onClick={workflow.goToProject} disabled={!canCreateProjects} />
        )}
        <ActionButton icon={<CalendarClock className="h-4 w-4" />} label="Schedule Follow-up" onClick={() => setShowFollowup(true)} disabled={!canScheduleFollowup} />
        <ActionButton icon={<ListPlus className="h-4 w-4" />} label="Create Task" onClick={() => setShowTaskModal(true)} disabled={!canCreateTask} />
        <ActionButton icon={<StickyNote className="h-4 w-4" />} label="Add Note" onClick={() => setShowNoteModal(true)} disabled={!canEditNote} />
        {sourceLeadId && canViewLeads && onViewSourceLead && (
          <ActionButton icon={<Link2 className="h-4 w-4" />} label="View Source Lead" onClick={onViewSourceLead} />
        )}
      </div>

      <CustomerFollowupModal
        open={showFollowup}
        customer={showFollowup ? customer : null}
        onClose={() => setShowFollowup(false)}
        onSave={(args) => addFollowup.mutate(args)}
        saving={addFollowup.isPending}
      />
      <QuickTaskModal
        open={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        customer={customer}
        companyId={companyId}
        createdById={createdById}
        createdByName={createdByName}
      />
      <NoteModal
        open={showNoteModal}
        onClose={() => setShowNoteModal(false)}
        customer={customer}
      />
    </div>
  );
}
