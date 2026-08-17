/**
 * Engines barrel export — Phase 0F
 *
 * Exports all engine modules:
 * - CaseEngine (Section 6)
 * - TaskEngine (Section 7)
 * - LinkedRecordsEngine (Section 8)
 * - WorkspaceSearchEngine (Phase 0F)
 */

export {
  caseEngine,
  generateCaseId,
  CASE_STAGE_ORDER,
  canAdvanceStage,
  getStageIndex,
} from './CaseEngine';

export type {
  CaseStage,
  CaseStatus,
  CaseLinkValidation,
  CaseGraph,
  CaseEngineAPI,
} from './CaseEngine';

export {
  taskEngine,
  generateTaskId,
  SLA_MATRIX,
  getSLAForPriority,
  getEscalationLevel,
} from './TaskEngine';

export type {
  TaskPriority,
  TaskStatus,
  EscalationLevel,
  CreateTaskInput,
  SLAStatus,
  EscalationEntry,
  TaskFilters,
  TaskEngineAPI,
} from './TaskEngine';

export {
  linkedRecordsEngine,
  getEntityTypeLabel,
  RELATIONSHIP_MAP,
} from './LinkedRecordsEngine';

export type {
  LinkedRecordsEngineAPI,
  RelationshipDef,
} from './LinkedRecordsEngine';

export {
  workspaceSearchEngine,
} from './WorkspaceSearchEngine';

export type {
  WorkspaceSearchEngineAPI,
  WorkspaceSearchCategory,
  WorkspaceSearchResult,
  WorkspaceSearchGroup,
} from './WorkspaceSearchEngine';

export {
  WORKSPACE_CATEGORY_LABELS,
  WORKSPACE_CATEGORY_ROUTES,
} from './WorkspaceSearchEngine';

export {
  caseValidationEngine,
  CASE_PARTICIPANT_ENTITIES,
} from './CaseValidationEngine';

export type {
  CaseHealthReport,
  EntityValidationResult,
  PropagationLink,
  RepairSummary,
} from './CaseValidationEngine';
