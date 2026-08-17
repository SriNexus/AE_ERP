/**
 * MobilePartnerHome — Partner Mobile Dashboard
 *
 * Reuses existing mobile components: MobileHomeCard, MobileActivityCard,
 * MobileBusinessFunnel. No duplicated business logic — same hooks as
 * the desktop PartnerDashboard.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Award,
  ClipboardCheck,
  DollarSign,
  FolderKanban,
  HardHat,
  Plus,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { MobileHomeCard, MobileHomeSkeletonRows, MobileHomeEmptyState } from '../home/MobileHomeCard';
import { MobileBusinessFunnel } from '../home/MobileBusinessFunnel';
import { MobileActivityCard } from '../home/MobileActivityCard';
import { MobileTasksCard } from '../home/MobileTasksCard';
import { statusBadge, tierBadge } from '../../ui/Badge';
import { cn } from '../../../utils/cn';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll, resolveWriteCompanyId } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import type { ChannelPartner, CommissionRecord } from '../../../features/channel-partner/types';

function fmtCompact(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)}K`;
  return `₹${value}`;
}

export function MobilePartnerHome() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  // ── Fetch partner record ───────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Fetch partner leads ────────────────────────────────
  const { data: allLeads = [], isLoading: leadsLoading } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerLeads = useMemo(
    () => allLeads.filter((l: any) => l.partnerId === partner?.id && !l.isDeleted),
    [allLeads, partner?.id],
  );

  // ── Fetch commission records ───────────────────────────
  const { data: allCommissions = [], isLoading: commissionsLoading } = useQuery({
    queryKey: ['commission_records_mobile_home', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.COMMISSION_RECORDS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerCommissions = useMemo(
    () => allCommissions.filter((c: any) => c.partnerId === partner?.id && !c.isDeleted) as CommissionRecord[],
    [allCommissions, partner?.id],
  );

  // ── Fetch partner customers + projects (Phase 5) ──────
  const { data: allCustomers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['partner_customers_home', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.CUSTOMERS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });
  const { data: allProjects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['partner_projects_home', activeCompanyId],
    queryFn: () => getAll(COLLECTIONS.PROJECTS),
    staleTime: 30_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerCustomers = useMemo(
    () => allCustomers.filter((c: any) => c.partnerId === partner?.id && !c.isDeleted),
    [allCustomers, partner?.id],
  );
  const partnerProjects = useMemo(
    () => allProjects.filter((p: any) => p.partnerId === partner?.id && !p.isDeleted),
    [allProjects, partner?.id],
  );

  // ── Compute KPIs ───────────────────────────────────────
  const kpis = useMemo(() => {
    const totalLeads = partnerLeads.length;
    const activeLeads = partnerLeads.filter(
      (l: any) => l.status !== 'Converted' && l.status !== 'Lost' && l.status !== 'Cancelled',
    ).length;
    const convertedLeads = partnerLeads.filter((l: any) => l.status === 'Converted').length;
    const activeInstallations = partnerLeads.filter(
      (l: any) => l.installationStatus && l.installationStatus !== 'pending' && l.installationStatus !== 'closed' && l.installationStatus !== 'installation_complete'
    ).length;
    return {
      totalLeads,
      activeLeads,
      convertedLeads,
      walletBalance: partner?.walletBalance ?? 0,
      pendingCommission: partnerCommissions
        .filter((c) => c.status === 'pending')
        .reduce((sum, c) => sum + (c.amount || 0), 0),
      paidCommission: partnerCommissions
        .filter((c) => c.status === 'paid')
        .reduce((sum, c) => sum + (c.amount || 0), 0),
      activeInstallations,
    };
  }, [partnerLeads, partnerCommissions, partner]);

  // ── Lead pipeline counts (for MobileBusinessFunnel) ────
  const pipelineCounts = useMemo(() => {
    const newLeads = partnerLeads.filter((l: any) => l.status === 'New').length;
    const quotations = partnerLeads.filter(
      (l: any) => l.status === 'Proposal' || l.status === 'Quotation',
    ).length;
    const orders = partnerLeads.filter(
      (l: any) => l.status === 'Converted' || l.status === 'Won',
    ).length;
    const invoices = 0; // Partners don't create invoices
    const pendingPayments = partnerCommissions.filter((c) => c.status === 'pending').length;
    const dispatched = partnerLeads.filter((l: any) => l.installationStatus === 'survey_completed').length;
    const installed = partnerLeads.filter(
      (l: any) => l.installationStatus === 'installation_complete',
    ).length;
    const completed = partnerCommissions.filter((c) => c.status === 'paid').length;

    return {
      newLeads, quotations, orders, invoices,
      pendingPayments, dispatched, installed, completed,
    };
  }, [partnerLeads, partnerCommissions]);

  const loading = partnersLoading || leadsLoading || commissionsLoading;

  // ── Empty state (no partner) ────────────────────────────
  if (!loading && !partner) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <MobileHomeEmptyState
          icon={<Target className="h-6 w-6" />}
          title="No Partner Profile"
          description="Your account isn't linked to a partner profile. Contact your administrator."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      {/* ── Welcome + Partner Status ──────────────────────── */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div>
          <p className="text-sm font-bold text-[var(--color-text)]">
            Hello, {partner?.contactPerson || user?.name || 'Partner'}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {partner?.firmName || 'Partner Portal'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {partner?.tier && tierBadge(partner.tier)}
          {statusBadge(partner?.status || 'active')}
        </div>
      </div>

      {/* ── Quick Stats Row (2x2 grid) ──────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400">
              <Target className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)] tabular-nums">
                {loading ? '—' : kpis.totalLeads}
              </p>
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Total Leads
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)] tabular-nums">
                {loading ? '—' : kpis.activeLeads}
              </p>
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Active
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)] tabular-nums">
                {loading ? '—' : fmtCompact(kpis.walletBalance)}
              </p>
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Wallet
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400">
              <DollarSign className="h-4 w-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)] tabular-nums">
                {loading ? '—' : fmtCompact(kpis.pendingCommission)}
              </p>
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Pending Comm.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Business Funnel ──────────────────────────────── */}
      <MobileBusinessFunnel counts={pipelineCounts} loading={loading} />

      {/* ── Recent Leads ─────────────────────────────────── */}
      <MobileHomeCard
        title="Recent Leads"
        actions={
          <button
            onClick={() => navigate('/partner/leads')}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400"
          >
            View All <ArrowUpRight className="h-3 w-3" />
          </button>
        }
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="px-3"><MobileHomeSkeletonRows count={5} /></div>
        ) : partnerLeads.length === 0 ? (
          <MobileHomeEmptyState
            icon={<Target className="h-5 w-5" />}
            title="No leads yet"
            description="Create your first lead to start tracking."
          />
        ) : (
          <div className="divide-y divide-[var(--color-border-subtle)] px-3">
            {[...partnerLeads]
              .sort((a: any, b: any) => {
                const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return db - da;
              })
              .slice(0, 5)
              .map((lead: any) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => navigate(`/partner/leads/${lead.id}`)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors active:scale-[0.99]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                    {(lead.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--color-text)]">{lead.name}</p>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {lead.city || '—'} · {lead.status || 'New'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-[var(--color-bg-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                      {lead.createdAt
                        ? `${Math.max(0, Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000))}d`
                        : '—'}
                    </span>
                  </div>
                </button>
              ))}
          </div>
        )}
      </MobileHomeCard>

      {/* ── Tier & Risk Summary Row ────────────────────── */}
      {partner && (
        <div className="flex items-center gap-2">
          {partner.tier && (
            <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs">
              <Award className="h-4 w-4 text-amber-500" />
              <span className="font-semibold text-[var(--color-text)] capitalize">{partner.tier}</span>
              <span className="text-[var(--color-text-muted)]">Tier</span>
            </div>
          )}

          {kpis.activeInstallations > 0 && (
            <button
              onClick={() => navigate('/partner/installations')}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs font-semibold text-[var(--color-primary)] transition-all active:scale-[0.98]"
            >
              <HardHat className="h-4 w-4" />
              {kpis.activeInstallations} Installation{kpis.activeInstallations !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {/* ── Customer / Project Quick Links (Phase 5) ─────── */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => navigate('/partner/customers')}
          className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-all active:scale-[0.98]"
        >
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
              <Users className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-bold text-[var(--color-text)]">Customers</span>
              <span className="block text-[10px] font-semibold text-[var(--color-text-muted)] tabular-nums">
                {loading || customersLoading ? '…' : partnerCustomers.length}
              </span>
            </span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-[var(--color-text-muted)]" />
        </button>
        <button
          onClick={() => navigate('/partner/projects')}
          className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-all active:scale-[0.98]"
        >
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
              <FolderKanban className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-bold text-[var(--color-text)]">Projects</span>
              <span className="block text-[10px] font-semibold text-[var(--color-text-muted)] tabular-nums">
                {loading || projectsLoading ? '…' : partnerProjects.length}
              </span>
            </span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-[var(--color-text-muted)]" />
        </button>
        {/* Registration (Vendor Lock / Scheme) — Phase 6/7 */}
        <button
          onClick={() => navigate('/partner/registration')}
          className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-all active:scale-[0.98]"
        >
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
              <ClipboardCheck className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-bold text-[var(--color-text)]">Registration</span>
              <span className="block text-[10px] font-semibold text-[var(--color-text-muted)]">Scheme registration</span>
            </span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-[var(--color-text-muted)]" />
        </button>
      </div>

      {/* ── Quick Action: Create Lead ────────────────────── */}
      <button
        onClick={() => navigate('/partner/leads/new')}
        className="flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-bold text-[var(--color-primary)] transition-all active:scale-[0.98]"
      >
        <Plus className="h-5 w-5" />
        Create New Lead
      </button>

      {/* ── Tasks ─────────────────────────────────────────── */}
      <MobileTasksCard />

      {/* ── Recent Activity ──────────────────────────────── */}
      <MobileActivityCard companyId={resolveWriteCompanyId()} />
    </div>
  );
}

export default MobilePartnerHome;
