/**
 * Service Ticket Module Types
 */

import type { ServiceTicketRecord as WorkflowServiceTicketRecord } from '../../../lib/serviceTicketWorkflow';

export type ServiceTicketRecord = WorkflowServiceTicketRecord;

export type { ServiceTicketCreateInput, TicketStatus, TicketStatusHistoryEntry } from '../../../lib/serviceTicketWorkflow';
