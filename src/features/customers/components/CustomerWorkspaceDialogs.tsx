import { Building2, User, UploadCloud } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input, Select, Textarea, FormRow, FormSection } from '../../../components/ui/Input';
import { useAppStore } from '../../../store/useAppStore';
import { resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { getAllowedCustomerTypesForBusinessMode } from '../../../lib/customerClassification';

type CustomerWorkspaceDialogsProps = { ctx: any };

export function CustomerWorkspaceDialogs({ ctx }: CustomerWorkspaceDialogsProps) {
  const {
    showTypeChooser, setShowTypeChooser, createType, setCreateType, lockedSourceLead,
    b2bForm, setB2bForm, b2cForm, setB2cForm, createB2B, createB2C, closeCreateForm,
    salesUsers = [], STATE_OPTS = [], PROPERTY_TYPES = [], INDUSTRY_TYPES = [],
    ROOF_TYPES = [],
    billFileRef, b2bBillFileRef, handleBillFile, handleB2BBillFile,
    aadhaarFileRef, panFileRef, handleAadhaarFile, handlePanFile,
    showCsvImport, setShowCsvImport, ctxToast,
  } = ctx;

  // Phase 2: Company Business Mode constrains which type(s) a directly-created
  // Customer may be — a 'B2B'-only company must never offer the B2C card, and vice versa.
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const allowedTypes = getAllowedCustomerTypesForBusinessMode(businessMode);

  return (
    <>
      <Modal open={showTypeChooser} onClose={closeCreateForm} title="Select Customer Type" size="sm">
        <div className="space-y-3 pt-1">
          <p className="text-sm text-[var(--color-text-muted)] text-center pb-2">Choose the type of customer you are adding.</p>
          <div className="grid grid-cols-2 gap-4">
            {allowedTypes.includes('B2B') && (
              <button onClick={() => setCreateType('B2B')}
                className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-[var(--color-border)] hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all duration-150 group">
                <div className="h-14 w-14 rounded-2xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center group-hover:scale-110 transition-transform duration-150">
                  <Building2 className="h-7 w-7 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-[var(--color-text)] text-sm">B2B Business</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Material/distribution buyer</p>
                </div>
              </button>
            )}
            {allowedTypes.includes('B2C') && (
              <button onClick={() => setCreateType('B2C')}
                className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-[var(--color-border)] hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all duration-150 group">
                <div className="h-14 w-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center group-hover:scale-110 transition-transform duration-150">
                  <User className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-[var(--color-text)] text-sm">B2C Individual</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Direct installation customer</p>
                </div>
              </button>
            )}
          </div>
        </div>
      </Modal>

      <Modal open={createType === 'B2B'} onClose={closeCreateForm} title="Add B2B Customer" size="xl">
        <form onSubmit={ctx.handleB2BSubmit} className="space-y-5">
          <FormSection title="Business Information">
            <FormRow>
              <Input label="Company Name *" required value={b2bForm.companyName || b2bForm.company} onChange={e => setB2bForm((f: any) => ({ ...f, companyName: e.target.value, company: e.target.value }))} placeholder="e.g. Sharma Solar Pvt Ltd" />
              <Input label="GST Number" value={b2bForm.gst} onChange={e => setB2bForm((f: any) => ({ ...f, gst: e.target.value.toUpperCase() }))} placeholder="15-char GST" />
            </FormRow>
            <FormRow>
              <Input label="Name *" required value={b2bForm.contactPerson} onChange={e => setB2bForm((f: any) => ({ ...f, contactPerson: e.target.value }))} placeholder="Primary contact name" />
              <Select label="Industry Type" value={b2bForm.industryType} onChange={e => setB2bForm((f: any) => ({ ...f, industryType: e.target.value }))} options={[{ label: 'Select Industry', value: '' }, ...INDUSTRY_TYPES.map((i: string) => ({ label: i, value: i }))]} />
            </FormRow>
            <FormRow>
              <Input label="Phone *" required value={b2bForm.businessPhone} onChange={e => setB2bForm((f: any) => ({ ...f, businessPhone: e.target.value }))} placeholder="10-digit number" />
              <Input label="Email" type="email" value={b2bForm.businessEmail} onChange={e => setB2bForm((f: any) => ({ ...f, businessEmail: e.target.value }))} placeholder="office@company.com" />
            </FormRow>
          </FormSection>
          <FormSection title="Address">
            <Textarea label="Office Address" value={b2bForm.address} onChange={e => setB2bForm((f: any) => ({ ...f, address: e.target.value }))} rows={2} placeholder="Registered office address" />
            <FormRow>
              <Select label="State" value={b2bForm.state} onChange={e => setB2bForm((f: any) => ({ ...f, state: e.target.value }))} options={STATE_OPTS} />
              <Input label="City" value={b2bForm.city} onChange={e => setB2bForm((f: any) => ({ ...f, city: e.target.value }))} placeholder="City" />
            </FormRow>
          </FormSection>
          <FormSection title="Assignment">
            <Select label="Assign Salesperson" value={b2bForm.assignedToId} onChange={e => {
              const u = salesUsers.find((x: any) => x.id === e.target.value);
              setB2bForm((f: any) => ({ ...f, assignedToId: e.target.value, assignedToName: u ? u.name : '' }));
            }} options={[{ label: 'Unassigned', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]} />
          </FormSection>
          <FormSection title="Upload Documents (Optional)">
            <p className="text-xs text-[var(--color-text-muted)] mb-3">You can upload multiple documents such as:</p>
            <ul className="text-xs text-[var(--color-text-muted)] mb-3 space-y-1 list-disc pl-4">
              <li>GST Certificate</li>
              <li>Company PAN Card</li>
              <li>Agreement / Contract</li>
              <li>Bank Details / Cancelled Cheque</li>
              <li>Other business documents</li>
            </ul>
            <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-5 text-center bg-[var(--color-bg-sunken)]">
              <input type="file" accept="image/*,.pdf" ref={b2bBillFileRef} onChange={handleB2BBillFile} className="hidden" id="b2b-bill-upload-create" />
              <label htmlFor="b2b-bill-upload-create" className="cursor-pointer flex flex-col items-center gap-1">
                <UploadCloud className="h-8 w-8 text-indigo-400" />
                <span className="text-sm font-medium text-[var(--color-text-secondary)]">{b2bForm.billUploadName || 'Click to upload document'}</span>
                <span className="text-xs text-[var(--color-text-muted)]">Image (JPG/PNG) or PDF · Max 5MB</span>
              </label>
            </div>
          </FormSection>
          <Textarea label="Notes" value={b2bForm.notes} onChange={e => setB2bForm((f: any) => ({ ...f, notes: e.target.value }))} placeholder="Additional notes..." />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" type="button" onClick={closeCreateForm}>Cancel</Button>
            <Button type="submit" loading={createB2B.isPending}>Add B2B Customer</Button>
          </div>
        </form>
      </Modal>

      <Modal open={createType === 'B2C'} onClose={closeCreateForm} title="Add B2C Customer" size="xl">
        <form onSubmit={ctx.handleB2CSubmit} className="space-y-5">
          <FormSection title="Customer Details">
            <FormRow>
              <Input label="Name *" required disabled={Boolean(lockedSourceLead)} value={b2cForm.fullName} onChange={e => setB2cForm((f: any) => ({ ...f, fullName: e.target.value }))} placeholder="Full name as per documents" />
              <Input label="Phone *" required disabled={Boolean(lockedSourceLead)} value={b2cForm.mobile} onChange={e => setB2cForm((f: any) => ({ ...f, mobile: e.target.value }))} placeholder="10-digit mobile" />
            </FormRow>
            <FormRow>
              <Input label="Alternate Number" value={b2cForm.altMobile} onChange={e => setB2cForm((f: any) => ({ ...f, altMobile: e.target.value }))} placeholder="Optional" />
              <Input label="Email" type="email" value={b2cForm.email} onChange={e => setB2cForm((f: any) => ({ ...f, email: e.target.value }))} placeholder="customer@email.com" />
            </FormRow>
            <Input label="Aadhaar Number (Optional)" value={b2cForm.aadhaar} onChange={e => setB2cForm((f: any) => ({ ...f, aadhaar: e.target.value }))} placeholder="12-digit Aadhaar" />
          </FormSection>
          <FormSection title="Installation Address">
            <Textarea label="Installation Address *" value={b2cForm.address} onChange={e => setB2cForm((f: any) => ({ ...f, address: e.target.value }))} rows={2} placeholder="Full installation site address" />
            <FormRow>
              <Select label="State" value={b2cForm.state} onChange={e => setB2cForm((f: any) => ({ ...f, state: e.target.value }))} options={STATE_OPTS} />
              <Input label="City" value={b2cForm.city} onChange={e => setB2cForm((f: any) => ({ ...f, city: e.target.value }))} placeholder="City" />
            </FormRow>
            <Select label="Project Type" value={b2cForm.projectType || b2cForm.propertyType} onChange={e => setB2cForm((f: any) => ({ ...f, projectType: e.target.value, propertyType: e.target.value }))} options={[{ label: 'Select Project Type', value: '' }, ...PROPERTY_TYPES.map((p: string) => ({ label: p, value: p }))]} />
          </FormSection>
          <FormSection title="Solar / Electricity Details">
            <FormRow>
              <Input label="Monthly Bill Amount (₹)" type="number" value={b2cForm.monthlyBillAmount} onChange={e => setB2cForm((f: any) => ({ ...f, monthlyBillAmount: e.target.value }))} placeholder="e.g. 2500" />
              <Input label="Sanction Load (kW)" type="number" value={b2cForm.sanctionLoad} onChange={e => setB2cForm((f: any) => ({ ...f, sanctionLoad: e.target.value }))} placeholder="e.g. 5" />
            </FormRow>
            <Select label="Roof Type" value={b2cForm.roofType} onChange={e => setB2cForm((f: any) => ({ ...f, roofType: e.target.value }))}                    options={[{ label: 'Select Roof Type', value: '' }, ...ROOF_TYPES.map((r: string) => ({ label: r, value: r }))]} />
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wide">Electricity Bill Upload</label>
              <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-5 text-center bg-[var(--color-bg-sunken)]">
                <input type="file" accept="image/*,.pdf" ref={billFileRef} onChange={handleBillFile} className="hidden" id="bill-upload-create" />
                {b2cForm.electricityBillPreview ? (
                  <div className="space-y-2">
                    {b2cForm.electricityBillFile?.type?.startsWith('image/') ? (
                      <img src={b2cForm.electricityBillPreview} alt="Bill preview" className="max-h-40 mx-auto rounded-lg object-contain border border-[var(--color-border)]" />
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
                        <UploadCloud className="h-6 w-6" />
                        <span className="text-sm font-medium">{b2cForm.electricityBillFile?.name}</span>
                      </div>
                    )}
                    <label htmlFor="bill-upload-create" className="cursor-pointer text-xs text-indigo-500 hover:underline block">Change file</label>
                  </div>
                ) : (
                  <label htmlFor="bill-upload-create" className="cursor-pointer flex flex-col items-center gap-1">
                    <UploadCloud className="h-8 w-8 text-indigo-400" />
                    <span className="text-sm font-medium text-[var(--color-text-secondary)]">Click to upload electricity bill</span>
                    <span className="text-xs text-[var(--color-text-muted)]">Image (JPG/PNG) or PDF · Max 5MB</span>
                  </label>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wide">Aadhaar Card Upload (Optional)</label>
              <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-5 text-center bg-[var(--color-bg-sunken)]">
                <input type="file" accept="image/*,.pdf" ref={aadhaarFileRef} onChange={handleAadhaarFile} className="hidden" id="aadhaar-upload-create" />
                {b2cForm.aadhaarPreview ? (
                  <div className="space-y-2">
                    {b2cForm.aadhaarFile?.type?.startsWith('image/') ? (
                      <img src={b2cForm.aadhaarPreview} alt="Aadhaar preview" className="max-h-40 mx-auto rounded-lg object-contain border border-[var(--color-border)]" />
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-indigo-600 dark:text-indigo-400">
                        <UploadCloud className="h-6 w-6" />
                        <span className="text-sm font-medium">{b2cForm.aadhaarFile?.name}</span>
                      </div>
                    )}
                    <label htmlFor="aadhaar-upload-create" className="cursor-pointer text-xs text-indigo-500 hover:underline block">Change file</label>
                  </div>
                ) : (
                  <label htmlFor="aadhaar-upload-create" className="cursor-pointer flex flex-col items-center gap-1">
                    <UploadCloud className="h-8 w-8 text-indigo-400" />
                    <span className="text-sm font-medium text-[var(--color-text-secondary)]">Click to upload Aadhaar card</span>
                    <span className="text-xs text-[var(--color-text-muted)]">Image (JPG/PNG) or PDF · Max 5MB</span>
                  </label>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-muted)] mb-1.5 uppercase tracking-wide">PAN Card Upload (Optional)</label>
              <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-5 text-center bg-[var(--color-bg-sunken)]">
                <input type="file" accept="image/*,.pdf" ref={panFileRef} onChange={handlePanFile} className="hidden" id="pan-upload-create" />
                {b2cForm.panPreview ? (
                  <div className="space-y-2">
                    {b2cForm.panFile?.type?.startsWith('image/') ? (
                      <img src={b2cForm.panPreview} alt="PAN preview" className="max-h-40 mx-auto rounded-lg object-contain border border-[var(--color-border)]" />
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400">
                        <UploadCloud className="h-6 w-6" />
                        <span className="text-sm font-medium">{b2cForm.panFile?.name}</span>
                      </div>
                    )}
                    <label htmlFor="pan-upload-create" className="cursor-pointer text-xs text-indigo-500 hover:underline block">Change file</label>
                  </div>
                ) : (
                  <label htmlFor="pan-upload-create" className="cursor-pointer flex flex-col items-center gap-1">
                    <UploadCloud className="h-8 w-8 text-indigo-400" />
                    <span className="text-sm font-medium text-[var(--color-text-secondary)]">Click to upload PAN card</span>
                    <span className="text-xs text-[var(--color-text-muted)]">Image (JPG/PNG) or PDF · Max 5MB</span>
                  </label>
                )}
              </div>
            </div>
          </FormSection>
          <FormSection title="Assignment">
            <Select label="Assign Salesperson" value={b2cForm.assignedToId} onChange={e => {
              const u = salesUsers.find((x: any) => x.id === e.target.value);
              setB2cForm((f: any) => ({ ...f, assignedToId: e.target.value, assignedToName: u ? u.name : '' }));
            }} options={[{ label: 'Unassigned', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]} />
          </FormSection>
          <Textarea label="Notes" value={b2cForm.notes} onChange={e => setB2cForm((f: any) => ({ ...f, notes: e.target.value }))} placeholder="Additional notes..." />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" type="button" onClick={closeCreateForm}>Cancel</Button>
            <Button type="submit" loading={createB2C.isPending}>Add B2C Customer</Button>
          </div>
        </form>
      </Modal>

    </>
  );
}
