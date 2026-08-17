import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';

interface CustomerFollowupModalProps {
  open: boolean;
  customer: any;
  onClose: () => void;
  onSave: (args: { customerId: string; note: string; next: string; existingLog: any }) => void;
  saving: boolean;
}

export function CustomerFollowupModal({ open, customer, onClose, onSave, saving }: CustomerFollowupModalProps) {
  const [fuNote, setFuNote] = useState('');
  const [fuDate, setFuDate] = useState('');

  function handleClose() {
    setFuNote('');
    setFuDate('');
    onClose();
  }

  return (
    <Modal open={!!customer && open} onClose={handleClose} title={`Follow-up: ${customer?.name || customer?.fullName || ''}`} size="sm">
      <div className="space-y-4">
        <Textarea label="Follow-up Note" required value={fuNote} onChange={e => setFuNote(e.target.value)} placeholder="What was discussed?" />
        <Input label="Next Follow-up Date" type="date" value={fuDate} onChange={e => setFuDate(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!fuNote) return toast.error('Note required');
              onSave({ customerId: customer.id, note: fuNote, next: fuDate, existingLog: customer.activityLog });
            }}
            loading={saving}
          >Save Follow-up</Button>
        </div>
      </div>
    </Modal>
  );
}
