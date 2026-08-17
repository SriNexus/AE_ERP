import { ThemeUISection } from './ThemeUISection';
import { AppearanceSection } from './AppearanceSection';
import { Paintbrush } from 'lucide-react';

/**
 * Theme & Appearance — unified workspace.
 *
 * Composes ThemeUISection (ERP-level theme selection) and AppearanceSection
 * (user-level display preferences) into a single settings page.
 *
 * This is a pure composition container. Business logic lives in the
 * child sections.
 */
export function ThemeAppearanceSection() {
  return (
    <div className="space-y-6">
      {/* ── Section header ── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
          <Paintbrush className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-bold text-[var(--color-text)]">Theme & Appearance</h2>
          <p className="text-xs text-[var(--color-text-muted)]">Customize the visual identity and display preferences of your ERP</p>
        </div>
      </div>

      {/* ── ERP Theme (company-scoped, requires Admin/Management) ── */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6 shadow-sm">
        <ThemeUISection />
      </div>

      {/* ── Personal Preferences (user-scoped) ── */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-[var(--color-border)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-bg)]">
            Personal Preferences
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6 shadow-sm">
        <AppearanceSection />
      </div>
    </div>
  );
}
