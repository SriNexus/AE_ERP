import type { BaseRecord } from '../../../types';

export type NetMeteringStatus =
  | 'Submitted'
  | 'UnderReview'
  | 'Approved'
  | 'MeterInstalled'
  | 'Rejected';

export interface NetMeteringStatusHistoryEntry {
  status: NetMeteringStatus;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

export interface NetMeteringFormValues {
  projectId: string;
  projectName?: string;
  discomName: string;
  applicationNumber: string;
  submittedDate: string;
  expectedMeterInstallationDate?: string;
  notes?: string;
}

export const NET_METERING_FORM_DEFAULT: NetMeteringFormValues = {
  projectId: '',
  projectName: '',
  discomName: '',
  applicationNumber: '',
  submittedDate: new Date().toISOString().slice(0, 10),
  expectedMeterInstallationDate: '',
  notes: '',
};

export const NET_METERING_STATUSES: NetMeteringStatus[] = [
  'Submitted',
  'UnderReview',
  'Approved',
  'MeterInstalled',
  'Rejected',
];

export interface NetMeteringRecord extends BaseRecord {
  projectId: string;
  projectName?: string;
  discomName: string;
  applicationNumber: string;
  status: NetMeteringStatus;
  submittedDate: string;
  approvedDate?: string;
  rejectedDate?: string;
  rejectionReason?: string;
  meterInstalledDate?: string;
  expectedMeterInstallationDate?: string;
  notes?: string;
  statusHistory: NetMeteringStatusHistoryEntry[];
}
