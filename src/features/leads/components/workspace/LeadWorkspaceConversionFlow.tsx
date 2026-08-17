/**
 * LeadWorkspaceConversionFlow — B2B / B2C conversion form
 *
 * Renders inside the Center Activity Area (no popups, no modals).
 *
 * DESIGN PRINCIPLES:
 * • Lead fields (Name, Phone, Email, City) are NOT shown again — they already exist
 * • B2B starts from Company Name
 * • B2C starts from customer-specific fields (alternate mobile, address, solar details)
 * • Uses the existing production convertLeadToCustomer service
 * • Reuses the existing electricity bill upload pattern (file input + preview)
 * • On success: lead is completed, customer is created, auto-navigate to next lead
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Building2, User, CheckCircle2, UploadCloud, Clock, UserCheck } from 'lucide-react';
import { useWorkspace } from './LeadWorkspaceEngine';
import { convertLeadToCustomer } from '../../../../lib/leadWorkflow';
import { INDIAN_STATES } from '../../../../config/company';
import { useLeadsUsers } from '../../hooks/useLeads';
import { useAppStore, useCurrentUser } from '../../../../store/useAppStore';
import { resolveBusinessMode } from '../../../../lib/companyBusinessMode';
import { getAllowedCustomerTypesForBusinessMode } from '../../../../lib/customerClassification';

type CustomerType = 'b2b' | 'b2c' | null;
type Step = 'form' | 'success';

interface Props {
  lead: any;
  nextLeadId?: string;
}

const STATE_OPTS = [
  { label: 'Select State', value: '' },
  ...(INDIAN_STATES || []).map((s: string) => ({ label: s, value: s })),
];

const ROOF_TYPES = ['RCC Flat', 'Tin Sheet', 'Asbestos', 'Mangalore Tile', 'Other'];

export default function LeadWorkspaceConversionFlow({ lead, nextLeadId }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { dispatch } = useWorkspace();
  const [step, setStep] = useState<Step>('form');
  const [countdown, setCountdown] = useState(3);
  const [saving, setSaving] = useState(false);
  // Phase 2: Company Business Mode constrains which type(s) a Lead may convert
  // to — a 'B2B'-only company must never offer the B2C toggle, and vice versa.
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const allowedTypes = useMemo(() => getAllowedCustomerTypesForBusinessMode(businessMode), [businessMode]);
  const [customerType, setCustomerType] = useState<CustomerType>(null);
  // Single-mode company: there is only one valid choice — select it automatically
  // so the operator never sees a toggle they can't actually use.
  useEffect(() => {
    if (allowedTypes.length === 1) {
      setCustomerType(allowedTypes[0].toLowerCase() as CustomerType);
    }
  }, [allowedTypes]);
  const currentUser = useCurrentUser();
  const { data: salesUsers = [] } = useLeadsUsers();
  const assignableUsers = useMemo(
    () => (salesUsers as any[]).filter(u => ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'].includes(u.role) && u.status !== 'Inactive' && !u.isDeleted),
    [salesUsers],
  );
  // Assignment for the resulting Customer record. Defaults to the current
  // operator — the lead never leaves conversion unassigned. A manager (or the
  // operator, on the manager's behalf) can pick someone else before submitting.
  const [assignedToId, setAssignedToId] = useState(() => lead.assignedToId || currentUser.id);
  const assignedToName = useMemo(() => {
    if (!assignedToId || assignedToId === currentUser.id) return currentUser.name;
    return assignableUsers.find(u => u.id === assignedToId)?.name || currentUser.name;
  }, [assignedToId, assignableUsers, currentUser]);

  // ── B2B form state ───────────────────────────────────
  const [b2bForm, setB2bForm] = useState({
    company: '',
    gst: '',
    contactPerson: '',
    businessEmail: '',
    businessPhone: '',
    address: '',
    state: '',
    city: '',
  });
  const hB2b = (f: string, v: string) => setB2bForm(p => ({ ...p, [f]: v }));

  // ── B2C form state (lead fields omitted — they come from the lead object) ─
  const [b2cForm, setB2cForm] = useState({
    altMobile: '',
    address: '',
    state: '',
    aadhaar: '',
    monthlyBillAmount: '',
    sanctionLoad: '',
    roofType: '',
  });
  // Electricity bill upload
  const billFileRef = useRef<HTMLInputElement>(null);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [billPreview, setBillPreview] = useState('');

  const hB2c = (f: string, v: string) => setB2cForm(p => ({ ...p, [f]: v }));

  const handleBillFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBillFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => setBillPreview(evt.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  // ── Convert type label ───────────────────────────────
  const convertTypeLabel = customerType === 'b2b' ? 'B2B' : customerType === 'b2c' ? 'B2C' : null;

  // ── Countdown after success ──────────────────────────
  useEffect(() => {
    if (step !== 'success') return;
    if (countdown <= 0) {
      if (nextLeadId) {
        navigate(`/leads/workspace/${encodeURIComponent(nextLeadId)}`);
      } else {
        navigate('/customers');
      }
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [step, countdown, nextLeadId, navigate]);

  // ── Submit handler ───────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (saving) return;
    if (!customerType) return;

    // Validation
    if (customerType === 'b2b') {
      if (!b2bForm.company.trim()) return toast.error('Company name is required');
    } else {
      if (!b2cForm.address.trim()) return toast.error('Address is required');
    }

    setSaving(true);
    try {
      const extra = customerType === 'b2b'
        ? {
            company: b2bForm.company,
            gst: b2bForm.gst,
            contactPerson: b2bForm.contactPerson,
            businessEmail: b2bForm.businessEmail,
            businessPhone: b2bForm.businessPhone,
            address: b2bForm.address,
            state: b2bForm.state,
            city: b2bForm.city,
            assignedToId,
            assignedToName,
          }
        : {
            fullName: lead.name || '',
            mobile: lead.phone || '',
            altMobile: b2cForm.altMobile,
            address: b2cForm.address,
            state: b2cForm.state,
            aadhaar: b2cForm.aadhaar,
            monthlyBillAmount: b2cForm.monthlyBillAmount,
            assignedToId,
            assignedToName,
            roofType: b2cForm.roofType,
            sanctionLoad: b2cForm.sanctionLoad,
            electricityBillFileName: billFile?.name || '',
          };

      const customerId = await convertLeadToCustomer({ ...lead, ...extra }, convertTypeLabel as 'B2B' | 'B2C');

      // Complete lead in queue, record the conversion timeline entry, THEN
      // mark the workspace clean. Order matters: ADD_TIMELINE sets
      // hasUnsaved:true, so it must run before MARK_CLEAN — otherwise the
      // operator would see a spurious dirty state after a saved conversion.
      dispatch({ type: 'COMPLETE_LEAD', payload: { leadId: lead.id, outcome: 'converted' } });
      dispatch({ type: 'ADD_TIMELINE', payload: { id: `conv-${Date.now()}`, time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }), type: 'Conversion', desc: `Converted (${convertTypeLabel}) - Customer ID: ${customerId}` } });
      dispatch({ type: 'MARK_CLEAN' });
      dispatch({ type: 'SET_LAST_ACTION', payload: 'Customer created' });

      // Invalidate caches
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['customers'] });

      toast.success(`Lead converted to ${convertTypeLabel} Customer!`);
      setStep('success');
    } catch (err: any) {
      toast.error(err?.message || 'Conversion failed');
    } finally {
      setSaving(false);
    }
  }, [saving, customerType, b2bForm, b2cForm, billFile, lead, convertTypeLabel, dispatch, qc, assignedToId, assignedToName]);

  // ── Reset handler ────────────────────────────────────
  const handleCancel = useCallback(() => {
    dispatch({ type: 'RESET_OUTCOME' });
  }, [dispatch]);

  return (
    <div className="space-y-4">
      {step === 'form' && (
        <>
          {/* ── Customer Type Toggle ─────────────────────── */}
          <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 p-6 shadow-sm">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 mb-4 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Convert to Customer
            </h3>

            {/* Segmented Control — only shows the type(s) this company's Business Mode allows */}
            <div className="flex rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5 mb-4">
              {allowedTypes.includes('B2B') && (
                <button onClick={() => setCustomerType('b2b')}
                  className={['flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors',
                    customerType === 'b2b' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'].join(' ')}>
                  <Building2 className="h-3.5 w-3.5" /> B2B — Material/Distribution Buyer
                </button>
              )}
              {allowedTypes.includes('B2C') && (
                <button onClick={() => setCustomerType('b2c')}
                  className={['flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors',
                    customerType === 'b2c' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'].join(' ')}>
                  <User className="h-3.5 w-3.5" /> B2C — Direct Installation Customer
                </button>
              )}
            </div>

            {!customerType && (
              <p className="text-xs text-[var(--color-text-muted)] text-center py-4">
                {allowedTypes.length > 1 ? 'Select B2B or B2C to begin' : `Select ${allowedTypes[0]} to begin`}
              </p>
            )}

            {/* ═══════════════════════════════════════════
                B2B FORM
               ═══════════════════════════════════════════ */}
            {customerType === 'b2b' && (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)] mb-1">
                  Lead: <span className="text-[var(--color-text)]">{lead.name}</span> · {lead.phone}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Company Name *</p>
                    <input type="text" value={b2bForm.company} onChange={e => hB2b('company', e.target.value)} placeholder="e.g. Sharma Solar Pvt Ltd"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">GST Number</p>
                    <input type="text" value={b2bForm.gst} onChange={e => hB2b('gst', e.target.value.toUpperCase())} placeholder="15-char GST"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Contact Person</p>
                    <input type="text" value={b2bForm.contactPerson} onChange={e => hB2b('contactPerson', e.target.value)} placeholder="Primary contact name"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Business Email</p>
                    <input type="email" value={b2bForm.businessEmail} onChange={e => hB2b('businessEmail', e.target.value)} placeholder="office@company.com"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Business Phone</p>
                    <input type="tel" value={b2bForm.businessPhone} onChange={e => hB2b('businessPhone', e.target.value)} placeholder="Landline / alternate"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Office Address</p>
                  <textarea value={b2bForm.address} onChange={e => hB2b('address', e.target.value)} placeholder="Registered office address"
                    className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">State</p>
                    <select value={b2bForm.state} onChange={e => hB2b('state', e.target.value)}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors">
                      {STATE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">City</p>
                    <input type="text" value={b2bForm.city} onChange={e => hB2b('city', e.target.value)} placeholder="City"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════
                B2C FORM
               ═══════════════════════════════════════════ */}
            {customerType === 'b2c' && (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold text-[var(--color-text-muted)] mb-1">
                  Lead: <span className="text-[var(--color-text)]">{lead.name}</span> · {lead.phone} · {lead.email || ''} · {lead.city || ''}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Alternate Mobile</p>
                    <input type="tel" value={b2cForm.altMobile} onChange={e => hB2c('altMobile', e.target.value)} placeholder="Alternate phone number"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Aadhaar Number</p>
                    <input type="text" value={b2cForm.aadhaar} onChange={e => hB2c('aadhaar', e.target.value)} placeholder="12-digit Aadhaar (optional)"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Installation Address *</p>
                  <textarea value={b2cForm.address} onChange={e => hB2c('address', e.target.value)} placeholder="Full installation site address"
                    className="w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" rows={2} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">State</p>
                    <select value={b2cForm.state} onChange={e => hB2c('state', e.target.value)}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors">
                      {STATE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Monthly Bill (₹)</p>
                    <input type="number" value={b2cForm.monthlyBillAmount} onChange={e => hB2c('monthlyBillAmount', e.target.value)} placeholder="e.g. 2500"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Sanction Load (kW)</p>
                    <input type="number" value={b2cForm.sanctionLoad} onChange={e => hB2c('sanctionLoad', e.target.value)} placeholder="e.g. 5"
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1">Roof Type</p>
                    <select value={b2cForm.roofType} onChange={e => hB2c('roofType', e.target.value)}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors">
                      <option value="">Select Roof Type</option>
                      {ROOF_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                {/* Electricity Bill Upload */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Electricity Bill</p>
                  <input type="file" accept="image/*,.pdf" ref={billFileRef} onChange={handleBillFile} className="hidden" id="b2c-bill-upload" />
                  {billPreview ? (
                    <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-4 text-center bg-[var(--color-bg-sunken)]">
                      {billFile?.type?.startsWith('image/') ? (
                        <img src={billPreview} alt="Bill preview" className="max-h-32 mx-auto rounded-lg object-contain border border-[var(--color-border)]" />
                      ) : (
                        <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400">
                          <UploadCloud className="h-5 w-5" />
                          <span className="text-xs font-medium">{billFile?.name}</span>
                        </div>
                      )}
                      <label htmlFor="b2c-bill-upload" className="cursor-pointer text-[10px] font-semibold text-indigo-500 hover:underline block mt-2">
                        Change file
                      </label>
                    </div>
                  ) : (
                    <label htmlFor="b2c-bill-upload" className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-sunken)] p-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/10">
                      <UploadCloud className="h-5 w-5 shrink-0 text-indigo-400" />
                      <span className="text-xs font-medium text-[var(--color-text-secondary)]">Click to upload electricity bill</span>
                      <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">Image or PDF</span>
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* ── Assign To — never left undefined; defaults to the current operator ── */}
            {customerType && (
              <div className="mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-1 flex items-center gap-1.5">
                  <UserCheck className="h-3 w-3" /> Assign Customer To
                </p>
                <select
                  value={assignedToId}
                  onChange={e => setAssignedToId(e.target.value)}
                  className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors"
                >
                  <option value={currentUser.id}>{currentUser.name} (Me)</option>
                  {assignableUsers.filter(u => u.id !== currentUser.id).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[9px] text-[var(--color-text-muted)]">Defaults to you — change this if a manager is assigning to someone else.</p>
              </div>
            )}
          </div>

          {/* ── Action Buttons ─────────────────────────── */}
          {customerType && (
            <div className="flex items-center justify-end gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <button onClick={handleCancel}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-[11px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={saving}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-[11px] font-semibold text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                {saving ? 'Converting...' : `Convert to ${convertTypeLabel}`}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── SUCCESS SCREEN ──────────────────────────────── */}
      {step === 'success' && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-900/20">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-[var(--color-text)]">Customer Created Successfully</h2>
          <div className="mb-6 space-y-1 text-center">
            <p className="text-xs text-[var(--color-text-muted)]">✓ Lead removed from queue</p>
            <p className="text-xs text-[var(--color-text-muted)]">✓ Customer record created</p>
          </div>
          {nextLeadId ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-4 py-3">
              <Clock className="h-4 w-4 text-[var(--color-primary-text)]" />
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                Opening next lead in <span className="font-bold text-[var(--color-text)]">{countdown}</span>...
              </span>
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">Queue completed. No more leads to process.</p>
          )}
          <div className="mt-4 flex gap-1">
            {[1, 2, 3].map(n => (
              <div key={n} className={`h-1.5 w-1.5 rounded-full transition-all duration-500 ${countdown >= n ? 'bg-emerald-500' : 'bg-[var(--color-bg-sunken)]'}`} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
