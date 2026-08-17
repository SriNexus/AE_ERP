/**
 * MobileCasesWorkspace — Mobile-optimized Case workspace
 *
 * Phase 3M — Mobile Support
 * Route: /cases/:id (mobile)
 *
 * Features:
 *   - Overview section with key fields
 *   - Vertical timeline (collapsible stages)
 *   - Activity list
 *   - Tasks list
 *   - Linked records
 *   - Documents
 *   - Mobile-optimized layout with sticky header
 *   - Touch-friendly interactions
 */

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getOne, getAll, fmtDate, fmtCurrency,
} from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { queryKeys } from '../../lib/queryKeys';
import { cn } from '../../utils/cn';
import {
  ArrowLeft, FolderKanban, ChevronRight, ChevronDown,
  CheckCircle2, AlertTriangle, XCircle, Clock, User,
  Building2, FileText, ShoppingCart, CreditCard, Truck,
  Wrench, ClipboardCheck, Zap, Gauge, PiggyBank,
  Handshake, Shield, Headphones, Activity,
  ListTodo, Link2, Paperclip, RefreshCw,
} from 'lucide-react';
import { CaseTimelineTab } from '../../features/cases/components/CaseTimelineTab';
import { TOUCH } from '../../components/mobile/shared/styles';

// ── Tab definitions ────────────────────────────────────────

type MobileTab = 'overview' | 'timeline' | 'activity' | 'tasks' | 'linked' | 'documents';

const TABS: Array<{ id: MobileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview',  label: 'Overview',  icon: FolderKanban },
  { id: 'timeline',  label: 'Timeline',  icon: Clock },
  { id: 'activity',  label: 'Activity',  icon: Activity },
  { id: 'tasks',     label: 'Tasks',     icon: ListTodo },
  { id: 'linked',    label: 'Linked',    icon: Link2 },
  { id: 'documents', label: 'Docs',      icon: Paperclip },
];

// ── Helpers ────────────────────────────────────────────────

function fmtDateSafe(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return fmtDate((value as any).toDate());
  }
  if (typeof value === 'object' && value && 'seconds' in value) {
    return fmtDate(new Date(Number((value as any).seconds) * 1000));
  }
  return fmtDate(String(value));
}

// ── Component ──────────────────────────────────────────────

