/**
 * appearanceRuntime — single source of truth for how a saved Appearance
 * `fontSize` label maps to the CSS scale applied to the whole app, and for
 * the one-time migration of pre-rename label values.
 *
 * Before this module existed, AppearanceSection.tsx (preview) and
 * ThemeProvider.tsx (authoritative, global) each carried their own copy of
 * the scale table and the legacy-label migration table, kept in sync only by
 * a "MUST stay in sync" comment. Worse, the migration was re-applied on
 * every load with no way to tell a freshly-saved current-format value apart
 * from a genuine pre-rename value, so saving "large" was silently persisted
 * correctly but then downgraded to "medium" the moment the page reloaded
 * (confirmed live: FS_MIGRATE.large === 'medium', and it ran unconditionally
 * on every load). `fontSizeSchema` fixes that: any document written by this
 * module's `migrateFontSize` carries the current schema and is never
 * re-migrated; only documents missing/older than the current schema (real
 * legacy data) go through the migration once.
 */

export type FontSizeLabel = 'small' | 'medium' | 'large';

/** Bump when fontSize label semantics change again; add a new migration step below. */
export const APPEARANCE_FONT_SIZE_SCHEMA = 2;

// small: 0.875 (14px — compact) · medium: 1.0625 (17px — default) · large: 1.25 (20px — readable)
export const FONT_SIZE_SCALE: Record<FontSizeLabel, string> = {
  small: '0.875',
  medium: '1.0625',
  large: '1.25',
};

const FONT_SIZE_LABELS: FontSizeLabel[] = ['small', 'medium', 'large'];

function isFontSizeLabel(value: unknown): value is FontSizeLabel {
  return typeof value === 'string' && (FONT_SIZE_LABELS as string[]).includes(value);
}

// Pre-schema label meanings, shifted down one tier when the 'large' tier was
// introduced: old 'medium' reads as today's 'small'; old 'large' reads as
// today's 'medium'. Old 'small' is unchanged (no entry needed).
const LEGACY_FONT_SIZE_MIGRATION: Partial<Record<string, FontSizeLabel>> = {
  medium: 'small',
  large: 'medium',
};

/**
 * Resolve a persisted (or in-progress) fontSize value to its canonical
 * current-schema label. Only migrates when `fontSizeSchema` is missing or
 * older than the current schema — a value already on the current schema is
 * returned unchanged, so a fresh save is never re-downgraded on next load.
 */
export function migrateFontSize(fontSize: unknown, fontSizeSchema: unknown): FontSizeLabel {
  // No valid label at all (fresh install, empty data) — nothing to migrate,
  // just the genuine current default. Only a value that was ACTUALLY present
  // goes through the legacy-migration table below; treating "absent" the
  // same as "legacy" would wrongly run new installs through it too.
  if (!isFontSizeLabel(fontSize)) return 'medium';
  if (fontSizeSchema === APPEARANCE_FONT_SIZE_SCHEMA) return fontSize;
  return LEGACY_FONT_SIZE_MIGRATION[fontSize] ?? fontSize;
}

/** CSS scale factor (multiplied against the 16px root) for a canonical fontSize label. */
export function fontScaleFor(fontSize: unknown): string {
  return isFontSizeLabel(fontSize) ? FONT_SIZE_SCALE[fontSize] : FONT_SIZE_SCALE.medium;
}

/**
 * Normalize a raw (pre-defaults-merge) Appearance data object: migrates
 * fontSize exactly once for documents that predate the schema, and stamps
 * the current schema so it is never re-migrated on a later load.
 *
 * MUST be called with the RAW document data, before merging with defaults —
 * merging with defaults first would backfill a present-but-unset
 * `fontSizeSchema`, making every legacy document look already-current and
 * silently defeating the migration check.
 */
export function normalizeAppearanceSettings<T extends Record<string, unknown>>(
  raw: T,
): T & { fontSize: FontSizeLabel; fontSizeSchema: number } {
  return {
    ...raw,
    fontSize: migrateFontSize(raw.fontSize, raw.fontSizeSchema),
    fontSizeSchema: APPEARANCE_FONT_SIZE_SCHEMA,
  };
}
