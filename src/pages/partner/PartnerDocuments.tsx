/**
 * PartnerDocuments — Partner Document Center Workspace
 *
 * Full workspace for partners to view, submit, and track documents
 * associated with their leads. Documents are derived from each lead's
 * uploadedDocuments and documentVerifications arrays.
 *
 * Reuses: PageShell, KPIStatCard, FilterBar, Table, Pagination, EmptyState
 * Consumes: existing updateDocumentationStatus workflow
 * No duplicated document engine, no Firestore SDK in UI.
 * Partner-only filtering via partnerId.
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  FileText,
  Upload,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Pagination } from '../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { KPIStatCard } from '../../components/dashboard/KPIStatCard';
import { getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { queryKeys } from '../../lib/queryKeys';
import { useAppStore } from '../../store/useAppStore';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import type { ChannelPartner } from '../../features/channel-partner/types';
import { PartnerUploadDocumentModal } from '../../components/partner/PartnerUploadDocumentModal';
import { PartnerDocumentDetailDrawer, type PartnerDocumentView } from '../../components/partner/PartnerDocumentDetailDrawer';

const PER_PAGE = 10;
const ALL = 'All';

const DOC_DATE_RANGE_OPTIONS = [
  { label: 'All Time',    value: 'all' },
  { label: 'Today',       value: 'today' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Custom Range', value: 'custom' },
];

const DOC_STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Statuses', value: ALL },
  { label: 'Submitted',    value: 'submitted' },
  { label: 'Verified',     value: 'verified' },
  { label: 'Rejected',     value: 'rejected' },
  { label: 'Pending',      value: 'pending' },
];

const DOC_STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  verified:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const DOC_STATUS_LABELS: Record<string, string> = {
  pending:   'Pending',
  submitted: 'Submitted',
  verified:  'Verified',
  rejected:  'Rejected',
};

function DocStatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = DOC_STATUS_BADGE[s] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  const label = DOC_STATUS_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

function toDateValue(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/** Derive a flat document list from a partner's leads */
function deriveDocuments(leads: any[]): PartnerDocumentView[] {
  const docs: PartnerDocumentView[] = [];
  leads.forEach((lead) => {
    const leadName = lead.name || lead.company || lead.id.slice(0, 10);

    // From document verifications (detailed tracking)
    (lead.documentVerifications || []).forEach((ver: any, idx: number) => {
      docs.push({
        id: `${lead.id}_ver_${idx}_${Date.now()}`,
        leadId: lead.id,
        leadName,
        documentName: ver.documentName || `Document ${idx + 1}`,
        status: ver.status || 'pending',
        rejectionReason: ver.rejectionReason || null,
        verifiedBy: ver.verifiedBy || null,
        verifiedAt: ver.verifiedAt || null,
        submittedAt: ver.submittedAt || lead.createdAt || null,
        notes: ver.notes || null,
        leadStatus: lead.status,
      });
    });

    // From uploaded documents that lack a verification entry
    (lead.uploadedDocuments || []).forEach((docName: string) => {
      const hasVerification = (lead.documentVerifications || []).some(
        (v: any) => v.documentName === docName,
      );
      if (!hasVerification) {
        docs.push({
          id: `${lead.id}_upl_${docName.replace(/\s+/g, '_')}`,
          leadId: lead.id,
          leadName,
          documentName: docName,
          status: 'submitted',
          rejectionReason: null,
          verifiedBy: null,
          verifiedAt: null,
          submittedAt: lead.updatedAt || lead.createdAt || null,
          notes: null,
          leadStatus: lead.status,
        });
      }
    });
  });
  return docs;
}

