import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db, COLLECTIONS } from '../../lib/firebase';
import { Button, FormRow, Input, Modal, Select, Textarea } from '../ui';
import { useAppStore } from '../../store/useAppStore';
import { resolveWriteCompanyId } from '../../lib/firestore';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { filterManageableUsers } from '../../lib/ownerAccess';

type UserOption = { id: string; name: string };
type EntityOption = { id: string; name: string };
type EntityType = 'Lead' | 'Customer' | 'Order';

type FormState = {
  title: string;
  description: string;
  assignedToId: string;
  assignedToName: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  entityType: EntityType | '';
  entityId: string;
  entityName: string;
};

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  assignedToId: '',
  assignedToName: '',
  dueDate: '',
  priority: 'Medium',
  status: 'Open',
  entityType: '',
  entityId: '',
  entityName: '',
};

const ENTITY_COLLECTION: Record<EntityType, string> = {
  Lead: COLLECTIONS.LEADS,
  Customer: COLLECTIONS.CUSTOMERS,
  Order: COLLECTIONS.ORDERS,
};

function entityLabel(data: Record<string, unknown>): string {
  return String(data.name || data.customerName || data.orderNumber || data.title || data.id || 'Untitled');
}

export function CreateTaskModal({
  open,
  onClose,
  onSubmit,
  task,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: FormState) => Promise<void | Task>;
  task?: Task | null;
}) {
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(task ? {
      title: task.title || '',
      description: task.description || '',
      assignedToId: task.assignedToId || '',
      assignedToName: task.assignedToName || '',
      dueDate: task.dueDate || '',
      priority: task.priority || 'Medium',
      status: task.status || 'Open',
      entityType: (task.entityType as EntityType) || '',
      entityId: task.entityId || '',
      entityName: task.entityName || '',
    } : EMPTY_FORM);
  }, [open, task]);

  useEffect(() => {
    if (!open || !companyId) return;
    let cancelled = false;
    getDocs(query(collection(db, COLLECTIONS.USERS), where('companyId', '==', companyId), limit(100)))
      .then((snapshot) => {
        if (cancelled) return;
        setUsers(filterManageableUsers(snapshot.docs.map((snap) => {
          const data = snap.data();
          return { id: snap.id, name: String(data.name || data.email || snap.id), email: data.email };
        })));
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, open]);

  useEffect(() => {
    if (!open || !form.entityType || !companyId) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    const col = ENTITY_COLLECTION[form.entityType];
    getDocs(query(collection(db, col), where('companyId', '==', companyId), limit(50)))
      .then((snapshot) => {
        if (cancelled) return;
        setEntities(snapshot.docs
          .map((snap) => ({ id: snap.id, name: entityLabel({ id: snap.id, ...snap.data() }) }))
          .filter((item) => item.name));
      })
      .catch(() => {
        if (!cancelled) setEntities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, form.entityType, open]);

  const assigneeOptions = useMemo(() => [
    { label: 'Select assignee', value: '' },
    ...users.map((user) => ({ label: user.name, value: user.id })),
  ], [users]);

  const entityOptions = useMemo(() => [
    { label: 'No linked entity', value: '' },
    ...entities.map((entity) => ({ label: entity.name, value: entity.id })),
  ], [entities]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!form.assignedToId) {
      setError('Assignee is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit Task' : 'Add Task'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">{error}</div>}
        <Input label="Title" required value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
        <Textarea label="Description" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
        <FormRow cols={2}>
          <Select
            label="Assignee"
            required
            value={form.assignedToId}
            options={assigneeOptions}
            onChange={(event) => {
              const selected = users.find((user) => user.id === event.target.value);
              setForm((prev) => ({ ...prev, assignedToId: event.target.value, assignedToName: selected?.name || '' }));
            }}
          />
          <Input label="Due Date" type="date" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
        </FormRow>
        <FormRow cols={2}>
          <Select
            label="Priority"
            value={form.priority}
            options={['Low', 'Medium', 'High', 'Urgent'].map((value) => ({ label: value, value }))}
            onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as TaskPriority }))}
          />
          <Select
            label="Status"
            value={form.status}
            options={['Open', 'In Progress', 'Done', 'Cancelled'].map((value) => ({ label: value, value }))}
            onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as TaskStatus }))}
          />
        </FormRow>
        <FormRow cols={2}>
          <Select
            label="Entity Type"
            value={form.entityType}
            options={[{ label: 'No linked entity', value: '' }, 'Lead', 'Customer', 'Order'].map((value) => typeof value === 'string' ? { label: value, value } : value)}
            onChange={(event) => setForm((prev) => ({ ...prev, entityType: event.target.value as EntityType | '', entityId: '', entityName: '' }))}
          />
          <Select
            label="Entity"
            value={form.entityId}
            options={entityOptions}
            disabled={!form.entityType}
            onChange={(event) => {
              const selected = entities.find((entity) => entity.id === event.target.value);
              setForm((prev) => ({ ...prev, entityId: event.target.value, entityName: selected?.name || '' }));
            }}
          />
        </FormRow>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{task ? 'Save Task' : 'Create Task'}</Button>
        </div>
      </form>
    </Modal>
  );
}
