import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { doc, runTransaction, serverTimestamp, type Transaction } from 'firebase/firestore';
import { createDocWithId, getAll, genId, getOne, resolveWriteCompanyId, resolveWriteGroupId } from '../../../lib/firestore';
import { resolveCurrentPartnerDocId, partnerDisplayName } from '../../../lib/partnerOwnership';
import {
  deleteProjectionWithEntity,
} from '../../../lib/entityProjection';
import { COLLECTIONS, db, firebaseEnv } from '../../../lib/firebase';
import { sanitizeFirestoreData } from '../../../lib/sanitizer';
import { linkMasterIdentityBestEffort, normalizePhone } from '../../../lib/userIdentity';
import { useCurrentUser, useAppStore } from '../../../store/useAppStore';
import { queryKeys } from '../../../lib/queryKeys';
import { CustomerDomainService } from '../../../services/CustomerDomainService';
import { usePaginatedCollection } from '../../../hooks/usePaginatedCollection';
import { resolveBusinessMode } from '../../../lib/companyBusinessMode';
import { isCustomerTypeAllowedForBusinessMode } from '../../../lib/customerClassification';
import toast from 'react-hot-toast';

export const CUSTOMER_FORM_DEFAULT = {
  name: '', phone: '', email: '', gst: '', pan: '', company: '',
  address: '', city: '', state: '', pincode: '', country: 'India',
  type: 'B2B', category: '', creditLimit: '', paymentTerms: '30', notes: '',
};
export type CustomerForm = typeof CUSTOMER_FORM_DEFAULT;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compactDelta(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null)
  );
}

const CUSTOMER_PHONE_LOCKS = 'customer_phone_locks';

