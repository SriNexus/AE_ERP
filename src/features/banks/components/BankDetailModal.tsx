import { useEffect, useState } from 'react';
import { X, Edit2, Trash2 } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { BankStatusBadge, BankTypeBadge, BankDetailCard, BankField } from './BankWorkspaceParts';
import { useBranches, useUpdateBranch, useDeleteBranch, type BankRecord, type BranchRecord } from '../hooks/useBanks';
import { fmtDate } from '../../../lib/firestore';

interface BankDetailModalProps {
  open: boolean;
  bank: BankRecord | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function formatDate(v: any) {
  if (!v) return '—';
  const d = typeof v === 'object' && v.seconds ? new Date(v.seconds * 1000) : new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
}

export function BankDetailModal({ open, bank, onClose, onEdit, onDelete }: BankDetailModalProps) {
  const [tab, setTab] = useState<'overview' | 'branches'>('overview');
  const { data: branches = [] } = useBranches(bank?.id);
  const updateBranch = useUpdateBranch();
  const deleteBranch = useDeleteBranch();
  const [editBranchId, setEditBranchId] = useState<string | null>(null);
  const [editBranchName, setEditBranchName] = useState('');
  const [deleteBranchId, setDeleteBranchId] = useState<string | null>(null);

  useEffect(() => { if (open) setTab('overview'); }, [open, bank?.id]);

  if (!open || !bank) return null;

  const sortedBranches = [...(branches as BranchRecord[])]
    .filter(b => !b.isDeleted)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));

  const tabs = [
    ['overview', 'Overview'],
    ['branches', `Branches (${sortedBranches.length})`],
  ] as const;

  return (
    <>
      <Modal open={open} onClose={onClose} size="2xl">
        <div className="flex h-[78vh] max-h-[760px] min-h-0 flex-col text-sm text-[var(--color-text-secondary)]">
          <header className="shrink-0 flex flex-col gap-5 border-b border-[var(--color-border-subtle)] pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-3xl font-bold text-[var(--color-primary-text)] ring-1 ring-[var(--color-primary-muted)]">
                {(bank.displayName || bank.bankName || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-bold text-[var(--color-text)]">{bank.displayName || bank.bankName}</h2>
                  <span>{BankStatusBadge(bank.status)}</span>
                  {bank.bankType && <span>{BankTypeBadge(bank.bankType)}</span>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                  <span className="font-mono">{bank.bankCode}</span>
                  <span>Priority: {bank.priority || '—'}</span>
                  <span>Updated: {formatDate(bank.updatedAt)}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2" data-action>
              <button onClick={onClose} className="rounded-xl p-2 hover:bg-[var(--color-surface-hover)]" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <nav className="shrink-0 grid grid-cols-2 gap-1 border-b border-[var(--color-border-subtle)] py-4">
            {tabs.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                className={`rounded-lg px-2 py-2 text-center text-xs font-semibold transition-colors ${
                  tab === key ? 'text-[var(--color-primary-text)] shadow-[inset_0_-2px_0_var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
                }`}>{label}</button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'overview' && (
              <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-5">
                  <BankDetailCard title="Bank Information">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <BankField label="Bank Code" value={bank.bankCode} />
                      <BankField label="Bank Name" value={bank.bankName} />
                      <BankField label="Display Name" value={bank.displayName || '—'} />
                      <BankField label="Bank Type" value={bank.bankType || '—'} />
                      <BankField label="Status" value={bank.status} />
                      <BankField label="Priority" value={bank.priority ?? '—'} />
                    </div>
                  </BankDetailCard>
                  {bank.ifscPrefix && (
                    <BankDetailCard title="Banking Configuration">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <BankField label="IFSC Prefix" value={bank.ifscPrefix} />
                      </div>
                    </BankDetailCard>
                  )}
                  <BankDetailCard title="System Info">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <BankField label="Created" value={formatDate(bank.createdAt)} />
                      <BankField label="Updated" value={formatDate(bank.updatedAt)} />
                      <BankField label="Known Branches" value={sortedBranches.length} />
                    </div>
                  </BankDetailCard>
                </div>
                <aside className="space-y-4">
                  <BankDetailCard title="Quick Actions">
                    <div className="space-y-2">
                      <Button variant="outline" size="sm" className="w-full justify-start" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={onEdit}>Edit Bank</Button>
                      <Button variant="danger" size="sm" className="w-full justify-start" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>Delete Bank</Button>
                    </div>
                  </BankDetailCard>
                </aside>
              </div>
            )}

            {tab === 'branches' && (
              <div className="pt-5 space-y-5">
                <BankDetailCard title="Known Branches">
                  <p className="text-xs text-[var(--color-text-muted)] mb-3">
                    Branches are learned automatically from ERP usage. Most-used branches appear first.
                  </p>
                  {sortedBranches.length > 0 ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[1fr_80px_120px_80px] gap-2 px-3 py-2 bg-[var(--color-bg-sunken)] rounded-lg text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                        <span>Branch Name</span>
                        <span className="text-right">Used</span>
                        <span className="text-right">Last Used</span>
                        <span className="text-right">Actions</span>
                      </div>
                      {sortedBranches.map((br: any) => (
                        <div key={br.id} className="grid grid-cols-[1fr_80px_120px_80px] gap-2 items-center px-3 py-2 rounded-lg border border-[var(--color-border-subtle)]">
                          {editBranchId === br.id ? (
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={editBranchName}
                                onChange={e => setEditBranchName(e.target.value)}
                                className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs bg-[var(--color-surface)]"
                                autoFocus
                              />
                              <Button size="xs" onClick={() => { updateBranch.mutate({ bankId: bank.id, branchId: br.id, branchName: editBranchName }); setEditBranchId(null); }}>Save</Button>
                              <Button size="xs" variant="outline" onClick={() => setEditBranchId(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-medium text-[var(--color-text)] truncate">{br.branchName}</span>
                              <span className="text-xs text-right text-[var(--color-text-muted)]">{br.usageCount || 0}</span>
                              <span className="text-xs text-right text-[var(--color-text-muted)]">{formatDate(br.lastUsedAt)}</span>
                              <div className="flex justify-end gap-1" data-action>
                                <button onClick={() => { setEditBranchId(br.id); setEditBranchName(br.branchName); }} className="p-1 rounded hover:bg-[var(--color-surface-hover)]" title="Rename"><Edit2 className="h-3 w-3" /></button>
                                <button onClick={() => setDeleteBranchId(br.id)} className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-red-500" title="Delete"><Trash2 className="h-3 w-3" /></button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)] py-4 text-center border border-dashed rounded-xl">
                      No branches recorded yet. Branches are automatically learned when employees enter them during registration.
                    </p>
                  )}
                </BankDetailCard>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteBranchId}
        onClose={() => setDeleteBranchId(null)}
        onConfirm={() => { if (deleteBranchId && bank) deleteBranch.mutate({ bankId: bank.id, branchId: deleteBranchId }); setDeleteBranchId(null); }}
        loading={deleteBranch.isPending}
        title="Delete Branch"
        message="Delete this branch from the known branches list?"
      />
    </>
  );
}
