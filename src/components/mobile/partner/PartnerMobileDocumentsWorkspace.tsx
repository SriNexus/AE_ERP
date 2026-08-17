/**
 * PartnerMobileDocumentsWorkspace — Mobile Document Center for Partner Portal
 *
 * Reuses mobile architecture from PartnerMobileCommissionsWorkspace.
 * Displays: KPI summary cards, document list with status badges, upload FAB,
 * filter chips, detail drawer, refresh.
 *
 * Documents are derived from the partner's lead documentVerifications + uploadedDocuments.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, RefreshCw, Search, AlertTriangle, Plus,
} from 'lucide-react';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import { usePartnerSelf } from '../../../features/channel-partner/hooks/usePartnerSelf';
import type { ChannelPartner } from '../../../features/channel-partner/types';
import { PartnerUploadDocumentModal } from '../../partner/PartnerUploadDocumentModal';
import { PartnerDocumentDetailDrawer, type PartnerDocumentView } from '../../partner/PartnerDocumentDetailDrawer';

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  verified:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  pending:   'Pending',
  submitted: 'Submitted',
  verified:  'Verified',
  rejected:  'Rejected',
};

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const style = STATUS_STYLES[s] || 'bg-gray-100 text-gray-600';
  const label = STATUS_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1);
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

function deriveDocuments(leads: any[]): PartnerDocumentView[] {
  const docs: PartnerDocumentView[] = [];
  leads.forEach((lead) => {
    const leadName = lead.name || lead.company || lead.id.slice(0, 10);
    (lead.documentVerifications || []).forEach((ver: any, idx: number) => {
      docs.push({
        id: `${lead.id}_ver_${idx}`,
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
    (lead.uploadedDocuments || []).forEach((docName: string) => {
      const has = (lead.documentVerifications || []).some((v: any) => v.documentName === docName);
      if (!has) {
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

export function PartnerMobileDocumentsWorkspace() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const companyKeys = queryKeys.forCompany(activeCompanyId);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<PartnerDocumentView | null>(null);
  const [replaceDoc, setReplaceDoc] = useState<PartnerDocumentView | null>(null);

  // ── Partner profile ───────────────────────────────────
  const { data: partnerSelf } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  // ── Leads ─────────────────────────────────────────────
  const { data: allLeads = [], isLoading, refetch } = useQuery({
    queryKey: companyKeys.leadsAll,
    queryFn: () => getAll(COLLECTIONS.LEADS),
    staleTime: 15_000,
    enabled: Boolean(activeCompanyId),
  });

  const partnerLeads = useMemo(
    () => allLeads.filter((l: any) => l.partnerId === partner?.id && !l.isDeleted),
    [allLeads, partner?.id],
  );

  const leadsForSelect = useMemo(
    () => partnerLeads.map((l: any) => ({ id: l.id, name: l.name || '', phone: l.phone || '' })),
    [partnerLeads],
  );

  // ── Derive documents ──────────────────────────────────
  const allDocuments: PartnerDocumentView[] = useMemo(
    () => deriveDocuments(partnerLeads).sort((a, b) => {
      const da = toDateValue(a.submittedAt)?.getTime() || 0;
      const db = toDateValue(b.submittedAt)?.getTime() || 0;
      return db - da;
    }),
    [partnerLeads],
  );

  // ── Filtering ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...allDocuments];
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((d) =>
        [d.documentName, d.leadName, d.status]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    if (statusFilter) {
      list = list.filter((d) => d.status === statusFilter);
    }
    return list;
  }, [allDocuments, search, statusFilter]);

  // ── KPIs ──────────────────────────────────────────────
  const kpis = useMemo(() => ({
    total: allDocuments.length,
    verified: allDocuments.filter((d) => d.status === 'verified').length,
    pending: allDocuments.filter((d) => d.status === 'pending' || d.status === 'submitted').length,
    rejected: allDocuments.filter((d) => d.status === 'rejected').length,
  }), [allDocuments]);

  const STATUS_FILTERS = [
    { label: 'All', value: null, count: allDocuments.length },
    { label: 'Verified', value: 'verified', count: allDocuments.filter((d) => d.status === 'verified').length },
    { label: 'Pending', value: 'submitted', count: allDocuments.filter((d) => d.status === 'pending' || d.status === 'submitted').length },
    { label: 'Rejected', value: 'rejected', count: allDocuments.filter((d) => d.status === 'rejected').length },
  ];

  function handleReplace(doc: PartnerDocumentView) {
    setReplaceDoc(doc);
    setSelectedDoc(null);
  }

  if (!partner) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-1">No Partner Profile</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Your account isn't linked to a partner profile.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-canvas)]">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-lg font-extrabold text-[var(--color-text)]">Documents</h1>
            <p className="text-xs text-[var(--color-text-muted)]">Upload and track your documents</p>
          </div>
          <button
            onClick={() => refetch()}
            className="h-9 w-9 flex items-center justify-center rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* ── Summary Cards ───────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 p-3 text-white">
            <p className="text-[10px] font-semibold opacity-80 uppercase tracking-wide">Total</p>
            <p className="text-lg font-extrabold tabular-nums leading-tight mt-0.5">{kpis.total}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 p-3">
            <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Verified</p>
            <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums leading-tight mt-0.5">
              {kpis.verified}
            </p>
          </div>
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3">
            <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Pending</p>
            <p className="text-lg font-extrabold text-amber-700 dark:text-amber-300 tabular-nums leading-tight mt-0.5">
              {kpis.pending}
            </p>
          </div>
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-3">
            <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Rejected</p>
            <p className="text-lg font-extrabold text-red-700 dark:text-red-300 tabular-nums leading-tight mt-0.5">
              {kpis.rejected}
            </p>
          </div>
        </div>

        {/* ── Search ──────────────────────────────────────── */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all"
          />
        </div>

        {/* ── Status Filter Chips ─────────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setStatusFilter(f.value)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                statusFilter === f.value
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]'
              }`}
            >
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {/* ── Document List ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-20 space-y-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[var(--color-bg-sunken)]" />
                <div className="flex-1">
                  <div className="h-4 w-28 bg-[var(--color-bg-sunken)] rounded mb-2" />
                  <div className="h-3 w-20 bg-[var(--color-bg-sunken)] rounded" />
                </div>
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-10 w-10 text-[var(--color-text-muted)] mb-3" />
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {search || statusFilter ? 'No matching documents' : 'No Documents Yet'}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              {search || statusFilter
                ? 'Try adjusting your search or filters.'
                : 'Submit your first document to get started.'}
            </p>
          </div>
        ) : (
          filtered.map((doc: PartnerDocumentView) => (
            <button
              key={doc.id}
              onClick={() => setSelectedDoc(doc)}
              className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-sm hover:border-[var(--color-border-strong)] transition-all active:scale-[0.98]"
            >
              <div className="flex items-start gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                  doc.status === 'verified'
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                    : doc.status === 'rejected'
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                      : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                }`}>
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm text-[var(--color-text)] truncate">
                      {doc.documentName}
                    </p>
                    <StatusPill status={doc.status} />
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {doc.leadName}
                    {doc.submittedAt ? ` · ${new Date(doc.submittedAt).toLocaleDateString('en-GB')}` : ''}
                  </p>
                  {doc.rejectionReason && (
                    <p className="text-[10px] text-red-500 mt-1 truncate">
                      Rejected: {doc.rejectionReason}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* ── Upload FAB ────────────────────────────────────── */}
      <button
        onClick={() => setShowUpload(true)}
        className="fixed bottom-20 right-4 h-12 w-12 rounded-full bg-[var(--color-primary)] text-white shadow-lg flex items-center justify-center hover:bg-[var(--color-primary-hover)] transition-all active:scale-95"
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* ── Upload Modal ──────────────────────────────────── */}
      <PartnerUploadDocumentModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        leads={leadsForSelect}
        onSuccess={() => refetch()}
      />

      {/* ── Replace Modal ─────────────────────────────────── */}
      <PartnerUploadDocumentModal
        open={!!replaceDoc}
        onClose={() => setReplaceDoc(null)}
        leads={leadsForSelect}
        preselectedLeadId={replaceDoc?.leadId || ''}
        preselectedType="other"
        onSuccess={() => { refetch(); setReplaceDoc(null); }}
      />

      {/* ── Detail Drawer ─────────────────────────────────── */}
      <PartnerDocumentDetailDrawer
        document={selectedDoc}
        open={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        onReplace={handleReplace}
      />
    </div>
  );
}

export default PartnerMobileDocumentsWorkspace;
