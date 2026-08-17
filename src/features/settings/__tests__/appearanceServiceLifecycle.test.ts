import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { APPEARANCE_FONT_SIZE_SCHEMA } from '../appearanceRuntime';
import { DEFAULT_APPEARANCE_SETTINGS } from '../defaults';

const mocks = vi.hoisted(() => ({
  getOne: vi.fn(), updateDocById: vi.fn(), createDocWithId: vi.fn(),
}));

vi.mock('../../../lib/firestore', () => ({
  getOne: mocks.getOne,
  updateDocById: mocks.updateDocById,
  createDocWithId: mocks.createDocWithId,
  genId: { generic: vi.fn(() => 'AUD-appearance') },
  resolveWriteCompanyId: () => useAppStore.getState().activeCompanyId || useAppStore.getState().user?.companyId || '',
}));
vi.mock('../../../lib/firebase', () => ({ COLLECTIONS: { SETTINGS: 'settings', AUDIT_LOGS: 'audit_logs' } }));
vi.mock('../../../lib/sanitizer', () => ({ sanitizePayload: (value: unknown) => value }));
vi.mock('../permissions', () => ({ canEditSection: () => true }));

import { getSectionScope, loadSettings, resetSettings, saveSettings } from '../services/settingsService';

describe('Appearance settings — service-level load/save/reset lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeCompanyId: 'company-1',
      user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', role: 'Sales', companyId: 'company-1' },
      isAuthenticated: true,
    });
  });

  it('is user-scoped, not company-scoped', () => {
    expect(getSectionScope('appearance')).toBe('user');
  });

  it('loads defaults (already on the current schema) when no document exists — a fresh install never gets wrongly migrated', async () => {
    mocks.getOne.mockResolvedValueOnce(null);
    const result = await loadSettings('appearance');
    expect(result.fontSize).toBe('medium');
    expect(result.fontSizeSchema).toBe(APPEARANCE_FONT_SIZE_SCHEMA);
  });

  it('migrates a legacy document (missing fontSizeSchema) exactly once on load', async () => {
    mocks.getOne.mockResolvedValueOnce({ data: { ...DEFAULT_APPEARANCE_SETTINGS, fontSize: 'large', fontSizeSchema: undefined } });
    const result = await loadSettings('appearance');
    expect(result.fontSize).toBe('medium'); // legacy 'large' reads as today's 'medium'
    expect(result.fontSizeSchema).toBe(APPEARANCE_FONT_SIZE_SCHEMA);
  });

  it('does NOT re-migrate a document already on the current schema — the exact regression this fix targets', async () => {
    mocks.getOne.mockResolvedValueOnce({ data: { ...DEFAULT_APPEARANCE_SETTINGS, fontSize: 'large', fontSizeSchema: APPEARANCE_FONT_SIZE_SCHEMA } });
    const result = await loadSettings('appearance');
    expect(result.fontSize).toBe('large');
  });

  it('handles a partially-populated legacy document — missing fields get defaults, present fields are preserved', async () => {
    mocks.getOne.mockResolvedValueOnce({ data: { highContrast: true } });
    const result = await loadSettings('appearance');
    expect(result.highContrast).toBe(true);
    expect(result.compactMode).toBe(false); // default
    expect(result.themeMode).toBe('system'); // default
    expect(result.fontSizeSchema).toBe(APPEARANCE_FONT_SIZE_SCHEMA);
  });

  it('falls back to defaults when the read is denied/fails (readSettingsDocOrNull swallows the error)', async () => {
    mocks.getOne.mockRejectedValueOnce(new Error('permission-denied'));
    const result = await loadSettings('appearance');
    expect(result.fontSize).toBe('medium');
    expect(result.fontSizeSchema).toBe(APPEARANCE_FONT_SIZE_SCHEMA);
  });

  it('saves whatever fontSize was chosen without re-migrating it (schema already current from load)', async () => {
    mocks.getOne.mockResolvedValueOnce(null); // doc does not exist -> create path
    await saveSettings('appearance', { ...DEFAULT_APPEARANCE_SETTINGS, fontSize: 'large', fontSizeSchema: APPEARANCE_FONT_SIZE_SCHEMA });
    const call = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'settings' && c[1] === 'user-1_settings_appearance');
    expect(call?.[2]).toMatchObject({ companyId: 'company-1', section: 'appearance', data: { fontSize: 'large', fontSizeSchema: APPEARANCE_FONT_SIZE_SCHEMA } });
  });

  it('resets to defaults (current schema, not migrated) and writes the audit log with the real companyId — not the user id', async () => {
    mocks.getOne
      .mockResolvedValueOnce({ id: 'user-1_settings_appearance' }) // existing doc -> update path
      .mockResolvedValueOnce(null); // second getOne is settingsDocumentExists-style check elsewhere; harmless if unused
    await resetSettings('appearance');
    const settingsCall = mocks.updateDocById.mock.calls.find((c) => c[0] === 'settings' && c[1] === 'user-1_settings_appearance');
    expect(settingsCall?.[2]).toMatchObject({ data: { fontSize: 'medium', fontSizeSchema: APPEARANCE_FONT_SIZE_SCHEMA } });

    const auditCall = mocks.createDocWithId.mock.calls.find((c) => c[0] === 'audit_logs');
    expect(auditCall?.[2]).toMatchObject({ companyId: 'company-1', action: 'settings.reset', section: 'appearance' });
  });
});
