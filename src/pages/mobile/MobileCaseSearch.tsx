/**
 * MobileCaseSearch — Mobile Case Search
 *
 * Phase 3M — Mobile Support
 * Route: /cases/search (mobile)
 *
 * Features:
 *   - Global search across case IDs, leads, customers
 *   - Filters: Status, Stage, Health, Date range
 *   - Tag-based stage selection
 *   - Health color coding
 *   - Touch-optimized results list
 */

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../utils/cn';
import {
  Search, X, FolderKanban, ChevronRight, Filter, SlidersHorizontal,
  CheckCircle2, AlertTriangle, XCircle, ArrowLeft,
} from 'lucide-react';
import { TOUCH } from '../../components/mobile/shared/styles';
import { generateCaseHealthReport } from '../../engines/CaseValidationEngine';

const STAGE_OPTIONS = [
  'All', 'New', 'Lead', 'Customer', 'Project', 'Quotation', 'Order',
  'Invoice', 'Payment', 'Dispatch', 'Installation', 'QC',
  'Commissioning', 'Net Metering', 'Subsidy', 'Handover',
  'AMC', 'Service', 'Monitoring',
];

const STATUS_OPTIONS = ['All', 'Active', 'Completed', 'Failed', 'Warning', 'Archived'];
const HEALTH_OPTIONS = ['All', 'Healthy', 'Warning', 'Critical'];

// ── Component ──────────────────────────────────────────────

