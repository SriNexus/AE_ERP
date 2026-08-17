/**
 * InactiveRecordsModal — generic "show inactive / restore" surface.
 *
 * Blueprint Phase 13 (§13 Delete/Inactive/Permanent Delete Policy): every
 * soft-deletable list view should offer a "show inactive" toggle plus a
 * restore action, reusing the existing softDelete()/restoreRecord()
 * primitives rather than a per-module reimplementation. This one component
 * is the shared implementation; pages wire it in with just a collection
 * name and a couple of label functions instead of rebuilding the list/
 * restore UI themselves.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArchiveRestore } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { EmptyState } from './EmptyState';
import { getAllDeleted, restoreRecord, fmtDateTime, type DocWithId } from '../../lib/firestore';

interface InactiveRecordsModalProps<T> {
  open: boolean;
  onClose: () => void;
  col: string;
  title: string;
  getLabel: (row: DocWithId<T>) => string;
  getSubtitle?: (row: DocWithId<T>) => string;
  /** Called after a successful restore, so the caller can refresh its own active-record list. */
  onRestored?: () => void;
}

export function InactiveRecordsModal<T = Record<string, unknown>>({
  open, onClose, col, title, getLabel, getSubtitle, onRestored,
}: InactiveRecordsModalProps<T>) {
  const qc = useQueryClient();
  const queryKey = ['inactive-records', col];

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getAllDeleted<T>(col),
    enabled: open,
    staleTime: 0,
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreRecord(col, id),
    onSuccess: () => {
      toast.success('Record restored');
      void qc.invalidateQueries({ queryKey });
      onRestored?.();
    },
    onError: (error: any) => toast.error(error?.message || 'Restore failed'),
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title={title}>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {isLoading && <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Loading inactive records…</p>}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={<ArchiveRestore className="h-8 w-8" />} title="No inactive records" description="Soft-deleted records will appear here and can be restored." />
        )}
        {rows.map((row: any) => (
          <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-text)]">{getLabel(row)}</p>
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {getSubtitle?.(row)}
                {getSubtitle?.(row) ? ' · ' : ''}
                Deleted {fmtDateTime(row.deletedAt)}{row.deletedBy ? ` by ${row.deletedBy}` : ''}
              </p>
            </div>
            <Button
              size="sm" variant="outline" icon={<ArchiveRestore className="h-3.5 w-3.5" />}
              loading={restoreMut.isPending && restoreMut.variables === row.id}
              onClick={() => restoreMut.mutate(row.id)}
            >
              Restore
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
