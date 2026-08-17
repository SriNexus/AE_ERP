import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Select, Textarea } from '../../../components/ui/Input';

interface CustomerTransferModalProps {
  open: boolean;
  customer: any;
  salesUsers: any[];
  onClose: () => void;
  onSave: (args: { customerId: string; newUserId: string; newUserName: string; note: string; existingLog: any; existingHistory: any }) => void;
  saving: boolean;
}

export function CustomerTransferModal({ open, customer, salesUsers, onClose, onSave, saving }: CustomerTransferModalProps) {
  const [transferUserId, setTransferUserId] = useState('');
  const [transferNote, setTransferNote] = useState('');

  function handleClose() {
    setTransferUserId('');
    setTransferNote('');
    onClose();
  }

  return (
    <Modal open={!!customer && open} onClose={handleClose} title="Transfer Customer" size="sm">
      {customer && (
        <div className="space-y-4">
          <div className="bg-[var(--color-bg-sunken)] rounded-lg p-3 text-sm">
            <p className="text-xs text-[var(--color-text-muted)] uppercase font-semibold mb-0.5">Current Assignee</p>
            <p className="font-semibold text-[var(--color-text)]">{customer.assignedToName || 'Unassigned'}</p>
          </div>
          <Select
            label="New Assignee"
            required
            value={transferUserId}
            onChange={e => setTransferUserId(e.target.value)}
            options={[{ label: 'Select Salesperson...', value: '' }, ...salesUsers.map(u => ({ label: u.name, value: u.id }))]}
          />
          <Textarea
            label="Transfer Note (Reason)"
            required
            value={transferNote}
            onChange={e => setTransferNote(e.target.value)}
            placeholder="Why is this being transferred?"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
            <Button
              onClick={() => {
                if (!transferUserId || !transferNote) return toast.error('Assignee and note required');
                const u = salesUsers.find(x => x.id === transferUserId);
                if (!u) return toast.error('Invalid user selected');
                onSave({ customerId: customer.id, newUserId: u.id, newUserName: u.name, note: transferNote, existingLog: customer.activityLog, existingHistory: customer.transferHistory });
              }}
              loading={saving}
            >Confirm Transfer</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
