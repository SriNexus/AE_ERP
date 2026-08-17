/**
 * workspaceConfig.ts — AMC Contracts Workspace Configuration
 *
 * Universal tabs only: Overview + universal tabs.
 * No module-specific tabs per MASTER_IMPLEMENTATION_DOCUMENT.md §6.1/§6.2.
 * Quick actions removed per Phase 8 standard.
 */

import type { TabDefinition } from '../../../components/shared/WorkspaceTabs';

export const AMC_TABS: TabDefinition[] = [
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
