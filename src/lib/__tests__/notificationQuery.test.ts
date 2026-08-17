import { initializeApp } from 'firebase/app';
import { collection, getFirestore } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { buildNotificationQuery } from '../notificationQuery';

const app = initializeApp({ projectId: 'notification-query-test' }, 'notification-query-test');
const notifications = collection(getFirestore(app), 'notifications');

type LeafFilter = { field: string; op: string; value: unknown };

const OP_ALIASES: Record<string, string> = {
  '==': 'EQUAL',
  'array-contains': 'ARRAY_CONTAINS',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
  'in': 'IN',
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  '!=': 'NOT_EQUAL',
};

function fieldName(field: unknown): string {
  const segments = (field as { segments?: string[] } | undefined)?.segments;
  if (Array.isArray(segments) && segments.length > 0) return segments[0];
  if (typeof field === 'string') return field;
  return String(field);
}

function filterValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'stringValue' in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).stringValue;
  }
  if (value && typeof value === 'object' && 'arrayValue' in (value as Record<string, unknown>)) {
    const values = (value as Record<string, { values?: Array<Record<string, unknown>> }>).arrayValue?.values ?? [];
    return values.map((item) => item.stringValue ?? Object.values(item)[0]);
  }
  return value;
}

/** Recursively walk the SDK's query filter tree and collect leaf filters. */
function collectFilters(node: unknown, out: LeafFilter[] = []): LeafFilter[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collectFilters(item, out));
    return out;
  }
  const composite = node as { filters?: unknown[] };
  if (Array.isArray(composite.filters)) {
    composite.filters.forEach((item) => collectFilters(item, out));
    return out;
  }
  const leaf = node as { field?: unknown; op?: string; value?: unknown };
  if (leaf.field) {
    out.push({ field: fieldName(leaf.field), op: OP_ALIASES[String(leaf.op)] ?? String(leaf.op), value: filterValue(leaf.value) });
  }
  return out;
}

function queryInternals(queryObj: unknown) {
  const internals = (queryObj as { _query?: unknown })?._query ?? queryObj;
  const i = internals as {
    filters?: unknown[];
    explicitOrderBy?: Array<{ field?: unknown; direction?: string }>;
    limit?: number | null;
  };
  const filters = collectFilters(i.filters);
  const orderBy = (i.explicitOrderBy ?? []).map((item) => ({
    field: fieldName(item.field),
    direction: String(item.direction).toUpperCase() === 'ASC' ? 'ASCENDING' : 'DESCENDING',
  }));
  const limit = i.limit ?? null;
  return { filters, orderBy, limit };
}

describe('buildNotificationQuery', () => {
  it('scopes non-admins to tenant + recipient/creator equality only — no array-contains', () => {
    const q = buildNotificationQuery(notifications, {
      companyId: 'company-demo-neozy',
      userId: 'MUSR-DEMO-0001',
      isAdmin: false,
    });
    const { filters, orderBy, limit } = queryInternals(q);

    const fields = filters.map((f) => f.field);
    const ops = filters.map((f) => f.op);

    // Tenant anchor must be present.
    expect(filters).toContainEqual({ field: 'companyId', op: 'EQUAL', value: 'company-demo-neozy' });
    // Both equality branches must be present.
    expect(filters).toContainEqual({ field: 'recipientUserId', op: 'EQUAL', value: 'MUSR-DEMO-0001' });
    expect(filters).toContainEqual({ field: 'createdBy', op: 'EQUAL', value: 'MUSR-DEMO-0001' });
    // The visibleTo array-contains branch must NEVER be part of the query:
    // Firestore's rules engine rejects it (PERMISSION_DENIED) and it is
    // redundant with the equality branches (visibleTo ⊆ {recipient, creator}).
    expect(fields).not.toContain('visibleTo');
    expect(ops).not.toContain('ARRAY_CONTAINS');
    expect(ops).not.toContain('ARRAY_CONTAINS_ANY');

    // Sort + limit contract.
    expect(orderBy).toEqual([{ field: 'createdAt', direction: 'DESCENDING' }]);
    expect(limit).toBe(100);
  });

  it('keeps the simpler company-scoped query for administrators', () => {
    const q = buildNotificationQuery(notifications, {
      companyId: 'company-demo-neozy',
      userId: 'admin-user',
      isAdmin: true,
    });
    const { filters, orderBy, limit } = queryInternals(q);

    expect(filters).toContainEqual({ field: 'companyId', op: 'EQUAL', value: 'company-demo-neozy' });
    // Admins must not be restricted by recipient/creator equality.
    expect(filters.map((f) => f.field)).not.toContain('recipientUserId');
    expect(filters.map((f) => f.field)).not.toContain('createdBy');
    expect(orderBy).toEqual([{ field: 'createdAt', direction: 'DESCENDING' }]);
    expect(limit).toBe(100);
  });
});
