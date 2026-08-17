/**
 * followupWorkflow — createFollowup(), extracted from CustomersWorkspace.tsx's
 * own `addFollowup` mutation (Phase 4) so the Customer Workspace's Right
 * Panel "Schedule Follow-up" quick action can create a follow-up without
 * duplicating this logic — same "Extract → Reuse → Integrate" pattern Phase
 * 0/2 used for createQuotation()/createOrder()/createLoanApplication().
 *
 * PRE-EXISTING BEHAVIOR, unchanged: writes a Followup document to
 * COLLECTIONS.FOLLOWUPS (the simple {customerId, note, next_date} shape
 * already used by CustomerFollowupModal — NOT the separate, more elaborate
 * crmEngine.ts Followup system, which is a different, currently-unwired
 * parallel model; reusing the one actually live in the app, not the one
 * that merely exists in the codebase), appends a Follow-up activityLog
 * entry, and updates the customer's next_date/last_note fields (the same
 * fields `isOverdue(customer.next_date)` already reads elsewhere in the app).
 */
import { createDocWithId, genId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { updateProjectionWithEntity } from '../../../lib/entityProjection';

export interface CreateFollowupInput {
  customerId: string;
  note: string;
  next: string;
  existingLog: any[];
  createdById: string;
  createdByName: string;
}

export async function createFollowup(input: CreateFollowupInput): Promise<void> {
  await createDocWithId(COLLECTIONS.FOLLOWUPS, genId.generic('FU'), {
    customerId: input.customerId, note: input.note, next_date: input.next,
  });
  const logEntry = {
    id: genId.generic('LOG'), type: 'Follow-up', desc: input.note,
    date: new Date().toISOString(), userName: input.createdByName,
  };
  await updateProjectionWithEntity(COLLECTIONS.CUSTOMERS, input.customerId, {
    next_date: input.next, last_note: input.note,
    activityLog: [...(input.existingLog || []), logEntry],
    updatedBy: input.createdById,
  });
}
