import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  where,
} from 'firebase/firestore';
import { COLLECTIONS, db, countDocumentsSafe } from './firebase';
import {
  dateMs,
  monthKey,
  startOfDay,
  startOfMonth,
  inRange,
  buildMonthBuckets,
  countProjectsByStage,
} from './analyticsCore';

export type DashboardStats = {
  todayLeads: number;
  todayOrders: number;
  pendingDispatch: number;
  pendingPayments: number;
  totalRevenueMTD: number;
  activeCustomers: number;
  newCustomersToday: number;
  todayCollection: number;
};

export type DashboardSummary = {
  totalLeads: number;
  customers: number;
  totalOrders: number;
  pendingOrders: number;
  revenue: number;
  collected: number;
  employees: number;
};

export type DashboardPipelinePoint = { status: string; count: number };
export type ProjectStageCount = { stage: string; count: number };
export type DashboardTrendPoint = { month: string; orders: number; revenue: number };
export type DashboardWorkflowCounts = {
  newLeads: number;
  followUp: number;
  quotations: number;
  orders: number;
  invoices: number;
  pendingPayments: number;
  dispatched: number;
  installed: number;
  completed: number;
};

export type DashboardRow = Record<string, unknown> & {
  id: string;
  companyId?: string;
  createdAt?: unknown;
  total?: unknown;
  amount?: unknown;
  status?: string;
  paymentStatus?: string;
  isDeleted?: boolean;
};

export type DashboardOverview = {
  stats: DashboardStats;
  summary: DashboardSummary;
  workflowCounts: DashboardWorkflowCounts;
  pipelineData: DashboardPipelinePoint[];
  revenueTrend: DashboardTrendPoint[];
  recentLeads: DashboardRow[];
  recentOrders: DashboardRow[];
};

const EMPTY_STATS: DashboardStats = {
  todayLeads: 0,
  todayOrders: 0,
  pendingDispatch: 0,
  pendingPayments: 0,
  totalRevenueMTD: 0,
  activeCustomers: 0,
  newCustomersToday: 0,
  todayCollection: 0,
};

const EMPTY_SUMMARY: DashboardSummary = {
  totalLeads: 0,
  customers: 0,
  totalOrders: 0,
  pendingOrders: 0,
  revenue: 0,
  collected: 0,
  employees: 0,
};

const EMPTY_WORKFLOW_COUNTS: DashboardWorkflowCounts = {
  newLeads: 0,
  followUp: 0,
  quotations: 0,
  orders: 0,
  invoices: 0,
  pendingPayments: 0,
  dispatched: 0,
  installed: 0,
  completed: 0,
};

// ── Date helpers imported from analyticsCore ──────────────

export function buildRevenueTrend(rows: DashboardRow[], months = 6): DashboardTrendPoint[] {
  const buckets = buildMonthBuckets(months);
  rows.forEach((row) => {
    const bucket = buckets[monthKey(new Date(dateMs(row.createdAt)))];
    if (!bucket) return;
    bucket.orders += 1;
    bucket.revenue += Number(row.total) || 0;
  });
  return Object.values(buckets);
}

export function buildPipelineData(statusCounts: Array<{ status: string; count: number }>): DashboardPipelinePoint[] {
  return statusCounts.filter((item) => item.count > 0);
}

export function buildProjectsByStage(
  projects: Array<{ currentStage?: unknown; isDeleted?: boolean }>,
): ProjectStageCount[] {
  const counts = countProjectsByStage(projects);
  return Array.from(counts, ([stage, count]) => ({ stage, count }));
}

export function sortRecentRows(rows: DashboardRow[], limitCount = 5): DashboardRow[] {
  return [...rows]
    .sort((a, b) => dateMs(b.createdAt) - dateMs(a.createdAt))
    .slice(0, limitCount);
}

async function countVisibleDocuments(
  collectionName: string,
  companyId: string,
  constraints: QueryConstraint[] = [],
  cacheKeySuffix = '',
) {
  return countDocumentsSafe(
    query(
      collection(db, collectionName),
      where('companyId', '==', companyId),
      ...constraints,
    ),
    `${collectionName}:${companyId}:${cacheKeySuffix}`,
  );
}

async function getDateRangeRows(collectionName: string, field: string, from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const [timestampSnap, stringSnap] = await Promise.allSettled([
    getDocs(query(
      collection(db, collectionName),
      where(field, '>=', from),
      where(field, '<', to),
    )),
    getDocs(query(
      collection(db, collectionName),
      where(field, '>=', fromIso),
      where(field, '<', toIso),
    )),
  ]);

  const rows = new Map<string, DashboardRow>();
  const docs = [
    ...(timestampSnap.status === 'fulfilled' ? timestampSnap.value.docs : []),
    ...(stringSnap.status === 'fulfilled' ? stringSnap.value.docs : []),
  ];

  docs.forEach((docSnap) => {
    rows.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) });
  });

  return Array.from(rows.values()).filter((row) => row.isDeleted !== true);
}

