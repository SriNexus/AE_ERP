import { DEFAULT_GENERAL_SETTINGS } from './defaults';
import type { GeneralSettings } from './types';

let current: GeneralSettings = { ...DEFAULT_GENERAL_SETTINGS };
export function setGeneralSettingsRuntime(settings?: Partial<GeneralSettings>) { current = { ...DEFAULT_GENERAL_SETTINGS, ...settings }; }
export function getGeneralSettingsRuntime(): GeneralSettings { return current; }

const DATE_PARTS: Record<string, Intl.DateTimeFormatOptions> = {
  'DD/MM/YYYY': { day: '2-digit', month: '2-digit', year: 'numeric' },
  'MM/DD/YYYY': { month: '2-digit', day: '2-digit', year: 'numeric' },
  'YYYY-MM-DD': { year: 'numeric', month: '2-digit', day: '2-digit' },
};

export function formatGeneralDate(value: string | Date, settings = current): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', { ...DATE_PARTS[settings.dateFormat], timeZone: settings.timezone }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (settings.dateFormat === 'MM/DD/YYYY') return `${map.month}/${map.day}/${map.year}`;
  if (settings.dateFormat === 'YYYY-MM-DD') return `${map.year}-${map.month}-${map.day}`;
  return `${map.day}/${map.month}/${map.year}`;
}

export function formatGeneralNumber(value: number, settings = current): string {
  return new Intl.NumberFormat(settings.numberFormat, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

export function nowInGeneralTimezone(settings = current): Date {
  const localized = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const p = Object.fromEntries(localized.map((part) => [part.type, part.value]));
  return new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);
}
