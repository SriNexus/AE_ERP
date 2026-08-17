import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Select, FormRow, FormSection } from '../../../components/ui/Input';
import { BANK_FORM_DEFAULT, type BankForm } from '../hooks/useBanks';

const STATUS_OPTIONS = [
  { label: 'Active', value: 'Active' },
  { label: 'Inactive', value: 'Inactive' },
];

const TYPE_OPTIONS = [
  { label: 'Select Type (optional)', value: '' },
  { label: 'Public Sector', value: 'Public' },
  { label: 'Private Sector', value: 'Private' },
  { label: 'Cooperative', value: 'Cooperative' },
  { label: 'NBFC', value: 'NBFC' },
];

interface BankWorkspaceDialogsProps {
  ctx: {
    showForm: boolean;
    closeForm: () => void;
    editId: string | null;
    form: BankForm;
    setForm: (f: BankForm) => void;
    save: any;
    handleSubmit: (e: React.FormEvent) => void;
  };
}

export function BankWorkspaceDialogs({ ctx }: BankWorkspaceDialogsProps) {
  const { showForm, closeForm, editId, form, setForm, save, handleSubmit } = ctx;

  return (
    <Modal open={showForm} onClose={closeForm} title={editId ? 'Edit Bank' : 'Add Bank'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        <FormSection title="Bank Details">
          <FormRow>
            <Input label="Bank Code" required value={form.bankCode} onChange={e => setForm({ ...form, bankCode: e.target.value })} placeholder="e.g. SBI, HDFC" />
            <Input label="Bank Name" required value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} placeholder="e.g. State Bank of India" />
          </FormRow>
          <FormRow>
            <Input label="Display Name" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} placeholder="Optional shorter display name" />
            <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as 'Active' | 'Inactive' })} options={STATUS_OPTIONS} />
          </FormRow>
          <FormRow>
            <Select label="Bank Type (optional)" value={(form as any).bankType || ''} onChange={e => setForm({ ...form, bankType: e.target.value as any })} options={TYPE_OPTIONS} />
            <Input label="Priority" type="number" value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} placeholder="Lower = first in dropdowns" />
          </FormRow>
        </FormSection>
        <p className="text-xs text-[var(--color-text-muted)] italic">
          Future-ready fields like IFSC prefix, supported schemes, regions, and contact info are schema-ready and will be available in future updates.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" type="button" onClick={closeForm}>Cancel</Button>
          <Button type="submit" loading={save?.isPending}>{editId ? 'Update Bank' : 'Add Bank'}</Button>
        </div>
      </form>
    </Modal>
  );
}
