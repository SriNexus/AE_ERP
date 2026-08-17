import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { COLLECTIONS } from '../../../lib/firebase';
import { getAll } from '../../../lib/firestore';
import { queryKeys } from '../../../lib/queryKeys';
import { useAppStore } from '../../../store/useAppStore';
import type { ProjectRecord, ProjectFormValues } from '../types';
import { archiveProject, createProject, updateProject } from '../../../lib/projectWorkflow';

export function useProjects(options?: { enabled?: boolean }) {
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  const result = useQuery({
    queryKey: keys.projectsRoot,
    queryFn: () => getAll<ProjectRecord>(COLLECTIONS.PROJECTS),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });

  return {
    ...result,
    data: (result.data || []) as ProjectRecord[],
  };
}

export function useSaveProject(editId: string | null, onSuccess: (project: ProjectRecord) => void) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (form: ProjectFormValues & { customerName?: string }) => {
      return editId ? updateProject(editId, form) : createProject(form, { customerName: form.customerName });
    },
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success(editId ? 'Project updated' : 'Project created');
      onSuccess(project as ProjectRecord);
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to save project'),
  });
}

export function useArchiveProject(onSuccess: (project: ProjectRecord) => void) {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async ({ projectId, reason }: { projectId: string; reason?: string }) => {
      return archiveProject(projectId, reason);
    },
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: keys.projectsRoot });
      toast.success('Project archived');
      onSuccess(project as ProjectRecord);
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to archive project'),
  });
}
