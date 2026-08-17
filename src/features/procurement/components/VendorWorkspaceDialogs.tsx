import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { VendorForm } from './VendorForm';
import type { VendorFormValues } from '../types';

type VendorWorkspaceDialogsProps = {
  ctx: any;
};

export function VendorWorkspaceDialogs({ ctx }: VendorWorkspaceDialogsProps) {
  const {
    showForm, closeForm, editing, form, setForm, save, permissions,
    showBulkStatus, setShowBulkStatus, bulkStatus, setBulkStatus, bulkStatusMutation, selected,
    showBulkAssign, setShowBulkAssign, bulkAssignId, setBulkAssignId, bulkAssignName, setBulkAssignName, bulkAssignMutation,
  } = ctx;

  return (
    <>
      <Modal open={showForm} onClose={closeForm} title={editing ? 'Edit Vendor' : 'Add Vendor'} size="lg">
        <VendorForm value={form} onChange={setForm} onSubmit={ctx.handleSubmit} onCancel={closeForm} saving={save.isPending} />
      </Modal>

      <Modal open={showBulkStatus} onClose={() => { setShowBulkStatus(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected.size} vendor{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <Select label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            options={[{ label: 'Select Status...', value: '' }, { label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }]} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={() => {
              if (!bulkStatus) return;
              bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
            }} loading={bulkStatusMutation.isPending}>Update {selected.size} Vendors</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showBulkAssign} onClose={() => { setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); }} title="Assign Vendors" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Assigning <span className="font-semibold text-[var(--color-text)]">{selected.size} vendor{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <Input label="Assign To Name" value={bulkAssignName} onChange={e => setBulkAssignName(e.target.value)} placeholder="Enter name" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); }}>Cancel</Button>
            <Button onClick={() => {
              if (!bulkAssignName) return;
              bulkAssignMutation.mutate({ ids: Array.from(selected), assigneeName: bulkAssignName });
            }} loading={bulkAssignMutation.isPending}>Assign {selected.size} Vendors</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
