/**
 * AttendanceSettingsSection — GPS check-in policy, shift timing & rules.
 *
 * Production fix (docs/audits/GEO_ATTENDANCE_CURRENT_STATE_AUDIT.md
 * Finding F3): the 'attendance' Settings section previously had a
 * registered id, a full schema (AttendanceSettings), and defaults, but no
 * renderer — it fell through to SettingsPlaceholder and no admin could
 * ever change a single value in it. Follows the same pattern as
 * GeneralSettingsSection.tsx (the closest existing precedent for a
 * typed-numeric-fields settings form): useSettingsSection/useSaveSettings/
 * useResetSettings, local form state synced from the query, dirty
 * tracking, unsaved-changes guard, validation-gated save.
 */
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useSettingsSection, useSaveSettings, useResetSettings } from '../../../features/settings/hooks/useSettingsSection';
import { DEFAULT_ATTENDANCE_SETTINGS } from '../../../features/settings/defaults';
import type { AttendanceSettings } from '../../../features/attendance/types';
import { validateAttendanceSettings } from '../../../features/settings/validation';
import { canEditSection } from '../../../features/settings/permissions';
import { useUnsavedChangesGuard } from '../../../features/settings/hooks/useUnsavedChangesGuard';
import { SettingsSection } from '../SettingsSection';
import { SettingsCard } from '../SettingsCard';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

