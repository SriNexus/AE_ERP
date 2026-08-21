import { type FormEvent } from 'react';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { INDIAN_STATES } from '../../../config/company';
import type { WarehouseForm as WarehouseFormValues, WarehouseForm } from '../types';
import { WAREHOUSE_STATUS_OPTIONS } from '../types';

const STATE_OPTS = [{ label: 'Select State', value: '' }, ...INDIAN_STATES.map(s => ({ label: s, value: s }))];

interface Props {
  form:     WarehouseFormValues;
  onChange: (f: WarehouseFormValues) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  loading:  boolean;
  isEdit:   boolean;
}

export function WarehouseFormComponent({ form, onChange, onSubmit, onCancel, loading, isEdit }: Props) {
  const set = (key: keyof WarehouseForm, val: string) => onChange({ ...form, [key]: val });

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <FormSection title="Basic Info">
        <FormRow>
          <Input label="Warehouse Name" required value={form.name} onChange={e => set('name', e.target.value)} />
          <Input label="Code" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="e.g. WH-MUM-01" />
        </FormRow>
        <Input label="Capacity" value={form.capacity} onChange={e => set('capacity', e.target.value)} placeholder="e.g. 5000 sq ft" />
        <Select label="Status" value={form.status} onChange={e => set('status', e.target.value)} options={WAREHOUSE_STATUS_OPTIONS} />
      </FormSection>

      <FormSection title="Address">
        <Textarea label="Address" value={form.address} onChange={e => set('address', e.target.value)} rows={2} />
        <FormRow cols={3}>
          <Input label="City" value={form.city} onChange={e => set('city', e.target.value)} />
          <Select label="State" value={form.state} onChange={e => set('state', e.target.value)} options={STATE_OPTS} />
          <Input label="Pincode" value={form.pincode} onChange={e => set('pincode', e.target.value)} />
        </FormRow>
      </FormSection>

      <FormSection title="Manager">
        <FormRow>
          <Input label="Manager Name" value={form.managerName} onChange={e => set('managerName', e.target.value)} />
          <Input label="Manager Phone" value={form.managerPhone} onChange={e => set('managerPhone', e.target.value)} />
        </FormRow>
      </FormSection>

      <FormSection title="Geo-Fence / Attendance Location">
        <p className="text-xs text-[var(--color-text-muted)] mb-2">
          Configure GPS coordinates for geo-fenced attendance check-in/check-out. Employees assigned to this warehouse will use these coordinates as their attendance location.
        </p>
        <FormRow>
          <Input
            label="Latitude"
            value={form.latitude}
            onChange={e => set('latitude', e.target.value)}
            placeholder="e.g. 18.5204"
            inputMode="decimal"
          />
          <Input
            label="Longitude"
            value={form.longitude}
            onChange={e => set('longitude', e.target.value)}
            placeholder="e.g. 73.8567"
            inputMode="decimal"
          />
        </FormRow>
        <Input
          label="Geofence Radius (meters)"
          value={form.geofenceRadiusMeters}
          onChange={e => set('geofenceRadiusMeters', e.target.value)}
          placeholder="e.g. 200"
          inputMode="decimal"
        />
      </FormSection>

      <Textarea label="Notes" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />

      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading}>{isEdit ? 'Update' : 'Add Warehouse'}</Button>
      </div>
    </form>
  );
}
