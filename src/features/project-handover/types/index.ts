/**
 * Project Handover Module Types
 */

import type { HandoverRecord as WorkflowHandoverRecord } from '../../../lib/projectHandoverWorkflow';

export type HandoverRecord = WorkflowHandoverRecord;

export type { HandoverCreateInput, HandoverStatus, HandoverStatusHistoryEntry } from '../../../lib/projectHandoverWorkflow';
