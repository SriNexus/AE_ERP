/**
 * styles.ts — Mobile Design System tokens
 *
 * Reusable class name constants for consistent spacing, typography,
 * cards, buttons, and sections across all mobile components.
 *
 * Every future mobile screen should import from here rather than
 * inlining class names, to ensure visual consistency.
 */

import { cn } from '../../../utils/cn';

// ── Spacing Scale ─────────────────────────────────────────────
// Consistent gaps used throughout: 2, 4, 8, 12, 16, 20, 24

export const SPACING = {
  /** 2px — icon-to-icon, tight */
  TIGHT: 'gap-0.5',
  /** 4px — label-to-data */
  COMPACT: 'gap-1',
  /** 8px — between elements within a card */
  NORMAL: 'gap-2',
  /** 12px — between adjacent cards, grid gaps */
  COMFORTABLE: 'gap-3',
  /** 16px — between sections */
  SECTION: 'gap-4',
  /** 20px — between major sections */
  LARGE: 'gap-5',
  /** 24px — between page groups */
  XLARGE: 'gap-6',
} as const;

export const PADDING = {
  CARD: 'p-3',
  CARD_COMPACT: 'p-2.5',
  SECTION: 'px-4',
  PAGE: 'px-4 py-4',
  PAGE_BOTTOM: 'pb-4',
} as const;

// ── Typography Scale ──────────────────────────────────────────

export const TYPOGRAPHY = {
  /** Section headers: 12px bold uppercase */
  SECTION_LABEL: 'text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-widest',
  /** Card titles: 13px semibold */
  CARD_TITLE: 'text-xs font-semibold text-[var(--color-text)]',
  /** Body text: 13px regular */
  BODY: 'text-xs text-[var(--color-text)]',
  /** Muted body: 12px muted */
  MUTED: 'text-xs text-[var(--color-text-muted)]',
  /** Tab labels: 10px medium */
  TAB_LABEL: 'text-[10px] font-medium leading-none',
  /** Badge/chip text: 10px bold */
  BADGE: 'text-[10px] font-bold tabular-nums',
  /** Page heading: 18px bold */
  PAGE_TITLE: 'text-lg font-bold text-[var(--color-text)]',
  /** Page subtitle: 12px muted */
  PAGE_SUBTITLE: 'text-xs text-[var(--color-text-muted)]',
} as const;

// ── Card Styles ───────────────────────────────────────────────

export const CARD = {
  /** Standard card container */
  BASE: cn(
    'bg-[var(--color-surface)] rounded-xl',
    'border border-[var(--color-border)]',
    'overflow-hidden',
  ),
  /** Pressable card with hover feedback */
  PRESSABLE: cn(
    'bg-[var(--color-bg-sunken)] rounded-xl',
    'ring-1 ring-[var(--color-border)]',
    'hover:bg-[var(--color-surface-hover)]',
    'transition-all duration-150 active:scale-[0.98]',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]',
  ),
  /** Compact inside card */
  INNER: 'rounded-lg bg-[var(--color-bg-sunken)]',
} as const;

// ── Section Spacing ───────────────────────────────────────────

export const SECTION = {
  /** Between-page spacing for stacked sections */
  STACK: 'space-y-4 pb-4',
  /** Group header container */
  HEADER: 'px-1 mb-3',
  /** Sub-section spacing */
  SUB: 'space-y-3',
} as const;

// ── Icon Sizing ───────────────────────────────────────────────

export const ICONS = {
  SMALL: 'h-4 w-4',
  MEDIUM: 'h-5 w-5',
  LARGE: 'h-6 w-6',
} as const;

// ── Icon Container ────────────────────────────────────────────

export const ICON_BOX = {
  /** 32×32 container for small icons */
  SM: 'p-1.5 rounded-lg',
  /** 36×36 container for medium icons */
  MD: 'p-2 rounded-lg',
  /** 44×44 container for large icons */
  LG: 'p-2.5 rounded-lg',
} as const;

// ── Touch Targets ─────────────────────────────────────────────

export const TOUCH = {
  /** Minimum 44px tap target */
  MIN: 'min-h-[44px] min-w-[44px]',
  /** Quick action buttons */
  ACTION: 'min-h-[48px]',
  /** Module card tiles */
  MODULE: 'min-h-[80px]',
} as const;

// ── Layout Grids ──────────────────────────────────────────────

export const GRID = {
  /** 2-column grid for KPIs, quick actions */
  COL2: 'grid grid-cols-2',
  /** 3-column grid for module cards */
  COL3: 'grid grid-cols-3',
} as const;

// ── Borders & Radii — every component should use these constants
// to ensure visual consistency across the mobile app.

export const RADIUS = {
  CARD: 'rounded-xl',
  INNER: 'rounded-lg',
  PILL: 'rounded-full',
  ICON: 'rounded-lg',
} as const;
