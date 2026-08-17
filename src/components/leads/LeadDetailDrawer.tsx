import { useQuery } from '@tanstack/react-query';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Calendar, CornerUpRight, Edit2, UserCheck, X } from 'lucide-react';
import { COLLECTIONS, db } from '../../lib/firebase';
import { fmtDate, fmtDateTime } from '../../lib/firestore';
import { Button } from '../ui/Button';
import { statusBadge } from '../ui/Badge';

type Props = {
  lead: Record<string, any> | null;
  onClose: () => void;
  onEdit: (lead: Record<string, any>) => void;
  onConvert: (lead: Record<string, any>) => void;
  onFollowup: (lead: Record<string, any>) => void;
  onAssign: (lead: Record<string, any>) => void;
};

async function getLeadActivity(leadId: string) {
  const snap = await getDocs(query(
    collection(db, COLLECTIONS.AUDIT_LOGS),
    where('entityId', '==', leadId)
  ));
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Record<string, any>))
    .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm text-[var(--color-text)]">{String(value || '-')}</p>
    </div>
  );
}

export function LeadDetailDrawer({ lead, onClose, onEdit, onConvert, onFollowup, onAssign }: Props) {
  const { data: activity = [] } = useQuery({
    queryKey: ['lead-audit-logs', lead?.id],
    queryFn: () => getLeadActivity(String(lead?.id || '')),
    enabled: Boolean(lead?.id),
    staleTime: 30_000,
  });

  if (!lead) return null;

  const fields = [
    ['Name', lead.name],
    ['Phone', lead.phone],
    ['Email', lead.email],
    ['City', lead.city],
    ['State', lead.state],
    ['Source', lead.source],
    ['Status', lead.status],
    ['Assigned To', lead.assignedToName || lead.assigned_t],
    ['Created', fmtDate(lead.createdAt)],
    ['Updated', fmtDate(lead.updatedAt)],
    ['Next Follow-up', fmtDate(lead.next_date)],
    ['Converted Customer', lead.convertedCustomerId],
    ['Notes', lead.notes],
    ['Last Note', lead.last_note],
  ];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[var(--color-overlay)]" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Lead</p>
            <h2 className="truncate text-lg font-semibold text-[var(--color-text)]">{lead.name || 'Untitled Lead'}</h2>
            <div className="mt-2">{statusBadge(lead.status || 'New')}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map(([label, value]) => <Field key={label} label={String(label)} value={value} />)}
          </section>

          <section className="mt-6 border-t border-[var(--color-border)] pt-5">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Activity timeline</h3>
            <div className="mt-3 space-y-3">
              {activity.length ? activity.map((item) => (
                <div key={item.id} className="rounded border border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{item.action || item.type || 'Activity'}</p>
                    <p className="shrink-0 text-xs text-[var(--color-text-muted)]">{fmtDateTime(item.createdAt || item.date)}</p>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{item.description || item.message || item.metadata?.leadName || item.userName || '-'}</p>
                </div>
              )) : (
                <p className="text-sm text-[var(--color-text-muted)]">No activity recorded.</p>
              )}
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg-sunken)] px-5 py-4">
          <Button variant="outline" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => onEdit(lead)}>Edit</Button>
          <Button variant="outline" size="sm" icon={<Calendar className="h-3.5 w-3.5" />} onClick={() => onFollowup(lead)}>Create Follow-up</Button>
          <Button variant="outline" size="sm" icon={<CornerUpRight className="h-3.5 w-3.5" />} onClick={() => onAssign(lead)}>Assign to</Button>
          <Button size="sm" icon={<UserCheck className="h-3.5 w-3.5" />} onClick={() => onConvert(lead)}>Convert to Customer</Button>
        </footer>
      </aside>
    </div>
  );
}