export default function MobileCasesWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const qkeys = queryKeys.forCompany(activeCompanyId);
  const [activeTab, setActiveTab] = useState<MobileTab>('overview');

  // ── Data queries ─────────────────────────────────────────
  const caseQ = useQuery({
    queryKey: ['mobile-case', id],
    queryFn: () => getOne(COLLECTIONS.CASES, id || ''),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
  const caseRecord = caseQ.data as any;

  const leadsQ = useQuery({ queryKey: qkeys.leadsRoot, queryFn: () => getAll(COLLECTIONS.LEADS), staleTime: 60_000 });
  const customersQ = useQuery({ queryKey: qkeys.customersAll, queryFn: () => getAll(COLLECTIONS.CUSTOMERS), staleTime: 60_000 });
  const projectsQ = useQuery({ queryKey: qkeys.projectsRoot, queryFn: () => getAll(COLLECTIONS.PROJECTS), staleTime: 60_000 });
  const tasksQ = useQuery({ queryKey: ['tasks', activeCompanyId, 'mobile'], queryFn: () => getAll('tasks'), staleTime: 60_000 });

  const allLeads = (leadsQ.data as any[]) || [];
  const allCustomers = (customersQ.data as any[]) || [];
  const allProjects = (projectsQ.data as any[]) || [];
  const allTasks = (tasksQ.data as any[]) || [];

  // ── Derived data ─────────────────────────────────────────
  const caseId = caseRecord?.caseId || id || '';
  const leadId = caseRecord?.leadId;
  const customerId = caseRecord?.customerId;

  const lead = useMemo(() => {
    if (!leadId) return null;
    return allLeads.find((l: any) => l.id === leadId) || null;
  }, [leadId, allLeads]);

  const customer = useMemo(() => {
    if (customerId) return allCustomers.find((c: any) => c.id === customerId) || null;
    return null;
  }, [customerId, allCustomers]);

  const project = useMemo(() => {
    if (!customer) return null;
    return allProjects.find((p: any) => p.customerId === customer.id) || null;
  }, [customer, allProjects]);

  const caseTasks = useMemo(() => {
    return allTasks.filter((t: any) => String(t.caseId || '') === caseId && !t.isDeleted);
  }, [allTasks, caseId]);

  // ── Loading ──────────────────────────────────────────────
  if (caseQ.isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-[var(--color-bg)]">
        <div className="flex items-center gap-3 px-3 py-3 border-b border-[var(--color-border-subtle)]">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-bg-sunken)] animate-pulse" />
          <div className="h-5 w-40 bg-[var(--color-bg-sunken)] rounded animate-pulse" />
        </div>
        <div className="p-4 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!caseRecord) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8">
        <FolderKanban className="h-12 w-12 text-[var(--color-text-muted)] opacity-40" />
        <h2 className="mt-4 text-lg font-semibold">Case not found</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">This case does not exist or has been deleted.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[var(--color-bg)]">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg)]/90 backdrop-blur-lg border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className={cn(TOUCH.MIN, 'p-1.5 rounded-lg shrink-0')}
          >
            <ArrowLeft className="h-5 w-5 text-[var(--color-text-muted)]" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-[var(--color-text)] truncate">{caseRecord.caseId || caseRecord.id}</h1>
            <p className="text-[10px] text-[var(--color-text-muted)]">{caseRecord.currentStage || 'New'}</p>
          </div>
          <StatusPill status={caseRecord.status} />
        </div>

        {/* Tab bar — scrollable */}
        <div className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all',
                  activeTab === tab.id
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-text-muted)] bg-[var(--color-bg-sunken)]',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-28">
        {activeTab === 'overview' && <OverviewTab record={caseRecord} lead={lead} customer={customer} project={project} navigate={navigate} />}
        {activeTab === 'timeline' && <TimelineTab caseId={caseId} />}
        {activeTab === 'activity' && <ActivityTab record={caseRecord} />}
        {activeTab === 'tasks' && <TasksTab tasks={caseTasks} navigate={navigate} />}
        {activeTab === 'linked' && <LinkedTab record={caseRecord} lead={lead} customer={customer} project={project} navigate={navigate} />}
        {activeTab === 'documents' && <DocumentsTab />}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const cfg: Record<string, string> = {
    Active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    Completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    Archived: 'bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300',
    Failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <span className={cn('px-2 py-0.5 text-[10px] font-semibold rounded-full', cfg[status] || 'bg-gray-100 text-gray-800')}>
      {status}
    </span>
  );
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{value ?? <span className="text-[var(--color-text-disabled)]">—</span>}</p>
    </div>
  );
}

function OverviewTab({ record, lead, customer, project, navigate }: any) {
  return (
    <div className="space-y-4 mt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Case Information</h3>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Case ID" value={record.caseId || record.id} />
        <Field label="Status" value={record.status || '—'} />
        <Field label="Current Stage" value={record.currentStage || 'New'} />
        <Field label="Created" value={fmtDateSafe(record.createdAt)} />
        <Field label="Last Updated" value={fmtDateSafe(record.updatedAt)} />
      </div>

      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Linked Entities</h3>
      <div className="space-y-2">
        <LinkedEntityCard label="Lead" name={lead?.name} onClick={() => lead && navigate(`/leads/workspace/${encodeURIComponent(lead.id)}`)} available={!!lead} />
        <LinkedEntityCard label="Customer" name={customer?.name} onClick={() => customer && navigate(`/customers/${encodeURIComponent(customer.id)}`)} available={!!customer} />
        <LinkedEntityCard label="Project" name={project?.projectName} onClick={() => project && navigate(`/projects/${encodeURIComponent(project.id)}`)} available={!!project} />
      </div>
    </div>
  );
}

function LinkedEntityCard({ label, name, onClick, available }: { label: string; name?: string; onClick: () => void; available: boolean }) {
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] px-3 py-2.5 text-left',
        available ? 'active:scale-[0.98] transition-transform' : 'opacity-50',
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
        <Building2 className="h-4 w-4 text-indigo-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</p>
        <p className="text-sm font-medium text-[var(--color-text)] truncate">{name || 'Not linked'}</p>
      </div>
      {available && <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />}
    </button>
  );
}