export default function PartnerDocuments() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf, isLoading: partnersLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Leads (partner-only, for document data) ────────────
  const { data: allLeads = [], isLoading: leadsLoading, refetch } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerLeads = useMemo(
    () => allLeads.filter((l: any) => l.partnerId === partner?.id && !l.isDeleted),
    [allLeads, partner?.id],
  );

  // ── Derive documents from leads ───────────────────────
  const allDocuments: PartnerDocumentView[] = useMemo(
    () => deriveDocuments(partnerLeads),
    [partnerLeads],
  );

  // ── Sort by most recent first ─────────────────────────
  const sortedDocs = useMemo(
    () => [...allDocuments].sort((a, b) => {
      const da = toDateValue(a.submittedAt)?.getTime() || 0;
      const db = toDateValue(b.submittedAt)?.getTime() || 0;
      return db - da;
    }),
    [allDocuments],
  );

  // ── Leads list for upload modal ───────────────────────
  const leadsForSelect = useMemo(
    () => partnerLeads.map((l: any) => ({ id: l.id, name: l.name || '', phone: l.phone || '' })),
    [partnerLeads],
  );

  // ── View state from URL params ────────────────────────
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [statusF, setStatusF] = useState(() => searchParams.get('status') || ALL);
  const [dateRange, setDateRange] = useState(() => searchParams.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [sortKey, setSortKey] = useState('submittedAt');
  const [sortDesc, setSortDesc] = useState(true);

  const [showUpload, setShowUpload] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<PartnerDocumentView | null>(null);
  const [replaceDoc, setReplaceDoc] = useState<PartnerDocumentView | null>(null);

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...sortedDocs];

    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((d) =>
        [d.documentName, d.leadName, d.leadId, d.status]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (statusF !== ALL) {
      list = list.filter((d) => d.status === statusF);
    }

    // Sort
    list.sort((a, b) => {
      const av = String(a[sortKey as keyof PartnerDocumentView] || '');
      const bv = String(b[sortKey as keyof PartnerDocumentView] || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDesc ? -cmp : cmp;
    });

    // Date range filter
    if (dateRange !== 'all') {
      list = list.filter((d) => {
        const dt = toDateValue(d.submittedAt);
        if (!dt) return false;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        if (dateRange === 'today') return dt.getTime() === now.getTime();
        if (dateRange === '7d') return (now.getTime() - dt.getTime()) <= 7 * 86400000;
        if (dateRange === '30d') return (now.getTime() - dt.getTime()) <= 30 * 86400000;
        if (dateRange === 'custom' && customFrom && customTo) {
          const from = new Date(customFrom);
          const to = new Date(customTo);
          return dt >= from && dt <= to;
        }
        return true;
      });
    }

    return list;
  }, [sortedDocs, search, statusF, dateRange, customFrom, customTo, sortKey, sortDesc]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Reset page when filters change
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page]);

  // ── KPIs ──────────────────────────────────────────────
  const kpis = useMemo(() => ({
    total: allDocuments.length,
    verified: allDocuments.filter((d) => d.status === 'verified').length,
    pending: allDocuments.filter((d) => d.status === 'pending' || d.status === 'submitted').length,
    rejected: allDocuments.filter((d) => d.status === 'rejected').length,
  }), [allDocuments]);

  // ── URL sync ──────────────────────────────────────────
  function syncParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== ALL && v !== 'all') next.set(k, v);
      else next.delete(k);
    });
    setSearchParams(next, { replace: true });
  }

  function clearAll() {
    setSearch('');
    setStatusF(ALL);
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
    setPage(1);
    setSearchParams({}, { replace: true });
  }

  function sort(k: string) {
    if (sortKey === k) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  }

  const loading = partnersLoading || leadsLoading;
  const hasActiveFilters = Boolean(search || statusF !== ALL || dateRange !== 'all');

  function handleReplace(doc: PartnerDocumentView) {
    setReplaceDoc(doc);
    setSelectedDoc(null);
  }

  return (
    <PageShell
      title="Document Center"
      subtitle="Upload and track KYC, agreements, and lead documents"
      icon={<FileText className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
          <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setShowUpload(true)}>
            Submit Document
          </Button>
        </div>
      }
    >
      {/* ── KPI Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPIStatCard
          label="Total Documents"
          value={kpis.total}
          icon={<FileText className="h-5 w-5" />}
          color="indigo"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Verified"
          value={kpis.verified}
          icon={<CheckCircle2 className="h-5 w-5" />}
          color="emerald"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Pending Review"
          value={kpis.pending}
          icon={<Clock className="h-5 w-5" />}
          color="amber"
          loading={loading}
          compact
        />
        <KPIStatCard
          label="Rejected"
          value={kpis.rejected}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="rose"
          loading={loading}
          compact
        />
      </div>

      {/* ── FilterBar ─────────────────────────────────────── */}
      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); syncParams({ q: v, page: page > 1 ? String(page) : '' }); }}
        searchPlaceholder="Search document name, lead, status..."
        dateRange={dateRange}
        onDateRange={(v) => { setDateRange(v); setPage(1); syncParams({ date: v, page: page > 1 ? String(page) : '' }); }}
        dateRangeOptions={DOC_DATE_RANGE_OPTIONS}
        customFrom={customFrom}
        customTo={customTo}
        onCustomRange={(f, t) => { setCustomFrom(f); setCustomTo(t); setPage(1); syncParams({ from: f, to: t, page: page > 1 ? String(page) : '' }); }}
        filters={[
          {
            label: 'Status',
            value: statusF,
            onChange: (v) => { setStatusF(v); setPage(1); },
            options: DOC_STATUS_OPTIONS,
          },
        ]}
        count={filtered.length}
        total={sortedDocs.length}
        label="documents"
        onClearAll={clearAll}
      />

      {/* ── Documents Table ───────────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
        <div className="min-h-0 overflow-x-auto">
          <Table>
            <Thead>
              <Th sortable sorted={sortKey === 'documentName'} desc={sortDesc} onSort={() => sort('documentName')}>DOCUMENT</Th>
              <Th>RELATED LEAD</Th>
              <Th className="hidden sm:table-cell" sortable sorted={sortKey === 'submittedAt'} desc={sortDesc} onSort={() => sort('submittedAt')}>SUBMITTED</Th>
              <Th sortable sorted={sortKey === 'status'} desc={sortDesc} onSort={() => sort('status')}>STATUS</Th>
              <Th className="hidden md:table-cell">UPDATED</Th>
              <Th className="w-20">ACTIONS</Th>
            </Thead>
            <Tbody>
              {loading ? (
                <SkeletonRows cols={6} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {!partner ? (
                      <EmptyState
                        icon={<FileText className="h-8 w-8" />}
                        title="No Partner Profile"
                        description="Your account isn't linked to a partner profile."
                      />
                    ) : hasActiveFilters ? (
                      <EmptyState
                        icon={<FileText className="h-8 w-8" />}
                        title="No matching documents"
                        description="Try adjusting your search or filters."
                      />
                    ) : (
                      <EmptyState
                        icon={<FileText className="h-8 w-8" />}
                        title="No Documents Yet"
                        description="Submit your first document to start tracking KYC, agreements, and other required documents for your leads."
                        action={
                          <Button size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => setShowUpload(true)}>
                            Submit Your First Document
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((doc: PartnerDocumentView) => (
                  <Tr
                    key={doc.id}
                    onClick={() => setSelectedDoc(doc)}
                    className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)]"
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                          doc.status === 'verified'
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                            : doc.status === 'rejected'
                              ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                        }`}>
                          <FileText className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-[var(--color-text)] text-sm leading-tight">
                            {doc.documentName}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {doc.leadName}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-xs text-[var(--color-text-muted)] max-w-[120px] truncate">
                      <span className="text-xs font-mono bg-[var(--color-bg-sunken)] px-1.5 py-0.5 rounded">
                        {(doc.leadId || '').slice(0, 10)}…
                      </span>
                    </Td>
                    <Td className="hidden sm:table-cell text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {doc.submittedAt ? formatShortDate(doc.submittedAt) : '—'}
                    </Td>
                    <Td>
                      <DocStatusBadge status={doc.status} />
                    </Td>
                    <Td className="hidden md:table-cell text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {doc.verifiedAt ? formatShortDate(doc.verifiedAt) : doc.submittedAt ? formatShortDate(doc.submittedAt) : '—'}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1 opacity-75 group-hover:opacity-100 transition-opacity">
                        {doc.status === 'rejected' && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleReplace(doc); }}
                            className="inline-flex h-7 items-center gap-1 rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-2.5 py-1 text-[10px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-all mr-1"
                          >
                            <RotateCcw className="h-3 w-3" /> Replace
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedDoc(doc); }}
                          className="inline-flex h-7 items-center gap-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-text)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-inverse)] shadow-sm transition-all hover:-translate-y-0.5 hover:opacity-90"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      </div>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>

        {filtered.length > PER_PAGE && (
          <Pagination
            page={page}
            total={filtered.length}
            perPage={PER_PAGE}
            onChange={(p) => { setPage(p); syncParams({ page: p > 1 ? String(p) : '' }); }}
          />
        )}
      </div>

      {/* ── Upload Document Modal ──────────────────────────── */}
      <PartnerUploadDocumentModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        leads={leadsForSelect}
        onSuccess={() => refetch()}
      />

      {/* ── Replace Document Modal ─────────────────────────── */}
      <PartnerUploadDocumentModal
        open={!!replaceDoc}
        onClose={() => setReplaceDoc(null)}
        leads={leadsForSelect}
        preselectedLeadId={replaceDoc?.leadId || ''}
        preselectedType="other"
        onSuccess={() => { refetch(); setReplaceDoc(null); }}
      />

      {/* ── Document Detail Drawer ─────────────────────────── */}
      <PartnerDocumentDetailDrawer
        document={selectedDoc}
        open={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        onReplace={handleReplace}
      />
    </PageShell>
  );
}

/** Inline date formatter that works with any date input type */
function formatShortDate(value: any): string {
  if (!value) return '—';
  const date = toDateValue(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB');
}
