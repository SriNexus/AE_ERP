import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useSettingsSection, useSaveSettings, useResetSettings } from '../../../features/settings/hooks/useSettingsSection';
import { DEFAULT_GENERAL_SETTINGS } from '../../../features/settings/defaults';
import type { GeneralSettings } from '../../../features/settings/types';
import { validateGeneralSettings } from '../../../features/settings/validation';
import { canEditSection } from '../../../features/settings/permissions';
import { useUnsavedChangesGuard } from '../../../features/settings/hooks/useUnsavedChangesGuard';
import { formatGeneralDate, formatGeneralNumber } from '../../../features/settings/generalRuntime';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Input';

const options = (items: string[]) => items.map((value) => ({ value, label: value }));
export function GeneralSettingsSection() {
  const query = useSettingsSection('general');
  const save = useSaveSettings();
  const reset = useResetSettings();
  const [form, setForm] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  useEffect(() => { if (query.data && Object.keys(query.data).length) setForm({ ...DEFAULT_GENERAL_SETTINGS, ...query.data } as GeneralSettings); }, [query.data]);
  const confirmed = useMemo(() => ({ ...DEFAULT_GENERAL_SETTINGS, ...(query.data || {}) } as GeneralSettings), [query.data]);
  const dirty = JSON.stringify(form) !== JSON.stringify(confirmed);
  useUnsavedChangesGuard(dirty);
  const validation = validateGeneralSettings(form as unknown as Record<string, unknown>);
  const editable = canEditSection('general');
  const set = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => setForm((old) => ({ ...old, [key]: value }));
  if (query.isLoading) return <div className="space-y-4 animate-pulse"><div className="h-28 rounded-xl bg-[var(--color-bg-sunken)]" /><div className="h-52 rounded-xl bg-[var(--color-bg-sunken)]" /></div>;
  if (query.isError) return <div className="rounded-xl border border-[var(--color-danger)] p-5"><p className="text-sm text-[var(--color-danger)]">General settings could not be loaded.</p><Button className="mt-3" variant="outline" onClick={() => query.refetch()}>Retry</Button></div>;
  return <SettingsSection title="General" description="Company-wide language, timezone and formatting defaults.">
    <SettingsCard title="Regional defaults" description="These values apply consistently to everyone in this company.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Language" value={form.language} disabled={!editable} onChange={(e) => set('language', e.target.value)} error={validation.errors.language} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' }, { value: 'gu', label: 'Gujarati' }]} />
        <Select label="Timezone" value={form.timezone} disabled={!editable} onChange={(e) => set('timezone', e.target.value)} error={validation.errors.timezone} options={options(['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York'])} />
        <Select label="Date format" value={form.dateFormat} disabled={!editable} onChange={(e) => set('dateFormat', e.target.value)} error={validation.errors.dateFormat} options={options(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])} />
        <Select label="Number format" value={form.numberFormat} disabled={!editable} onChange={(e) => set('numberFormat', e.target.value)} error={validation.errors.numberFormat} options={options(['en-IN', 'en-US', 'en-GB'])} />
        <Select label="First day of week" value={String(form.firstDayOfWeek)} disabled={!editable} onChange={(e) => set('firstDayOfWeek', Number(e.target.value))} error={validation.errors.firstDayOfWeek} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }, { value: '6', label: 'Saturday' }]} />
      </div>
      <div className="mt-5 rounded-lg bg-[var(--color-bg-sunken)] p-4 text-sm"><p className="font-semibold">Preview</p><p className="mt-1 text-[var(--color-text-secondary)]">Date: {formatGeneralDate(new Date('2026-07-12T12:00:00Z'), form)} · Number: {formatGeneralNumber(1234567.89, form)}</p></div>
    </SettingsCard>
    {!editable && <p className="text-xs text-[var(--color-text-muted)]">You can view these company defaults. An administrator is required to change them.</p>}
    {editable && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} loading={reset.isPending} onClick={async () => { await reset.mutateAsync('general'); setForm(DEFAULT_GENERAL_SETTINGS); }}>Reset</Button><Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty || !validation.valid} onClick={() => save.mutateAsync({ section: 'general', data: form as unknown as Record<string, unknown> })}>Save changes</Button></div>}
  </SettingsSection>;
}
