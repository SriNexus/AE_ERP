// features/loan-applications/hooks/useLoanApplications.ts
import { useQuery } from '@tanstack/react-query';
import { getAll } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import { useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { usePaginatedCollection } from '../../../hooks/usePaginatedCollection';

export const LOAN_APPLICATION_FORM_DEFAULT = {
  customerId: '',
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  bankName: '',
  branch: '',
  loanAmount: 0,
  applicationNumber: '',
  caseId: '',
  registrationId: '',
  status: 'Draft' as LoanApplicationStatus,
  digitalSignStatus: 'pending' as DigitalSignStatus,
  submissionDate: '',
  approvalDate: '',
  paymentDate: '',
  assignedToId: '',
  assignedToName: '',
  notes: '',
};

export type LoanApplicationForm = typeof LOAN_APPLICATION_FORM_DEFAULT;

export type DigitalSignStatus = 'pending' | 'completed';

export type LoanApplicationStatus =
  | 'Draft'
  | 'Digital Sign Pending'
  | 'Digital Sign Completed'
  | 'Bank Submission Pending'
  | 'Submitted To Bank'
  | 'Under Review'
  | 'Approved'
  | 'Rejected'
  | 'Payment Received'
  | 'Closed';

export const LOAN_APPLICATION_STATUSES: LoanApplicationStatus[] = [
  'Draft',
  'Digital Sign Pending',
  'Digital Sign Completed',
  'Bank Submission Pending',
  'Submitted To Bank',
  'Under Review',
  'Approved',
  'Rejected',
  'Payment Received',
  'Closed',
];

// Banks are now managed via Bank Master (banks collection)
// Use useBankOptions() from features/banks/hooks/useBanks

/** Check if createdAt is today */
export function isToday(value: any): boolean {
  if (!value) return false;
  let d: Date;
  if (typeof value === 'object' && typeof value.toDate === 'function') d = value.toDate();
  else if (typeof value === 'object' && value.seconds) d = new Date(value.seconds * 1000);
  else d = new Date(value);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

export function useLoanApplications() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return usePaginatedCollection(keys.registrationsPaged, COLLECTIONS.LOAN_APPLICATIONS, 30_000);
}

export function useLoanApplicationsUsers() {
  return useQuery({
    queryKey: queryKeys.global.users,
    queryFn: () => getAll(COLLECTIONS.USERS),
    staleTime: 60_000,
  });
}
