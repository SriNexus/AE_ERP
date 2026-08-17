/**
 * Payment Module Types
 */

import type { PaymentRecord as WorkflowPaymentRecord } from '../../../lib/paymentWorkflow';

export type PaymentRecord = WorkflowPaymentRecord;

export type { PaymentCreateInput, PaymentStatus, PaymentStatusHistoryEntry } from '../../../lib/paymentWorkflow';
