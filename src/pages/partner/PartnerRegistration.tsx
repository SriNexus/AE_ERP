/**
 * PartnerRegistration — Partner Portal "My Registration" (Vendor Lock /
 * Scheme Registration).
 *
 * The partner sees ONLY their own registrations (ownership resolves from the
 * authenticated partner via usePartnerSelf → users.channelPartnerId →
 * channel_partners — never from a URL/query/form partnerId), can file a
 * Registration on one of their OWN projects, submit / resubmit / retry /
 * cancel it, upload required documents (shared `documents` collection,
 * case-scoped storage) and view the status timeline + portal reference.
 *
 * All mutations run through the canonical hooks
 * (useCreateSchemeRegistration / useTransitionSchemeRegistration); the
 * service derives partnerId/partnerName from the Project chain (§9.3) and
 * enforces the machine + permissions. No parallel business logic.
 *
 * User-facing label is exactly "Registration" (the underlying process is
 * Vendor Lock / Portal Registration — internal stage SchemeRegistration,
 * collection scheme_registrations, never the loan 'registrations' domain).
 */

import { useState, useMemo } from 'react';
import { ClipboardCheck, Plus, Eye, RefreshCw } from 'lucide-react';
import { PageShell } from '../../components/shared/PageShell';
import { EmptyState } from '../../components/shared/EmptyState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Pagination } from '../../components/ui/Pagination';
import { Table, Thead, Th, Tbody, Tr, Td, SkeletonRows } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { usePartnerSelf } from '../../features/channel-partner/hooks/usePartnerSelf';
import { useProjects } from '../../features/projects/hooks/useProjects';
import {
  filterPartnerOwnedProjects,
  filterPartnerOwnedRegistrations,
} from '../../lib/partnerOwnership';
import type { ChannelPartner } from '../../features/channel-partner/types';
import { useSchemeRegistrations } from '../../features/scheme-registration/hooks/useSchemeRegistrations';
import type { SchemeRegistrationRecord } from '../../features/scheme-registration/types';
import { SchemeRegistrationStatusBadge } from '../../features/scheme-registration/components/registrationShared';
import { PartnerRegistrationDetailModal } from '../../components/partner/PartnerRegistrationDetailModal';
import { PartnerRegistrationCreateModal } from '../../components/partner/PartnerRegistrationCreateModal';

const PER_PAGE = 10;
const ALL = 'All';

function formatDate(value: any): string {
  if (!value) return '—';
  const date = typeof value === 'object' && typeof value.toDate === 'function'
    ? value.toDate()
    : typeof value === 'object' && value.seconds
      ? new Date(value.seconds * 1000)
      : new Date(value);
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-GB');
}

