/**
 * QuickActionBar — Floating action icon bar for mobile record detail screens.
 * Shows: Call, Mail, WhatsApp, Share, More (overflow).
 * Only renders actions where data (phone, email) is available.
 * Uses semantic CSS tokens. Icons-only layout.
 */

import React, { useState } from 'react';
import { Phone, Mail, MessageCircle, Share2, MoreHorizontal, X } from 'lucide-react';

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
}

interface QuickActionBarProps {
  phone?: string | null;
  email?: string | null;
  /** Additional overflow actions shown when "More" is tapped */
  moreActions?: Array<{ label: string; onClick: () => void; danger?: boolean }>;
}

export function QuickActionBar({ phone, email, moreActions = [] }: QuickActionBarProps) {
  const [showMoreSheet, setShowMoreSheet] = useState(false);

  const actions: QuickAction[] = [
    ...(phone
      ? [{ icon: <Phone className="h-4 w-4" />, label: 'Call', href: `tel:${phone}`, onClick: () => { window.location.href = `tel:${phone}`; } }]
      : []),
    ...(email
      ? [{ icon: <Mail className="h-4 w-4" />, label: 'Email', href: `mailto:${email}`, onClick: () => { window.location.href = `mailto:${email}`; } }]
      : []),
    ...(phone
      ? [{ icon: <MessageCircle className="h-4 w-4" />, label: 'WhatsApp', href: `https://wa.me/${String(phone).replace(/\D/g, '')}`, onClick: () => { window.open(`https://wa.me/${String(phone).replace(/\D/g, '')}`, '_blank'); } }]
      : []),
    ...(phone || email
      ? [{
          icon: <Share2 className="h-4 w-4" />,
          label: 'Share',
          onClick: () => {
            const text = [phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : ''].filter(Boolean).join('\n');
            if (navigator.share) {
              navigator.share({ title: 'Contact', text }).catch(() => {});
            } else if (navigator.clipboard) {
              navigator.clipboard.writeText(text).then(() => {
                const toast = document.createElement('div');
                toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-[var(--color-text)] px-4 py-2 text-sm font-semibold text-[var(--color-text-inverse)] shadow-[var(--shadow-dropdown)] animate-fadeIn';
                toast.textContent = 'Contact info copied';
                document.body.appendChild(toast);
                window.setTimeout(() => toast.remove(), 2000);
              }).catch(() => {});
            }
          },
        }]
      : []),
  ];

  if (actions.length === 0 && moreActions.length === 0) return null;

  const visibleIcons = actions.slice(0, 4);
  const hasOverflow = actions.length > 4 || moreActions.length > 0;

  return (
    <>
      <div className="flex items-center justify-center gap-1.5 px-2 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
        {visibleIcons.map((action, index) => (
          <button
            key={action.label}
            type="button"
            aria-label={action.label}
            onClick={action.onClick}
            className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] transition-colors active:scale-95"
          >
            {action.icon}
          </button>
        ))}
        {hasOverflow && (
          <button
            type="button"
            aria-label="More actions"
            onClick={() => setShowMoreSheet(true)}
            className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] transition-colors active:scale-95"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>

      {showMoreSheet && (
        <div className="mobile-detail-action-sheet" role="dialog" aria-modal="true">
          <button
            type="button"
            className="mobile-detail-action-sheet__backdrop"
            aria-label="Close"
            onClick={() => setShowMoreSheet(false)}
          />
          <div className="mobile-detail-action-sheet__sheet" role="menu">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-border-strong)]" />
            <div className="space-y-1">
              {/* Overflow from quick actions (actions beyond the first 4) */}
              {actions.slice(4).map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className="w-full rounded-xl px-4 py-3 text-left text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  onClick={() => { setShowMoreSheet(false); action.onClick?.(); }}
                >
                  <span className="inline-flex items-center gap-3">
                    {action.icon}
                    {action.label}
                  </span>
                </button>
              ))}
              {/* Divider if both overflow actions and moreActions exist */}
              {actions.length > 4 && moreActions.length > 0 && (
                <div className="my-2 border-t border-[var(--color-border-subtle)]" />
              )}
              {/* Additional custom overflow actions */}
              {moreActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className={[
                    'w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors',
                    action.danger
                      ? 'text-[var(--color-danger-text)] hover:bg-[var(--color-danger-light)]'
                      : 'text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]',
                  ].join(' ')}
                  onClick={() => { setShowMoreSheet(false); action.onClick(); }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default QuickActionBar;
