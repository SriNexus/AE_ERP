import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from './useTheme';
import { cn } from '../utils/cn';
import type { ThemeMode } from './theme';

const ICONS: Record<ThemeMode, { Icon: React.FC<{ className?: string }>; label: string }> = {
  light:  { Icon: Sun,     label: 'Light mode'  },
  dark:   { Icon: Moon,    label: 'Dark mode'   },
  system: { Icon: Monitor, label: 'System theme' },
};

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { mode, cycleTheme } = useTheme();
  const { Icon, label } = ICONS[mode];

  return (
    <button
      onClick={cycleTheme}
      title={label}
      aria-label={label}
      className={cn(
        'relative p-2 rounded-lg transition-all duration-200',
        'text-[var(--color-text-muted)]',
        'hover:bg-[var(--color-surface-hover)]',
        'hover:text-[var(--color-text-secondary)]',
        'focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
        className
      )}
    >
      <span className="relative block w-4 h-4">
        <Icon className="h-4 w-4 transition-all duration-200 ease-out" />
      </span>
      {mode === 'system' && (
        <span className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] ring-1 ring-[var(--color-surface)]" />
      )}
    </button>
  );
}

export default ThemeToggle;
