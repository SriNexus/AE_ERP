import type { ProjectRecord } from '../../../types';

/** Shared prop contract every per-stage operational workspace component
 * implements (see stages/index.ts's STAGE_WORKSPACES registry) — so
 * ProjectWorkOnThisProject.tsx can mount whichever stage is expanded
 * without knowing its internals. */
export interface ProjectStageWorkspaceProps {
  project: ProjectRecord;
  customer: any;
  users: any[];
  canEdit: boolean;
}
