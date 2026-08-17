import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task, TaskStatus } from '../types';
import {
  changeTaskStatus,
  createTask as createTaskRecord,
  deleteTask as deleteTaskRecord,
  subscribeCompanyTasks,
  subscribeTask,
  updateTask as updateTaskRecord,
} from '../lib/tasks';
import { useAppStore } from '../store/useAppStore';
import { resolveWriteCompanyId } from '../lib/firestore';

type CreateTaskPayload = Parameters<typeof createTaskRecord>[0];
type UpdateTaskPayload = Parameters<typeof updateTaskRecord>[1];
const ACTIVE_STATUSES: TaskStatus[] = ['Open', 'In Progress', 'Done'];

function resolveCompanyId(): string {
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

export function useTasks() {
  const user = useAppStore((state) => state.user);
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);
  const company = useAppStore((state) => state.company);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const companyId = useMemo(() => {
    // Canonical tenant resolution — never the neutral 'default' placeholder.
    return resolveWriteCompanyId();
  }, [activeCompanyId, company?.id, user?.companyId]);

  useEffect(() => {
    if (!user?.id || !companyId) {
      setAllTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const unsubscribe = subscribeCompanyTasks(
      companyId,
      (tasks) => {
        setAllTasks(tasks);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [companyId, user?.id]);

  const myTasks = useMemo(() => {
    if (!user?.id) return [];
    return allTasks.filter((task) => task.assignedToId === user.id && ACTIVE_STATUSES.includes(task.status));
  }, [allTasks, user?.id]);

  const createTask = useCallback((payload: CreateTaskPayload) => {
    return createTaskRecord({ ...payload, companyId: payload.companyId || resolveCompanyId() });
  }, []);

  const updateTask = useCallback((id: string, payload: UpdateTaskPayload) => {
    return updateTaskRecord(id, payload);
  }, []);

  const deleteTask = useCallback((id: string) => {
    return deleteTaskRecord(id);
  }, []);

  const changeStatus = useCallback((id: string, status: TaskStatus) => {
    return changeTaskStatus(id, status);
  }, []);

  return { myTasks, allTasks, createTask, updateTask, deleteTask, changeStatus, loading, error };
}

export function useTask(id?: string) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setTask(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    return subscribeTask(
      id,
      (nextTask) => {
        setTask(nextTask);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
  }, [id]);

  const updateTask = useCallback((payload: UpdateTaskPayload) => {
    if (!id) return Promise.reject(new Error('Task id is required'));
    return updateTaskRecord(id, payload);
  }, [id]);

  const deleteTask = useCallback(() => {
    if (!id) return Promise.reject(new Error('Task id is required'));
    return deleteTaskRecord(id);
  }, [id]);

  const changeStatus = useCallback((status: TaskStatus) => {
    if (!id) return Promise.reject(new Error('Task id is required'));
    return changeTaskStatus(id, status);
  }, [id]);

  return { task, loading, error, updateTask, deleteTask, changeStatus };
}
