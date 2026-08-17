/**
 * QC workspace configuration — tab definitions
 *
 * Phase 7C — QC Workspace
 * Universal tabs only, no module-specific tabs.
 * Overview is always present.
 */

import type { TabDefinition } from '../../../components/shared';

// ── QC tab definitions ─────────────────────────────────────
export const QC_TABS: TabDefinition[] = [
  { id: 'overview',       label: 'Overview',       always: true },
  { id: 'tasks',          label: 'Tasks',          always: false },
  { id: 'notes',          label: 'Notes',          always: false },
  { id: 'activity',       label: 'Activity',       always: false },
  { id: 'documents',      label: 'Documents',      always: false },
  { id: 'history',        label: 'History',        always: false },
  { id: 'linked_records', label: 'Linked Records', always: false },
  { id: 'permissions',    label: 'Permissions',    always: false },
  { id: 'disposable',     label: 'Disposable',     always: false },
];
