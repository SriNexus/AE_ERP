import { useMemo } from 'react';

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value && 'seconds' in value) return new Date(Number(value.seconds) * 1000);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isCurrentMonth(value: unknown) {
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

type KPIValue = string | number | boolean | Date | null | undefined | { seconds?: number; toDate?: () => Date };

type KPIConfig<T extends object> = {
  statusField: keyof T;
  statuses: readonly string[];
  revenueField?: keyof T;
  dateField?: keyof T;
};

function keyForStatus(status: string) {
  return status
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

function getKPIValue<T extends object>(row: T, field: keyof T): KPIValue {
  return row[field] as KPIValue;
}

export function useKPIStats<T extends object>(rows: readonly T[], config: KPIConfig<T>) {
  return useMemo(() => {
    const byStatus = config.statuses.reduce((acc, status) => {
      acc[keyForStatus(status)] = rows.filter((row) => getKPIValue(row, config.statusField) === status).length;
      return acc;
    }, {} as { [key: string]: number });

    const revenueMTD = config.revenueField && config.dateField
      ? rows
        .filter((row) => isCurrentMonth(getKPIValue(row, config.dateField as keyof T)))
        .reduce((sum, row) => sum + (Number(getKPIValue(row, config.revenueField as keyof T)) || 0), 0)
      : 0;

    return {
      total: rows.length,
      byStatus,
      revenueMTD,
    };
  }, [rows, config.statusField, config.statuses, config.revenueField, config.dateField]);
}
