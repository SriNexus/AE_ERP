import type React from 'react';
import { Button, Input, Textarea } from '../../../components/ui';
import type { VendorFormValues } from '../types';

export function VendorForm({ value, onChange, onSubmit, onCancel, saving }: { value: VendorFormValues; onChange: (value: VendorFormValues) => void; onSubmit: (event: React.FormEvent) => void; onCancel: () => void; saving: boolean }) {
  const patch = (next: Partial<VendorFormValues>) => onChange({ ...value, ...next });
  return <form className="space-y-4" onSubmit={onSubmit}>
    <div className="grid gap-4 md:grid-cols-2">
      <Input label="Vendor Name *" required value={value.name} onChange={(event) => patch({ name: event.target.value })} />
      <Input label="GSTIN" maxLength={15} value={value.gstin} onChange={(event) => patch({ gstin: event.target.value.toUpperCase() })} />
      <Input label="Contact Person" value={value.contactPerson} onChange={(event) => patch({ contactPerson: event.target.value })} />
      <Input label="Phone" value={value.phone} onChange={(event) => patch({ phone: event.target.value })} />
      <Input label="Email" type="email" value={value.email} onChange={(event) => patch({ email: event.target.value })} />
      <Input label="Payment Terms" placeholder="e.g. Net 30" value={value.paymentTerms} onChange={(event) => patch({ paymentTerms: event.target.value })} />
    </div>
    <Input label="Category Tags" placeholder="Panels, Inverters, Structures" value={value.categoryTags} onChange={(event) => patch({ categoryTags: event.target.value })} />
    <Textarea label="Address" value={value.address} onChange={(event) => patch({ address: event.target.value })} />
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit" loading={saving}>Save Vendor</Button></div>
  </form>;
}
