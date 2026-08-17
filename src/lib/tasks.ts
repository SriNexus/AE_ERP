import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, firebaseEnv } from './firebase';
import { createDocWithId, genId, fromDoc, getAll, getOne, updateDocById, resolveWriteCompanyId } from './firestore';
import { sanitizeFirestoreData } from './sanitizer';
import { logActivity } from './taskWorkflow';
import { sendNotification } from './notifications';
import { useAppStore } from '../store/useAppStore';
import { NotificationType, type Task, type TaskPriority, type TaskStatus } from '../types';

const TASKS_COLLECTION = 'tasks';

type TaskInput = {
  title: string;
  description?: string;
  assignedToId: string;
  assignedToName: string;
  dueDate: string;
  priority: TaskPriority;
  status?: TaskStatus;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  companyId?: string;
};

type TaskUpdate = Partial<Omit<TaskInput, 'companyId'>> & {
  status?: TaskStatus;
  isDeleted?: boolean;
};

type SubscribeTaskOptions = {
  assignedToId?: string;
  status?: TaskStatus;
  limit?: number;
};

function resolveCompanyId(inputCompanyId?: string): string {
  const state = useAppStore.getState();
  if (inputCompanyId) return inputCompanyId;
  if (state.activeCompanyId && state.activeCompanyId !== 'all') return state.activeCompanyId;
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  return resolveWriteCompanyId();
}

function nowUserId(): string {
  return useAppStore.getState().user?.id || 'system';
}

export async function createTask(input: TaskInput): Promise<Task> {
  const id = genId.generic('TSK');
  const companyId = resolveCompanyId(input.companyId);
  const payload = {
    id,
    companyId,
    title: input.title.trim(),
    description: input.description?.trim() || '',
    assignedToId: input.assignedToId,
    assignedToName: input.assignedToName,
    createdBy: nowUserId(),
    dueDate: input.dueDate,
    priority: input.priority,
    status: input.status || 'Open',
    entityType: input.entityType || '',
    entityId: input.entityId || '',
    entityName: input.entityName || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isDeleted: false,
  };

  await createDocWithId(TASKS_COLLECTION, id, sanitizeFirestoreData(payload));
  void sendNotification(
    input.assignedToId,
    NotificationType.TASK_ASSIGNED,
    'Task assigned',
    input.title.trim(),
    'task',
    id,
    companyId
  );
  return { ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Task;
}

export async function updateTask(id: string, delta: TaskUpdate): Promise<void> {
  await updateDocById(TASKS_COLLECTION, id, { ...delta, updatedBy: nowUserId() });
}

export async function deleteTask(id: string): Promise<void> {
  await updateDocById(TASKS_COLLECTION, id, {
    isDeleted: true,
    status: 'Cancelled',
    deletedAt: firebaseEnv.isConfigured ? undefined : new Date().toISOString(),
    deletedBy: nowUserId(),
    updatedBy: nowUserId(),
  });
}

export async function changeTaskStatus(id: string, status: TaskStatus): Promise<void> {
  let task: Task | null = null;
  if (firebaseEnv.isConfigured) {
    const taskSnap = await getDoc(doc(db, TASKS_COLLECTION, id));
    task = taskSnap.exists() ? fromDoc<Task>(taskSnap) : null;
  } else {
    task = await getOne<Task>(TASKS_COLLECTION, id);
  }
  await updateDocById(TASKS_COLLECTION, id, { status, updatedBy: nowUserId() });

  try {
    await logActivity('Tasks', 'Task Status Changed', id, {
      actionLabel: `Task marked ${status}`,
      entityName: id,
      status,
    });
  } catch {
    // logActivity is non-blocking; task status is already persisted.
  }

  if (task?.assignedToId) {
    void sendNotification(
      task.assignedToId,
      NotificationType.TASK_STATUS_CHANGED,
      'Task status changed',
      `${task.title} is now ${status}`,
      'task',
      id,
      task.companyId
    );
  }
}

function sortTasksByCreatedAt(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

export function subscribeTasks(
  companyId: string,
  options: SubscribeTaskOptions,
  callback: (tasks: Task[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  if (!firebaseEnv.isConfigured) {
    let active = true;
    void getAll<Task>(TASKS_COLLECTION).then((rows) => {
      if (!active) return;
      callback(sortTasksByCreatedAt(rows.filter((task) => (
        task.companyId === companyId
        && task.isDeleted !== true
        && (!options.assignedToId || task.assignedToId === options.assignedToId)
        && task.status === (options.status || 'Open')
      ))).slice(0, options.limit || rows.length));
    }).catch((error) => onError?.(error));
    return () => {
      active = false;
    };
  }

  const constraints: QueryConstraint[] = [where('companyId', '==', companyId)];
  if (options.assignedToId) {
    constraints.push(where('assignedToId', '==', options.assignedToId));
    constraints.push(where('status', '==', options.status || 'Open'));
    constraints.push(orderBy('dueDate', 'asc'));
  } else {
    constraints.push(where('status', '==', options.status || 'Open'));
    constraints.push(orderBy('createdAt', 'desc'));
  }
  if (options.limit) constraints.push(limit(options.limit));

  return onSnapshot(
    query(collection(db, TASKS_COLLECTION), ...constraints),
    (snapshot) => {
      callback(snapshot.docs.map((snap) => fromDoc<Task>(snap)).filter((task) => task.isDeleted !== true));
    },
    (error) => onError?.(error)
  );
}

export function subscribeCompanyTasks(
  companyId: string,
  callback: (tasks: Task[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  if (!firebaseEnv.isConfigured) {
    let active = true;
    void getAll<Task>(TASKS_COLLECTION).then((rows) => {
      if (active) callback(sortTasksByCreatedAt(rows.filter((task) => task.companyId === companyId && task.isDeleted !== true)));
    }).catch((error) => onError?.(error));
    return () => {
      active = false;
    };
  }

  let fallbackUnsubscribe: Unsubscribe | null = null;
  const primaryUnsubscribe = onSnapshot(
    query(collection(db, TASKS_COLLECTION), where('companyId', '==', companyId), orderBy('createdAt', 'desc')),
    (snapshot) => {
      callback(snapshot.docs.map((snap) => fromDoc<Task>(snap)).filter((task) => task.isDeleted !== true));
    },
    (error) => {
      if (error.code === 'failed-precondition' && !fallbackUnsubscribe) {
        const fallbackQuery = query(collection(db, TASKS_COLLECTION), where('companyId', '==', companyId));
        fallbackUnsubscribe = onSnapshot(
          fallbackQuery,
          (snapshot) => {
            callback(sortTasksByCreatedAt(snapshot.docs.map((snap) => fromDoc<Task>(snap)).filter((task) => task.isDeleted !== true)));
          },
          (fallbackError) => onError?.(fallbackError)
        );
        return;
      }
      onError?.(error);
    }
  );
  return () => {
    primaryUnsubscribe();
    fallbackUnsubscribe?.();
  };
}

export function subscribeTask(
  id: string,
  callback: (task: Task | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  if (!firebaseEnv.isConfigured) {
    let active = true;
    void getOne<Task>(TASKS_COLLECTION, id).then((task) => {
      if (active) callback(task?.isDeleted ? null : task);
    }).catch((error) => onError?.(error));
    return () => {
      active = false;
    };
  }

  return onSnapshot(
    doc(db, TASKS_COLLECTION, id),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      const task = fromDoc<Task>(snapshot);
      callback(task.isDeleted ? null : task);
    },
    (error) => onError?.(error)
  );
}
