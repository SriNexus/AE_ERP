/**
 * workspaceConfig — Projects module workspace configuration
 *
 * Phase 7A: Full Solar EPC workspace with module-specific execution tabs
 * and 14+ quick actions mapped to the canonical stage progression.
 */

import type { TabDefinition } from '../../../components/shared/WorkspaceTabs';

// ── Tab definitions ─────────────────────────────────────────

export const PROJECT_TABS: TabDefinition[] = [
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