function TimelineTab({ caseId }: { caseId: string }) {
  // Reuse the existing desktop CaseTimelineTab component
  return (
    <div className="mt-4">
      <CaseTimelineTab caseId={caseId} />
    </div>
  );
}

function ActivityTab({ record }: { record: any }) {
  const history = record.stageHistory || [];
  const stageHistory = Array.isArray(history) ? history : [];

  return (
    <div className="space-y-3 mt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Stage History</h3>
      {stageHistory.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No stage history available</p>
      ) : (
        <div className="relative pl-6 space-y-3">
          {stageHistory.map((entry: any, i: number) => (
            <div key={i} className="relative">
              {/* Vertical line */}
              {i < stageHistory.length - 1 && (
                <div className="absolute left-[-14px] top-4 bottom-0 w-0.5 bg-[var(--color-border-subtle)]" />
              )}
              {/* Dot */}
              <div className="absolute left-[-18px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)] border-2 border-[var(--color-bg)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">{entry.stage}</p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                  {entry.changedBy ? `by ${entry.changedBy}` : ''} · {fmtDateSafe(entry.changedAt)}
                </p>
                {entry.note && <p className="text-xs text-[var(--color-text-secondary)] mt-1">{entry.note}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TasksTab({ tasks, navigate }: { tasks: any[]; navigate: any }) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <ListTodo className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
        <p className="text-sm text-[var(--color-text-muted)]">No tasks for this case</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-4">
      {tasks.map((task: any) => (
        <button
          key={task.id}
          type="button"
          onClick={() => navigate(`/tasks/${encodeURIComponent(task.id)}`)}
          className={cn(
            'w-full flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)]',
            'px-3 py-2.5 text-left active:scale-[0.98] transition-transform',
          )}
        >
          <div className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
            task.status === 'Done' ? 'bg-emerald-50 dark:bg-emerald-900/20' :
            task.status === 'In Progress' ? 'bg-blue-50 dark:bg-blue-900/20' :
            'bg-amber-50 dark:bg-amber-900/20',
          )}>
            <ListTodo className={cn(
              'h-4 w-4',
              task.status === 'Done' ? 'text-emerald-600' :
              task.status === 'In Progress' ? 'text-blue-600' :
              'text-amber-600',
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)] truncate">{task.title || task.id}</p>
            <p className="text-[10px] text-[var(--color-text-muted)]">{task.status || 'Open'} · {task.assignedToName || 'Unassigned'}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
        </button>
      ))}
    </div>
  );
}

function LinkedTab({ record, lead, customer, project, navigate }: any) {
  const links = [
    { label: 'Lead', type: 'Lead', id: record.leadId, name: lead?.name, route: (id: string) => `/leads/workspace/${encodeURIComponent(id)}` },
    { label: 'Customer', type: 'Customer', id: record.customerId, name: customer?.name, route: (id: string) => `/customers/${encodeURIComponent(id)}` },
    { label: 'Project', type: 'Project', id: project?.id, name: project?.projectName, route: (id: string) => `/projects/${encodeURIComponent(id)}` },
  ];

  return (
    <div className="space-y-2 mt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Linked Records</h3>
      {links.filter(l => l.id).length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No linked records</p>
      ) : (
        links.filter(l => l.id).map((link) => (
          <button
            key={link.label}
            type="button"
            onClick={() => navigate(link.route(link.id))}
            className={cn(
              'w-full flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)]',
              'px-3 py-2.5 text-left active:scale-[0.98] transition-transform',
            )}
          >
            <div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
              <Link2 className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--color-text-muted)]">{link.label}</p>
              <p className="text-sm font-medium text-[var(--color-text)] truncate">{link.name || link.id}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
          </button>
        ))
      )}
    </div>
  );
}

function DocumentsTab() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Paperclip className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
      <p className="text-sm text-[var(--color-text-muted)]">Open the desktop workspace to manage documents</p>
    </div>
  );
}
