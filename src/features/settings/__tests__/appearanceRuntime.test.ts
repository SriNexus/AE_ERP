import { describe, it, expect } from 'vitest';
import {
  APPEARANCE_FONT_SIZE_SCHEMA,
  fontScaleFor,
  migrateFontSize,
  normalizeAppearanceSettings,
} from '../appearanceRuntime';

describe('appearanceRuntime — fontSize migration (regression for the save→reload downgrade bug)', () => {
  it('does NOT migrate a value already on the current schema — this is the exact bug: saving "large" then reloading previously returned "medium" because the migration table was reapplied unconditionally on every load', () => {
    expect(migrateFontSize('large', APPEARANCE_FONT_SIZE_SCHEMA)).toBe('large');
    expect(migrateFontSize('medium', APPEARANCE_FONT_SIZE_SCHEMA)).toBe('medium');
    expect(migrateFontSize('small', APPEARANCE_FONT_SIZE_SCHEMA)).toBe('small');
  });

  it('migrates a genuine legacy value exactly once, when the schema is missing or older', () => {
    expect(migrateFontSize('large', undefined)).toBe('medium');
    expect(migrateFontSize('medium', undefined)).toBe('small');
    expect(migrateFontSize('small', undefined)).toBe('small'); // unchanged — no old->new shift for the bottom tier
    expect(migrateFontSize('large', 1)).toBe('medium'); // any schema older than current is treated as legacy
  });

  it('treats a genuinely absent value as the current default, NOT as legacy data needing migration', () => {
    // A fresh install / empty document has no fontSize at all. Feeding that
    // through the legacy table (as an earlier version of this fix did) would
    // wrongly downgrade a brand-new user's default from 'medium' to 'small'.
    expect(migrateFontSize(undefined, undefined)).toBe('medium');
    expect(migrateFontSize(null, undefined)).toBe('medium');
    expect(migrateFontSize('', undefined)).toBe('medium');
  });

  it('treats malformed/garbage values defensively as the current default rather than crashing', () => {
    expect(migrateFontSize(42, undefined)).toBe('medium');
    expect(migrateFontSize({ nested: true }, undefined)).toBe('medium');
    expect(migrateFontSize('huge', APPEARANCE_FONT_SIZE_SCHEMA)).toBe('medium');
  });
});

describe('appearanceRuntime — fontScaleFor', () => {
  it('maps every canonical label to its documented CSS scale', () => {
    expect(fontScaleFor('small')).toBe('0.875');
    expect(fontScaleFor('medium')).toBe('1.0625');
    expect(fontScaleFor('large')).toBe('1.25');
  });

  it('falls back to the medium scale for anything not a valid label', () => {
    expect(fontScaleFor(undefined)).toBe('1.0625');
    expect(fontScaleFor('huge')).toBe('1.0625');
    expect(fontScaleFor(null)).toBe('1.0625');
  });
});

describe('appearanceRuntime — normalizeAppearanceSettings (the single normalization point used by settingsService)', () => {
  it('migrates fontSize and stamps the current schema for a legacy raw document', () => {
    const result = normalizeAppearanceSettings({ fontSize: 'large', highContrast: true });
    expect(result.fontSize).toBe('medium');
    expect(result.fontSizeSchema).toBe(APPEARANCE_FONT_SIZE_SCHEMA);
    expect(result.highContrast).toBe(true); // untouched fields pass through
  });

  it('leaves an already-current document unchanged (idempotent — safe to call on every load)', () => {
    const input = { fontSize: 'large', fontSizeSchema: APPEARANCE_FONT_SIZE_SCHEMA, highContrast: false };
    const result = normalizeAppearanceSettings(input);
    expect(result.fontSize).toBe('large');
    expect(result.fontSizeSchema).toBe(APPEARANCE_FONT_SIZE_SCHEMA);
    expect(normalizeAppearanceSettings(result)).toEqual(result); // calling it twice is a no-op
  });

  it('handles a completely empty raw object (fresh install) without inventing a legacy migration', () => {
    const result = normalizeAppearanceSettings({});
    expect(result.fontSize).toBe('medium');
    expect(result.fontSizeSchema).toBe(APPEARANCE_FONT_SIZE_SCHEMA);
  });
});