export default function PartnerRegistration() {
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState(ALL);
  const [page, setPage] = useState(1);

  const { data: partnerSelf, isLoading: partnerLoading } = usePartnerSelf();
  const partner: ChannelPartner | undefined = partnerSelf?.partner ?? undefined;

  const { data: allRegistrations = [], isLoading: regsLoading, refetch } = useSchemeRegistrations();
  const { data: allProjects = [], isLoading: projectsLoading } = useProjects();

  const myRegistrations = useMemo(
    () => filterPartnerOwnedRegistrations(allRegistrations as any[], partner?.id) as SchemeRegistrationRecord[],
    [allRegistrations, partner?.id],
  );
  const myProjects = useMemo(
    () => filterPartnerOwnedProjects(allProjects, partner?.id) as any[],
    [allProjects, partner?.id],
  );
  const projectMap = useMemo(() => {
    const map = new Map<string, any>();
    myProjects.forEach((p: any) => map.set(p.id, p));
    return map;
  }, [myProjects]);

  // ── Detail / create view state ───────────────────────
  const [viewReg, setViewReg] = useState<SchemeRegistrationRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = [...myRegistrations];
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((r) =>
        [r.registrationId, r.projectId, r.vendorName, r.schemeName, r.applicationNumber, r.portalReference]
          .some((v) => String(v || '').toLowerCase().includes(q)),
      );
    }
    if (statusF !== ALL) list = list.filter((r) => r.status === statusF);
    list.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    return list;
  }, [myRegistrations, search, statusF]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const statusOptions = useMemo(() => {
    const set = new Set(myRegistrations.map((r) => r.status).filter(Boolean));
    return [ALL, ...Array.from(set)];
  }, [myRegistrations]);

  const stats = useMemo(() => ({
    total: myRegistrations.length,
    active: myRegistrations.filter((r) => !['Completed', 'Cancelled'].includes(r.status)).length,
    vendorLocked: myRegistrations.filter((r) => r.status === 'VendorLocked').length,
    completed: myRegistrations.filter((r) => r.status === 'Completed').length,
  }), [myRegistrations]);

  const loading = partnerLoading || regsLoading || projectsLoading;

  return (
    <PageShell
      title="My Registration"
      subtitle="Scheme registration on your projects"
      icon={<ClipboardCheck className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
            Refresh
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New Registration
          </Button>
        </div>
      }
    >
      {/* ── KPI row ───────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {[
          { label: 'TOTAL', value: stats.total, color: 'border-l-[var(--color-border-strong)]' },
          { label: 'IN PROGRESS', value: stats.active, color: 'border-l-blue-500' },
          { label: 'VENDOR LOCKED', value: stats.vendorLocked, color: 'border-l-violet-500' },
          { label: 'COMPLETED', value: stats.completed, color: 'border-l-emerald-500' },
        ].map((k) => (
          <div
            key={k.label}
            className={`bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-4 ${k.color} px-3 py-2.5 shadow-[var(--shadow-enterprise-kpi)]`}
          >
            <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wide">{k.label}</p>
            <p className="text-2xl font-extrabold text-[var(--color-text)] tabular-nums leading-tight">
              {loading ? '—' : k.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── FilterBar ─────────────────────────────────────── */}
      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search registration ID, vendor, scheme, portal ref..."
        filters={[
          {
            label: 'Status',
            value: statusF,
            onChange: (v) => { setStatusF(v); setPage(1); },
            options: statusOptions.map((s) => ({ label: s, value: s })),
          },
        ]}
        count={filtered.length}
        total={myRegistrations.length}
        label="registrations"
        onClearAll={() => { setSearch(''); setStatusF(ALL); setPage(1); }}
      />

      {/* ── Data Table ────────────────────────────────────── */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-enterprise-surface)] overflow-hidden">
        <div className="min-h-0 overflow-x-auto">
          <Table>
            <Thead>
              <Th>REGISTRATION</Th>
              <Th>PROJECT</Th>
              <Th>STATUS</Th>
              <Th className="hidden md:table-cell">VENDOR</Th>
              <Th className="hidden sm:table-cell">PORTAL REF</Th>
              <Th className="hidden lg:table-cell">UPDATED</Th>
              <Th className="w-20">ACTIONS</Th>
            </Thead>
            <Tbody>
              {loading ? (
                <SkeletonRows cols={7} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    {!partner ? (
                      <EmptyState
                        icon={<ClipboardCheck className="h-8 w-8" />}
                        title="No Partner Profile"
                        description="Your account isn't linked to a partner profile. Contact your administrator."
                      />
                    ) : (
                      <EmptyState
                        icon={<ClipboardCheck className="h-8 w-8" />}
                        title="No Registrations Yet"
                        description="File a Registration on one of your projects to start the vendor lock / scheme registration."
                        action={
                          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                            New Registration
                          </Button>
                        }
                      />
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map((reg) => (
                  <Tr
                    key={reg.id}
                    onClick={() => setViewReg(reg)}
                    className="group cursor-pointer transition-all duration-200 ease-out hover:bg-[var(--color-surface-hover)] hover:shadow-[var(--shadow-enterprise-row)]"
                  >
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">
                          {reg.registrationId.slice(-4)}
                        </div>
                        <div>
                          <p className="font-semibold text-[var(--color-text)] text-sm leading-tight">{reg.registrationId}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{reg.schemeName || reg.portalType || 'Registration'}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-xs text-[var(--color-text-muted)]">
                      {projectMap.get(reg.projectId)?.name || reg.projectId}
                    </Td>
                    <Td><SchemeRegistrationStatusBadge status={reg.status} /></Td>
                    <Td className="hidden md:table-cell text-xs text-[var(--color-text-muted)]">{reg.vendorName || '—'}</Td>
                    <Td className="hidden sm:table-cell text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {reg.applicationNumber || reg.portalReference || '—'}
                    </Td>
                    <Td className="hidden lg:table-cell text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {formatDate(reg.updatedAt || reg.createdAt)}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end opacity-75 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setViewReg(reg); }}
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
            onChange={setPage}
          />
        )}
      </div>

      {/* ── Create Registration Modal ─────────────────────── */}
      <PartnerRegistrationCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        registrations={myRegistrations}
        projects={myProjects}
        onCreated={(reg) => setViewReg(reg)}
      />

      {/* ── Registration Detail Modal ─────────────────────── */}
      <PartnerRegistrationDetailModal
        registration={viewReg}
        project={viewReg ? projectMap.get(viewReg.projectId) : null}
        open={!!viewReg}
        onClose={() => setViewReg(null)}
      />
    </PageShell>
  );
}