export default function MobileCaseSearch() {
  const navigate = useNavigate();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  const [healthFilter, setHealthFilter] = useState('All');
  const [showFilters, setShowFilters] = useState(false);
  const [healthReport, setHealthReport] = useState<any>(null);

  // Auto-focus search input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load health report for health filter
  useEffect(() => {
    generateCaseHealthReport().then(setHealthReport).catch(() => {});
  }, []);

  // Data
  const casesQ = useQuery({
    queryKey: ['mobile-case-search', activeCompanyId],
    queryFn: () => getAll<any>(COLLECTIONS.CASES),
    staleTime: 30_000,
  });
  const leadsQ = useQuery({
    queryKey: ['mobile-leads-search', activeCompanyId],
    queryFn: () => getAll<any>(COLLECTIONS.LEADS),
    staleTime: 60_000,
  });
  const customersQ = useQuery({
    queryKey: ['mobile-customers-search', activeCompanyId],
    queryFn: () => getAll<any>(COLLECTIONS.CUSTOMERS),
    staleTime: 60_000,
  });

  const allCases = (casesQ.data as any[]) || [];
  const allLeads = (leadsQ.data as any[]) || [];
  const allCustomers = (customersQ.data as any[]) || [];

  // Determine health for a case
  const getHealth = useCallback((c: any): 'healthy' | 'warning' | 'critical' => {
    if (c.status === 'Failed') return 'critical';
    if (c.status === 'Warning') return 'warning';
    if (c.status === 'Active' && c.leadId && c.customerId) return 'healthy';
    return 'warning';
  }, []);

  // Filtered results
  const results = useMemo(() => {
    let list = allCases.filter((c: any) => !c.isDeleted);

    // Text search
    if (query.trim()) {
      const q = query.toLowerCase().trim();
      list = list.filter((c: any) => {
        const lead = allLeads.find((l: any) => l.id === c.leadId);
        const customer = allCustomers.find((cu: any) => cu.id === c.customerId);
        return (
          String(c.caseId || '').toLowerCase().includes(q) ||
          String(lead?.name || '').toLowerCase().includes(q) ||
          String(customer?.name || '').toLowerCase().includes(q) ||
          String(c.currentStage || '').toLowerCase().includes(q) ||
          String(c.status || '').toLowerCase().includes(q)
        );
      });
    }

    // Status filter
    if (statusFilter !== 'All') {
      list = list.filter((c: any) => c.status === statusFilter);
    }

    // Stage filter
    if (stageFilter !== 'All') {
      list = list.filter((c: any) => (c.currentStage || '') === stageFilter);
    }

    // Health filter
    if (healthFilter !== 'All') {
      list = list.filter((c: any) => {
        const h = getHealth(c);
        if (healthFilter === 'Healthy') return h === 'healthy';
        if (healthFilter === 'Warning') return h === 'warning';
        if (healthFilter === 'Critical') return h === 'critical';
        return true;
      });
    }

    return list.sort((a: any, b: any) => {
      const aDate = a.updatedAt || a.createdAt;
      const bDate = b.updatedAt || b.createdAt;
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return new Date(String(bDate)).getTime() - new Date(String(aDate)).getTime();
    });
  }, [allCases, allLeads, allCustomers, query, statusFilter, stageFilter, healthFilter, getHealth]);

  const activeFilterCount = [statusFilter, stageFilter, healthFilter].filter(f => f !== 'All').length;

  return (
    <div className="flex flex-col min-h-screen bg-[var(--color-bg)]">
      {/* Sticky search header */}
      <div className="sticky top-0 z-10 bg-[var(--color-bg)]/90 backdrop-blur-lg border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className={cn(TOUCH.MIN, 'p-2 rounded-lg shrink-0')}
          >
            <ArrowLeft className="h-5 w-5 text-[var(--color-text-muted)]" />
          </button>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search cases by ID, lead, customer..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cn(
                'w-full pl-9 pr-8 py-2.5 text-sm rounded-xl',
                'bg-[var(--color-bg-sunken)] text-[var(--color-text)]',
                'placeholder-[var(--color-text-muted)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]/40',
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
              >
                <X className="h-4 w-4 text-[var(--color-text-muted)]" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              TOUCH.MIN, 'p-2 rounded-lg relative shrink-0',
              showFilters || activeFilterCount > 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]',
            )}
          >
            <SlidersHorizontal className="h-5 w-5" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-[var(--color-primary)] text-[9px] font-bold text-white flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Collapsible filters */}
        {showFilters && (
          <div className="px-3 pb-3 space-y-3">
            {/* Status */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setStatusFilter(opt)}
                    className={cn(
                      'px-2.5 py-1.5 text-xs rounded-lg font-medium transition-all',
                      statusFilter === opt
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Stage */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Stage</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {STAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setStageFilter(opt)}
                    className={cn(
                      'px-2.5 py-1.5 text-xs rounded-lg font-medium transition-all',
                      stageFilter === opt
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Health */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Health</p>
              <div className="flex flex-wrap gap-1.5">
                {HEALTH_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setHealthFilter(opt)}
                    className={cn(
                      'px-2.5 py-1.5 text-xs rounded-lg font-medium transition-all',
                      healthFilter === opt
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-3 pb-28">
        <div className="flex items-center justify-between py-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            {results.length} result{results.length !== 1 ? 's' : ''}
            {query && ` for "${query}"`}
          </p>
        </div>

        {results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FolderKanban className="h-10 w-10 text-[var(--color-text-disabled)] mb-3" />
            <p className="text-sm text-[var(--color-text-muted)]">
              {query ? 'No cases match your search' : 'Start typing to search'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {results.map((c: any) => {
              const health = getHealth(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`/cases/${encodeURIComponent(c.id)}`)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)]',
                    'px-3 py-2.5 text-left active:scale-[0.98] transition-transform',
                  )}
                >
                  <div className={cn(
                    'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
                    health === 'healthy' ? 'bg-emerald-50 dark:bg-emerald-900/20' :
                    health === 'critical' ? 'bg-red-50 dark:bg-red-900/20' :
                    'bg-amber-50 dark:bg-amber-900/20',
                  )}>
                    {health === 'healthy' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : health === 'critical' ? (
                      <XCircle className="h-4 w-4 text-red-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text)] truncate">
                      {c.caseId || c.id}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[var(--color-text-muted)]">{c.currentStage || 'New'}</span>
                      <span className={cn(
                        'inline-block h-1.5 w-1.5 rounded-full',
                        health === 'healthy' ? 'bg-emerald-500' :
                        health === 'critical' ? 'bg-red-500' : 'bg-amber-500',
                      )} />
                      <span className="text-[10px] capitalize text-[var(--color-text-muted)]">{health}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)] shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
