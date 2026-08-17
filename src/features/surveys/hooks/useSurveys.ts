import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import type { ScheduleSurveyInput, SurveyRecord, SurveyReportInput } from '../types';
import { approveSurvey, rejectSurvey, scheduleSurvey, startSurvey, submitSurveyReport } from '../services/surveyWorkflow';

export function useSurveys() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  return useQuery({ queryKey: queryKeys.forCompany(companyId).surveysAll, queryFn: () => getAll<SurveyRecord>(COLLECTIONS.SURVEYS), staleTime: 30_000 });
}

export function useSurveyActions() {
  const companyId = useAppStore((state) => state.activeCompanyId);
  const client = useQueryClient();
  const invalidate = () => Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).surveysRoot }),
    client.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).projectsRoot }),
    client.invalidateQueries({ queryKey: queryKeys.forCompany(companyId).engineeringRoot }),
  ]);
  return {
    schedule: useMutation({ mutationFn: (input: ScheduleSurveyInput) => scheduleSurvey(input), onSuccess: invalidate }),
    start: useMutation({ mutationFn: (id: string) => startSurvey(id), onSuccess: invalidate }),
    submit: useMutation({ mutationFn: ({ id, report }: { id: string; report: SurveyReportInput }) => submitSurveyReport(id, report), onSuccess: invalidate }),
    approve: useMutation({ mutationFn: ({ id, note }: { id: string; note?: string }) => approveSurvey(id, note), onSuccess: invalidate }),
    reject: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectSurvey(id, reason), onSuccess: invalidate }),
  };
}
