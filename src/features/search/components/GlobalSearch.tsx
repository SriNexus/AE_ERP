import { useState, useEffect, useCallback } from 'react';
import { Search, Command } from 'lucide-react';
import { SearchModal } from './SearchModal';
import { cn } from '../../../utils/cn';

interface GlobalSearchProps {
  className?: string;
}

export function GlobalSearch({ className }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setOpen((v) => !v);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open global search (Ctrl+K)"
        className={cn(
          'hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg',
          'text-sm text-[var(--color-text-muted)]',
          'border border-[var(--color-border)]',
          'bg-[var(--color-bg-sunken)]',
          'hover:bg-[var(--color-surface-hover)]',
          'hover:border-[var(--color-border-strong)]',
          'hover:text-[var(--color-text-secondary)]',
          'transition-all duration-150',
          className
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs">Quick search…</span>
        <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] font-mono">
          <Command className="h-3 w-3" />K
        </span>
      </button>

      <button
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="md:hidden p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <Search className="h-4 w-4" />
      </button>

      <SearchModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default GlobalSearch;