/** Numeric input bound to one field of the settings form, with error display. */
function NumberField({
  label, hint, value, min, editable, error, onChange,
}: {
  label: string; hint?: string; value: number; min?: number; editable: boolean; error?: string;
  onChange: (v: number) => void;
}) {
  return (
    <Input
      label={label}
      hint={!error ? hint : undefined}
      error={error}
      type="number"
      min={min}
      disabled={!editable}
      value={Number.isFinite(value) ? String(value) : ''}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function AttendanceSettingsSection() {
  const query = useSettingsSection('attendance');
  const save = useSaveSettings();
  const reset = useResetSettings();
  const [form, setForm] = useState<AttendanceSettings>(DEFAULT_ATTENDANCE_SETTINGS);

  useEffect(() => {
    if (query.data && Object.keys(query.data).length) {
      setForm({ ...DEFAULT_ATTENDANCE_SETTINGS, ...query.data } as AttendanceSettings);
    }
  }, [query.data]);

  const confirmed = useMemo(
    () => ({ ...DEFAULT_ATTENDANCE_SETTINGS, ...(query.data || {}) } as AttendanceSettings),
    [query.data],
  );
  const dirty = JSON.stringify(form) !== JSON.stringify(confirmed);
  useUnsavedChangesGuard(dirty);

  const validation = validateAttendanceSettings(form as unknown as Record<string, unknown>);
  const editable = canEditSection('attendance');

  const set = <K extends keyof AttendanceSettings>(key: K, value: AttendanceSettings[K]) =>
    setForm((old) => ({ ...old, [key]: value }));

  if (query.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-xl bg-[var(--color-bg-sunken)]" />
        <div className="h-52 rounded-xl bg-[var(--color-bg-sunken)]" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-xl border border-[var(--color-danger)] p-5">
        <p className="text-sm text-[var(--color-danger)]">Attendance settings could not be loaded.</p>
        <Button className="mt-3" variant="outline" onClick={() => query.refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <SettingsSection title="Attendance" description="GPS check-in policy, shift timing & rules — applies to every self-service geo-attendance check-in/check-out in this company.">
      <SettingsCard
        title="Geo-Fence Defaults"
        description="Default Geofence Radius pre-fills new Warehouse/Company location forms — it is a convenience, not a fallback: every location's own radius is still required for that location to be usable."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label="Default Geofence Radius"
            hint="Metres. Pre-fills new Warehouse/Company forms."
            min={1}
            value={form.geofenceRadiusDefaultMeters}
            editable={editable}
            error={validation.errors.geofenceRadiusDefaultMeters}
            onChange={(v) => set('geofenceRadiusDefaultMeters', v)}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="GPS Accuracy"
        description="Real mobile GPS is noisy — these two numbers decide how much uncertainty the attendance decision tolerates, not a single strict cutoff."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label="Target (Good) Accuracy"
            hint="Metres. The GPS retry loop aims for this and stops early once reached."
            min={1}
            value={form.gpsAccuracyThresholdMeters}
            editable={editable}
            error={validation.errors.gpsAccuracyThresholdMeters}
            onChange={(v) => set('gpsAccuracyThresholdMeters', v)}
          />
          <NumberField
            label="Maximum Acceptable Accuracy"
            hint="Metres. A reading worse than this is rejected outright, regardless of distance."
            min={1}
            value={form.gpsAccuracyCeilingMeters}
            editable={editable}
            error={validation.errors.gpsAccuracyCeilingMeters}
            onChange={(v) => set('gpsAccuracyCeilingMeters', v)}
          />
        </div>
        <div className="mt-5 rounded-lg bg-[var(--color-bg-sunken)] p-4 text-xs text-[var(--color-text-secondary)]">
          <p className="font-semibold text-[var(--color-text)]">How this is used</p>
          <p className="mt-1">
            Below the Maximum, GPS accuracy is folded into the geofence decision as uncertainty (distance vs. radius + accuracy),
            not checked as a second independent pass/fail gate — an employee standing well within the fence is no longer rejected
            purely for having a noisy GPS chip.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Location Consistency"
        description="Rejects check-ins where the device's own GPS readings disagreed with each other by more than this during capture (a jittery/spoofed signal, distinct from a single stable-but-imprecise reading)."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label="Maximum Reading Spread"
            hint="Metres, across all readings collected during one check-in attempt."
            min={1}
            value={form.locationConsistencyMaxSpreadMeters}
            editable={editable}
            error={validation.errors.locationConsistencyMaxSpreadMeters}
            onChange={(v) => set('locationConsistencyMaxSpreadMeters', v)}
          />
          <NumberField
            label="Stale Location Max Age"
            hint="Seconds. A captured reading older than this by submit time is rejected."
            min={1}
            value={form.staleLocationMaxAgeSeconds}
            editable={editable}
            error={validation.errors.staleLocationMaxAgeSeconds}
            onChange={(v) => set('staleLocationMaxAgeSeconds', v)}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Shift & Policy" description="Company-default shift window used to compute Late/Half-Day/Early-Exit status at checkout.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Shift Start Time"
            type="time"
            disabled={!editable}
            value={form.shiftStartTime}
            error={validation.errors.shiftStartTime}
            onChange={(e) => set('shiftStartTime', e.target.value)}
          />
          <Input
            label="Shift End Time"
            type="time"
            disabled={!editable}
            value={form.shiftEndTime}
            error={validation.errors.shiftEndTime}
            onChange={(e) => set('shiftEndTime', e.target.value)}
          />
          <NumberField
            label="Grace Period"
            hint="Minutes after shift start before marked Late."
            min={0}
            value={form.gracePeriodMinutes}
            editable={editable}
            error={validation.errors.gracePeriodMinutes}
            onChange={(v) => set('gracePeriodMinutes', v)}
          />
          <NumberField
            label="Half-Day Threshold"
            hint="Hours. Worked time below this (but above 0) is marked Half-Day."
            min={0.5}
            value={form.halfDayThresholdHours}
            editable={editable}
            error={validation.errors.halfDayThresholdHours}
            onChange={(v) => set('halfDayThresholdHours', v)}
          />
        </div>
      </SettingsCard>

      {!editable && (
        <p className="text-xs text-[var(--color-text-muted)]">
          You can view these company-wide attendance defaults. An administrator is required to change them.
        </p>
      )}
      {editable && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            icon={<RotateCcw className="h-4 w-4" />}
            loading={reset.isPending}
            onClick={async () => { await reset.mutateAsync('attendance'); setForm(DEFAULT_ATTENDANCE_SETTINGS); }}
          >
            Reset
          </Button>
          <Button
            icon={<Save className="h-4 w-4" />}
            loading={save.isPending}
            disabled={!dirty || !validation.valid}
            onClick={() => save.mutateAsync({ section: 'attendance', data: form as unknown as Record<string, unknown> })}
          >
            Save changes
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

export default AttendanceSettingsSection;
