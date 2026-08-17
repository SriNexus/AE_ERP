import { useMemo, useState } from 'react';
import {
  addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format,
  isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek, subDays, subMonths, subWeeks,
} from 'date-fns';
import {
  CalendarDays, ChevronLeft, ChevronRight, LayoutDashboard, List, Search,
} from 'lucide-react';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Input';
import { cn } from '../../utils/cn';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string | Date;
  description?: string;
  status?: string;
  assignee?: string;
  projectId?: string;
  color?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'orange' | 'teal';
}

type ViewMode = 'month' | 'week' | 'day' | 'agenda';

interface CalendarModalProps {
  open: boolean;
  onClose: () => void;
  events: CalendarEvent[];
  title: string;
  statusOptions?: { label: string; value: string }[];
  assigneeOptions?: { label: string; value: string }[];
  onEventClick?: (event: CalendarEvent) => void;
  onCreateEvent?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-blue-500',
  InProgress: 'bg-amber-500',
  Completed: 'bg-emerald-500',
  Rejected: 'bg-red-500',
  Draft: 'bg-slate-400',
  InReview: 'bg-purple-500',
  Approved: 'bg-emerald-500',
  Revised: 'bg-orange-500',
  Cancelled: 'bg-red-400',
};

export function CalendarModal({
  open,
  onClose,
  events,
  title,
  statusOptions = [],
  assigneeOptions = [],
  onEventClick,
  onCreateEvent,
}: CalendarModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || event.title.toLowerCase().includes(q) || (event.description?.toLowerCase().includes(q));
      const matchesStatus = !statusFilter || event.status === statusFilter;
      const matchesAssignee = !assigneeFilter || event.assignee === assigneeFilter;
      return matchesSearch && matchesStatus && matchesAssignee;
    });
  }, [events, searchQuery, statusFilter, assigneeFilter]);

  const navigateBack = () => {
    if (viewMode === 'month') setCurrentDate((d) => subMonths(d, 1));
    else if (viewMode === 'week') setCurrentDate((d) => subWeeks(d, 1));
    else if (viewMode === 'day') setCurrentDate((d) => subDays(d, 1));
  };

  const navigateForward = () => {
    if (viewMode === 'month') setCurrentDate((d) => addMonths(d, 1));
    else if (viewMode === 'week') setCurrentDate((d) => addWeeks(d, 1));
    else if (viewMode === 'day') setCurrentDate((d) => addDays(d, 1));
  };

  const goToToday = () => setCurrentDate(new Date());

  const headerLabel = useMemo(() => {
    if (viewMode === 'month') return format(currentDate, 'MMMM yyyy');
    if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
    }
    return format(currentDate, 'EEEE, MMMM d, yyyy');
  }, [currentDate, viewMode]);

  // Month view
  const monthDays = useMemo(() => {
    if (viewMode !== 'month') return [];
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    const days: { date: Date; inMonth: boolean; isToday: boolean; events: CalendarEvent[] }[] = [];
    const current = new Date(start);
    while (current <= end) {
      const date = new Date(current);
      days.push({
        date,
        inMonth: isSameMonth(date, currentDate),
        isToday: isToday(date),
        events: filteredEvents.filter((e) => isSameDay(new Date(e.date), date)),
      });
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [currentDate, viewMode, filteredEvents]);

  // Week view
  const weekDays = useMemo(() => {
    if (viewMode !== 'week') return [];
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const days: { date: Date; isToday: boolean; events: CalendarEvent[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      days.push({
        date,
        isToday: isToday(date),
        events: filteredEvents.filter((e) => isSameDay(new Date(e.date), date)),
      });
    }
    return days;
  }, [currentDate, viewMode, filteredEvents]);

  // Day view events
  const dayEvents = useMemo(() => {
    if (viewMode !== 'day') return [];
    return filteredEvents.filter((e) => isSameDay(new Date(e.date), currentDate));
  }, [currentDate, viewMode, filteredEvents]);

  // Agenda view
  const agendaEvents = useMemo(() => {
    if (viewMode !== 'agenda') return [];
    return [...filteredEvents].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [filteredEvents, viewMode]);

  const weekdayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (      <Modal open={open} onClose={onClose} title={title} size="xl">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-6 py-3">
        {/* View switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
          {(['month', 'week', 'day', 'agenda'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                viewMode === mode
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              {mode === 'month' && <LayoutDashboard className="h-3 w-3" />}
              {mode === 'week' && <CalendarDays className="h-3 w-3" />}
              {mode === 'day' && <CalendarDays className="h-3 w-3" />}
              {mode === 'agenda' && <List className="h-3 w-3" />}
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToToday}>Today</Button>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={navigateBack} />
            <span className="min-w-[160px] text-center text-sm font-semibold text-[var(--color-text)]">{headerLabel}</span>
            <Button variant="outline" size="sm" icon={<ChevronRight className="h-3.5 w-3.5" />} onClick={navigateForward} />
          </div>
        </div>

        {/* Create button */}
        {onCreateEvent && (
          <Button size="sm" onClick={onCreateEvent}>Create Event</Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border-subtle)] px-6 py-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            className="h-8 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {statusOptions.length > 1 && (
          <Select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} options={statusOptions} className="h-8 min-w-[120px]" />
        )}
        {assigneeOptions.length > 1 && (
          <Select value={assigneeFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAssigneeFilter(e.target.value)} options={assigneeOptions} className="h-8 min-w-[120px]" />
        )}
        {(searchQuery || statusFilter || assigneeFilter) && (
          <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setAssigneeFilter(''); }} className="text-xs font-medium text-[var(--color-primary-text)] hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      <div className="min-h-[400px] overflow-auto p-6">
        {/* Month View */}
        {viewMode === 'month' && (
          <div>
            <div className="grid grid-cols-7 gap-px rounded-lg border border-[var(--color-border-subtle)] overflow-hidden">
              {weekdayHeaders.map((day) => (
                <div key={day} className="bg-[var(--color-bg-sunken)] px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {day}
                </div>
              ))}
              {monthDays.map((day, i) => (
                <div
                  key={i}
                  className={cn(
                    'min-h-[90px] border-b border-r border-[var(--color-border-subtle)] p-1.5 transition-colors',
                    day.inMonth ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-bg-sunken)]/50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                      day.isToday && 'bg-[var(--color-primary)] text-white',
                      !day.isToday && day.inMonth && 'text-[var(--color-text)]',
                      !day.inMonth && 'text-[var(--color-text-disabled)]',
                    )}>
                      {format(day.date, 'd')}
                    </span>
                    {day.events.length > 0 && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">{day.events.length}</span>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {day.events.slice(0, 2).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onEventClick?.(event)}
                        className={cn(
                          'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] font-medium transition-colors hover:opacity-80',
                          event.color === 'success' || event.status === 'Completed' || event.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : event.status === 'Rejected' || event.status === 'Cancelled'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : event.status === 'InProgress'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_COLORS[event.status || ''] || 'bg-blue-500')} />
                        <span className="truncate">{event.title}</span>
                      </button>
                    ))}
                    {day.events.length > 2 && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">+{day.events.length - 2} more</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Week View */}
        {viewMode === 'week' && (
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day, i) => (
              <div key={i} className="flex flex-col rounded-lg border border-[var(--color-border-subtle)]">
                <div className={cn(
                  'border-b border-[var(--color-border-subtle)] px-2 py-2 text-center',
                  day.isToday && 'bg-[var(--color-primary-light)]',
                )}>
                  <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">{format(day.date, 'EEE')}</p>
                  <p className={cn('text-lg font-bold', day.isToday ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text)]')}>
                    {format(day.date, 'd')}
                  </p>
                </div>
                <div className="flex flex-col gap-1 p-1.5 min-h-[120px]">
                  {day.events.length === 0 && (
                    <p className="text-[10px] text-[var(--color-text-disabled)] p-1">No events</p>
                  )}
                  {day.events.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onEventClick?.(event)}
                      className={cn(
                        'rounded px-1.5 py-1 text-left text-[10px] font-medium transition-colors hover:opacity-80',
                        'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]',
                      )}
                    >
                      <span className="truncate block">{event.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Day View */}
        {viewMode === 'day' && (
          <div>
            <div className="mb-3">
              <h3 className="text-lg font-semibold text-[var(--color-text)]">{format(currentDate, 'EEEE, MMMM d, yyyy')}</h3>
            </div>
            <div className="space-y-2">
              {dayEvents.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]">
                  <CalendarDays className="mb-2 h-8 w-8" />
                  <p className="text-sm">No events scheduled for this day</p>
                </div>
              )}
              {dayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onEventClick?.(event)}
                  className="flex w-full items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] p-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <span className={cn('h-3 w-3 shrink-0 rounded-full', STATUS_COLORS[event.status || ''] || 'bg-blue-500')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{event.title}</p>
                    {event.description && (
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)] truncate">{event.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {event.status && <Badge variant="info">{event.status}</Badge>}
                    <span className="text-xs text-[var(--color-text-muted)]">{format(new Date(event.date), 'h:mm a')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agenda View */}
        {viewMode === 'agenda' && (
          <div className="space-y-6">
            {agendaEvents.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]">
                <List className="mb-2 h-8 w-8" />
                <p className="text-sm">No events found</p>
              </div>
            )}
            {(() => {
              const grouped: Record<string, CalendarEvent[]> = {};
              agendaEvents.forEach((event) => {
                const key = format(new Date(event.date), 'yyyy-MM-dd');
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(event);
              });
              return Object.entries(grouped).map(([dateKey, dateEvents]) => (
                <div key={dateKey}>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {format(new Date(dateKey), 'EEEE, MMMM d, yyyy')}
                    {isSameDay(new Date(dateKey), new Date()) && <span className="ml-2 text-[var(--color-primary-text)]">• Today</span>}
                  </h4>
                  <div className="space-y-1">
                    {dateEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onEventClick?.(event)}
                        className="flex w-full items-center gap-3 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_COLORS[event.status || ''] || 'bg-blue-500')} />
                        <span className="flex-1 text-sm font-medium text-[var(--color-text)] min-w-0 truncate">{event.title}</span>
                        {event.status && <Badge variant="info">{event.status}</Badge>}
                        {event.assignee && <span className="text-xs text-[var(--color-text-muted)]">{event.assignee}</span>}
                        <span className="text-xs text-[var(--color-text-muted)]">{format(new Date(event.date), 'h:mm a')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </Modal>
  );
}
