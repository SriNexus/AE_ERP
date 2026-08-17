export const PROJECT_BACKFILL_COLLECTIONS = {
  PROJECTS: 'projects',
  ORDERS: 'orders',
  QUOTATIONS: 'quotations',
  DISPATCH: 'dispatch',
} as const;

export type ProjectBackfillCollection =
  | typeof PROJECT_BACKFILL_COLLECTIONS.ORDERS
  | typeof PROJECT_BACKFILL_COLLECTIONS.QUOTATIONS
  | typeof PROJECT_BACKFILL_COLLECTIONS.DISPATCH;

type UnknownRecord = Record<string, unknown>;

export type ProjectBackfillSourceRecord = UnknownRecord & {
  id: string;
  companyId?: string;
  customerId?: string;
  projectId?: string | null;
  date?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  isDeleted?: boolean;
};

export type ProjectBackfillProjectRecord = {
  id: string;
  projectId: string;
  customerId?: string;
  companyId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  isDeleted?: boolean;
};

export type ProjectBackfillInput = {
  projects: ProjectBackfillProjectRecord[];
  orders: ProjectBackfillSourceRecord[];
  quotations: ProjectBackfillSourceRecord[];
  dispatch: ProjectBackfillSourceRecord[];
};

export type ProjectBackfillOptions = {
  companyId?: string;
  clusterGapDays?: number;
};

export type ProjectBackfillAssignment = {
  collection: ProjectBackfillCollection;
  id: string;
  companyId: string;
  customerId: string;
  projectId: string;
  sourceDate: string;
  matchedProjectId: string;
  clusterId: string;
};

export type ProjectBackfillSkipCounts = {
  existingProjectId: number;
  missingCompanyId: number;
  missingCustomerId: number;
  missingDate: number;
  invalidProject: number;
  ambiguousCluster: number;
  clusterWithoutProject: number;
};

export type ProjectBackfillSummary = {
  inputCounts: Record<'projects' | ProjectBackfillCollection, number>;
  eligibleSourceCount: number;
  assignmentCount: number;
  clusterCount: number;
  skipped: ProjectBackfillSkipCounts;
  byCollection: Record<ProjectBackfillCollection, { eligible: number; assigned: number; skippedExistingProjectId: number; skippedMissingCompanyId: number; skippedMissingCustomerId: number; skippedMissingDate: number; skippedAmbiguousCluster: number; skippedClusterWithoutProject: number }>;
};

export type ProjectBackfillPlan = {
  assignments: ProjectBackfillAssignment[];
  summary: ProjectBackfillSummary;
};

type TimelineItem =
  | { kind: 'project'; record: ProjectBackfillProjectRecord; dateMs: number; companyId: string; customerId: string }
  | { kind: 'source'; record: ProjectBackfillSourceRecord; collection: ProjectBackfillCollection; dateMs: number; companyId: string; customerId: string };

function normalizedCompanyId(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || 'default';
}

function normalizedCustomerId(value: unknown): string {
  return String(value ?? '').trim();
}

function toDateMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'object') {
    const candidate = value as { toDate?: unknown; seconds?: unknown; nanos?: unknown };
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date.getTime();
      }
    }
    if (typeof candidate.seconds === 'number' || typeof candidate.seconds === 'string') {
      const seconds = Number(candidate.seconds);
      if (Number.isFinite(seconds)) return Math.floor(seconds * 1000);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = new Date(String(value));
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
}

function toIsoString(value: unknown): string {
  const ms = toDateMs(value);
  return ms == null ? '' : new Date(ms).toISOString();
}

function getSourceDateMs(record: ProjectBackfillSourceRecord): number | null {
  return toDateMs(record.date) ?? toDateMs(record.createdAt) ?? toDateMs(record.updatedAt) ?? null;
}

function getProjectDateMs(record: ProjectBackfillProjectRecord): number | null {
  return toDateMs(record.createdAt) ?? toDateMs(record.updatedAt) ?? null;
}

