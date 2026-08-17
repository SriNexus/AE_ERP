/**
 * Subsidy workspace configuration — tab definitions
 *
 * Universal tabs only: Overview + 9 universal tabs.
 * No module-specific tabs per MASTER_IMPLEMENTATION_DOCUMENT.md §6.1/§6.2.
 * Quick actions removed per Phase 7 standard.
 */

import type { TabDefinition } from '../../../components/shared';

export const SUBSIDY_TABS: TabDefinition[] = [
  { id: 'overview',       label: 'Overview',       always: true  },
  { id: 'tasks',          label: 'Tasks',          always: false },
  { id: 'notes',          label: 'Notes',          always: false },
  { id: 'activity',       label: 'Activity',       always: false },
  { id: 'documents',      label: 'Documents',      always: false },
  { id: 'history',        label: 'History',        always: false },
  { id: 'linked_records', label: 'Linked Records', always: false },
  { id: 'permissions',    label: 'Permissions',    always: false },
  { id: 'disposable',     label: 'Disposable',     always: false },
];
