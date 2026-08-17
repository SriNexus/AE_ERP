/**
 * PartnerRegistrationCreateModal — partner-facing "New Registration" form.
 * The project picker is restricted to the partner's OWN projects in the
 * New/Registration stage without an active registration; ownership
 * (partnerId/partnerName) is derived by createSchemeRegistration from the
 * selected project's chain (§9.3) — the partner can never stamp another
 * partner's project or partnerId. Portal details are recorded manually
 * (application number / portal reference) — no external portal API.
 */
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, FormSection } from '../ui/Input';
import { useCreateSchemeRegistration } from '../../features/scheme-registration/hooks/useSchemeRegistrations';
import type {
  SchemeRegistrationRecord,
  SchemeRegistrationPortalType,
} from '../../features/scheme-registration/types';

export function PartnerRegistrationCreateModal({
  open,
  onClose,
  registrations,
  projects,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  registrations: SchemeRegistrationRecord[];
  projects: any[];
  onCreated?: (reg: SchemeRegistrationRecord) => void;
}) {
  const createMutation = useCreateSchemeRegistration();

  const [projectId, setProjectId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [schemeName, setSchemeName] = useState('');
  const [portalType, setPortalType] = useState<SchemeRegistrationPortalType | ''>('');
  const [discom, setDiscom] = useState('');
  const [applicationNumber, setApplicationNumber] = useState('');
  const [portalReference, setPortalReference] = useState('');
  const [registrationDate, setRegistrationDate] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [notes, setNotes] = useState('');

  // Own projects in the New/Registration window WITHOUT an active (non-voided)
  // registration — the service also enforces this, the picker is UX only.
  const eligible = projects.filter((p: any) =>
    ['New', 'SchemeRegistration'].includes(p.currentStage)
    && !registrations.some((r) => r.projectId === p.id && r.status !== 'Cancelled'),
  );

  function handleSubmit() {
    if (createMutation.isPending) return;
    if (!projectId) { toast.error('Select one of your projects'); return; }
    if (!vendorName.trim()) { toast.error('Please enter the vendor name'); return; }
    if (applicantPhone && !/^\d{10}$/.test(applicantPhone.trim())) {
      toast.error('A valid 10-digit mobile number is required');
      return;
    }
    createMutation.mutate(
      {
        projectId,
        vendorName: vendorName.trim(),
        schemeName: schemeName.trim() || undefined,
        portalType: portalType || undefined,
        discom: discom.trim() || undefined,
        applicationNumber: applicationNumber.trim() || undefined,
        portalReference: portalReference.trim() || undefined,
        registrationDate: registrationDate || undefined,
        applicantName: applicantName.trim() || undefined,
        applicantPhone: applicantPhone.trim() || undefined,
        applicantEmail: applicantEmail.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (data) => { onClose(); reset(); onCreated?.(data); },
      },
    );
  }

  function reset() {
    setProjectId('');
    setVendorName('');
    setSchemeName('');
    setPortalType('');
    setDiscom('');
    setApplicationNumber('');
    setPortalReference('');
    setRegistrationDate('');
    setApplicantName('');
    setApplicantPhone('');
    setApplicantEmail('');
    setNotes('');
  }

  return (
    <Modal open={open} onClose={onClose} size="2xl" title="New Registration">
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-sunken)] px-3 py-2.5">
          <p className="text-[11px] text-[var(--color-text-muted)]">
            File the Vendor Lock / scheme registration for one of your projects. Ownership flows from the project's partner chain — you can only create a Registration on a project you own.
          </p>
        </div>

        <FormSection title="Project">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Project *</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
            >
              <option value="">Select one of your projects...</option>
              {eligible.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name || p.projectId || p.id}</option>
              ))}
            </select>
            {eligible.length === 0 && (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                No eligible projects — all of your projects already have an active Registration or have moved past the Registration stage.
              </p>
            )}
          </div>
        </FormSection>

        <FormSection title="Registration Details">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Vendor Name *" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor to be locked" />
            <Input label="Scheme Name" value={schemeName} onChange={(e) => setSchemeName(e.target.value)} placeholder="Government / financing scheme" />
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">Portal Type</label>
              <select
                value={portalType}
                onChange={(e) => setPortalType(e.target.value as SchemeRegistrationPortalType | '')}
                className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
              >
                <option value="">Not specified</option>
                <option value="pmsuryaghar">PM Surya Ghar</option>
                <option value="discom">DISCOM</option>
                <option value="vendor">Vendor</option>
                <option value="state">State scheme</option>
                <option value="other">Other</option>
              </select>
            </div>
            <Input label="DISCOM" value={discom} onChange={(e) => setDiscom(e.target.value)} placeholder="DISCOM name" />
            <Input label="Application Number" value={applicationNumber} onChange={(e) => setApplicationNumber(e.target.value)} placeholder="External portal application number" />
            <Input label="Portal Reference" value={portalReference} onChange={(e) => setPortalReference(e.target.value)} placeholder="Portal reference ID / URL" />
            <Input label="Registration Date" type="date" value={registrationDate} onChange={(e) => setRegistrationDate(e.target.value)} />
            <Input label="Applicant Name" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder="Applicant / customer name" />
            <Input label="Applicant Phone" value={applicantPhone} onChange={(e) => setApplicantPhone(e.target.value)} placeholder="10-digit mobile number" />
            <Input label="Applicant Email" value={applicantEmail} onChange={(e) => setApplicantEmail(e.target.value)} placeholder="Email address" />
          </div>
          <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes about the registration" />
        </FormSection>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={createMutation.isPending} onClick={handleSubmit}>
            Create Registration Draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}
