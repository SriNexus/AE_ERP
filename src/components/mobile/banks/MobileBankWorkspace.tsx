/**
 * MobileBankWorkspace — Mobile Bank Master workspace
 *
 * Follows Desktop business logic. Card layout only.
 * No mobile-specific business logic.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Landmark } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, Modal } from '../../ui';
import { useBanks, type BankRecord } from '../../../features/banks/hooks/useBanks';
import { usePermissions } from '../../../lib/permissions';

const PER_PAGE = 10;

type Mode = 'records';

type BankFilters = {
  search: string;
  status: string;
};

function filterBanks(rows: BankRecord[], filters: BankFilters) {
  const term = filters.search.trim().toLowerCase();
  return rows
    .filter((b) => {
      if (filters.status !== 'All' && b.status !== filters.status) return false;
      if (!term) return true;
      return [b.bankName, b.bankCode, b.displayName]
        .some((value) => String(value || '').toLowerCase().includes(term));
    })
    .sort((a, b) => (a.priority || 999) - (b.priority || 999));
}

export function MobileBankWorkspace({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const perms = usePermissions();
  const { data: banks = [], isLoading, error } = useBanks();

  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page')) || 1));
  const [viewBank, setViewBank] = useState<BankRecord | null>(null);
  const openId = params.get('open') || '';

  const filters = useMemo<BankFilters>(() => ({
    search: params.get('q') || '',
    status: params.get('status') || 'All',
  }), [params]);

  const filteredRows = useMemo(() => filterBanks(banks as BankRecord[], filters), [banks, filters]);
  const paginatedRows = useMemo(() => filteredRows.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredRows, page]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRows.length / PER_PAGE));
    if (page > maxPage) setPage(maxPage);
  }, [filteredRows.length, page]);

  const userClosedRef = useRef(false);

  useEffect(() => {
    if (userClosedRef.current) { userClosedRef.current = false; return; }
    if (!openId || isLoading) return;
    const target = (banks as BankRecord[]).find((r) => r.id === openId);
    if (target && !viewBank) setViewBank(target);
  }, [openId, isLoading, banks, viewBank]);

  function openDetail(bank: BankRecord) {
    userClosedRef.current = false;
    setViewBank(bank);
    const next = new URLSearchParams(params);
    next.set('open', bank.id);
    setParams(next, { replace: true });
  }

  function closeDetail() {
    userClosedRef.current = true;
    setViewBank(null);
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next, { replace: true });
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set('page', String(nextPage));
    else next.delete('page');
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-4 pb-2 pt-2">
      <div className="px-1 pb-1 pt-2">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Bank Master</h1>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
          {(error as Error).message}
        </div>
      )}

      <div className="space-y-3">
        {isLoading && Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="rounded-xl p-3">
            <div className="flex gap-3">
              <div className="flex-1 space-y-3">
                <div className="h-4 w-2/3 rounded bg-[var(--color-bg-sunken)]" />
                <div className="h-3 w-1/2 rounded bg-[var(--color-bg-sunken)]" />
              </div>
            </div>
          </Card>
        ))}
        {!isLoading && filteredRows.length === 0 && (
          <Card className="rounded-xl p-8 text-center text-sm text-[var(--color-text-muted)]">
            <Landmark className="mx-auto h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="mt-2">{filters.search || filters.status !== 'All' ? 'No banks match filters.' : 'No banks yet.'}</p>
          </Card>
        )}
        {!isLoading && paginatedRows.map((bank) => (
          <BankCard key={bank.id} bank={bank} onView={() => openDetail(bank)} />
        ))}
      </div>

      {!isLoading && filteredRows.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-[var(--color-text-muted)]">{filteredRows.length} bank{filteredRows.length > 1 ? 's' : ''}</span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => changePage(page - 1)}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs font-medium disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= Math.ceil(filteredRows.length / PER_PAGE)}
              onClick={() => changePage(page + 1)}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-xs font-medium disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <BankViewModal bank={viewBank} onClose={closeDetail} />
    </div>
  );
}

function BankCard({ bank, onView }: { bank: BankRecord; onView: () => void }) {
  return (
    <Card className="rounded-xl border border-[var(--color-border-subtle)] p-3 shadow-sm transition-shadow hover:shadow-[var(--shadow-enterprise-row)]">
      <button type="button" onClick={onView} className="w-full text-left">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
            {(bank.displayName || bank.bankName || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-5 text-[var(--color-text)]">{bank.displayName || bank.bankName}</p>
            <p className="mt-0.5 text-xs font-medium text-[var(--color-text-muted)]">
              {bank.bankCode}
              {bank.bankType ? ` · ${bank.bankType}` : ''}
            </p>
          </div>
          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${
            bank.status === 'Active'
              ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-700'
              : 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600'
          }`}>
            {bank.status || 'Active'}
          </span>
        </div>
      </button>
    </Card>
  );
}

function BankViewModal({ bank, onClose }: { bank: BankRecord | null; onClose: () => void }) {
  if (!bank) return null;
  return (
    <Modal open={!!bank} onClose={onClose} title={bank.displayName || bank.bankName} size="full">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Bank Code</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{bank.bankCode}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Status</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{bank.status}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Bank Name</p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{bank.bankName}</p>
        </div>
        {bank.bankType && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Type</p>
            <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{bank.bankType}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Priority</p>
          <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{bank.priority ?? '—'}</p>
        </div>
      </div>
    </Modal>
  );
}

export default MobileBankWorkspace;
