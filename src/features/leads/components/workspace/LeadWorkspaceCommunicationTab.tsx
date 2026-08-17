/**
 * CommunicationTab — Communication history tab.
 * Shows call/WhatsApp/email activity from the activity log.
 * UI only — driven by activity log data, no persistence.
 * Phase 1 Polish — Better summary cards, history entries, visual hierarchy.
 */
import { Phone, MessageCircle, Mail, History } from 'lucide-react';

interface ActivityEntry {
  id?: string;
  type?: string;
  desc?: string;
  date?: string;
  userName?: string;
}

interface Props {
  activities: ActivityEntry[];
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  try {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}

export default function CommunicationTab({ activities }: Props) {
  const sorted = [...activities].reverse();

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: Phone, label: 'Calls', value: sorted.filter(a => (a.desc || '').toLowerCase().includes('call')).length, color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20', borderColor: 'border-blue-200 dark:border-blue-800' },
          { icon: MessageCircle, label: 'WhatsApp', value: sorted.filter(a => (a.desc || '').toLowerCase().includes('whatsapp')).length, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20', borderColor: 'border-emerald-200 dark:border-emerald-800' },
          { icon: Mail, label: 'Emails', value: sorted.filter(a => (a.desc || '').toLowerCase().includes('email')).length, color: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20', borderColor: 'border-purple-200 dark:border-purple-800' },
        ].map((stat, i) => (
          <div key={i} className={['flex items-center gap-3 rounded-xl border bg-[var(--color-surface)] px-4 py-3.5 shadow-sm transition-shadow hover:shadow-md', stat.borderColor].join(' ')}>
            <div className={['flex h-10 w-10 items-center justify-center rounded-full', stat.color].join(' ')}>
              <stat.icon className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-text)]">{stat.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Activity Feed */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-primary-light)]">
            <History className="h-3.5 w-3.5 text-[var(--color-primary-text)]" />
          </div>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Communication History</h3>
          {sorted.length > 0 && (
            <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{sorted.length} entries</span>
          )}
        </div>
        {sorted.length > 0 ? (
          <div className="space-y-2">
            {sorted.slice(0, 20).map((entry, idx) => (
              <div key={entry.id || idx} className="flex items-start gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-4 py-3.5 transition-colors hover:border-[var(--color-border)]">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[var(--color-text)]">{entry.type || 'Activity'}</p>
                    <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">{fmtDate(entry.date)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{entry.desc || 'No details recorded'}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{entry.userName || 'System'}</p>
                </div>
              </div>
            ))}
            {sorted.length > 20 && (
              <p className="text-[11px] font-medium text-[var(--color-text-muted)] text-center pt-2">+{sorted.length - 20} older entries</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <MessageCircle className="h-10 w-10 text-[var(--color-text-disabled)]" />
            <p className="text-sm text-[var(--color-text-muted)]">No communication history yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
