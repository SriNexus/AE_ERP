import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Settings, LogOut, ShieldCheck, Sun, Moon, Monitor } from 'lucide-react';
import { useAppStore, useCurrentUser } from '../../../store/useAppStore';
import { cn } from '../../../utils/cn';
import { useTheme } from '../../../theme/useTheme';
import type { ThemeMode } from '../../../theme/theme';
import React from 'react';

// ROLE_COLORS: palette pigments for role identity — intentional, not theme surfaces
const ROLE_COLORS: Record<string, string> = {
  Admin:     'text-[var(--color-primary-text)] bg-[var(--color-primary-light)]',
  Manager:   'text-[var(--color-success-text)] bg-[var(--color-success-light)]',
  BDM:       'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  BDE:       'text-[var(--color-info-text)] bg-[var(--color-info-light)]',
  Sales:     'text-[var(--color-warning-text)] bg-[var(--color-warning-light)]',
  TL:        'text-[var(--color-danger-text)] bg-[var(--color-danger-light)]',
  Executive: 'text-[var(--color-text-secondary)] bg-[var(--color-bg-sunken)]',
};

interface UserMenuProps {
  open:     boolean;
  onToggle: () => void;
  onClose:  () => void;
}

export function UserMenu({ open, onToggle, onClose }: UserMenuProps) {
  const { company, logout } = useAppStore();
  const user  = useCurrentUser();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const initials = (user.displayName || user.name || 'U').charAt(0).toUpperCase();
  const roleColor = ROLE_COLORS[user.role] ?? ROLE_COLORS.Executive;

  // Outside-click dismissal only while THIS menu is open — the menu must not
  // close unrelated overlays (e.g. the notification drawer) with its own
  // document listener. Each overlay owns its own dismissal.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-lg transition-colors',
          'hover:bg-[var(--color-surface-hover)]',
          open && 'bg-[var(--color-surface-hover)]'
        )}
      >
        <Avatar initials={initials} avatar={user.avatarUrl || user.avatar} size="sm" />
        <div className="hidden sm:block text-left leading-tight">
          <p className="text-xs font-semibold text-[var(--color-text)] max-w-[80px] truncate">
            {user.displayName || user.name || 'User'}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] truncate">
            {user.role || 'Employee'}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-[var(--color-text-muted)] hidden sm:block transition-transform duration-150',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-[var(--shadow-dropdown)] z-50 animate-scaleIn overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border-subtle)]">
            <div className="flex items-start gap-3">
              <Avatar initials={initials} avatar={user.avatarUrl || user.avatar} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)] truncate">
                  {user.displayName || user.name || 'User'}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                  {user.email || ''}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold', roleColor)}>
                    <ShieldCheck className="h-3 w-3" />
                    {user.role}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">·</span>
                  <span className="text-xs text-[var(--color-text-muted)] truncate">
                    {company?.shortName || 'System'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="py-1">
            <MenuButton
              icon={<Settings className="h-3.5 w-3.5" />}
              label="Profile & Settings"
              onClick={() => { navigate('/settings/my-profile'); onClose(); }}
            />
            {/* Theme toggle inside profile */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Theme</span>
              <ThemeToggleInline />
            </div>
          </div>

          <div className="border-t border-[var(--color-border-subtle)] py-1">
            <MenuButton
              icon={<LogOut className="h-3.5 w-3.5" />}
              label="Sign out"
              danger
              onClick={() => { logout(); navigate('/login'); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ initials, avatar, size }: { initials: string; avatar?: string; size: 'sm' | 'lg' }) {
  const cls = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
  return (
    <span className={cn(
      'rounded-full flex items-center justify-center font-bold text-white shrink-0 overflow-hidden',
      'bg-gradient-to-br from-[var(--color-primary)] to-violet-600',
      cls
    )}>
      {avatar ? <img src={avatar} alt={initials} className="h-full w-full object-cover" /> : initials}
    </span>
  );
}

const THEME_ICONS: Record<ThemeMode, React.ReactNode> = {
  light:  <Sun className="h-3.5 w-3.5" />,
  dark:   <Moon className="h-3.5 w-3.5" />,
  system: <Monitor className="h-3.5 w-3.5" />,
};

function ThemeToggleInline() {
  const { mode, cycleTheme } = useTheme();
  const label = { light: 'Light', dark: 'Dark', system: 'System' }[mode];
  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] transition-colors"
      title={`Theme: ${label}`}
    >
      {THEME_ICONS[mode]}
      <span>{label}</span>
    </button>
  );
}

function MenuButton({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-colors',
        danger
          ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export default UserMenu;