async function getCompanyDateRangeRows(collectionName: string, companyId: string, field: string, from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const [timestampSnap, stringSnap] = await Promise.allSettled([
    getDocs(query(
      collection(db, collectionName),
      where('companyId', '==', companyId),
      where(field, '>=', from),
      where(field, '<', to),
    )),
    getDocs(query(
      collection(db, collectionName),
      where('companyId', '==', companyId),
      where(field, '>=', fromIso),
      where(field, '<', toIso),
    )),
  ]);

  const rows = new Map<string, DashboardRow>();
  const docs = [
    ...(timestampSnap.status === 'fulfilled' ? timestampSnap.value.docs : []),
    ...(stringSnap.status === 'fulfilled' ? stringSnap.value.docs : []),
  ];

  docs.forEach((docSnap) => {
    rows.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) });
  });

  return Array.from(rows.values()).filter((row) => row.isDeleted !== true);
}

async function countDateRangeForCompany(collectionName: string, companyId: string, field: string, from: Date, to: Date) {
  const rows = await getCompanyDateRangeRows(collectionName, companyId, field, from, to);
  return rows.filter((row) => inRange(row[field], from, to)).length;
}

async function sumDateRangeForCompany(collectionName: string, companyId: string, field: string, amountField: string, from: Date, to: Date) {
  const rows = await getCompanyDateRangeRows(collectionName, companyId, field, from, to);
  return rows
    .filter((row) => inRange(row[field], from, to))
    .reduce((sum, row) => sum + (Number(row[amountField]) || 0), 0);
}

async function fetchRecentDateRangeRows(collectionName: string, companyId: string, field: string, months = 12) {
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const to = new Date();
  return getCompanyDateRangeRows(collectionName, companyId, field, from, to);
}

async function fetchRecentRows(collectionName: string, companyId: string, recentLimit: number) {
  const snap = await getDocs(query(
    collection(db, collectionName),
    where('companyId', '==', companyId),
    orderBy('createdAt', 'desc'),
    limit(recentLimit),
  ));
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) })) as DashboardRow[];
}

export async function getDashboardStats(companyId: string): Promise<DashboardStats> {
  if (!companyId) return EMPTY_STATS;

  const today = startOfDay();
  const tomorrow = startOfDay();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const month = startOfMonth();

  const [
    todayLeads,
    todayOrders,
    pendingDispatch,
    pendingPaymentDocs,
    pendingInvoiceDocs,
    totalRevenueMTD,
    activeCustomers,
  ] = await Promise.all([
    countDateRangeForCompany(COLLECTIONS.LEADS, companyId, 'createdAt', today, tomorrow),
    countDateRangeForCompany(COLLECTIONS.ORDERS, companyId, 'createdAt', today, tomorrow),
    countVisibleDocuments(
      COLLECTIONS.DISPATCH,
      companyId,
      [where('status', 'in', ['Pending', 'Pending Verification', 'Approved', 'Partial Dispatch']), where('isDeleted', '==', false)],
      'pending-dispatch',
    ),
    countVisibleDocuments(
      COLLECTIONS.PAYMENTS,
      companyId,
      [where('status', 'in', ['Pending', 'Unpaid', 'Overdue']), where('isDeleted', '==', false)],
      'pending-payments',
    ),
    countVisibleDocuments(
      COLLECTIONS.PROFORMA_INVOICES,
      companyId,
      [where('paymentStatus', 'in', ['Pending', 'Unpaid', 'Overdue']), where('isDeleted', '==', false)],
      'pending-invoices',
    ),
    sumDateRangeForCompany(COLLECTIONS.PAYMENTS, companyId, 'createdAt', 'amount', month, tomorrow),
    countVisibleDocuments(
      COLLECTIONS.CUSTOMERS,
      companyId,
      [where('status', '==', 'Active'), where('isDeleted', '==', false)],
      'active-customers',
    ),
  ]);

  return {
    todayLeads,
    todayOrders,
    pendingDispatch,
    pendingPayments: pendingPaymentDocs + pendingInvoiceDocs,
    totalRevenueMTD,
    activeCustomers,
    newCustomersToday: 0,
    todayCollection: 0,
  };
}

