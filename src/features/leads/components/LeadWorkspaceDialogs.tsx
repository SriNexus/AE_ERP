import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { LeadCsvImportModal } from './LeadCsvImportModal';

type LeadWorkspaceDialogsProps = {
  ctx: any;
};

/** Create-only: a lead's fields, documents, status, and assignment are edited
 * exclusively inside Lead Workspace, never from this list page. */
export function LeadWorkspaceDialogs({ ctx }: LeadWorkspaceDialogsProps) {
  const {
    showForm, closeForm, form, setForm, save,
    salesUsers, showCsvImport, setShowCsvImport, importCsvMutation,
    showBulkStatus, setShowBulkStatus, bulkStatus, setBulkStatus, bulkStatusMutation, selected,
    showBulkAssign, setShowBulkAssign, bulkAssignId, setBulkAssignId, bulkAssignName, setBulkAssignName, bulkAssignMutation,
  } = ctx;

  return (
    <>
      <Modal open={showForm} onClose={closeForm} title="Add Lead" size="lg">
        <form onSubmit={ctx.handleSubmit} className="space-y-5">
          <FormSection title="Contact Information">
            <FormRow>
              <Input data-tour="lead-form-name" label="Full Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Anil Kumar" />
              <Input data-tour="lead-form-phone" label="Phone" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile" />
            </FormRow>
            <FormRow>
              <Input label="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
              <Input label="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="City" />
            </FormRow>
          </FormSection>
          <FormSection title="Lead Details">
            <FormRow>
              <Select data-tour="lead-form-source" label="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} options={ctx.LEAD_SOURCES.map((s: string) => ({ label: s, value: s }))} />
              <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} options={ctx.LEAD_STATUSES.map((s: string) => ({ label: s, value: s }))} />
            </FormRow>
            <FormRow>
              <Select data-tour="lead-form-assign" label="Assign To (Sales Team)" value={form.assignedToId} onChange={e => {
                const u = salesUsers.find((x: any) => x.id === e.target.value);
                setForm({ ...form, assignedToId: e.target.value, assignedToName: u ? u.name : '' });
              }} options={[{ label: 'Unassigned', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]} />
              <Input label="Next Follow-up Date" type="date" value={form.next_date} onChange={e => setForm({ ...form, next_date: e.target.value })} />
            </FormRow>
            <Textarea label="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Initial inquiry details..." />
          </FormSection>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
            <Button data-tour="lead-form-save" type="submit" loading={save.isPending}>Add Lead</Button>
          </div>
        </form>
      </Modal>

      <LeadCsvImportModal
        open={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        onImport={rows => importCsvMutation.mutate(rows)}
        importing={importCsvMutation.isPending}
        importResult={ctx.importResult}
        onResultClose={() => { setShowCsvImport(false); ctx.setImportResult(null); }}
      />

      <Modal open={showBulkStatus} onClose={() => { setShowBulkStatus(false); setBulkStatus(''); }} title="Change Status" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Changing status for <span className="font-semibold text-[var(--color-text)]">{selected.size} lead{selected.size > 1 ? 's' : ''}</span>.
          </p>
          <Select label="New Status" value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            options={[{ label: 'Select Status...', value: '' }, ...ctx.LEAD_STATUSES.map((s: string) => ({ label: s, value: s }))]} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkStatus(false); setBulkStatus(''); }}>Cancel</Button>
            <Button onClick={() => {
              if (!bulkStatus) return ctx.toast.error('Select a status');
              bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus });
            }} loading={bulkStatusMutation.isPending}>Update {selected.size} Leads</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showBulkAssign} onClose={() => { setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); }} title="Assign Leads" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Assigning <span className="font-semibold text-[var(--color-text)]">{selected.size} lead{selected.size > 1 ? 's' : ''}</span> to a salesperson.
          </p>
          <Select label="Assign To" value={bulkAssignId} onChange={e => {
            const u = salesUsers.find((x: any) => x.id === e.target.value);
            setBulkAssignId(e.target.value);
            setBulkAssignName(u ? u.name : '');
          }} options={[{ label: 'Select Salesperson...', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setShowBulkAssign(false); setBulkAssignId(''); setBulkAssignName(''); }}>Cancel</Button>
            <Button onClick={() => {
              if (!bulkAssignId) return ctx.toast.error('Select a salesperson');
              bulkAssignMutation.mutate({ ids: Array.from(selected), userId: bulkAssignId, userName: bulkAssignName });
            }} loading={bulkAssignMutation.isPending}>Assign {selected.size} Leads</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
