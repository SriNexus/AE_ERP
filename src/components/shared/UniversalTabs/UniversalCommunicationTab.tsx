/**
 * UniversalCommunicationTab — Communication log viewer
 *
 * Phase 0C: Shows communication records from the record data.
 * Supports Email, SMS, WhatsApp entries.
 * Future portal compatible — data structure allows partner portal integration.
 *
 * Features:
 * - Chronological communication timeline
 * - Icon per channel (Email, SMS, WhatsApp)
 * - Sender, recipient, timestamp
 * - Empty state: "No communication logged yet."
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Mail, MessageSquare, Phone, Send, Clock, User } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { EmptyState } from '../EmptyState';
import type { UniversalTabProps } from '../../../types';

// ── Communication Entry interface ───────────────────────────

type CommunicationChannel = 'email' | 'sms' | 'whatsapp' | 'phone' | 'meeting';

interface CommEntry {
  id: string;
  channel: CommunicationChannel;
  subject?: string;
  body: string;
  sender: string;
  recipient: string;
  sentAt: string;
  direction: 'inbound' | 'outbound';
  status?: 'sent' | 'delivered' | 'failed' | 'read';
}

// ── Channel config ──────────────────────────────────────────

const CHANNEL_CONFIG: Record<CommunicationChannel, { icon: React.ReactNode; label: string; color: string }> = {
  email:    { icon: <Mail className="h-3.5 w-3.5" />,         label: 'Email',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  sms:      { icon: <MessageSquare className="h-3.5 w-3.5" />, label: 'SMS',     color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  whatsapp: { icon: <MessageSquare className="h-3.5 w-3.5" />, label: 'WhatsApp', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  phone:    { icon: <Phone className="h-3.5 w-3.5" />,        label: 'Phone',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  meeting:  { icon: <User className="h-3.5 w-3.5" />,         label: 'Meeting', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
};

function formatCommDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffHours < 24) {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Main Component ──────────────────────────────────────────

export function UniversalCommunicationTab({
  permissions,
  record,
}: UniversalTabProps) {
  const [loading, setLoading] = useState(true);

  const entries = useMemo<CommEntry[]>(() => {
    const comms = (record as any)?.communicationLog || (record as any)?.communications || [];
    return comms
      .map((entry: any, index: number) => ({
        id: entry.id || `comm-${index}`,
        channel: (entry.channel || entry.type || 'email') as CommunicationChannel,
        subject: entry.subject,
        body: entry.body || entry.message || entry.note || '',
        sender: entry.sender || entry.from || entry.sentBy || 'System',
        recipient: entry.recipient || entry.to || '',
        sentAt: entry.sentAt || entry.createdAt || entry.date || new Date().toISOString(),
        direction: entry.direction || 'outbound',
        status: entry.status,
      }))
      .sort((a: CommEntry, b: CommEntry) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }, [record]);

  useEffect(() => {
    setLoading(false);
  }, [entries]);

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-[var(--color-bg-sunken)] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--color-border-subtle)] text-sm text-[var(--color-text-muted)]">
        <Send className="h-4 w-4" />
        <span>
          {entries.length} communication{entries.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Communication list */}
      <div className="flex-1 overflow-y-auto p-6">
        {entries.length === 0 ? (
          <EmptyState
            title="No communication logged yet."
            description="Email, SMS, and WhatsApp logs will appear here."
            compact
          />
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const config = CHANNEL_CONFIG[entry.channel] || CHANNEL_CONFIG.email;
              return (
                <div
                  key={entry.id}
                  className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]"
                >
                  <div className="flex items-start gap-3">
                    {/* Channel icon */}
                    <div className={cn(
                      'flex items-center justify-center h-8 w-8 rounded-lg shrink-0',
                      config.color,
                    )}>
                      {config.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                          {config.label}
                        </span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)]">
                          {entry.direction === 'inbound' ? 'Incoming' : 'Outgoing'}
                        </span>
                        {entry.status && (
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            · {entry.status}
                          </span>
                        )}
                      </div>

                      {/* Subject */}
                      {entry.subject && (
                        <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
                          {entry.subject}
                        </p>
                      )}

                      {/* Body */}
                      <p className="mt-0.5 text-sm text-[var(--color-text-secondary)] line-clamp-2">
                        {entry.body}
                      </p>

                      {/* Metadata */}
                      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {entry.sender}
                        </span>
                        {entry.recipient && (
                          <>
                            <span>→</span>
                            <span>{entry.recipient}</span>
                          </>
                        )}
                        <span className="inline-flex items-center gap-1 ml-auto">
                          <Clock className="h-3 w-3" />
                          {formatCommDate(entry.sentAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default UniversalCommunicationTab;
