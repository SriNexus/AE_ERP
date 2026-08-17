import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bell, CheckCheck, Eye, Inbox, Trash2, Undo2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Input,
  Pagination,
  PremiumKpi,
  Select,
  SkeletonRows,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  UniversalCheckbox,
  OverflowMenu,
  WorkspaceHero,
} from '../components/ui';
import { statusBadge } from '../components/ui/Badge';
import { fmtDateTime } from '../lib/firestore';
import { getNotificationRoute } from '../lib/notificationRoutes';
import { notificationErrorMessage } from '../lib/notificationErrors';
import { toMillis, useNotification, useNotifications } from '../hooks/useNotifications';
import type { Notification } from '../types';

const STATUS_OPTIONS = ['All', 'Unread', 'Read'];
const DATE_OPTIONS = [
  { label: 'All dates', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: 'week' },
  { label: 'Last 30 days', value: 'month' },
];
const SORT_OPTIONS = [
  { label: 'Newest first', value: 'createdAt:desc' },
  { label: 'Oldest first', value: 'createdAt:asc' },
  { label: 'Title A-Z', value: 'title:asc' },
  { label: 'Type A-Z', value: 'type:asc' },
];

function relativeTime(value: unknown) {
  const millis = toMillis(value);
  if (!millis) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - millis) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isToday(notification: Notification) {
  const created = new Date(toMillis(notification.createdAt));
  return created.toDateString() === new Date().toDateString();
}

function inLastDays(notification: Notification, days: number) {
  const created = toMillis(notification.createdAt);
  return created > 0 && created >= Date.now() - days * 86400000;
}

function isActionRequired(notification: Notification) {
  return !notification.isRead && ['TASK_ASSIGNED', 'DISPATCH_APPROVED', 'DISPATCH_VERIFIED', 'PAYMENT_CONFIRMED'].includes(notification.type);
}

function setParam(params: URLSearchParams, key: string, value: string, defaultValue = 'All') {
  if (!value || value === defaultValue) params.delete(key);
  else params.set(key, value);
}

function compareNotifications(a: Notification, b: Notification, sort: string) {
  const [key, dir] = sort.split(':');
  let result = 0;
  if (key === 'createdAt') result = toMillis(a.createdAt) - toMillis(b.createdAt);
  else result = String((a as unknown as Record<string, unknown>)[key] || '').localeCompare(String((b as unknown as Record<string, unknown>)[key] || ''), undefined, { sensitivity: 'base' });
  return dir === 'desc' ? -result : result;
}

function typeLabel(type: string) {
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

export default function Notifications() {
  const { id } = useParams();
  if (id) return <NotificationDetail notificationId={id} />;
  return <NotificationList />;
}

function NotificationDetail({ notificationId }: { notificationId: string }) {
  const navigate = useNavigate();
  const { notification, isLoading, error, markAsRead, markAsUnread, deleteNotification } = useNotification(notificationId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (notification && !notification.isRead) void markAsRead();
  }, [markAsRead, notification]);

  return (
    <div className="space-y-5">
      <WorkspaceHero
        title={notification?.title || 'Notification Details'}
        subtitle={notification ? `${notification.id} · ${relativeTime(notification.createdAt)}` : 'Loading notification'}
        breadcrumbs={['Home', 'Notifications', notificationId]}
        actions={notification && (
          <>
            <Button variant="outline" onClick={() => navigate('/notifications')}>Back</Button>
            {notification.isRead ? (
              <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={() => void markAsUnread()}>Mark Unread</Button>
            ) : (
              <Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} onClick={() => void markAsRead()}>Mark Read</Button>
            )}
            <Button
              icon={<Eye className="h-4 w-4" />}
              onClick={() => navigate(getNotificationRoute(notification.entityType, notification.entityId, notification.projectId), { state: { entityId: notification.entityId } })}
            >
              Open Target
            </Button>
          </>
        )}
      />

      {error && <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">{notificationErrorMessage(error)}</div>}
      {isLoading && <Card><CardBody className="space-y-3">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="skeleton h-10" />)}</CardBody></Card>}
      {!isLoading && !notification && (
        <Card>
          <EmptyState icon={<Inbox className="h-9 w-9" />} title="Notification not found" description="It may have been deleted or you may not have access." action={<Button onClick={() => navigate('/notifications')}>Open Notifications</Button>} />
        </Card>
      )}

      {notification && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <div className="flex items-center gap-2">
                {statusBadge(notification.isRead ? 'Read' : 'Unread')}
                <Badge variant="info">{typeLabel(notification.type)}</Badge>
              </div>
            </CardHeader>
            <CardBody className="space-y-5">
              <p className="whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">{notification.body}</p>
              <div className="grid gap-4 md:grid-cols-3">
                <Detail label="Created By" value={notification.createdByName || notification.createdBy || 'System'} />
                <Detail label="Recipient" value={notification.recipientName || notification.recipientUserId || '-'} />
                <Detail label="Created Date" value={fmtDateTime(notification.createdAt as string | Date | null | undefined)} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Linked Entity</p>
                <button
                  className="mt-1 text-sm font-semibold text-[var(--color-primary)] hover:underline"
                  onClick={() => navigate(getNotificationRoute(notification.entityType, notification.entityId, notification.projectId), { state: { entityId: notification.entityId } })}
                >
                  {notification.entityType || 'Entity'} {notification.entityId || ''}
                </button>
              </div>
            </CardBody>
          </Card>

          <div className="flex justify-end">
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Delete</Button>
          </div>
          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => void deleteNotification().then(() => navigate('/notifications'))}
            title="Delete Notification"
            message={`Hide "${notification.title}" from notifications?`}
          />
        </>
      )}
    </div>
  );
}