function buildClusterId(companyId: string, customerId: string, index: number) {
  return `${companyId}::${customerId}::${String(index).padStart(4, '0')}`;
}

export function buildProjectBackfillPlan(input: ProjectBackfillInput, options: ProjectBackfillOptions = {}): ProjectBackfillPlan {
  const clusterGapDays = Math.max(1, Math.floor(options.clusterGapDays ?? 30));
  const gapMs = clusterGapDays * 86400000;
  const companyFilter = normalizedCompanyId(options.companyId || '');

  const assignments: ProjectBackfillAssignment[] = [];
  const skipped: ProjectBackfillSkipCounts = {
    existingProjectId: 0,
    missingCompanyId: 0,
    missingCustomerId: 0,
    missingDate: 0,
    invalidProject: 0,
    ambiguousCluster: 0,
    clusterWithoutProject: 0,
  };
  const byCollection: ProjectBackfillSummary['byCollection'] = {
    orders: { eligible: 0, assigned: 0, skippedExistingProjectId: 0, skippedMissingCompanyId: 0, skippedMissingCustomerId: 0, skippedMissingDate: 0, skippedAmbiguousCluster: 0, skippedClusterWithoutProject: 0 },
    quotations: { eligible: 0, assigned: 0, skippedExistingProjectId: 0, skippedMissingCompanyId: 0, skippedMissingCustomerId: 0, skippedMissingDate: 0, skippedAmbiguousCluster: 0, skippedClusterWithoutProject: 0 },
    dispatch: { eligible: 0, assigned: 0, skippedExistingProjectId: 0, skippedMissingCompanyId: 0, skippedMissingCustomerId: 0, skippedMissingDate: 0, skippedAmbiguousCluster: 0, skippedClusterWithoutProject: 0 },
  };

  const inputCounts = {
    projects: input.projects.length,
    orders: input.orders.length,
    quotations: input.quotations.length,
    dispatch: input.dispatch.length,
  } as const;

  const timelineByGroup = new Map<string, TimelineItem[]>();
  const addItem = (item: TimelineItem) => {
    const key = `${item.companyId}::${item.customerId}`;
    const list = timelineByGroup.get(key) ?? [];
    list.push(item);
    timelineByGroup.set(key, list);
  };

  for (const project of input.projects) {
    if (project.isDeleted) {
      skipped.invalidProject += 1;
      continue;
    }
    const companyId = normalizedCompanyId(project.companyId);
    if (companyFilter && companyFilter !== 'default' && companyFilter !== companyId) continue;
    const customerId = normalizedCustomerId(project.customerId);
    const dateMs = getProjectDateMs(project);
    if (!project.id || !project.projectId || !customerId || dateMs == null) {
      skipped.invalidProject += 1;
      continue;
    }
    addItem({ kind: 'project', record: project, dateMs, companyId, customerId });
  }

  const sourceCollections: Array<[ProjectBackfillCollection, ProjectBackfillSourceRecord[]]> = [
    ['orders', input.orders],
    ['quotations', input.quotations],
    ['dispatch', input.dispatch],
  ];

  for (const [collection, records] of sourceCollections) {
    for (const record of records) {
      if (record.isDeleted) continue;
      const companyId = normalizedCompanyId(record.companyId);
      if (companyFilter && companyFilter !== 'default' && companyFilter !== companyId) continue;
      const customerId = normalizedCustomerId(record.customerId);
      if (!record.id || !customerId) {
        byCollection[collection].skippedMissingCustomerId += 1;
        skipped.missingCustomerId += 1;
        continue;
      }
      if (!companyId) {
        byCollection[collection].skippedMissingCompanyId += 1;
        skipped.missingCompanyId += 1;
        continue;
      }
      const dateMs = getSourceDateMs(record);
      if (dateMs == null) {
        byCollection[collection].skippedMissingDate += 1;
        skipped.missingDate += 1;
        continue;
      }
      if (record.projectId && String(record.projectId).trim()) {
        byCollection[collection].skippedExistingProjectId += 1;
        skipped.existingProjectId += 1;
        continue;
      }

      byCollection[collection].eligible += 1;
      addItem({ kind: 'source', record, collection, dateMs, companyId, customerId });
    }
  }

  let clusterCount = 0;
  for (const [, items] of timelineByGroup) {
    const sorted = [...items].sort((a, b) => a.dateMs - b.dateMs || (a.kind === 'project' ? -1 : 1));
    if (sorted.length === 0) continue;

    let clusterStart = 0;
    for (let index = 1; index <= sorted.length; index += 1) {
      const current = sorted[index];
      const previous = sorted[index - 1];
      const gap = current ? current.dateMs - previous.dateMs : gapMs + 1;
      if (!current || gap > gapMs) {
        const cluster = sorted.slice(clusterStart, index);
        clusterStart = index;
        clusterCount += 1;

        const projects = cluster.filter((item): item is Extract<TimelineItem, { kind: 'project' }> => item.kind === 'project');
        const sources = cluster.filter((item): item is Extract<TimelineItem, { kind: 'source' }> => item.kind === 'source');
        if (projects.length !== 1) {
          if (projects.length === 0 && sources.length > 0) {
            for (const source of sources) {
              byCollection[source.collection].skippedClusterWithoutProject += 1;
              skipped.clusterWithoutProject += 1;
            }
          } else if (projects.length > 1 && sources.length > 0) {
            for (const source of sources) {
              byCollection[source.collection].skippedAmbiguousCluster += 1;
              skipped.ambiguousCluster += 1;
            }
          }
          continue;
        }

        const project = projects[0];
        const clusterId = buildClusterId(project.companyId, project.customerId, clusterCount);
        for (const source of sources) {
          const sourceProjectId = String(source.record.projectId ?? '').trim();
          if (sourceProjectId) {
            byCollection[source.collection].skippedExistingProjectId += 1;
            skipped.existingProjectId += 1;
            continue;
          }
          assignments.push({
            collection: source.collection,
            id: source.record.id,
            companyId: source.companyId,
            customerId: source.customerId,
            projectId: project.record.projectId,
            sourceDate: toIsoString(source.record.date || source.record.createdAt || source.record.updatedAt),
            matchedProjectId: project.record.projectId,
            clusterId,
          });
          byCollection[source.collection].assigned += 1;
        }
      }
    }
  }

  const summary: ProjectBackfillSummary = {
    inputCounts,
    eligibleSourceCount: Object.values(byCollection).reduce((total, item) => total + item.eligible, 0),
    assignmentCount: assignments.length,
    clusterCount,
    skipped,
    byCollection,
  };

  return { assignments, summary };
}

export function formatProjectBackfillSummary(summary: ProjectBackfillSummary) {
  const lines = [
    `Projects scanned: ${summary.inputCounts.projects}`,
    `Orders scanned: ${summary.inputCounts.orders}`,
    `Quotations scanned: ${summary.inputCounts.quotations}`,
    `Dispatch scanned: ${summary.inputCounts.dispatch}`,
    `Eligible records: ${summary.eligibleSourceCount}`,
    `Assignments: ${summary.assignmentCount}`,
    `Clusters examined: ${summary.clusterCount}`,
    `Skipped existing projectId: ${summary.skipped.existingProjectId}`,
    `Skipped missing companyId: ${summary.skipped.missingCompanyId}`,
    `Skipped missing customerId: ${summary.skipped.missingCustomerId}`,
    `Skipped missing date: ${summary.skipped.missingDate}`,
    `Skipped invalid project records: ${summary.skipped.invalidProject}`,
    `Skipped ambiguous clusters: ${summary.skipped.ambiguousCluster}`,
    `Skipped clusters without project: ${summary.skipped.clusterWithoutProject}`,
  ];
  return lines.join('\n');
}
