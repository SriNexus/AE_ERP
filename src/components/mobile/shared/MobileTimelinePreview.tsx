import { useMemo, useState } from 'react';
import { Button, Modal } from '../../ui';

export type MobileTimelineEntry = {
  type?: string;
  title?: string;
  desc?: string;
  description?: string;
  date?: any;
  createdAt?: any;
  updatedAt?: any;
  modifiedAt?: any;
  userName?: string;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function entryDate(entry: MobileTimelineEntry) {
  return toDate(entry.modifiedAt || entry.updatedAt || entry.date || entry.createdAt);
}

function formatDate(value: any) {
  const date = toDate(value);
  if (!date) return 'Not available';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function TimelineRow({ entry }: { entry: MobileTimelineEntry }) {
  const title = entry.type || entry.title || 'Activity';
  const desc = entry.desc || entry.description || '';
  const date = entryDate(entry);
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] p-3">
      <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
      {desc ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{desc}</p> : null}
      <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
        {formatDate(date)}{entry.userName ? ` · ${entry.userName}` : ''}
      </p>
    </div>
  );
}

export function MobileTimelinePreview({ title = 'Timeline', entries }: { title?: string; entries: MobileTimelineEntry[] }) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(() => [...entries]
    .filter(Boolean)
    .sort((a, b) => (entryDate(b)?.getTime() || 0) - (entryDate(a)?.getTime() || 0)), [entries]);
  const preview = sorted.slice(0, 2);

  return (
    <>
      <div className="space-y-2">
        {preview.length ? preview.map((entry, index) => <TimelineRow key={index} entry={entry} />) : (
          <p className="text-sm text-[var(--color-text-muted)]">No timeline activity yet.</p>
        )}
        {sorted.length > 2 ? (
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            View All
          </Button>
        ) : null}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="full">
        <div className="space-y-2">
          {sorted.map((entry, index) => <TimelineRow key={index} entry={entry} />)}
        </div>
      </Modal>
    </>
  );
}

export default MobileTimelinePreview;
