/**
 * Monitoring.tsx — Desktop Monitoring (Generation Readings) page (Leads Gold Standard)
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Download, FileText, Plus, RefreshCw, Zap, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Button, Card, CardHeader, EmptyState, Modal,
  Pagination, PremiumKpi, Select, SkeletonRows,
  Table, Thead, Th, Tbody, Tr, Td, UniversalCheckbox,
  WorkspaceHero,
} from '../components/ui';
import { Input, Textarea } from '../components/ui/Input';
import { fmtDate } from '../lib/firestore';
import { useGenerationReadings, useCreateGenerationReading } from '../features/monitoring/hooks/useGenerationReadings';
import { useProjects } from '../features/projects/hooks/useProjects';
import { useAmcContracts } from '../features/amc/hooks/useAmcContracts';
import { useServiceTickets } from '../features/service-tickets/hooks/useServiceTickets';
import type { GenerationReadingRecord } from '../lib/monitoringWorkflow';

const PER_PAGE = 15;
const defaults = { projectId: '', projectName: '', readingDate: new Date().toISOString().slice(0, 10), readingKwh: '', notes: '' };

function downloadCsv(rows: GenerationReadingRecord[]) {
  const h = ['Date', 'Project', 'Generation kWh', 'Recorded By', 'Notes'];
  const l = rows.map(r => [r.readingDate, r.projectName || r.projectId, String(r.readingKwh), r.recordedByName || '', r.notes || '']
    .map(v => `"${v.split('"').join('""')}"`).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + [h.join(','), ...l].join('\r\n')], { type: 'text/csv' }));
  a.download = `generation-readings-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

export default function Monitoring() {
  const [sp, setSp] = useSearchParams();
  const { data: readings = [], isLoading, refetch } = useGenerationReadings();
  const { data: projects = [] } = useProjects();
  const { data: amcContracts = [] } = useAmcContracts();
  const { data: serviceTickets = [] } = useServiceTickets();
  const create = useCreateGenerationReading();

  const [search, setSearch] = useState(() => sp.get('q') || '');
  const [dateRange, setDateRange] = useState(() => sp.get('date') || 'all');
  const [customFrom, setCustomFrom] = useState(() => sp.get('from') || '');
  const [customTo, setCustomTo] = useState(() => sp.get('to') || '');
  const [activeKpi, setActiveKpi] = useState(() => sp.get('kpi') || '');
  const [recordedByF, setRecordedByF] = useState(() => sp.get('recordedBy') || '');
  const [projectIdF, setProjectIdF] = useState(() => sp.get('projectId') || '');
  const [customerIdF, setCustomerIdF] = useState(() => sp.get('customerId') || '');
  const [amcIdF, setAmcIdF] = useState(() => sp.get('amcId') || '');
  const [serviceTicketIdF, setServiceTicketIdF] = useState(() => sp.get('serviceTicketId') || '');
  const [page, setPage] = useState(() => Math.max(1, Number(sp.get('page')) || 1));
  const [perPage, setPerPage] = useState(() => Math.max(1, Number(sp.get('perPage')) || PER_PAGE));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ ...defaults });
  const [formOpen, setFormOpen] = useState(sp.get('create') === '1');
  const [view, setView] = useState<GenerationReadingRecord | null>(null);

  function sync(ns: Record<string, string | number>) {
    const n = new URLSearchParams(sp);
    Object.entries(ns).forEach(([key, value]) =>
      value === '' || value === 'all' || (value === 1 && key === 'page') || (value === PER_PAGE && key === 'perPage')
        ? n.delete(key) : n.set(key, String(value))
    );
    setSp(n, { replace: true });
  }

  const projectMap = useMemo(() => new Map((projects as any[]).map((p: any) => [p.id, p])), [projects]);

  const filtered = useMemo(() => {
    let list = [...(readings as GenerationReadingRecord[])];
    const avg = list.length ? list.reduce((s, r) => s + r.readingKwh, 0) / list.length : 0;
    if (activeKpi === 'online') list = list.filter(r => r.readingKwh > 0);
    if (activeKpi === 'offline') list = list.filter(r => r.readingKwh === 0);
    if (activeKpi === 'low_generation') list = list.filter(r => r.readingKwh > 0 && r.readingKwh < avg);
    if (activeKpi === 'maintenance_due') list = list.filter(r => (amcContracts as any[]).some((a: any) => a.projectId === r.projectId && a.status !== 'Active'));
    if (activeKpi === 'alerts') list = list.filter(r => r.readingKwh === 0 || Boolean(r.notes));
    const q = search.toLowerCase();
    if (q) list = list.filter(r => [r.projectName, r.projectId, r.recordedByName, String(r.readingKwh)].some(v => String(v || '').toLowerCase().includes(q)));
    if (recordedByF) list = list.filter(r => (r.recordedByName || r.recordedBy) === recordedByF);
    if (projectIdF) list = list.filter(r => r.projectId === projectIdF);
    if (customerIdF) list = list.filter(r => projectMap.get(r.projectId)?.customerId === customerIdF);
    if (amcIdF) list = list.filter(r => r.amcContractId === amcIdF || (amcContracts as any[]).some((a: any) => a.id === amcIdF && a.projectId === r.projectId));
    if (serviceTicketIdF) list = list.filter(r => r.linkedServiceTicketId === serviceTicketIdF || (serviceTickets as any[]).some((t: any) => t.id === serviceTicketIdF && t.projectId === r.projectId));
    if (dateRange !== 'all') {
      const start = customFrom ? new Date(customFrom) : null;
      const end = customTo ? new Date(customTo) : null;
      list = list.filter(r => { const d = new Date(r.readingDate); return (!start || d >= start) && (!end || d <= end); });
    }
    return list.sort((a, b) => b.readingDate.localeCompare(a.readingDate));
  }, [readings, search, dateRange, customFrom, customTo, activeKpi, recordedByF, projectIdF, customerIdF, amcIdF, serviceTicketIdF, projectMap, amcContracts, serviceTickets]);

  useEffect(() => { const max = Math.max(1, Math.ceil(filtered.length / perPage)); if (page > max) { setPage(max); sync({ page: max }); } }, [filtered.length, perPage, page]);
  const rows = filtered.slice((page - 1) * perPage, page * perPage);
  const total = (readings as GenerationReadingRecord[]).length;
  const avgKwh = total ? Math.round((readings as GenerationReadingRecord[]).reduce((s, r) => s + r.readingKwh, 0) / total) : 0;

  const stats = useMemo(() => ({
    total, online: (readings as GenerationReadingRecord[]).filter(r => r.readingKwh > 0).length,
    offline: (readings as GenerationReadingRecord[]).filter(r => r.readingKwh === 0).length,
    lowGeneration: (readings as GenerationReadingRecord[]).filter(r => r.readingKwh > 0 && r.readingKwh < avgKwh).length,
    maintenanceDue: (readings as GenerationReadingRecord[]).filter(r => (amcContracts as any[]).some((a: any) => a.projectId === r.projectId && a.status !== 'Active')).length,
    alerts: (readings as GenerationReadingRecord[]).filter(r => r.readingKwh === 0 || Boolean(r.notes)).length,
  }), [readings, avgKwh, amcContracts]);

  const isTotalDefault = useMemo(() => !activeKpi && !search && dateRange === 'all' && !recordedByF && !projectIdF && !customerIdF && !amcIdF && !serviceTicketIdF, [activeKpi, search, dateRange, recordedByF, projectIdF, customerIdF, amcIdF, serviceTicketIdF]);
  const activeFilterCount = useMemo(() => { let c = 0; if (search) c++; if (dateRange !== 'all') c++; if (activeKpi) c++; if (recordedByF) c++; if (projectIdF) c++; if (customerIdF) c++; if (amcIdF) c++; if (serviceTicketIdF) c++; return c; }, [search, dateRange, activeKpi, recordedByF, projectIdF, customerIdF, amcIdF, serviceTicketIdF]);

  const KPI_TILES = [
    { key: '', label: 'TOTAL', icon: <Activity className="h-4 w-4" />, value: stats.total, description: `${stats.total} total readings` },
    { key: 'online', label: 'ONLINE', icon: <Zap className="h-4 w-4" />, value: stats.online, description: 'Active generation (>0 kWh)' },
    { key: 'offline', label: 'OFFLINE', icon: <Zap className="h-4 w-4" />, value: stats.offline, description: 'No generation (0 kWh)' },
    { key: 'low_generation', label: 'LOW GENERATION', icon: <Activity className="h-4 w-4" />, value: stats.lowGeneration, description: `Below avg (${avgKwh} kWh)` },
    { key: 'maintenance_due', label: 'MAINT DUE', icon: <RefreshCw className="h-4 w-4" />, value: stats.maintenanceDue, description: 'AMC not active' },
    { key: 'alerts', label: 'ALERTS', icon: <X className="h-4 w-4" />, value: stats.alerts, description: 'Requires attention' },
  ];

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));
  const allSel = selected.size === rows.length && rows.length > 0;

  function filterChange(setter: (v: string) => void, key: string, value: string) { setter(value); setPage(1); sync({ [key]: value, page: 1 }); }

  function resetAll() {
    setSearch(''); setDateRange('all'); setCustomFrom(''); setCustomTo(''); setActiveKpi('');
    setRecordedByF(''); setProjectIdF(''); setCustomerIdF(''); setAmcIdF(''); setServiceTicketIdF('');
    setPage(1); sync({ q: '', date: 'all', from: '', to: '', kpi: '', recordedBy: '', projectId: '', customerId: '', amcId: '', serviceTicketId: '', page: 1 });
  }

  const recordedByOptions = useMemo(() =>
    [{ label: 'All recorded by', value: '' }, ...Array.from(new Set((readings as GenerationReadingRecord[]).map(r => r.recordedByName || r.recordedBy))).filter(Boolean).map(v => ({ label: v, value: v }))],
    [readings]);
  const projectOptions = useMemo(() =>
    [{ label: 'All projects', value: '' }, ...(projects as any[]).map((p: any) => ({ label: p.projectId || p.name || p.id, value: p.id }))],
    [projects]);
  const customerOptions = useMemo(() =>
    [{ label: 'All customers', value: '' }, ...Array.from(new Map((projects as any[]).filter((p: any) => p.customerId).map((p: any) => [p.customerId, p.customerName || p.customerId])).entries()).map(([value, label]) => ({ label, value }))],
    [projects]);
  const amcOptions = useMemo(() =>
    [{ label: 'All AMC', value: '' }, ...(amcContracts as any[]).map((a: any) => ({ label: a.contractNumber || a.id, value: a.id }))],
    [amcContracts]);
  const ticketOptions = useMemo(() =>
    [{ label: 'All service tickets', value: '' }, ...(serviceTickets as any[]).map((t: any) => ({ label: t.ticketNumber || t.id, value: t.id }))],
    [serviceTickets]);

  const DATE_OPTIONS = [
    { label: 'All dates', value: 'all' }, { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'week' }, { label: 'Last 30 days', value: 'month' },
    { label: 'Custom', value: 'custom' },
  ];
  function handleDateChange(v: string) { setDateRange(v); setPage(1); if (v !== 'custom') { setCustomFrom(''); setCustomTo(''); } sync({ date: v, from: '', to: '', page: 1 }); }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      projectId: form.projectId, projectName: form.projectName,
      readingDate: form.readingDate, readingKwh: Number(form.readingKwh), notes: form.notes,
    }, { onSuccess: () => { setFormOpen(false); setForm({ ...defaults }); toast.success('Reading recorded'); } });
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
      <WorkspaceHero title="Monitoring" icon={<Activity className="h-6 w-6" />}
        breadcrumbs={['Home', 'Post Sales', 'Monitoring']}
        statusText="Last sync · Realtime Connected" statusDotColor="var(--color-success)" className="gap-3"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => refetch()}>Refresh</Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...defaults }); setFormOpen(true); }}>Record Reading</Button>
          </>
        }
      />
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
        {KPI_TILES.map(k => (
          <PremiumKpi key={k.key} label={k.label} value={k.value} icon={k.icon} description={k.description}
            onClick={() => { const nk = activeKpi === k.key ? '' : k.key; setActiveKpi(nk); setPage(1); sync({ kpi: nk, page: 1 }); }}
            active={k.key === '' ? (activeKpi === '' || isTotalDefault) : activeKpi === k.key}
          />
        ))}
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        <CardHeader className="px-6 pt-2 pb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input aria-label="Search readings" placeholder="Search project, reading, or recorded by..."
              value={search} onChange={e => { setSearch(e.target.value); setPage(1); sync({ q: e.target.value, page: 1 }); }}
              className="min-w-[160px] flex-1 h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            />
            <Select aria-label="Date" value={dateRange} options={DATE_OPTIONS} onChange={e => handleDateChange(e.target.value)} className="w-[110px] h-8 py-1" />
            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); sync({ from: e.target.value, to: customTo, date: 'custom', page: 1 }); }} className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
                <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
                <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); sync({ to: e.target.value, from: customFrom, date: 'custom', page: 1 }); }} className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]" />
              </div>
            )}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeKpi && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">{KPI_TILES.find(t => t.key === activeKpi)?.label || activeKpi}<button type="button" onClick={() => { setActiveKpi(''); setPage(1); sync({ kpi: '', page: 1 }); }} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button></span>}
                {search && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">S: {search.slice(0, 12)}{search.length > 12 ? '…' : ''}</span>}
                <button type="button" onClick={resetAll} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"><X className="h-2.5 w-2.5" /> Clear</button>
              </div>
            )}
          </div>
        </CardHeader>

        {/* Business reference filters row */}
        <div className="px-6 pb-2 flex flex-wrap gap-2 border-b border-[var(--color-border-subtle)]">
          <Select aria-label="Recorded By" value={recordedByF} onChange={e => filterChange(setRecordedByF, 'recordedBy', e.target.value)} options={recordedByOptions} className="w-[140px] h-8 py-1" />
          <Select aria-label="Project" value={projectIdF} onChange={e => filterChange(setProjectIdF, 'projectId', e.target.value)} options={projectOptions} className="w-[150px] h-8 py-1" />
          <Select aria-label="Customer" value={customerIdF} onChange={e => filterChange(setCustomerIdF, 'customerId', e.target.value)} options={customerOptions} className="w-[150px] h-8 py-1" />
          <Select aria-label="AMC" value={amcIdF} onChange={e => filterChange(setAmcIdF, 'amcId', e.target.value)} options={amcOptions} className="w-[150px] h-8 py-1" />
          <Select aria-label="Service Ticket" value={serviceTicketIdF} onChange={e => filterChange(setServiceTicketIdF, 'serviceTicketId', e.target.value)} options={ticketOptions} className="w-[150px] h-8 py-1" />
        </div>

        {selected.size > 0 && (
          <div className="px-6 py-2.5 flex items-center gap-3 bg-[var(--color-primary-light)] border-b border-[var(--color-primary-muted)]">
            <span className="text-sm font-semibold text-[var(--color-primary-text)]">{selected.size} reading{selected.size > 1 ? 's' : ''} selected</span>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Button size="sm" variant="outline" icon={<Download className="h-3.5 w-3.5" />} onClick={() => { const rows_ = (readings as GenerationReadingRecord[]).filter(r => selected.has(r.id)); if (!rows_.length) return toast.error('No readings selected'); downloadCsv(rows_); toast.success(`Exported ${rows_.length} reading${rows_.length > 1 ? 's' : ''}`); }} className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-700 dark:hover:bg-emerald-900/30">Export CSV</Button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] ml-1">✕ Clear</button>
            </div>
          </div>
        )}

        <div className="px-6 flex-1 flex flex-col min-h-0">
          <div className="min-h-0 flex-1 overflow-auto scroll-pt-10">
            <Table>
              <Thead>
                <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}><UniversalCheckbox checked={allSel} indeterminate={selected.size > 0 && !allSel} onChange={toggleAll} ariaLabel="Select visible readings" /></Th>
                <Th style={{ width: '14%', minWidth: 110 }}>DATE</Th>
                <Th style={{ width: '22%', minWidth: 200 }}>PROJECT</Th>
                <Th style={{ width: '16%', minWidth: 120 }}>GENERATION</Th>
                <Th style={{ width: '14%', minWidth: 130 }}>RECORDED BY</Th>
                <Th style={{ width: '22%', minWidth: 200 }}>NOTES</Th>
                <Th align="right" style={{ width: 130, minWidth: 130 }}>ACTIONS</Th>
              </Thead>
              <Tbody>
                {isLoading ? <SkeletonRows cols={7} />
                  : rows.length === 0 ? (
                    <tr><td colSpan={7} className="py-14 text-center">
                      <EmptyState icon={<Activity className="h-9 w-9" />}
                        title={search || activeKpi ? 'No readings match filters' : 'No generation readings yet'}
                        description={search || activeKpi ? undefined : 'Record your first generation reading to start monitoring.'}
                        action={!search && !activeKpi ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setForm({ ...defaults }); setFormOpen(true); }} className="mt-2">Record Your First Reading</Button> : undefined}
                      />
                    </td></tr>
                  ) : rows.map((r: any) => (
                    <Tr key={r.id} selected={selected.has(r.id)} role="button" tabIndex={0}
                      onClick={() => setView(r)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView(r); } }}
                      className="transition-colors duration-150 cursor-pointer outline-none"
                    >
                      <Td className="py-3" onClick={e => e.stopPropagation()}><UniversalCheckbox checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} ariaLabel={`Select reading ${r.readingDate}`} /></Td>
                      <Td className="py-3"><span className="text-xs font-medium text-[var(--color-text-secondary)]">{fmtDate(r.readingDate)}</span></Td>
                      <Td className="py-3 min-w-[200px]">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center text-[11px] font-bold">
                            {(r.projectName || r.projectId || '?')[0].toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-[var(--color-text)]">{r.projectName || r.projectId}</span>
                        </div>
                      </Td>
                      <Td className="py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold">
                          <Zap className="h-3.5 w-3.5 text-amber-500" />{r.readingKwh} kWh
                        </span>
                      </Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">{r.recordedByName || 'System'}</Td>
                      <Td className="py-3 text-[13px] text-[var(--color-text-muted)] max-w-[240px] truncate">{r.notes || '—'}</Td>
                      <Td className="py-3" onClick={e => e.stopPropagation()}><div className="flex items-center justify-end"><Button size="xs" variant="outline" onClick={() => setView(r)}><FileText className="h-3.5 w-3.5 mr-1" />View</Button></div></Td>
                    </Tr>
                  ))}
              </Tbody>
            </Table>
          </div>
          <div className="shrink-0 border-t border-[var(--color-border-subtle)]">
            <Pagination page={page} total={filtered.length} perPage={perPage} onChange={n => { setPage(n); sync({ page: n }); }} onPerPageChange={n => { setPerPage(n); setPage(1); sync({ perPage: n, page: 1 }); }} />
          </div>
        </div>
      </Card>

      {/* Create Modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Record Generation Reading" size="md">
        <form onSubmit={submit} className="space-y-4">
          <Select label="Project" required value={form.projectId} onChange={e => { const p = (projects as any[]).find((x: any) => x.id === e.target.value); setForm(v => ({ ...v, projectId: e.target.value, projectName: p?.projectId || p?.name || '' })); }}
            options={[{ label: 'Select project...', value: '' }, ...(projects as any[]).map((p: any) => ({ label: p.projectId || p.name || p.id, value: p.id }))]} />
          <Input label="Reading Date" required type="date" value={form.readingDate} onChange={e => setForm(v => ({ ...v, readingDate: e.target.value }))} />
          <Input label="Generation (kWh)" required type="number" min="0" step="0.1" value={form.readingKwh} onChange={e => setForm(v => ({ ...v, readingKwh: e.target.value }))} />
          <Textarea label="Notes" value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} />
          <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Record Reading</Button></div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.readingKwh} kWh` : ''} size="lg">
        {view && (
          <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Project</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{view.projectName || view.projectId}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Reading Date</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{fmtDate(view.readingDate)}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Generation</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{view.readingKwh} kWh</p>
              </div>
              <div className="min-w-0 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Recorded By</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{view.recordedByName || 'System'}</p>
              </div>
              <div className="min-w-0 sm:col-span-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Notes</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{view.notes || 'No notes recorded.'}</p>
              </div>
            </div>
            <p className="text-[11px] text-[var(--color-text-disabled)] italic">Immutable historical record.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
