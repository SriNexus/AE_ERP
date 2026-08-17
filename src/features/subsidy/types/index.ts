import type { BaseRecord } from '../../../types';

export type SubsidyStatus =
  | 'Draft'
  | 'Submitted'
  | 'UnderReview'
  | 'Approved'
  | 'Disbursed'
  | 'Rejected';

export interface SubsidyStatusHistoryEntry {
  status: SubsidyStatus;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

export interface DisbursementEntry {
  id: string;
  amount: number;
  disbursedDate: string;
  referenceNumber?: string;
  disbursedBy?: string;
  notes?: string;
  createdAt: string;
}

export interface SubsidyFormValues {
  projectId: string;
  projectName?: string;
  schemeName: string;
  schemeType?: string;
  applicationNumber: string;
  applicationDate: string;
  submittedDate?: string;
  totalSanctionedAmount?: string;
  documentsSubmitted?: string;
  notes?: string;
}

export const SUBSIDY_FORM_DEFAULT: SubsidyFormValues = {
  projectId: '',
  projectName: '',
  schemeName: '',
  schemeType: '',
  applicationNumber: '',
  applicationDate: new Date().toISOString().slice(0, 10),
  submittedDate: '',
  totalSanctionedAmount: '',
  documentsSubmitted: '',
  notes: '',
};

export const SUBSIDY_STATUSES: SubsidyStatus[] = [
  'Draft',
  'Submitted',
  'UnderReview',
  'Approved',
  'Disbursed',
  'Rejected',
];

export interface SubsidyRecord extends BaseRecord {
  projectId: string;
  projectName?: string;
  schemeName: string;
  schemeType?: string;
  applicationNumber: string;
  status: SubsidyStatus;
  applicationDate?: string;
  submittedDate?: string;
  approvedDate?: string;
  rejectedDate?: string;
  rejectionReason?: string;
  disbursedDate?: string;
  totalSanctionedAmount?: number;
  totalDisbursedAmount?: number;
  documentsSubmitted?: string[];
  notes?: string;
  statusHistory: SubsidyStatusHistoryEntry[];
  disbursements: DisbursementEntry[];
}
