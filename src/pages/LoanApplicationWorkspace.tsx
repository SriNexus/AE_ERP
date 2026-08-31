/**
 * LoanApplicationWorkspace — Full workspace page for individual Loan
 * Applications at /loan-applications/:id. Follows the Project Workspace
 * architecture: base-less header, 3-panel layout (Left=Project+Customer
 * Context, Center=Loan Application Workspace, Right=Quick Actions).
 *
 * Two kinds of interaction:
 * A. STATUS UPDATE — inline dropdown, one-click, no full form needed
 * B. EDIT — opens full form for deep application data changes
 */
import { Suspense, useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Edit2, Trash2, Send, FileText,
  Phone, Mail, MessageCircle, User, MapPin, Save, X, Hash,
  ChevronDown, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/shared';
import { CollapsedRow } from '../components/shared/WorkspaceSectionCards';
import { usePermissions } from '../lib/permissions';
import { useAppStore, useCurrentUser } from '../store/useAppStore';
import { getAll, getOne, updateDocById, fmtDate, fmtCurrency } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { queryKeys } from '../lib/queryKeys';
import { useLoanApplications, LOAN_APPLICATION_STATUSES } from '../features/loan-applications/hooks/useLoanApplications';
import { loanApplicationStatusBadge } from '../features/loan-applications/components/LoanApplicationWorkspaceParts';
import { useUserNameResolver } from '../hooks/useUserNameResolver';
import type { ProjectRecord } from '../features/projects/types';

// ── Two-column info grid — compact, uses center width properly ────
function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">{children}</div>;
}

function InfoField({ label, value, span }: { label: string; value?: React.ReactNode; span?: boolean }) {
  if (value === undefined || value === null || value === '' || value === '—') return null;
  return (
    <div className={`flex items-baseline justify-between gap-2 py-2 border-b border-[var(--color-border-subtle)] last:border-b-0 ${span ? 'sm:col-span-2' : ''}`}>
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="text-[12px] font-medium text-[var(--color-text)] text-right break-words">{value}</span>
    </div>
  );
}

// ── Left-panel InfoRow (compact for sidebar) ──────────────────────
function LeftInfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '' || value === '—') return null;
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-1.5 gap-2 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <span className="text-[11px] font-medium text-[var(--color-text)] break-words leading-4">{value}</span>
    </div>
  );
}

function LeftLinkRow({ label, displayText, href }: { label: string; displayText?: string; href: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start py-1.5 gap-2 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] leading-4">{label}</span>
      <a href={href} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline leading-4">
        {displayText || label}
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}

function QuickAction({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className="group flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2.5 text-center transition-all shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 hover:border-[var(--color-primary-muted)] hover:shadow-[0_6px_14px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.05)] active:translate-y-0 active:scale-[0.98] active:shadow-[0_1px_1px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:border-[var(--color-border)] disabled:hover:shadow-[0_1px_2px_rgba(0,0,0,0.045),0_1px_1px_rgba(0,0,0,0.03)]"
    >
      <span className="text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{icon}</span>
      <span className="text-[10px] font-semibold leading-tight text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-primary-text)]">{label}</span>
    </button>
  );
}

function customerField(customer: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!customer) return '';
  for (const key of keys) {
    const val = String(customer[key] || '').trim();
    if (val) return val;
  }
  return '';
}

