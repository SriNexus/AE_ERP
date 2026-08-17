// ═══════════════════════════════════════════════════════════
//  APP VERSION — single source of truth.
//  package.json's "version" field is left at the Vite template default
//  ("0.0.0") and isn't used anywhere in the app; the canonical, already
//  user-facing value (Settings → Overview → "ERP Version") was a local
//  const in OverviewSection.tsx. Centralized here so both Overview and
//  About ERP display the same value — update this ONE line to bump it.
// ═══════════════════════════════════════════════════════════

export const APP_VERSION = '1.0.0';
export const APP_NAME = 'Neozy ERP';
export const APP_DISPLAY_VERSION = `v${APP_VERSION}`;
