/**
 * ActionMenu — Standardized row-level action trigger
 * Phase P1: Full semantic token compliance.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface ActionItem {
  label:     string;
  icon?:     React.ReactNode;
  onClick:   () => void;
  danger?:   boolean;
  disabled?: boolean;
  hidden?:   boolean;
}

interface ActionMenuProps {
  actions:   ActionItem[];
  mode?:     'auto' | 'inline' | 'dropdown';
  className?: string;
}

function DropdownActions({ actions, className }: { actions: ActionItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const triggerWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerWrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const viewportPadding = 12;
    const gap = 4;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const candidates = [
      { top: triggerRect.bottom + gap, left: triggerRect.right - menuRect.width },
      { top: triggerRect.bottom + gap, left: triggerRect.left },
      { top: triggerRect.top - menuRect.height - gap, left: triggerRect.right - menuRect.width },
      { top: triggerRect.top - menuRect.height - gap, left: triggerRect.left },
    ];

    const fits = (candidate: { top: number; left: number }) =>
      candidate.top >= viewportPadding &&
      candidate.left >= viewportPadding &&
      candidate.top + menuRect.height <= viewportHeight - viewportPadding &&
      candidate.left + menuRect.width <= viewportWidth - viewportPadding;

    const preferred = candidates.find(fits) ?? candidates[0];
    setPosition({
      top: Math.min(Math.max(preferred.top, viewportPadding), viewportHeight - menuRect.height - viewportPadding),
      left: Math.min(Math.max(preferred.left, viewportPadding), viewportWidth - menuRect.width - viewportPadding),
    });
  }, [open, actions]);

  const visible = actions.filter(a => !a.hidden);

  return (
    <div ref={triggerWrapRef} className={cn('relative inline-block', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="More actions"
        aria-haspopup="true"
        aria-expanded={open}
        className={cn(
          'inline-flex min-h-11 min-w-11 md:min-h-7 md:min-w-7 items-center justify-center p-1.5 rounded-lg transition-all',
          'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
          'hover:bg-[var(--color-surface-hover)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{ top: position.top, left: position.left }}
          className={cn(
            'fixed z-[80] w-44 rounded-xl',
            'bg-[var(--color-surface)]',
            'border border-[var(--color-border)]',
            'shadow-[var(--shadow-dropdown)]',
            'py-1 animate-fadeIn',
          )}
          role="menu"
        >
          {visible.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={a.disabled}
              role="menuitem"
              onClick={() => { setOpen(false); a.onClick(); }}
              className={cn(
                'flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                a.danger
                  ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]'
                  : 'text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]',
              )}
            >
              {a.icon && <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{a.icon}</span>}
              <span>{a.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export function ActionMenu({ actions, className }: ActionMenuProps) {
  return <DropdownActions actions={actions} className={className} />;
}

export default ActionMenu;