export default function LoanApplicationWorkspace() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const perms = usePermissions();
  const user = useCurrentUser();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  const resolveUserName = useUserNameResolver();

  // ── Loan Application data
  const { data: registrations = [], isLoading } = useLoanApplications();
  const reg = useMemo(() => (registrations as any[]).find((r) => r.id === id) || null, [id, registrations]);

  // ── Project data (if linked)
  const projectQuery = useQuery({
    queryKey: [...keys.projectsRoot, 'loan-workspace', reg?.projectId],
    queryFn: () => getOne<ProjectRecord>(COLLECTIONS.PROJECTS, reg!.projectId),
    enabled: Boolean(reg?.projectId),
    staleTime: 60_000,
  });
  const project = projectQuery.data as ProjectRecord | undefined;

  // ── Customer data
  const customerQuery = useQuery({
    queryKey: [...keys.customersRoot, 'loan-workspace', reg?.customerId],
    queryFn: () => getOne<Record<string, unknown>>(COLLECTIONS.CUSTOMERS, reg!.customerId),
    enabled: Boolean(reg?.customerId),
    staleTime: 60_000,
  });
  const customer = customerQuery.data as Record<string, unknown> | undefined;

  const canEdit = perms.canEdit('loan_applications');
  const canDelete = perms.canDelete('loan_applications');

  // ── Delete
  const [showDelete, setShowDelete] = useState(false);
  const handleDelete = useCallback(async () => {
    if (!reg?.id) return;
    const { softDelete } = await import('../lib/firestore');
    const { COLLECTIONS: COLS } = await import('../lib/firebase');
    await softDelete(COLS.LOAN_APPLICATIONS, reg.id);
    qc.invalidateQueries({ queryKey: keys.registrationsPaged });
    toast.success('Loan Application deleted');
    navigate('/loan-applications');
  }, [reg, qc, keys, navigate]);

  // ════════════════════════════════════════════════════════════════
  // A. INLINE STATUS UPDATE — real Firestore persistence, no full form
  // ════════════════════════════════════════════════════════════════
  const [statusUpdating, setStatusUpdating] = useState(false);
  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!reg?.id || newStatus === reg.status) return;
    setStatusUpdating(true);
    try {
      await updateDocById(COLLECTIONS.LOAN_APPLICATIONS, reg.id, {
        status: newStatus,
        updatedBy: user?.id,
      });
      qc.invalidateQueries({ queryKey: keys.registrationsPaged });
      toast.success(`Status updated to ${newStatus}`);
    } catch (err) {
      toast.error('Failed to update status');
    } finally {
      setStatusUpdating(false);
    }
  }, [reg, user, qc, keys]);

  // ════════════════════════════════════════════════════════════════
  // B. FULL EDIT — for deep application data changes
  // ════════════════════════════════════════════════════════════════
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  function startEdit() {
    if (!reg) return;
    setEditForm({
      bankName: reg.bankName || '',
      branch: reg.branch || '',
      loanAmount: String(reg.loanAmount || ''),
      applicationNumber: reg.applicationNumber || '',
      caseId: reg.caseId || '',
      status: reg.status || 'Draft',
      assignedToName: reg.assignedToName || '',
      assignedToId: reg.assignedToId || '',
      digitalSignStatus: reg.digitalSignStatus || 'pending',
      submissionDate: reg.submissionDate || '',
      approvalDate: reg.approvalDate || '',
      paymentDate: reg.paymentDate || '',
      notes: reg.notes || '',
    });
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditForm({});
  }

  async function saveEdit() {
    if (!reg?.id) return;
    await updateDocById(COLLECTIONS.LOAN_APPLICATIONS, reg.id, {
      ...editForm,
      loanAmount: Number(editForm.loanAmount) || 0,
      updatedBy: user?.id,
    });
    qc.invalidateQueries({ queryKey: keys.registrationsPaged });
    setIsEditing(false);
    setEditForm({});
    toast.success('Loan Application updated');
  }

  function updateEditField(field: string, value: string) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  // ── Mobile collapsed state
  const [mobileProjectOpen, setMobileProjectOpen] = useState(false);
  const [mobileCustomerOpen, setMobileCustomerOpen] = useState(false);

  // ── Loading state
  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)] p-2 lg:-m-5 lg:h-[calc(100%_+_2.5rem)]">
        <div className="h-10 w-72 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
        <div className="flex min-h-0 flex-1 gap-2">
          <div className="w-[25%] animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
          <div className="flex-1 animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
          <div className="w-[19%] animate-pulse rounded-xl bg-[var(--color-bg-sunken)]" />
        </div>
      </div>
    );
  }

  // ── Not found
  if (!reg) {
    return (
      <EmptyState
        title="Loan Application not found"
        description="The application does not exist or is outside your visibility scope."
        action={<Link to="/loan-applications"><Button variant="outline">Back to Loan Applications</Button></Link>}
      />
    );
  }

  // ── Derived data
  const displayName = reg.customerName || 'Loan Application';
  const regId = reg.registrationId || reg.id;
  const status = reg.status || 'Draft';
  const customerName = reg.customerName || '';
  const customerPhone = reg.customerPhone || '';

  // Project identity for header
  const projectTitle = project
    ? `${customerName || '—'} – ${project.capacityKw ? `${project.capacityKw} kW` : ''} – ${project.projectType || ''}`
    : undefined;

  // Customer fields
  const custPhone = customerField(customer, ['phone', 'mobile', 'businessPhone']);
  const custEmail = customerField(customer, ['email', 'businessEmail']);
  const custAddress = customerField(customer, ['address']);
  const custCity = customerField(customer, ['city']);
  const custState = customerField(customer, ['state']);
  const custType = customerField(customer, ['type']);
  const custCompany = customerField(customer, ['company', 'companyName']);
  const custGst = customerField(customer, ['gst']);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-[var(--color-bg)] p-2 lg:-m-5 lg:h-[calc(100%_+_2.5rem)]">
      {/* ── HEADER — identity-first, actions secondary ──────── */}
      <div className="flex shrink-0 flex-col px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2 sm:px-6 sm:py-4">
        <button
          type="button" onClick={() => navigate('/loan-applications')}
          className="flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors lg:hidden"
          title="Back to Loan Applications"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="text-[11px] font-semibold">Back</span>
        </button>

        <div className="flex flex-1 items-center gap-3 sm:flex-wrap sm:gap-x-3 sm:gap-y-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-hover)] text-lg font-bold text-white shadow-sm ring-2 ring-[var(--color-primary-muted)] sm:h-12 sm:w-12">
            {displayName[0]?.toUpperCase() || 'R'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="min-w-0 break-words text-base font-bold text-[var(--color-text)] sm:truncate sm:text-xl">
                {projectTitle || displayName}
              </h1>
              {loanApplicationStatusBadge(status)}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><FileText className="h-3 w-3" />{regId}</span>
              {reg.bankName && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><Hash className="h-3 w-3" />{reg.bankName}</span>}
              {reg.assignedToName && <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1"><User className="h-3 w-3" />{resolveUserName(reg.assignedToName)}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:shrink-0">
          {customerPhone && (
            <a href={`tel:${customerPhone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm">
              <Phone className="h-3.5 w-3.5" /> Call
            </a>
          )}
          {customerPhone && (
            <a href={`https://wa.me/${String(customerPhone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors shadow-sm">
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          )}
          {(custEmail || customerPhone) && (
            <a href={`mailto:${custEmail || ''}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors shadow-sm">
              <Mail className="h-3.5 w-3.5" /> Email
            </a>
          )}
          <button
            type="button" onClick={() => navigate('/loan-applications')}
            className="hidden lg:inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-strong)] transition-colors shadow-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Loan Applications
          </button>
        </div>
      </div>

      {/* ── BODY — 3-column layout ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1.5 lg:flex-row lg:gap-2 lg:overflow-hidden lg:pr-0">

        {/* ════════ LEFT PANEL — Project + Customer Context ════════ */}
        <div className="hidden w-full shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm p-4 lg:block lg:w-[25%] lg:overflow-hidden">
          <div className="lg:h-full lg:overflow-y-auto">
            {/* ── Project Information (if project exists) ── */}
            {project && (
              <div className="mb-4">
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1 mb-1">Project Information</h3>
                <LeftInfoRow label="Project ID" value={project.projectId || project.id} />
                <LeftInfoRow label="Type" value={project.projectType} />
                <LeftInfoRow label="Capacity" value={project.capacityKw ? `${project.capacityKw} kW` : undefined} />
                <LeftInfoRow label="Sales Owner" value={resolveUserName(project.salesOwner)} />
                <LeftInfoRow label="Surveyor" value={resolveUserName(project.assignedSurveyor)} />
                <LeftInfoRow label="Installer" value={resolveUserName(project.assignedInstaller)} />
                {project.leadId && (
                  <LeftLinkRow label="Source Lead" displayText="View source lead" href={`/leads/workspace/${encodeURIComponent(project.leadId as string)}`} />
                )}
              </div>
            )}

            {/* ── Customer Information ── */}
            {customerName && (
              <div>
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1 mb-1">
                  {project ? 'Customer Information' : 'Applicant Information'}
                </h3>
                {reg.customerId && (
                  <LeftLinkRow label="Customer" displayText={customerName} href={`/customers/${encodeURIComponent(reg.customerId)}`} />
                )}
                {!reg.customerId && <LeftInfoRow label="Name" value={customerName} />}
                {custType && <LeftInfoRow label="Type" value={custType} />}
                {custCompany && <LeftInfoRow label="Company" value={custCompany} />}
                {(custPhone || customerPhone) && <LeftInfoRow label="Phone" value={custPhone || customerPhone} />}
                {custEmail && <LeftInfoRow label="Email" value={custEmail} />}
                {(custAddress || custCity) && (
                  <LeftInfoRow label="Address" value={[custAddress, [custCity, custState].filter(Boolean).join(', ')].filter(Boolean).join(', ') || undefined} />
                )}
                {custGst && <LeftInfoRow label="GST" value={custGst} />}
              </div>
            )}

            {/* ── Fallback ── */}
            {!project && !customerName && (
              <div>
                <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1 mb-1">Application Context</h3>
                <LeftInfoRow label="App ID" value={regId} />
                <LeftInfoRow label="Status" value={status} />
              </div>
            )}
          </div>
        </div>

        {/* ════════ CENTER PANEL — Loan Application Workspace ════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="overflow-y-auto lg:h-full lg:min-h-0 lg:flex-1">
            <Suspense fallback={<div className="flex justify-center py-16 text-sm text-[var(--color-text-muted)]">Loading...</div>}>

              {/* ══ MOBILE: flat stack of independent sections ══ */}
              <div className="space-y-3 p-4 lg:hidden">

                {/* ── Project Information — independent collapsed section ── */}
                {project && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
                    <CollapsedRow label="Project Information" icon={<MapPin className="h-3.5 w-3.5" />} open={mobileProjectOpen} onToggle={() => setMobileProjectOpen((v) => !v)}>
                      <div className="space-y-3 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project ID</p>
                            <p className="mt-0.5 font-mono font-semibold text-[var(--color-text)] break-all">{project.projectId || project.id}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Capacity</p>
                            <p className="mt-0.5 font-semibold text-[var(--color-text)]">{project.capacityKw ? `${project.capacityKw} kW` : '—'}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Type</p>
                            <p className="mt-0.5 font-semibold text-[var(--color-text)]">{project.projectType || '—'}</p>
                          </div>
                          {project.siteAddress && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Site</p>
                              <p className="mt-0.5 leading-relaxed text-[var(--color-text-secondary)]">{typeof project.siteAddress === 'string' ? project.siteAddress : [project.siteAddress.city, project.siteAddress.state].filter(Boolean).join(', ')}</p>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1.5 border-t border-[var(--color-border-subtle)] pt-2 text-[13px]">
                          {([['Sales Owner', project.salesOwner], ['Surveyor', project.assignedSurveyor], ['Installer', project.assignedInstaller]] as const).map(([label, person]) => (
                            <div key={label} className="flex justify-between gap-3">
                              <span className="text-[var(--color-text-muted)]">{label}</span>
                              <span className="truncate font-semibold text-[var(--color-text)]">{resolveUserName(person) || 'Unassigned'}</span>
                            </div>
                          ))}
                        </div>
                        {project.leadId && (
                          <a href={`/leads/workspace/${encodeURIComponent(project.leadId as string)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline">
                            View source lead <ArrowUpRight className="h-3 w-3 shrink-0" />
                          </a>
                        )}
                      </div>
                    </CollapsedRow>
                  </div>
                )}

                {/* ── Customer Information — independent collapsed section ── */}
                {customerName && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 shadow-sm">
                    <CollapsedRow label="Customer Information" icon={<User className="h-3.5 w-3.5" />} open={mobileCustomerOpen} onToggle={() => setMobileCustomerOpen((v) => !v)}>
                      <div className="space-y-1.5 text-[13px]">
                        {reg.customerId && (
                          <a href={`/customers/${encodeURIComponent(reg.customerId)}`} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline mb-2">
                            View customer profile <ArrowUpRight className="h-3 w-3 shrink-0" />
                          </a>
                        )}
                        <div className="flex justify-between gap-3">
                          <span className="text-[var(--color-text-muted)]">Name</span>
                          <span className="truncate font-semibold text-[var(--color-text)]">{customerName}</span>
                        </div>
                        {custType && (
                          <div className="flex justify-between gap-3">
                            <span className="text-[var(--color-text-muted)]">Type</span>
                            <span className="truncate font-semibold text-[var(--color-text)]">{custType}</span>
                          </div>
                        )}
                        {custCompany && (
                          <div className="flex justify-between gap-3">
                            <span className="text-[var(--color-text-muted)]">Company</span>
                            <span className="truncate font-semibold text-[var(--color-text)]">{custCompany}</span>
                          </div>
                        )}
                        {(custPhone || customerPhone) && (
                          <div className="flex justify-between gap-3">
                            <span className="text-[var(--color-text-muted)]">Phone</span>
                            <span className="truncate font-semibold text-[var(--color-text)]">{custPhone || customerPhone}</span>
                          </div>
                        )}
                        {custEmail && (
                          <div className="flex justify-between gap-3">
                            <span className="text-[var(--color-text-muted)]">Email</span>
                            <span className="truncate font-semibold text-[var(--color-text)]">{custEmail}</span>
                          </div>
                        )}
                        {(custAddress || custCity) && (
                          <div className="flex justify-between gap-3">
                            <span className="text-[var(--color-text-muted)]">Address</span>
                            <span className="truncate font-semibold text-[var(--color-text)]">{[custAddress, [custCity, custState].filter(Boolean).join(', ')].filter(Boolean).join(', ')}</span>
                          </div>
                        )}
                        {custGst && (
                          <div className="flex justify-between gap-3">
                            <span className="text-[var(--color-text-muted)]">GST</span>
                            <span className="truncate font-semibold text-[var(--color-text)]">{custGst}</span>
                          </div>
                        )}
                      </div>
                    </CollapsedRow>
                  </div>
                )}

                {/* ── Loan Application — main workspace content ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1">Loan Application</h3>
                    {isEditing && (
                      <div className="flex items-center gap-1">
                        <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
                          <X className="h-3 w-3" /> Cancel
                        </button>
                        <button onClick={saveEdit} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-600 transition-colors">
                          <Save className="h-3 w-3" /> Save
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Application Information</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</label>
                            <select value={editForm.status} onChange={(e) => updateEditField('status', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                              {LOAN_APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Application Number</label>
                            <input value={editForm.applicationNumber} onChange={(e) => updateEditField('applicationNumber', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Case ID</label>
                            <input value={editForm.caseId} onChange={(e) => updateEditField('caseId', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Digital Sign</label>
                            <select value={editForm.digitalSignStatus} onChange={(e) => updateEditField('digitalSignStatus', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                              <option value="pending">Pending</option>
                              <option value="completed">Completed</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Bank / Loan Information</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Bank</label>
                            <input value={editForm.bankName} onChange={(e) => updateEditField('bankName', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Branch</label>
                            <input value={editForm.branch} onChange={(e) => updateEditField('branch', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Loan Amount</label>
                            <input type="number" value={editForm.loanAmount} onChange={(e) => updateEditField('loanAmount', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Assigned To</label>
                            <input value={editForm.assignedToName} onChange={(e) => updateEditField('assignedToName', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Dates</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Submission Date</label>
                            <input type="date" value={editForm.submissionDate} onChange={(e) => updateEditField('submissionDate', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approval Date</label>
                            <input type="date" value={editForm.approvalDate} onChange={(e) => updateEditField('approvalDate', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Payment Date</label>
                            <input type="date" value={editForm.paymentDate} onChange={(e) => updateEditField('paymentDate', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</label>
                        <textarea value={editForm.notes} onChange={(e) => updateEditField('notes', e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0">
                      <div className="border-b border-[var(--color-border-subtle)] pb-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Application Information</h4>
                        <InfoGrid>
                          <InfoField label="App ID" value={regId} />
                          <InfoField label="App No." value={reg.applicationNumber} />
                          <InfoField label="Case ID" value={reg.caseId} />
                          <InfoField label="Status" value={loanApplicationStatusBadge(status)} />
                        </InfoGrid>
                      </div>
                      <div className="border-b border-[var(--color-border-subtle)] py-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Bank / Loan Information</h4>
                        <InfoGrid>
                          <InfoField label="Bank" value={reg.bankName} />
                          <InfoField label="Branch" value={reg.branch} />
                          <InfoField label="Amount" value={fmtCurrency(Number(reg.loanAmount) || 0)} />
                          <InfoField label="Assigned To" value={resolveUserName(reg.assignedToName)} />
                        </InfoGrid>
                      </div>
                      <div className="py-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Dates</h4>
                        <InfoGrid>
                          <InfoField label="Created" value={fmtDate(reg.createdAt)} />
                          {reg.submissionDate && <InfoField label="Submitted" value={fmtDate(reg.submissionDate)} />}
                          {reg.approvalDate && <InfoField label="Approved" value={fmtDate(reg.approvalDate)} />}
                          {reg.paymentDate && <InfoField label="Payment" value={fmtDate(reg.paymentDate)} />}
                        </InfoGrid>
                      </div>
                      {reg.notes && (
                        <div className="border-t border-[var(--color-border-subtle)] pt-4">
                          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Notes</h4>
                          <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{reg.notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Quick Actions — mobile ── */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Quick Actions</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {canEdit && <QuickAction icon={<Edit2 className="h-4 w-4" />} label="Edit" onClick={startEdit} />}
                    {canDelete && <QuickAction icon={<Trash2 className="h-4 w-4" />} label="Delete" onClick={() => setShowDelete(true)} />}
                    {reg.customerId && (
                      <QuickAction icon={<User className="h-4 w-4" />} label="View Customer" onClick={() => navigate(`/customers/${encodeURIComponent(reg.customerId)}`)} />
                    )}
                    {reg.projectId && (
                      <QuickAction icon={<MapPin className="h-4 w-4" />} label="View Project" onClick={() => navigate(`/projects/${encodeURIComponent(reg.projectId)}`)} />
                    )}
                    {reg.status === 'Payment Received' && (
                      <QuickAction icon={<Send className="h-4 w-4" />} label="Create Project" onClick={() => navigate('/projects')} />
                    )}
                  </div>
                  {canEdit && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                      <div className="relative flex-1">
                        <select
                          value={status}
                          onChange={(e) => handleStatusChange(e.target.value)}
                          disabled={statusUpdating}
                          className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-1 pr-7 text-[11px] font-semibold text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50 cursor-pointer"
                        >
                          {LOAN_APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                      </div>
                      {statusUpdating && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />}
                    </div>
                  )}
                  {!canEdit && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                      {loanApplicationStatusBadge(status)}
                    </div>
                  )}
                </div>

                {/* ── Activity Log — mobile ── */}
                {reg.activityLog?.length > 0 && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1 mb-3">Activity</h3>
                    <div className="space-y-2">
                      {[...reg.activityLog].reverse().slice(0, 10).map((entry: any, idx: number) => (
                        <div key={entry.id || idx} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                          <p className="min-w-0 flex-1 text-[11.5px] text-[var(--color-text-secondary)]">
                            <span className="text-[var(--color-text)] font-medium">{entry.desc || entry.type || 'Activity'}</span>
                            <span className="text-[var(--color-text-muted)]"> · {fmtDate(entry.date)}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ══ DESKTOP: 3-panel layout (unchanged) ══ */}
              <div className="hidden lg:block p-5 space-y-4">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1">Loan Application</h3>
                    {isEditing && (
                      <div className="flex items-center gap-1">
                        <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
                          <X className="h-3 w-3" /> Cancel
                        </button>
                        <button onClick={saveEdit} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-600 transition-colors">
                          <Save className="h-3 w-3" /> Save
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Application Information</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</label>
                            <select value={editForm.status} onChange={(e) => updateEditField('status', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                              {LOAN_APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Application Number</label>
                            <input value={editForm.applicationNumber} onChange={(e) => updateEditField('applicationNumber', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Case ID</label>
                            <input value={editForm.caseId} onChange={(e) => updateEditField('caseId', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Digital Sign</label>
                            <select value={editForm.digitalSignStatus} onChange={(e) => updateEditField('digitalSignStatus', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]">
                              <option value="pending">Pending</option>
                              <option value="completed">Completed</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Bank / Loan Information</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Bank</label>
                            <input value={editForm.bankName} onChange={(e) => updateEditField('bankName', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Branch</label>
                            <input value={editForm.branch} onChange={(e) => updateEditField('branch', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Loan Amount</label>
                            <input type="number" value={editForm.loanAmount} onChange={(e) => updateEditField('loanAmount', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Assigned To</label>
                            <input value={editForm.assignedToName} onChange={(e) => updateEditField('assignedToName', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Dates</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Submission Date</label>
                            <input type="date" value={editForm.submissionDate} onChange={(e) => updateEditField('submissionDate', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Approval Date</label>
                            <input type="date" value={editForm.approvalDate} onChange={(e) => updateEditField('approvalDate', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Payment Date</label>
                            <input type="date" value={editForm.paymentDate} onChange={(e) => updateEditField('paymentDate', e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</label>
                        <textarea value={editForm.notes} onChange={(e) => updateEditField('notes', e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0">
                      <div className="border-b border-[var(--color-border-subtle)] pb-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Application Information</h4>
                        <InfoGrid>
                          <InfoField label="App ID" value={regId} />
                          <InfoField label="App No." value={reg.applicationNumber} />
                          <InfoField label="Case ID" value={reg.caseId} />
                          <InfoField label="Status" value={loanApplicationStatusBadge(status)} />
                        </InfoGrid>
                      </div>
                      <div className="border-b border-[var(--color-border-subtle)] py-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Bank / Loan Information</h4>
                        <InfoGrid>
                          <InfoField label="Bank" value={reg.bankName} />
                          <InfoField label="Branch" value={reg.branch} />
                          <InfoField label="Amount" value={fmtCurrency(Number(reg.loanAmount) || 0)} />
                          <InfoField label="Assigned To" value={resolveUserName(reg.assignedToName)} />
                        </InfoGrid>
                      </div>
                      <div className="py-4">
                        <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Dates</h4>
                        <InfoGrid>
                          <InfoField label="Created" value={fmtDate(reg.createdAt)} />
                          {reg.submissionDate && <InfoField label="Submitted" value={fmtDate(reg.submissionDate)} />}
                          {reg.approvalDate && <InfoField label="Approved" value={fmtDate(reg.approvalDate)} />}
                          {reg.paymentDate && <InfoField label="Payment" value={fmtDate(reg.paymentDate)} />}
                        </InfoGrid>
                      </div>
                      {reg.notes && (
                        <div className="border-t border-[var(--color-border-subtle)] pt-4">
                          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Notes</h4>
                          <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{reg.notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {reg.activityLog?.length > 0 && (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                    <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)] border-b-2 border-[var(--color-primary)] pb-1 mb-3">Activity</h3>
                    <div className="space-y-2">
                      {[...reg.activityLog].reverse().slice(0, 10).map((entry: any, idx: number) => (
                        <div key={entry.id || idx} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                          <p className="min-w-0 flex-1 text-[11.5px] text-[var(--color-text-secondary)]">
                            <span className="text-[var(--color-text)] font-medium">{entry.desc || entry.type || 'Activity'}</span>
                            <span className="text-[var(--color-text-muted)]"> · {fmtDate(entry.date)}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Suspense>
          </div>
        </div>

        {/* ════════ RIGHT PANEL — Quick Actions + Linked Records ════════ */}
        <div className="hidden shrink-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm lg:block lg:w-[19%] lg:overflow-hidden">
          <div className="lg:h-full lg:overflow-y-auto">
            <div className="px-4 py-4 border-b border-[var(--color-border-subtle)]">
              <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                {canEdit && <QuickAction icon={<Edit2 className="h-4 w-4" />} label="Edit" onClick={startEdit} />}
                {canDelete && <QuickAction icon={<Trash2 className="h-4 w-4" />} label="Delete" onClick={() => setShowDelete(true)} />}
                {reg.customerId && (
                  <QuickAction icon={<User className="h-4 w-4" />} label="View Customer" onClick={() => navigate(`/customers/${encodeURIComponent(reg.customerId)}`)} />
                )}
                {reg.projectId && (
                  <QuickAction icon={<MapPin className="h-4 w-4" />} label="View Project" onClick={() => navigate(`/projects/${encodeURIComponent(reg.projectId)}`)} />
                )}
                {reg.status === 'Payment Received' && (
                  <QuickAction icon={<Send className="h-4 w-4" />} label="Create Project" onClick={() => navigate('/projects')} />
                )}
              </div>
              {canEdit && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                  <div className="relative flex-1">
                    <select
                      value={status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      disabled={statusUpdating}
                      className="w-full appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-2 py-1 pr-7 text-[11px] font-semibold text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:opacity-50 cursor-pointer"
                    >
                      {LOAN_APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-muted)]" />
                  </div>
                  {statusUpdating && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />}
                </div>
              )}
              {!canEdit && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] shrink-0">Status</span>
                  {loanApplicationStatusBadge(status)}
                </div>
              )}
            </div>

            <div className="px-4 py-4">
              <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-[var(--color-text)]">Linked Records</h3>
              <div className="space-y-1.5">
                {reg.customerId && (
                  <a href={`/customers/${encodeURIComponent(reg.customerId)}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors">
                    <span className="text-[11px] text-[var(--color-text-secondary)]">Customer</span>
                    <span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span>
                  </a>
                )}
                {reg.projectId && (
                  <a href={`/projects/${encodeURIComponent(reg.projectId)}`} className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-left hover:border-[var(--color-primary)] transition-colors">
                    <span className="text-[11px] text-[var(--color-text-secondary)]">Project</span>
                    <span className="text-[11px] font-semibold text-[var(--color-primary)]">→</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── FOOTER — Previous/Next navigation ── */}
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm px-3 py-2 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3 lg:py-1.5">
        <div className="flex w-full items-center justify-between gap-2 sm:gap-3 lg:flex-1">
          <button
            type="button"
            onClick={() => {
              const idx = (registrations as any[]).findIndex((r) => r.id === id);
              if (idx > 0) navigate(`/loan-applications/${encodeURIComponent((registrations as any[])[idx - 1].id)}`);
            }}
            disabled={(registrations as any[]).findIndex((r) => r.id === id) <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            ← Previous
          </button>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {(registrations as any[]).findIndex((r) => r.id === id) + 1} of {(registrations as any[]).length}
          </span>
          <button
            type="button"
            onClick={() => {
              const idx = (registrations as any[]).findIndex((r) => r.id === id);
              if (idx >= 0 && idx < (registrations as any[]).length - 1) navigate(`/loan-applications/${encodeURIComponent((registrations as any[])[idx + 1].id)}`);
            }}
            disabled={(registrations as any[]).findIndex((r) => r.id === id) >= (registrations as any[]).length - 1}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-text-secondary)] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete Loan Application" size="sm">
        <p className="text-sm text-[var(--color-text-secondary)]">Delete this loan application permanently? This cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDelete(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
