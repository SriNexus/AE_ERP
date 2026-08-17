/**
 * surveysBulkAssignSync.test.ts — Phase 6 regression check.
 *
 * Source-text analysis, matching this repo's established convention for
 * wiring facts (see customerWorkspacePhase2.test.ts and siblings).
 *
 * Bulk-assigning surveys from the Surveys.tsx list page used to write only
 * `surveyorId`, leaving `assignedSurveyor` stale — the field
 * projectVisibility.ts's PROJECT_ASSIGNMENT_FIELDS actually scopes a
 * Surveyor role's visibility by. A reassigned survey stayed visible to the
 * old surveyor and invisible to the new one until some unrelated edit
 * happened to touch assignedSurveyor again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const surveysPage = readFileSync(resolve(__dirname, '../Surveys.tsx'), 'utf-8');

describe('Surveys.tsx — bulk-assign keeps assignedSurveyor in sync with surveyorId', () => {
  it('bulkAssignMutation writes both surveyorId and assignedSurveyor in the same update', () => {
    const bulkAssignFn = surveysPage.slice(
      surveysPage.indexOf('const bulkAssignMutation'),
      surveysPage.indexOf('const bulkDeleteMutation'),
    );
    expect(bulkAssignFn).toMatch(/surveyorId:\s*userId,\s*assignedSurveyor:\s*userId/);
  });
});
