import { useMemo, useState } from 'react';
import { addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../../utils/cn';

export interface ScheduleCalendarEvent {
  id: string;
  title: string;
  date: string | Date;
  description?: string;
  color?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'gray' | 'orange' | 'teal' | 'pink';
}

export interface CalendarDayCell {
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: ScheduleCalendarEvent[];
}

export interface ScheduleCalendarState {
  monthLabel: string;
  days: CalendarDayCell[][];
}

export function buildScheduleCalendarState(viewDate: Date, events: ScheduleCalendarEvent[] = []): ScheduleCalendarState {
  const start = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 0 });
  const days: CalendarDayCell[][] = [];
  const current = new Date(start);
  const normalizedEvents = events.map((event) => ({
    ...event,
    date: event.date instanceof Date ? event.date : new Date(event.date),
  }));

  while (current <= end) {
    const week: CalendarDayCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(current);
      week.push({
        date,
        inCurrentMonth: isSameMonth(date, viewDate),
        isToday: isToday(date),
        events: normalizedEvents.filter((event) => isSameDay(event.date, date)),
      });
      current.setDate(current.getDate() + 1);
    }
    days.push(week);
  }

  return {
    monthLabel: format(viewDate, 'MMMM yyyy'),
    days,
  };
}

export interface ScheduleCalendarProps {
  events?: ScheduleCalendarEvent[];
  value?: Date;
  selectedDate?: Date | null;
  title?: string;
  className?: string;
  readOnly?: boolean;
  onChange?: (date: Date) => void;
  onMonthChange?: (month: Date) => void;
  onEventClick?: (event: ScheduleCalendarEvent) => void;
}

export function ScheduleCalendar({
  events = [],
  value = new Date(),
  selectedDate,
  title = 'Schedule Calendar',
  className,
  readOnly = false,
  onChange,
  onMonthChange,
  onEventClick,
}: ScheduleCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(value));
  const calendar = useMemo(() => buildScheduleCalendarState(currentMonth, events), [currentMonth, events]);

  function updateMonth(nextMonth: Date) {
    setCurrentMonth(startOfMonth(nextMonth));
    onMonthChange?.(startOfMonth(nextMonth));
  }

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Card className={cn('p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{calendar.monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<ChevronLeft className="h-3.5 w-3.5" />}
            onClick={() => updateMonth(subMonths(currentMonth, 1))}
          >
            Prev
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<ChevronRight className="h-3.5 w-3.5" />}
            onClick={() => updateMonth(addMonths(currentMonth, 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-2 text-center text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {weekdayLabels.map((label) => (
          <div key={label} className="py-1">{label}</div>
        ))}
      </div>

      <div className="mt-2 space-y-2">
        {calendar.days.map((week, index) => (
          <div key={`${calendar.monthLabel}-${index}`} className="grid grid-cols-7 gap-2">
            {week.map((day) => (
              <div
                key={day.date.toISOString()}
                role={readOnly ? undefined : 'button'}
                tabIndex={readOnly ? -1 : 0}
                onClick={() => !readOnly && onChange?.(day.date)}
                onKeyDown={(event) => {
                  if (readOnly) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onChange?.(day.date);
                  }
                }}
                className={cn(
                  'min-h-24 rounded-2xl border p-2 text-left transition',
                  day.inCurrentMonth
                    ? 'border-[var(--color-border)] bg-[var(--color-surface)]'
                    : 'border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)]/70 text-[var(--color-text-disabled)]',                  day.isToday && 'ring-2 ring-[var(--color-primary)]',
                  selectedDate && isSameDay(day.date, selectedDate) && 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary-light)]'
                )}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-xs font-semibold', day.inCurrentMonth ? 'text-[var(--color-text)]' : 'text-[var(--color-text-disabled)]')}>
                    {format(day.date, 'd')}
                  </span>
                  {day.events.length > 0 && <Badge variant="info">{day.events.length}</Badge>}
                </div>
                <div className="mt-2 space-y-1">
                  {day.events.slice(0, 2).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={(eventClick) => {
                        eventClick.stopPropagation();
                        onEventClick?.(event);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] font-medium',
                        'bg-[var(--color-primary-light)] text-[var(--color-primary-text)]'
                      )}
                    >
                      <CalendarDays className="h-3 w-3 shrink-0" />
                      <span className="truncate">{event.title}</span>
                    </button>
                  ))}
                  {day.events.length > 2 && (
                    <p className="text-[11px] text-[var(--color-text-muted)]">+{day.events.length - 2} more</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
