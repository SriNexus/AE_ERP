// components/shared/index.ts
// Barrel export for all shared reusable components

export { PageShell, AlertBanner } from './PageShell';
export { DataTable }             from './DataTable';
export { EntityModal }           from './EntityModal';
export { ActionMenu }            from './ActionMenu';
export { RowViewAction }         from './RowViewAction';
export { EmptyState }            from './EmptyState';
export { PermissionGate }        from './PermissionGate';
export { StageCard }             from './StageCard';
export { StageTimeline }         from './StageTimeline';
export { ApprovalStepper }       from './ApprovalStepper';
export { WorkspaceShell }        from './WorkspaceShell';
export { DocumentVault }         from './DocumentVault';
export { MultiStepForm }         from './MultiStepForm';
export { ScheduleCalendar }      from './ScheduleCalendar';
export { CalendarModal }         from './CalendarModal';
export { DocumentViewer, useDocumentViewer, formatFileSize, forceDownload } from './DocumentViewer';
export type { DocumentViewerFile } from './DocumentViewer';
export { default as DocumentManager } from './DocumentManager';
export type { NeozyDocument } from './DocumentManager';

// Phase 0 — Workspace Architecture components
export { WorkspaceHeader }       from './WorkspaceHeader';
export type { WorkspaceHeaderProps } from './WorkspaceHeader';
export { WorkspaceTabs }         from './WorkspaceTabs';
export type { UniversalTabId, ModuleTabId, TabDefinition, WorkspaceTabsProps } from './WorkspaceTabs';
export { WorkspaceQuickActions } from './WorkspaceQuickActions';
export type { QuickActionDef, WorkspaceQuickActionsProps } from './WorkspaceQuickActions';
export { useWorkspace }          from './hooks/useWorkspace';
export type { WorkspaceState }   from './hooks/useWorkspace';

// Phase 0B — Universal Tab components (9 of 10 implemented; Notes, Activity, Documents, History, Communication, Attachments, Permissions, Tasks, LinkedRecords)
export { UniversalNotesTab }       from './UniversalTabs/UniversalNotesTab';
export { UniversalActivityTab }    from './UniversalTabs/UniversalActivityTab';
export { UniversalDocumentsTab }   from './UniversalTabs/UniversalDocumentsTab';
export { UniversalHistoryTab }     from './UniversalTabs/UniversalHistoryTab';
export { UniversalCommunicationTab } from './UniversalTabs/UniversalCommunicationTab';
export { UniversalAttachmentsTab } from './UniversalTabs/UniversalAttachmentsTab';
export { UniversalPermissionsTab }  from './UniversalTabs/UniversalPermissionsTab';
export { UniversalTasksTab }       from './UniversalTabs/UniversalTasksTab';
export { UniversalLinkedRecordsTab } from './UniversalTabs/UniversalLinkedRecordsTab';

export type { TableColumn }      from './DataTable';
export type { ActionItem }       from './ActionMenu';