function NotificationList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    lastSyncAt,
    markAsRead,
    markAsUnread,
    markAllRead,
    deleteNotification,
    bulkMarkRead,
  } = useNotifications();
  const [searchDraft, setSearchDraft] = useState(params.get('q') || '');
  const [page, setPage] = useState(Number(params.get('page') || 1));
  const [perPage, setPerPage] = useState(Number(params.get('perPage') || 10));
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Notification | null>(null);
  const [activeKpi, setActiveKpi] = useState<string | null>(null);

  const search = params.get('q') || '';
  const type = params.get('type') || 'All';
  const status = params.get('status') || 'All';
  const date = params.get('date') || 'all';
  const sort = params.get('sort') || 'createdAt:desc';

  // Compute active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (type !== 'All') count++;
    if (status !== 'All') count++;
    if (date !== 'all') count++;
    if (sort !== 'createdAt:desc') count++;
    if (activeKpi) count++;
    return count;
  }, [search, type, status, date, sort, activeKpi]);

  useEffect(() => {
    const nextParams = new URLSearchParams(location.search);
    const nextSearch = nextParams.get('q') || '';
    if (nextSearch !== searchDraft) setSearchDraft(nextSearch);
    const nextPage = Math.max(1, Number(nextParams.get('page') || 1));
    if (nextPage !== page) setPage(nextPage);
    const nextPerPage = Math.max(1, Number(nextParams.get('perPage') || 10));
    if (nextPerPage !== perPage) setPerPage(nextPerPage);
  }, [location.search]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if ((params.get('q') || '') === searchDraft.trim()) return;
      const next = new URLSearchParams(params);
      setParam(next, 'q', searchDraft.trim(), '');
      next.delete('page');
      setParams(next, { replace: true });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [params, searchDraft, setParams]);

  const typeOptions = useMemo(() => {
    const types = Array.from(new Set(notifications.map((notification) => notification.type).filter(Boolean))).sort();
    return ['All', ...types];
  }, [notifications]);

  const kpis = useMemo(() => ({
    total: notifications.length,
    unread: unreadCount,
    read: notifications.length - unreadCount,
    today: notifications.filter(isToday).length,
    actionRequired: notifications.filter(isActionRequired).length,
  }), [notifications, unreadCount]);

  // Total KPI active by default when no filters/search/KPI are set
  const isTotalDefault = useMemo(() => {
    return !activeKpi && !search && type === 'All' && status === 'All' && date === 'all';
  }, [activeKpi, search, type, status, date]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notifications.filter((notification) => {
      if (type !== 'All' && notification.type !== type) return false;

      // Handle KPI filters
      if (activeKpi === 'unread' && notification.isRead) return false;
      if (activeKpi === 'read' && !notification.isRead) return false;
      if (activeKpi === 'today' && !isToday(notification)) return false;
      if (activeKpi === 'actionRequired' && !isActionRequired(notification)) return false;

      // Handle legacy filter params
      if (!activeKpi || activeKpi === 'total') {
        if (status === 'Unread' && notification.isRead) return false;
        if (status === 'Read' && !notification.isRead) return false;
      }
      if (date === 'today' && !isToday(notification)) return false;
      if (date === 'week' && !inLastDays(notification, 7)) return false;
      if (date === 'month' && !inLastDays(notification, 30)) return false;
      if (!term) return true;
      return [notification.id, notification.title, notification.body, notification.type, notification.createdBy, notification.recipientUserId]
        .some((value) => String(value || '').toLowerCase().includes(term));
    }).sort((a, b) => compareNotifications(a, b, sort));
  }, [date, notifications, search, sort, status, type, activeKpi]);

  const paged = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage]);
  const allPageSelected = paged.length > 0 && paged.every((notification) => selected.includes(notification.id));

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / perPage));
    if (page > maxPage) setPage(maxPage);
  }, [filtered.length, page, perPage]);

  function updateFilter(key: string, value: string, defaultValue = 'All') {
    const next = new URLSearchParams(params);
    setParam(next, key, value, defaultValue);
    next.delete('page');
    setParams(next, { replace: true });
  }

  function handleKpiClick(kpiKey: string | null) {
    setActiveKpi((prev) => (prev === kpiKey ? null : kpiKey));
    setPage(1);

    // Clear legacy filter params when a KPI filter is active
    const next = new URLSearchParams(params);
    if (kpiKey && kpiKey !== 'total') {
      next.delete('status');
      next.delete('date');
    }
    if (kpiKey === 'unread') { next.delete('status'); }
    if (kpiKey === 'read') { next.delete('status'); }
    if (kpiKey === 'today') { next.delete('date'); }
    if (kpiKey === null || kpiKey === 'total') {
      next.delete('status');
      next.delete('date');
    }
    next.delete('page');
    setParams(next, { replace: true });
  }

  function clearAllFilters() {
    setSearchDraft('');
    setActiveKpi(null);
    setPage(1);
    setParams({}, { replace: true });
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    const next = new URLSearchParams(params);
    if (nextPage === 1) next.delete('page');
    else next.set('page', String(nextPage));
    setParams(next, { replace: true });
  }

  function changePerPage(nextPerPage: number) {
    setPerPage(nextPerPage);
    setPage(1);
    const next = new URLSearchParams(params);
    next.set('perPage', String(nextPerPage));
    next.delete('page');
    setParams(next, { replace: true });
  }

  function toggleSelected(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function togglePageSelected() {
    if (allPageSelected) {
      setSelected((current) => current.filter((id) => !paged.some((notification) => notification.id === id)));
      return;
    }
    setSelected((current) => Array.from(new Set([...current, ...paged.map((notification) => notification.id)])));
  }

  function navigateToTarget(notification: Notification) {
    void markAsRead(notification.id);
    navigate(getNotificationRoute(notification.entityType, notification.entityId, notification.projectId), { state: { entityId: notification.entityId, fromNotificationId: notification.id } });
  }

  return (
    <div className="space-y-6">
      {/* ── Premium Workspace Hero ─────────────────────────── */}
      <WorkspaceHero
        title="Notifications"
        icon={<Bell className="h-6 w-6" />}
        breadcrumbs={['Home', 'Notifications']}
        statusText={error
          ? 'Connection issue — notifications unavailable'
          : `Last sync ${lastSyncAt ? fmtDateTime(lastSyncAt) : 'pending'} · Realtime Connected`}
        statusDotColor={error ? 'var(--color-danger)' : 'var(--color-success)'}
        actions={
          <>
            {selected.length > 0 && (
              <Button variant="outline" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={() => void bulkMarkRead(selected).then(() => setSelected([]))}>
                Mark Selected Read
              </Button>
            )}
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={() => void markAllRead()}>
                Mark All Read
              </Button>
            )}
          </>
        }
      />

      {/* ── Premium Clickable KPI Cards ────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <PremiumKpi
          label="Total Notifications"
          value={kpis.total}
          icon={<Bell className="h-4 w-4" />}
          description={kpis.total > 0 ? `${kpis.unread} unread, ${kpis.read} read` : 'No notifications yet'}
          onClick={() => handleKpiClick('total')}
          active={activeKpi === 'total' || isTotalDefault}
        />
        <PremiumKpi
          label="Unread"
          value={kpis.unread}
          icon={<Inbox className="h-4 w-4" />}
          description={kpis.unread === 0 ? 'Everything is up to date' : 'Requires attention'}
          onClick={() => handleKpiClick('unread')}
          active={activeKpi === 'unread'}
        />
        <PremiumKpi
          label="Read"
          value={kpis.read}
          icon={<CheckCheck className="h-4 w-4" />}
          description={kpis.read > 0 ? `${Math.round((kpis.read / Math.max(kpis.total, 1)) * 100)}% completion rate` : 'No read notifications'}
          onClick={() => handleKpiClick('read')}
          active={activeKpi === 'read'}
        />
        <PremiumKpi
          label="Today"
          value={kpis.today}
          icon={<Bell className="h-4 w-4" />}
          description={`${kpis.today > 0 ? 'New today' : 'No new notifications today'}`}
          onClick={() => handleKpiClick('today')}
          active={activeKpi === 'today'}
        />
        <PremiumKpi
          label="Action Required"
          value={kpis.actionRequired}
          icon={<Eye className="h-4 w-4" />}
          description={kpis.actionRequired > 0 ? 'Needs immediate attention' : 'All clear'}
          onClick={() => handleKpiClick('actionRequired')}
          active={activeKpi === 'actionRequired'}
        />
      </div>

      {/* ── Premium Elevated Table Card ────────────────────── */}
      <Card className="shadow-[0_4px_24px_rgba(0,0,0,0.04)] border-[var(--color-border)]">
        <CardHeader className="px-6 pt-5 pb-3">
          <CardTitle>Notification Register</CardTitle>
          <div className="flex items-center gap-3">
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-1.5">
                {activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-light)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary-text)]">
                    {activeKpi === 'unread' ? 'Unread' : activeKpi === 'read' ? 'Read' : activeKpi === 'today' ? 'Today' : activeKpi === 'actionRequired' ? 'Action Required' : 'Total'}
                    <button type="button" onClick={() => handleKpiClick(activeKpi)} className="ml-0.5 hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                  </span>
                )}
                {search && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">Search: {search.slice(0, 20)}{search.length > 20 ? '…' : ''}</span>
                )}
                {type !== 'All' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{typeLabel(type)}</span>
                )}
                {status !== 'All' && !activeKpi && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">{status}</span>
                )}
              </div>
            )}
            {activeFilterCount > 0 && (
              <button type="button" onClick={clearAllFilters} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]">
                <X className="h-3 w-3" />
                Clear All
              </button>
            )}
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              Realtime
            </div>
          </div>
        </CardHeader>

        <CardBody className="px-6 pb-3 space-y-4">
          {error && (
            <div className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-light)] px-3 py-2 text-sm text-[var(--color-danger-text)]">
              {notificationErrorMessage(error)}
            </div>
          )}

          {/* ── Premium Filter Bar ──────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <Input
              aria-label="Search notifications"
              placeholder="Search notifications…"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              className="min-w-[200px] flex-1"
            />
            <Select
              aria-label="Type"
              value={type}
              options={typeOptions.map((value) => ({ label: value === 'All' ? value : typeLabel(value), value }))}
              onChange={(event) => updateFilter('type', event.target.value)}
              className="w-[150px]"
            />
            <Select
              aria-label="Status"
              value={status}
              options={STATUS_OPTIONS.map((value) => ({ label: value, value }))}
              onChange={(event) => updateFilter('status', event.target.value)}
              className="w-[130px]"
            />
            <Select
              aria-label="Date"
              value={date}
              options={DATE_OPTIONS}
              onChange={(event) => updateFilter('date', event.target.value, 'all')}
              className="w-[140px]"
            />
            <Select
              aria-label="Sort"
              value={sort}
              options={SORT_OPTIONS}
              onChange={(event) => updateFilter('sort', event.target.value, 'createdAt:desc')}
              className="w-[150px]"
            />
          </div>



          {/* ── Premium Universal Table ──────────────────────── */}
          <Table>
            <Thead>
              <Th style={{ width: 44, minWidth: 44, maxWidth: 44 }}>
                <UniversalCheckbox checked={allPageSelected} indeterminate={selected.length > 0 && !allPageSelected} onChange={togglePageSelected} ariaLabel="Select visible notifications" />
              </Th>
              <Th sortable sorted={sort.startsWith('title')} desc={sort === 'title:desc'} onSort={() => updateFilter('sort', sort === 'title:asc' ? 'title:desc' : 'title:asc', 'createdAt:desc')}>
                Notification
              </Th>
              <Th style={{ width: 110, minWidth: 110 }}>Type</Th>
              <Th style={{ width: 130, minWidth: 130 }}>Recipient</Th>
              <Th style={{ width: 90, minWidth: 90 }}>Status</Th>
              <Th
                sortable
                sorted={sort.startsWith('createdAt')}
                desc={sort === 'createdAt:desc'}
                onSort={() => updateFilter('sort', sort === 'createdAt:desc' ? 'createdAt:asc' : 'createdAt:desc', 'createdAt:desc')}
                style={{ width: 100, minWidth: 100 }}
              >
                Created
              </Th>
              <Th align="right" style={{ width: 120, minWidth: 120 }}>Actions</Th>
            </Thead>
            <Tbody>
              {isLoading && <SkeletonRows cols={7} rows={6} />}
              {!isLoading && paged.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState icon={<Inbox className="h-9 w-9" />} title="No notifications found" description={notifications.length ? 'Adjust filters or search to see more notifications.' : 'New ERP activity will appear here.'} />
                  </td>
                </tr>
              )}
              {!isLoading && paged.map((notification) => (
                <Tr
                  key={notification.id}
                  onClick={() => navigateToTarget(notification)}
                  className={notification.isRead ? '' : 'bg-[var(--color-bg-sunken)]/30'}
                >
                  {/* Checkbox */}
                  <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                    <UniversalCheckbox checked={selected.includes(notification.id)} onChange={() => toggleSelected(notification.id)} ariaLabel={`Select ${notification.title}`} />
                  </Td>

                  {/* Premium card-style Notification cell */}
                  <Td className="py-3 min-w-[280px]">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        {!notification.isRead && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]" />
                        )}
                        <span className="text-sm font-medium text-[var(--color-text)] truncate">
                          {notification.title}
                        </span>
                      </div>
                      <span className="text-[13px] leading-snug text-[var(--color-text-tertiary)] line-clamp-1 max-w-[420px]">
                        {notification.body}
                      </span>
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {(notification.createdByName || notification.createdBy || 'System')} · {notification.id?.slice(-8) || ''}
                      </span>
                    </div>
                  </Td>

                  {/* Type */}
                  <Td className="py-3">
                    <Badge variant="info">{typeLabel(notification.type)}</Badge>
                  </Td>

                  {/* Recipient */}
                  <Td className="py-3 text-[13px] text-[var(--color-text-secondary)]">
                    {notification.recipientName || notification.recipientUserId || '-'}
                  </Td>

                  {/* Status */}
                  <Td className="py-3">
                    {statusBadge(notification.isRead ? 'Read' : 'Unread')}
                  </Td>

                  {/* Created (relative time) */}
                  <Td className="py-3 text-[13px] text-[var(--color-text-muted)] whitespace-nowrap">
                    {relativeTime(notification.createdAt)}
                  </Td>

                  {/* Actions: Open + OverflowMenu */}
                  <Td className="py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        icon={<Eye className="h-3 w-3" />}
                        onClick={() => navigateToTarget(notification)}
                        className="shrink-0"
                      >
                        Open
                      </Button>
                      <OverflowMenu
                        items={[
                          ...(notification.isRead
                            ? [{ label: 'Mark Unread', icon: <Undo2 className="h-3.5 w-3.5" />, onClick: () => void markAsUnread(notification.id) }]
                            : [{ label: 'Mark Read', icon: <CheckCheck className="h-3.5 w-3.5" />, onClick: () => void markAsRead(notification.id) }]
                          ),
                          { label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, onClick: () => setDeleteTarget(notification), variant: 'danger' as const },
                        ]}
                      />
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardBody>

        <Pagination page={page} total={filtered.length} perPage={perPage} onChange={changePage} onPerPageChange={changePerPage} />
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void deleteNotification(deleteTarget.id).then(() => setDeleteTarget(null));
        }}
        title="Delete Notification"
        message={`Hide "${deleteTarget?.title || 'this notification'}" from notifications?`}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  );
}