export async function getDashboardOverview(companyId: string, recentLimit = 5): Promise<DashboardOverview> {
  if (!companyId) {
    return {
      stats: EMPTY_STATS,
      summary: EMPTY_SUMMARY,
      workflowCounts: EMPTY_WORKFLOW_COUNTS,
      pipelineData: [],
      revenueTrend: buildRevenueTrend([]),
      recentLeads: [],
      recentOrders: [],
    };
  }

  const stats = await getDashboardStats(companyId);
  const sixMonthsAgo = startOfMonth();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  const tomorrow = startOfDay();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalLeads,
    customers,
    totalOrders,
    pendingOrders,
    // revenueRows — windowed to last 12mo to avoid full-collection reads at scale
    revenueRows,
    // collectedRows — windowed to last 12mo
    collectedRows,
    employees,
    newLeads,
    followUp,
    quotations,
    confirmedOrders,
    invoices,
    pendingPayments,
    dispatched,
    installed,
    completed,
    pipelineRows,
    recentLeads,
    recentOrders,
    trendRows,
  ] = await Promise.all([
    countVisibleDocuments(COLLECTIONS.LEADS, companyId, [], 'summary-leads'),
    countVisibleDocuments(COLLECTIONS.CUSTOMERS, companyId, [], 'summary-customers'),
    countVisibleDocuments(COLLECTIONS.ORDERS, companyId, [], 'summary-orders'),
    countVisibleDocuments(COLLECTIONS.ORDERS, companyId, [where('status', 'in', ['Pending', 'Processing'])], 'summary-pending-orders'),
    fetchRecentDateRangeRows(COLLECTIONS.ORDERS, companyId, 'createdAt', 12),
    fetchRecentDateRangeRows(COLLECTIONS.PAYMENTS, companyId, 'createdAt', 12),
    countVisibleDocuments(COLLECTIONS.EMPLOYEES, companyId, [], 'summary-employees'),
    countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'New')], 'workflow-new'),
    countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'Follow-up')], 'workflow-follow-up'),
    countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'Quotation')], 'workflow-quotation'),
    countVisibleDocuments(COLLECTIONS.ORDERS, companyId, [where('status', '==', 'Confirmed')], 'workflow-orders'),
    countVisibleDocuments(COLLECTIONS.PROFORMA_INVOICES, companyId, [], 'workflow-invoices'),
    countVisibleDocuments(COLLECTIONS.PROFORMA_INVOICES, companyId, [where('paymentStatus', 'in', ['Pending', 'Unpaid', 'Overdue'])], 'workflow-pending-payments'),
    countVisibleDocuments(COLLECTIONS.DISPATCH, companyId, [where('status', '==', 'Dispatched')], 'workflow-dispatched'),
    countVisibleDocuments(COLLECTIONS.DISPATCH, companyId, [where('status', '==', 'Delivered')], 'workflow-delivered'),
    countVisibleDocuments(COLLECTIONS.ORDERS, companyId, [where('status', '==', 'Completed')], 'workflow-completed'),
    Promise.all([
      countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'New')], 'pipeline-new'),
      countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'Follow-up')], 'pipeline-follow-up'),
      countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'Qualified')], 'pipeline-qualified'),
      countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'Converted')], 'pipeline-converted'),
      countVisibleDocuments(COLLECTIONS.LEADS, companyId, [where('status', '==', 'Lost')], 'pipeline-lost'),
    ]).then((values) => buildPipelineData([
      { status: 'New', count: values[0] },
      { status: 'Follow-up', count: values[1] },
      { status: 'Qualified', count: values[2] },
      { status: 'Converted', count: values[3] },
      { status: 'Lost', count: values[4] },
    ])),
    fetchRecentRows(COLLECTIONS.LEADS, companyId, recentLimit),
    fetchRecentRows(COLLECTIONS.ORDERS, companyId, recentLimit),
    getCompanyDateRangeRows(COLLECTIONS.ORDERS, companyId, 'createdAt', sixMonthsAgo, tomorrow),
  ]);

  return {
    stats,
    summary: {
      totalLeads,
      customers,
      totalOrders,
      pendingOrders,
      revenue: revenueRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
      collected: collectedRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
      employees,
    },
    workflowCounts: {
      newLeads,
      followUp,
      quotations,
      orders: confirmedOrders,
      invoices,
      pendingPayments,
      dispatched,
      installed,
      completed,
    },
    pipelineData: pipelineRows,
    revenueTrend: buildRevenueTrend(trendRows, 6),
    recentLeads: sortRecentRows(recentLeads, recentLimit),
    recentOrders: sortRecentRows(recentOrders, recentLimit),
  };
}
