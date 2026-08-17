/**
 * PartnerUploadDocumentModal — Document Upload/Submit Modal for Partner Portal
 *
 * Partners can submit documents associated with their leads.
 * "Upload" in this system is a metadata submission — the document name/type
 * is recorded on the lead's document tracking arrays.
 *
 * Calls:
 *   - updateDocById() to add to lead's uploadedDocuments and documentVerifications
 *   - updateDocumentationStatus() for lead-level status, activity logging, and notifications
 *
 * No file storage logic. No direct Firestore SDK usage.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { updateDocById, getOne } from '../../lib/firestore';
import { COLLECTIONS } from '../../lib/firebase';
import { updateDocumentationStatus } from '../../lib/partnerLeadIntegration';
import toast from 'react-hot-toast';

export const DOCUMENT_TYPE_OPTIONS = [
  { label: 'KYC Documents', value: 'kyc' },
  { label: 'PAN Card', value: 'pan' },
  { label: 'GST Certificate', value: 'gst' },
  { label: 'Aadhaar Card', value: 'aadhaar' },
  { label: 'Bank Proof', value: 'bank_proof' },
  { label: 'Cancelled Cheque', value: 'cancelled_cheque' },
  { label: 'Installation Documents', value: 'installation_documents' },
  { label: 'Customer Documents', value: 'customer_documents' },
  { label: 'Site Photos', value: 'site_photos' },
  { label: 'Other', value: 'other' },
];

interface PartnerUploadDocumentModalProps {
  open: boolean;
  onClose: () => void;
  leads: { id: string; name: string; phone: string }[];
  /** Pre-selected lead ID (for "Replace Document" action) */
  preselectedLeadId?: string;
  /** Pre-selected document type (for "Replace Document" action) */
  preselectedType?: string;
  onSuccess?: () => void;
}

export function PartnerUploadDocumentModal({
  open,
  onClose,
  leads,
  preselectedLeadId,
  preselectedType,
  onSuccess,
}: PartnerUploadDocumentModalProps) {
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState(preselectedLeadId || '');
  const [docType, setDocType] = useState(preselectedType || '');
  const [docName, setDocName] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setLeadId(preselectedLeadId || '');
    setDocType(preselectedType || '');
    setDocName('');
    setNotes('');
  }

  async function handleSubmit() {
    if (!leadId) return toast.error('Please select a lead');
    if (!docType && !docName) return toast.error('Please enter or select a document type');
    if (docName.length < 2) return toast.error('Document name must be at least 2 characters');

    setLoading(true);
    try {
      const documentName = docType
        ? DOCUMENT_TYPE_OPTIONS.find((o) => o.value === docType)?.label || docType
        : docName;

      // 1. Add to lead's uploadedDocuments and documentVerifications
      const verificationEntry = {
        documentName,
        status: 'pending',
        rejectionReason: null,
        notes: notes || null,
        submittedAt: new Date().toISOString(),
      };

      // Fetch current lead to merge arrays
      const lead = await getOne(COLLECTIONS.LEADS, leadId) as any;
      if (!lead) return toast.error('Lead not found');

      const existingDocs = lead.uploadedDocuments || [];
      const existingVerifications = lead.documentVerifications || [];

      await updateDocById(COLLECTIONS.LEADS, leadId, {
        uploadedDocuments: [...existingDocs, documentName],
        documentVerifications: [...existingVerifications, verificationEntry],
      });

      // 2. Call lead-level documentation status update (logs activity + sends notifications)
      await updateDocumentationStatus(leadId, 'submitted', documentName);

      toast.success('Document submitted successfully');
      qc.invalidateQueries({ queryKey: ['leads'] });
      resetForm();
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit document');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  const selectedLead = leads.find((l) => l.id === leadId);

  return (
    <Modal open={open} onClose={handleClose} title="Submit Document" size="sm">
      <div className="space-y-4">
        {/* ── Lead Selection ──────────────────────────────── */}
        {leads.length > 0 && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">
              Related Lead *
            </label>
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)]"
              disabled={!!preselectedLeadId}
            >
              <option value="">Select a lead…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.phone || l.id.slice(0, 10)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── Selected Lead Info ──────────────────────────── */}
        {selectedLead && (
          <div className="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300">
            Lead: <strong>{selectedLead.name || selectedLead.phone || selectedLead.id.slice(0, 10)}</strong>
          </div>
        )}

        {/* ── Document Type ───────────────────────────────── */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">
            Document Type *
          </label>
          <select
            value={docType}
            onChange={(e) => { setDocType(e.target.value); if (e.target.value) setDocName(''); }}
            className="w-full h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)]"
            disabled={!!preselectedType}
          >
            <option value="">Select document type…</option>
            {DOCUMENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* ── Or Custom Document Name ─────────────────────── */}
        <Input
          label="Or enter custom document name"
          placeholder="e.g. Rooftop Agreement"
          value={docName}
          onChange={(e) => { setDocName(e.target.value); if (e.target.value) setDocType(''); }}
        />

        {/* ── Notes ───────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">
            Notes <span className="text-[var(--color-text-disabled)]">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional information about this document…"
            rows={3}
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] resize-none"
          />
        </div>

        {/* ── Actions ─────────────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
          <Button variant="outline" size="sm" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<Upload className="h-4 w-4" />}
            onClick={handleSubmit}
            loading={loading}
          >
            Submit Document
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default PartnerUploadDocumentModal;