export function formatCustomerDate(value: unknown): string {
  if (!value) return '—';
  const date = typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function'
    ? value.toDate()
    : typeof value === 'object' && value && 'seconds' in value
      ? new Date(Number(value.seconds) * 1000)
      : value instanceof Date
        ? value
        : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function customerPhoneLockId(companyId: string, phone: string) {
  return `${encodeURIComponent(companyId)}_${phone}`;
}

export async function assertUniqueCustomerPhone(companyId: string, phone: string, excludeCustomerId?: string) {
  const normalizedPhone = normalizePhone(phone);
  const lockSnap = await getOne<Record<string, unknown>>(CUSTOMER_PHONE_LOCKS, customerPhoneLockId(companyId, normalizedPhone));
  if (lockSnap && lockSnap.customerId !== excludeCustomerId) throw new Error('Customer phone already exists for this company');
  return normalizedPhone;
}

// Tenant safety: delegates to the canonical resolveWriteCompanyId() instead
// of a local duplicate that treated the neutral 'default' placeholder as
// real and fell back to the literal string 'default' (Admin
// companyId='default' 403-storm root cause — same bug class fixed in
// entityProjection.ts's systemCompanyId).
function resolveCompanyId(payload: Record<string, unknown>) {
  return stringValue(payload.companyId) || resolveWriteCompanyId();
}

function resolveCreatedBy(payload: Record<string, unknown>) {
  return stringValue(payload.createdBy) || useAppStore.getState().user?.id || 'system';
}

export async function createCustomerProjectionInTransaction(
  transaction: Transaction,
  id: string,
  payload: Record<string, unknown>,
  // Pre-resolved, OPTIONAL master-identity link. Resolved BEFORE the transaction
  // by the caller via userIdentity.linkMasterIdentityBestEffort (identical model
  // to Lead creation): the users/MUSR-* contact write is CRM enrichment and is
  // NOT allowed to abort this transaction — the phone-lock + canonical Customer
  // are the only REQUIRED writes here. '' when the link was denied/skipped; an
  // Admin edit/backfill populates it later.
  masterUserId = ''
) {
  const companyId = resolveCompanyId(payload);
  const phone = normalizePhone(stringValue(payload.phone || payload.mobile || payload.businessPhone));
  if (!phone || phone.length !== 10) throw new Error('A valid 10 digit phone is required');

  const createdBy = resolveCreatedBy(payload);
  // Same "Group Admin cannot add stock" bug class: this raw Firestore
  // transaction bypasses createDocWithId()'s automatic groupId stamping
  // (Master Plan §3.4); firestore.rules' groupAdminCanCreate() requires a
  // `groupId` field to match a Group Admin creating a Customer for a
  // sibling Company of their Group.
  const groupId = resolveWriteGroupId(companyId);
  const lockRef = doc(db, CUSTOMER_PHONE_LOCKS, customerPhoneLockId(companyId, phone));
  const lockSnap = await transaction.get(lockRef);
  if (lockSnap.exists() && lockSnap.data().isDeleted !== true && lockSnap.data().customerId !== id) {
    throw new Error('Customer phone already exists for this company');
  }

  const now = serverTimestamp();
  transaction.set(lockRef, sanitizeFirestoreData({
    id: lockRef.id,
    companyId,
    ...(groupId ? { groupId } : {}),
    phone,
    customerId: id,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  }));
  transaction.set(doc(db, COLLECTIONS.CUSTOMERS, id), sanitizeFirestoreData({
    ...payload,
    id,
    phone,
    ...(masterUserId ? { userId: masterUserId, masterUserId } : {}),
    companyId,
    ...(groupId ? { groupId } : {}),
    createdBy,
    updatedBy: stringValue(payload.updatedBy) || createdBy,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  }));
  return { id, userId: masterUserId, masterUserId, companyId, phone };
}

export async function createCustomerProjection(id: string, payload: Record<string, unknown>) {
  // Phase 2: system-invariant guard for the direct-create path (leadWorkflow.ts's
  // convertLeadToCustomer carries its own equivalent guard for the conversion path).
  const requestedType = stringValue(payload.type);
  if (requestedType === 'B2B' || requestedType === 'B2C') {
    const businessMode = resolveBusinessMode(useAppStore.getState().company);
    if (!isCustomerTypeAllowedForBusinessMode(requestedType, businessMode)) {
      throw new Error(`This company operates in ${businessMode} mode and cannot create ${requestedType} customers`);
    }
  }
  // Phase 3 (§9.2 rule 2/§9.3): when the actor is a linked Channel Partner and
  // the payload does not already carry explicit partner attribution, derive
  // partnerId from the authenticated user's canonical link
  // (users.channelPartnerId) and partnerName from the partner record. The
  // partner can never supply another partner's id via the payload here — the
  // derivation is authoritative and a supplied-but-different partnerId is
  // rejected by the write-side rules in Phase 13; this keeps direct customer
  // creation (not via lead conversion) inside the ownership chain.
  if (!stringValue(payload.partnerId)) {
    const partnerDocId = await resolveCurrentPartnerDocId();
    if (partnerDocId && !payload.partnerId) {
      payload.partnerId = partnerDocId;
      if (!stringValue(payload.partnerName)) {
        // The channel_partners doc has NO `partnerName` field — a Channel
        // Partner is a human/agent: derive firm-or-human via the canonical
        // resolver so a firm-less agent's customers still carry a readable
        // attribution name (the partnerId is what matters for ownership).
        const partner = await getOne<{ firmName?: string; contactPerson?: string }>(COLLECTIONS.CHANNEL_PARTNERS, partnerDocId);
        payload.partnerName = partnerDisplayName(partner, '') || undefined;
      }
    }
  }

  if (!firebaseEnv.isConfigured) {
    const companyId = resolveCompanyId(payload);
    const phone = normalizePhone(stringValue(payload.phone || payload.mobile || payload.businessPhone));
    if (!phone || phone.length !== 10) throw new Error('A valid 10 digit phone is required');
    const createdBy = resolveCreatedBy(payload);
    await createDocWithId(COLLECTIONS.CUSTOMERS, id, sanitizeFirestoreData({
      ...payload,
      id,
      phone,
      companyId,
      createdBy,
      updatedBy: stringValue(payload.updatedBy) || createdBy,
      isDeleted: false,
    }));
    return { id, userId: '', masterUserId: '', companyId, phone };
  }

  // OPTIONAL master-identity enrichment — resolved OUTSIDE the transaction and
  // BEST-EFFORT, exactly like Lead creation (entityProjection.attachUserId).
  // The users/MUSR-* contact write shares the heavy staff-account `users`
  // rules (which route a Group Admin through a group-coherence CREATE arm the
  // group-less contact cannot satisfy); that must never block Customer
  // creation, so a denial here just leaves the link empty and an Admin
  // edit/backfill fills it in.
  const companyId = resolveCompanyId(payload);
  const masterUserId = await linkMasterIdentityBestEffort(
    {
      name: stringValue(payload.name || payload.fullName || payload.contactPerson || payload.company),
      email: stringValue(payload.email || payload.businessEmail),
      phone: stringValue(payload.phone || payload.mobile || payload.businessPhone),
      companyId,
      createdBy: resolveCreatedBy(payload),
      linkedModules: ['customers'],
    },
    'Customer',
  );

  const result = await runTransaction(db, (transaction) =>
    createCustomerProjectionInTransaction(transaction, id, payload, masterUserId));
  await updateCustomerProjection(id, { updatedBy: resolveCreatedBy(payload) });
  return result;
}

export async function updateCustomerProjectionWithPhoneLock(id: string, payload: Record<string, unknown>) {
  const current = await getOne<Record<string, unknown>>(COLLECTIONS.CUSTOMERS, id);
  if (!current) throw new Error('Customer not found');

  // Phase 4: cross-entity validation before Customer reclassification.
  // "B2B customers must NEVER have a Project" is a locked, non-negotiable
  // business rule (Blueprint §Business Rules) — so re-typing an existing
  // B2C customer to B2B is only safe if it has no linked Project yet. This
  // is a service-layer guard (defense-in-depth, matching the pattern every
  // prior phase used at the true lowest-level write) — the Customer
  // Workspace editor also disables the B2B option in this situation for
  // immediate UI feedback, but this check is what actually prevents it.
  const nextType = stringValue(payload.type);
  const currentType = stringValue(current.type) || 'B2B';
  if (nextType === 'B2B' && currentType !== 'B2B') {
    const projects = await getAll<Record<string, unknown>>(COLLECTIONS.PROJECTS);
    const hasLinkedProject = projects.some((project) => project.customerId === id && project.isDeleted !== true);
    if (hasLinkedProject) {
      throw new Error('This customer has a linked Project and cannot be reclassified as B2B — B2B customers can never have a Project.');
    }
  }

  const companyId = resolveCompanyId({ ...current, ...payload });
  const oldPhone = normalizePhone(stringValue(current.phone || current.mobile || current.businessPhone));
  const nextPhone = normalizePhone(stringValue(payload.phone || payload.mobile || payload.businessPhone || current.phone));
  if (!nextPhone || nextPhone.length !== 10) throw new Error('A valid 10 digit phone is required');

  if (!firebaseEnv.isConfigured) {
    return updateCustomerProjection(id, { ...payload, phone: nextPhone, companyId });
  }

  const groupId = resolveWriteGroupId(companyId);

  await runTransaction(db, async (transaction) => {
    const nextLockRef = doc(db, CUSTOMER_PHONE_LOCKS, customerPhoneLockId(companyId, nextPhone));
    const nextLockSnap = await transaction.get(nextLockRef);
    if (nextLockSnap.exists() && nextLockSnap.data().isDeleted !== true && nextLockSnap.data().customerId !== id) {
      throw new Error('Customer phone already exists for this company');
    }
    const oldLockRef = oldPhone && oldPhone !== nextPhone
      ? doc(db, CUSTOMER_PHONE_LOCKS, customerPhoneLockId(companyId, oldPhone))
      : null;
    const oldLockSnap = oldLockRef ? await transaction.get(oldLockRef) : null;

    transaction.set(nextLockRef, sanitizeFirestoreData({
      id: nextLockRef.id,
      companyId,
      // A brand-new lock doc (phone changed) needs groupId stamped for the
      // same reason as createCustomerProjectionInTransaction() above.
      ...(groupId ? { groupId } : {}),
      phone: nextPhone,
      customerId: id,
      createdAt: nextLockSnap.exists() ? nextLockSnap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
      isDeleted: false,
    }), { merge: true });

    if (oldLockRef && oldLockSnap?.exists() && oldLockSnap.data().customerId === id) {
      transaction.set(oldLockRef, sanitizeFirestoreData({ isDeleted: true, releasedAt: serverTimestamp(), updatedAt: serverTimestamp() }), { merge: true });
    }
  });

  return updateCustomerProjection(id, { ...payload, phone: nextPhone, companyId });
}

export async function deleteCustomerProjection(id: string) {
  if (!firebaseEnv.isConfigured) {
    return deleteProjectionWithEntity(COLLECTIONS.CUSTOMERS, id);
  }

  const current = await getOne<Record<string, unknown>>(COLLECTIONS.CUSTOMERS, id);
  const result = await deleteProjectionWithEntity(COLLECTIONS.CUSTOMERS, id);
  if (current) {
    const companyId = resolveCompanyId(current);
    const phone = normalizePhone(stringValue(current.phone || current.mobile || current.businessPhone));
    if (phone) {
      await runTransaction(db, async (transaction) => {
        const lockRef = doc(db, CUSTOMER_PHONE_LOCKS, customerPhoneLockId(companyId, phone));
        const lockSnap = await transaction.get(lockRef);
        if (lockSnap.exists() && lockSnap.data().customerId === id) {
          transaction.set(lockRef, sanitizeFirestoreData({ isDeleted: true, releasedAt: serverTimestamp(), updatedAt: serverTimestamp() }), { merge: true });
        }
      });
    }
  }
  return result;
}

export function updateCustomerProjection(id: string, payload: Record<string, unknown>) {
  // Phase 5.1 fix: CustomerDomainService.updateProjection() applies a narrow
  // 4-field allowlist (name/phone/email/city) meant for cross-entity
  // projection sync (see LeadDomainService.update()'s own direct call to it
  // when propagating a converted Lead's identity fields onto its Customer).
  // This wrapper is the customer's OWN primary update path — used by the
  // list-page Edit form, Mobile Customer Workspace, and Customer Workspace
  // Save via updateCustomerProjectionWithPhoneLock — and must persist the
  // full delta, not just the projection fields. Using .updateProjection()
  // here silently dropped every other field (gst, pan, address, state,
  // pincode, company, creditLimit, paymentTerms, notes, assignedToId/Name,
  // activityLog, ...) on every customer edit.
  return CustomerDomainService.update(id, compactDelta(payload));
}

export function useCustomers() {
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys = queryKeys.forCompany(activeCompanyId);
  return usePaginatedCollection(keys.customersPaged, COLLECTIONS.CUSTOMERS, 30_000);
}

export function useSaveCustomer(editId: string | null, onSuccess: () => void) {
  const qc              = useQueryClient();
  const user            = useCurrentUser();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);

  return useMutation({
    mutationFn: async (data: CustomerForm) => {
      const payload = { ...data, creditLimit: Number(data.creditLimit) || 0, paymentTerms: Number(data.paymentTerms) || 30 };
      if (editId) {
        await CustomerDomainService.update(editId, { ...payload, updatedBy: user.id });
      } else {
        const id = genId.customer();
        // Master-identity linking happens ONCE, inside createCustomerProjection
        // (best-effort, before its phone-lock transaction). The separate
        // unwrapped call that used to sit here was redundant (its result was
        // never used) and hard-failed the whole Customer creation for every
        // actor the `users` rules don't let write a contact identity —
        // Group Admin especially — before the canonical write was even reached.
        await createCustomerProjection(id, { ...payload, id, createdBy: user.id, companyId: activeCompanyId });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.customersRoot });
      toast.success(editId ? 'Customer updated' : 'Customer added');
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteCustomer() {
  const qc              = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  const keys            = queryKeys.forCompany(activeCompanyId);
  return useMutation({
    mutationFn: (id: string) => deleteCustomerProjection(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: keys.customersRoot }); toast.success('Customer deleted'); },
    onError:    (e: any) => toast.error(e.message),
  });
}

export function exportCustomersCSV(customers: any[]) {
  const rows = [
    ['ID', 'Name', 'Phone', 'Email', 'Company', 'GST', 'City', 'State', 'Type', 'Date'],
    ...customers.map((c: any) => [c.id, c.name, c.phone, c.email, c.company, c.gst, c.city, c.state, c.type, formatCustomerDate(c.createdAt)]),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = 'customers.csv';
  a.click();
  toast.success('Exported!');
}
