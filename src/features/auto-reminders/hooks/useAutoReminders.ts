/**
 * P10-03 — Auto-Reminders: React Query Hooks
 *
 * Provides hooks for loading/saving reminder config and triggering evaluations.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAppStore } from '../../../store/useAppStore';
import { getAll, resolveWriteCompanyId } from '../../../lib/firestore';
import { COLLECTIONS } from '../../../lib/firebase';
import {
  loadReminderConfig,
  saveReminderConfig,
  previewReminderEvaluation,
  executeReminderRules,
} from '../../../lib/autoReminderWorkflow';
import type { ReminderConfig, ReminderEvaluationResult } from '../types';

/**
 * Load the reminder configuration.
 */
export function useReminderConfig() {
  return useQuery<ReminderConfig>({
    queryKey: ['auto-reminder-config'],
    queryFn: loadReminderConfig,
    staleTime: 60_000,
  });
}

/**
 * Save the reminder configuration.
 */
export function useSaveReminderConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: ReminderConfig) => {
      await saveReminderConfig(config);
      return config;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auto-reminder-config'] });
      toast.success('Reminder configuration saved');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save reminder configuration');
    },
  });
}

/**
 * Preview reminder evaluation (read-only, no side effects).
 */
export function usePreviewReminders() {
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  return useMutation({
    mutationFn: async (config: ReminderConfig) => {
      return previewReminderEvaluation(config, companyId);
    },
  });
}

/**
 * Execute reminder rules (creates tasks + sends notifications).
 */
export function useExecuteReminders() {
  const qc = useQueryClient();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  return useMutation({
    mutationFn: async (config: ReminderConfig) => {
      // Fetch all relevant data
      const [projects, leads, tasks, serviceTickets] = await Promise.all([
        getAll<any>(COLLECTIONS.PROJECTS),
        getAll<any>(COLLECTIONS.LEADS),
        getAll<any>('tasks'),
        getAll<any>(COLLECTIONS.SERVICE_TICKETS),
      ]);

      // Company-scope
      const scopedProjects = projects.filter((p) => p.companyId === companyId && !p.isDeleted);
      const scopedLeads = leads.filter((l) => l.companyId === companyId && !l.isDeleted);
      const scopedTasks = tasks.filter((t) => t.companyId === companyId && !t.isDeleted);
      const scopedTickets = serviceTickets.filter((s) => s.companyId === companyId && !s.isDeleted);

      return executeReminderRules(
        config,
        scopedProjects,
        scopedLeads,
        scopedTasks,
        scopedTickets,
        companyId,
      );
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['auto-reminder-config'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(
        `Reminders evaluated: ${data.results.length} triggered, ${data.tasksCreated} tasks created`,
      );
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to evaluate reminders');
    },
  });
}
