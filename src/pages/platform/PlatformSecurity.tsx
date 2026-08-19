/**
 * PlatformSecurity — Super Admin Platform Security screen (§6.7).
 *
 * Table: security_logs, platform-wide, filterable by severity / event type /
 * company / date range, with severity badges. This screen is the primary
 * consumer of the F-04-hardened security_logs collection (trustworthy,
 * Admin-only create, immutable — closed in Phase 0).
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search, Shield } from 'lucide-react';
import PlatformShell from './PlatformShell';
import { getAllPlatform } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Input';

const SEVERITY_VARIANT: Record<string, any> = {
  critical: 'danger', danger: 'danger', warning: 'warning',
  success: 'success', info: 'info',
};

export default function PlatformSecurity() {
  const [severityF, setSeverityF] = useState('all');
  const [eventF, setEventF] = useState('all');
  const [companyF, setCompanyF] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: logs = [] } = useQuery({ queryKey: ['platform-security'], queryFn: () => getAllPlatform<any>(COLLECTIONS.SECURITY_LOGS), staleTime: 30_000 });
  const { data: companies = [] } = useQuery({ queryKey: ['platform-companies'], queryFn: () => getAllPlatform<any>(COLLECTIONS.COMPANIES), staleTime: 30_000 });

  const eventTypes = useMemo(() => Array.from(new Set(logs.map((l: any) => l.metadata?.eventType || l.action).filter(Boolean))).sort(), [logs]);
  const companyName = (id: string) => { const c = companies.find((co: any) => co.id === id); return c ? (c.name || id) : id; };

  const rows = useMemo(() => {
    return logs
      .filter((l: any) => !l.isDeleted)
      .map((l: any) => ({
        id: l.id, timestamp: l.timestamp || l.createdAt || '', severity: l.severity || 'info',
        eventType: l.metadata?.eventType || l.action || 'security_event', message: l.message || '',
        userEmail: l.userEmail || '', companyId: l.companyId || '', metadata: l.metadata || {},
      }))
      .filter((l: any) => {
        if (severityF !== 'all' && l.severity !== severityF) return false;
        if (eventF !== 'all' && l.eventType !== eventF) return false;
        if (companyF !== 'all' && l.companyId !== companyF) return false;
        const q = search.toLowerCase().trim();
        if (q && !l.message.toLowerCase().includes(q) && !l.userEmail.toLowerCase().includes(q)) return false;
        if (dateFrom && new Date(l.timestamp) < new Date(dateFrom + 'T00:00:00')) return false;
        if (dateTo && new Date(l.timestamp) > new Date(dateTo + 'T23:59:59')) return false;
        return true;
      })
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [logs, companies, severityF, eventF, companyF, search, dateFrom, dateTo]);

  const criticalCount = rows.filter((l: any) => l.severity === 'critical').length;

  return (
    <PlatformShell title="Platform Security">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events…"
            className="pl-8 pr-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] w-56"
          />
        </div>
        <Select aria-label="Severity" value={severityF} onChange={(e) => setSeverityF(e.target.value)} options={[
          { label: 'All severities', value: 'all' },
          { label: 'Critical', value: 'critical' },
          { label: 'Warning', value: 'warning' },
          { label: 'Info', value: 'info' },
        ]} />
        <Select aria-label="Event type" value={eventF} onChange={(e) => setEventF(e.target.value)} options={[
          { label: 'All event types', value: 'all' },
          ...eventTypes.map((t) => ({ label: t, value: t })),
        ]} />
        <Select aria-label="Company" value={companyF} onChange={(e) => setCompanyF(e.target.value)} options={[
          { label: 'All companies', value: 'all' },
          ...companies.filter((c: any) => !c.isDeleted).map((c: any) => ({ label: c.name || c.id, value: c.id })),
        ]} />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]" title="From" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]" title="To" />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-danger-light)] text-[var(--color-danger-text)] text-sm font-semibold">
          <AlertTriangle className="h-4 w-4" /> {criticalCount} critical events in current filter
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] text-sm">
          <Shield className="h-4 w-4" /> {rows.length} events · security_logs is tamper-evident (immutable, Admin-only create — F-04)
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3 font-semibold">Timestamp</th>
                <th className="px-4 py-3 font-semibold">Severity</th>
                <th className="px-4 py-3 font-semibold">Event type</th>
                <th className="px-4 py-3 font-semibold">Message</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">Company</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((l: any) => (
                <tr key={l.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]">
                  <td className="px-4 py-3 text-[var(--color-text-muted)] whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge variant={SEVERITY_VARIANT[l.severity] || 'gray'}>{l.severity}</Badge></td>
                  <td className="px-4 py-3 text-[var(--color-text)]">{l.eventType}</td>
                  <td className="px-4 py-3 text-[var(--color-text)] max-w-md truncate" title={l.message}>{l.message}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{l.userEmail || 'system'}</td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">{l.companyId ? companyName(l.companyId) : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-muted)]">No security events match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </PlatformShell>
  );
}
