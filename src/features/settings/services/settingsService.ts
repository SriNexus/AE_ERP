/**
 * settingsService — Centralized Settings persistence layer.
 *
 * Phase 3: Enterprise Settings persistence architecture.
 *
 * This is the single gateway for all settings CRUD operations.
 * No UI component should call Firestore directly.
 *
 * Design principles:
 *   - Each section is stored as a separate document in the 'settings' collection.
 *   - Document ID: `${companyId}_${section}` for company-scoped, `${userId}_${section}` for user-scoped.
 *   - Uses existing firestore.ts helpers (getOne, updateDocById, createDocWithId).
 *   - Merges with defaults so new fields always have values.
 *   - Companies module = single source of truth for company data.
 *   - Settings service = single source of truth for app preferences.
 */

import { getOne, updateDocById, createDocWithId, genId, resolveWriteCompanyId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { sanitizePayload } from '../../../lib/sanitizer';
import { useAppStore } from '../../../store/useAppStore';
import { getDefaultSettings } from '../defaults';
import { normalizeDocumentSettings } from '../documentRuntime';
import { normalizeEmailSettings } from '../emailRuntime';
import { sanitizeIntegrationSettings, type IntegrationSectionId } from '../integrationRuntime';
import { canEditSection } from '../permissions';
import { type SettingsSectionId } from '../config';
import type { SettingsDocument, SettingsSectionData, ThemeSettings } from '../types';
import { normalizeBuiltInTheme } from '../../../theme/presets';
import { normalizeAppearanceSettings } from '../appearanceRuntime';

// ── Document ID helpers ──────────────────────────────────────
export function getSettingsDocId(companyId: string, section: string): string {
  return `${companyId}_settings_${section}`;
}

export function getUserSettingsDocId(userId: string, section: string): string {
  return `${userId}_settings_${section}`;
}

// ── Scope types ──────────────────────────────────────────────
export type SettingsScope = 'company' | 'user';

function resolveScopeId(scope: SettingsScope): string {
  const state = useAppStore.getState();
  if (scope === 'company') {
    // Canonical tenant resolution — NEVER the neutral 'default' placeholder.
    // activeCompanyId is 'default' post-logout until useGlobalBoot resolves it;
    // the previous `activeCompanyId !== 'all'` branch returned that placeholder
    // and the resulting doc id '_settings_general' was denied by the rules →
    // the Admin settings 403 storm. resolveWriteCompanyId() returns '' when no
    // real company is resolvable, and loadSettings/settingsDocumentExists skip
    // the Firestore read entirely for an empty scope id (fail closed → defaults).
    return resolveWriteCompanyId();
  }
  return state.user?.id || 'system';
}

function resolveDocId(scope: SettingsScope, section: string): string {
  const scopeId = resolveScopeId(scope);
  return scope === 'company'
    ? getSettingsDocId(scopeId, section)
    : getUserSettingsDocId(scopeId, section);
}

/**
 * Tolerant settings-doc read. Settings documents are keyed deterministically
 * (companyId_settings_section / userId_settings_section) and the Firestore
 * rules deny reads of NOT-YET-CREATED docs (the read rule validates
 * resource.data.companyId, which is null for a missing doc → permission
 * denied). That denial is indistinguishable client-side from "no saved
 * settings yet" — the service contract is merge-with-defaults, so a denied
 * read must fall back to defaults instead of failing the whole settings
 * screen (the Admin settings 403-storm root cause). Writes still enforce
 * admin + same-company via the rules; this only changes read fallback.
 */
async function readSettingsDocOrNull(docId: string): Promise<SettingsDocument | null> {
  try {
    return await getOne<SettingsDocument>(COLLECTIONS.SETTINGS, docId);
  } catch (err) {
    console.warn(`[settingsService] Settings read fell back to defaults (${docId}):`, err);
    return null;
  }
}

export async function settingsDocumentExists(section: SettingsSectionId): Promise<boolean> {
  const scope = getSectionScope(section);
  // Fail closed: no resolvable company scope → no settings doc can exist.
  if (scope === 'company' && !resolveScopeId('company')) return false;
  return Boolean(await readSettingsDocOrNull(resolveDocId(scope, section)));
}

// ── Section-to-scope mapping ─────────────────────────────────
// Theme/UI, Documents, Automation, Integrations, Backup are company-scoped.
// My Profile, Notifications, Security, Appearance are user-scoped.
const SECTION_SCOPE: Record<string, SettingsScope> = {
  'theme-ui': 'company',
  documents: 'company',
  automation: 'company',
  integrations: 'company',
  'backup-restore': 'company',
  'audit-logs': 'company',
  email: 'company',
  whatsapp: 'company',
  sms: 'company',
  general: 'company',
  notifications: 'user',
  security: 'user',
  appearance: 'user',
  developer: 'user',
  'my-profile': 'user',
  'about-erp': 'company',
};

export function getSectionScope(section: string): SettingsScope {
  return SECTION_SCOPE[section] ?? 'company';
}


function resolveFallbackCompany() {
  const state = useAppStore.getState();
  return state.company || state.globalCompany || undefined;
}

function buildSectionDefaults(section: SettingsSectionId): Record<string, unknown> {
  const defaults = getDefaultSettings(section);
  if (section === 'theme-ui') {
    return normalizeBuiltInTheme(defaults as unknown as ThemeSettings) as unknown as Record<string, unknown>;
  }
  if (section === 'documents') {
    return normalizeDocumentSettings(defaults as Record<string, unknown>, resolveFallbackCompany()) as unknown as Record<string, unknown>;
  }
  if (section === 'email') {
    return normalizeEmailSettings(defaults as Record<string, unknown>) as unknown as Record<string, unknown>;
  }
  if (section === 'whatsapp' || section === 'sms' || section === 'integrations') {
    return sanitizeIntegrationSettings(section as IntegrationSectionId, defaults as Record<string, unknown>);
  }
  return defaults;
}
// ── Load settings for a section ──────────────────────────────
/**
 * Load settings for a section, merging with defaults.
 *
 * @returns The merged settings data — always a valid object, never null/undefined.
 */
export async function loadSettings(section: SettingsSectionId): Promise<Record<string, unknown>> {
  const defaults = buildSectionDefaults(section);
  const scope = getSectionScope(section);
  // Fail closed (Admin companyId='default' 403-storm root cause): with no real
  // company resolved yet, the doc id would be '_settings_general' — a read the
  // rules deny. Skip the Firestore read entirely and return defaults.
  if (scope === 'company' && !resolveScopeId('company')) {
    return { ...defaults };
  }
  const docId = resolveDocId(scope, section);

  const doc = await readSettingsDocOrNull(docId);
  if (doc?.data) {
    if (section === 'theme-ui') {
      return normalizeBuiltInTheme({ ...defaults, ...doc.data } as unknown as ThemeSettings) as unknown as Record<string, unknown>;
    }
    if (section === 'documents') {
      return normalizeDocumentSettings({ ...defaults, ...doc.data } as Record<string, unknown>, resolveFallbackCompany()) as unknown as Record<string, unknown>;
    }
    if (section === 'email') {
      return normalizeEmailSettings({ ...defaults, ...doc.data } as Record<string, unknown>) as unknown as Record<string, unknown>;
    }
    if (section === 'whatsapp' || section === 'sms' || section === 'integrations') {
      return sanitizeIntegrationSettings(section as IntegrationSectionId, { ...defaults, ...doc.data } as Record<string, unknown>);
    }
    if (section === 'appearance') {
      // MUST normalize the RAW doc.data (not a defaults-merged copy) — merging
      // first would backfill a present-but-unset fontSizeSchema from defaults,
      // making every legacy document look already-current and silently
      // defeating the one-time fontSize migration (see appearanceRuntime.ts).
      return { ...defaults, ...normalizeAppearanceSettings(doc.data as unknown as Record<string, unknown>) };
    }
    return { ...defaults, ...doc.data };
  }

  return { ...defaults };
}

// ── Save settings for a section ──────────────────────────────
/**
 * Save settings for a section.
 * Enforces permission check before write.
 * Uses merge write to preserve any fields not included in the payload.
 * Writes an audit log entry on success.
 */
export async function saveSettings(
  section: SettingsSectionId,
  data: Record<string, unknown>,
): Promise<void> {
  // Permission enforcement: check edit permission before any write
  if (!canEditSection(section)) {
    throw new Error('You do not have permission to edit these settings');
  }
  const state = useAppStore.getState();
  const normalizedData: Record<string, unknown> = section === 'theme-ui'
    ? (normalizeBuiltInTheme(data as unknown as ThemeSettings) as unknown as Record<string, unknown>)
    : section === 'documents'
    ? (normalizeDocumentSettings(data as Record<string, unknown>, resolveFallbackCompany()) as unknown as Record<string, unknown>)
    : section === 'email'
      ? (normalizeEmailSettings(data as Record<string, unknown>) as unknown as Record<string, unknown>)
      : (section === 'whatsapp' || section === 'sms' || section === 'integrations')
        ? sanitizeIntegrationSettings(section as IntegrationSectionId, data as Record<string, unknown>)
        : section === 'appearance'
          ? normalizeAppearanceSettings(data)
          : data;
  const validation = await validateSettings(section, normalizedData);
  if (!validation.valid) throw new Error(`Validation failed: ${Object.values(validation.errors).join('; ')}`);

  const scope = getSectionScope(section);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  if (scope === 'company' && !companyId) {
    throw new Error('Tenant context is not resolved: cannot save company settings without a valid companyId.');
  }
  const docId = resolveDocId(scope, section);

  const payload = sanitizePayload({
    companyId,
    section,
    data: normalizedData,
    updatedAt: new Date().toISOString(),
    updatedBy: state.user?.id || 'system',
  });

  try {
    // Check if doc exists — update or create (denied reads = not yet created).
    const existing = await readSettingsDocOrNull(docId);
    if (existing) {
      await updateDocById(COLLECTIONS.SETTINGS, docId, payload);
    } else {
      await createDocWithId(COLLECTIONS.SETTINGS, docId, payload);
    }

    // Audit log entry for the settings change
    await logSettingsAuditEntry('settings.updated', section, companyId, state, data);
  } catch (err) {
    console.error(`[settingsService] Failed to save settings for ${section}:`, err);
    throw err;
  }
}

// ── Reset settings to defaults ───────────────────────────────
/**
 * Reset settings to defaults.
 * Enforces permission check before write.
 * Writes an audit log entry on success.
 */
export async function resetSettings(section: SettingsSectionId): Promise<void> {
  // Permission enforcement: check edit permission before any write
  if (!canEditSection(section)) {
    throw new Error('You do not have permission to reset these settings');
  }

  const scope = getSectionScope(section);
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const resolvedCompanyId = resolveWriteCompanyId();
  if (scope === 'company' && !resolvedCompanyId) {
    throw new Error('Tenant context is not resolved: cannot reset company settings without a valid companyId.');
  }
  const docId = resolveDocId(scope, section);

  try {
    const payload = {
      companyId: scope === 'company' ? resolvedCompanyId : state.user?.companyId || resolvedCompanyId,
      section,
      data: buildSectionDefaults(section),
      updatedAt: new Date().toISOString(),
      updatedBy: state.user?.id || 'system',
    };
    const existing = await readSettingsDocOrNull(docId);
    if (existing) await updateDocById(COLLECTIONS.SETTINGS, docId, payload);
    else await createDocWithId(COLLECTIONS.SETTINGS, docId, payload);

    // Audit log entry for the settings reset. Must use the same real
    // companyId as the settings write itself (payload.companyId) — the
    // audit_logs rules check sameCompany() against this field, and passing
    // the user's own id here for user-scoped sections (as this previously
    // did) always failed that check, silently losing every reset audit
    // entry for appearance/notifications/security/developer/my-profile.
    await logSettingsAuditEntry('settings.reset', section, payload.companyId, state);
  } catch (err) {
    console.error(`[settingsService] Failed to reset settings for ${section}:`, err);
    throw err;
  }
}

// ── Merge defaults helper ────────────────────────────────────
/**
 * Merges raw settings data with defaults.
 * Used after loading from Firestore to ensure all fields exist.
 */
export function mergeDefaults(
  section: SettingsSectionId,
  data: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (section === 'theme-ui') {
    return normalizeBuiltInTheme({ ...buildSectionDefaults(section), ...(data ?? {}) } as unknown as ThemeSettings) as unknown as Record<string, unknown>;
  }
  if (section === 'documents') {
    return normalizeDocumentSettings({ ...buildSectionDefaults(section), ...(data ?? {}) } as Record<string, unknown>, resolveFallbackCompany()) as unknown as Record<string, unknown>;
  }
  if (section === 'email') {
    return normalizeEmailSettings({ ...getDefaultSettings(section), ...(data ?? {}) } as Record<string, unknown>) as unknown as Record<string, unknown>;
  }
  if (section === 'whatsapp' || section === 'sms' || section === 'integrations') {
    return sanitizeIntegrationSettings(section as IntegrationSectionId, { ...getDefaultSettings(section), ...(data ?? {}) } as Record<string, unknown>);
  }
  if (section === 'appearance') {
    return { ...getDefaultSettings(section), ...normalizeAppearanceSettings((data ?? {}) as Record<string, unknown>) };
  }
  return { ...getDefaultSettings(section), ...(data ?? {}) };
}
// ── Audit log helper ─────────────────────────────────────────
/**
 * Writes a settings audit log entry without exposing secret values.
 * Only field names are recorded, never field values.
 * Uses COLLECTIONS.AUDIT_LOGS which already has Firestore-level append-only rules.
 */
async function logSettingsAuditEntry(
  action: string,
  section: SettingsSectionId,
  companyId: string,
  state: ReturnType<typeof useAppStore.getState>,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const id = genId.generic('AUD');
    // Record field NAMES only — NEVER values, especially for settings where
    // future sections may contain sensitive configuration names.
    // For reset actions, data is undefined so changedFields is intentionally empty.
    const changedFields = data ? Object.keys(data).filter((key) => !key.startsWith('secret')) : [];
    await createDocWithId(COLLECTIONS.AUDIT_LOGS, id, {
      id,
      companyId,
      module: 'settings',
      action,
      section,
      entityId: section,
      entityName: `Settings: ${section}`,
      userId: state.user?.id || 'system',
      userName: state.user?.name || 'System',
      changedFields,
      outcome: 'success',
      createdAt: new Date().toISOString(),
      isDeleted: false,
    });
  } catch (err) {
    // Audit logging failure must never break the settings operation
    console.warn(`[settingsService] Audit log write failed for ${action} on ${section}:`, err);
  }
}

// ── Validate settings (placeholder — future use) ─────────────
export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Validate settings for a section.
 * Delegates to section-specific validators from validation.ts.
 */
export async function validateSettings(
  section: SettingsSectionId,
  data: Record<string, unknown>,
): Promise<ValidationResult> {
  // Import dynamically to avoid circular dependencies
  const { validateSectionSettings } = await import('../validation');
  return validateSectionSettings(section, data);
}
