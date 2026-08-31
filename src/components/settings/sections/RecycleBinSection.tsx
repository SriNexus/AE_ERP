/**
 * RecycleBinSection — App Settings surface for recovering deactivated records.
 *
 * Central access point for inactive / soft-deleted records that used to be
 * exposed directly on their list pages. Currently hosts Inactive Leads; it
 * reuses the existing soft-delete primitives (getAllDeleted / restoreRecord)
 * rather than introducing a second inactive-record system.
 */

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../shared/EmptyState';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAllDeleted, restoreRecord, fmtDateTime } from '../../../lib/firestore';

interface RecycleBinListProps {
  col: string;
  getLabel: (row: any) => string;
  getSubtitle?: (row: any) => string;
}

function RecycleBinList({ col, getLabel, getSubtitle }: RecycleBinListProps) {
  const qc = useQueryClient();
  const queryKey = ['inactive-records', col];

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getAllDeleted(col),
    staleTime: 0,
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreRecord(col, id),
    onSuccess: () => {
      toast.success('Record restored');
      void qc.invalidateQueries({ queryKey });
      // Refresh the active list the record rejoins.
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Restore failed'),
  });

  if (isLoading) {
    return <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">Loading inactive records…</p>;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ArchiveRestore className="h-8 w-8" />}
        title="No inactive records"
        description="Deactivated records will appear here and can be restored."
      />
    );
  }

  return (
    <div className="max-h-[55vh] space-y-2 overflow-y-auto">
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
  );
}

export function RecycleBinSection() {
  return (
    <SettingsSection
      title="Recycle Bin"
      description="Recover records that were deactivated from their workspaces."
      icon={<Trash2 className="h-4 w-4" />}
    >
      <SettingsCard title="Inactive Leads" description="Leads that were deactivated from the Leads workspace. Restore one to return it to the active Leads list.">
        <RecycleBinList
          col={COLLECTIONS.LEADS}
          getLabel={(row) => row.name || row.phone || row.id}
          getSubtitle={(row) => row.phone || row.email || ''}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
