import { createDocWithId, updateDocById, genId } from './firestore';
import { COLLECTIONS, firebaseEnv } from './firebase';
import { sanitizeFirestoreData } from './sanitizer';
import { useAppStore } from '../store/useAppStore';
import { attachUserRole } from './userIdentity';
import { createCustomerProjectionInTransaction, updateCustomerProjection } from '../features/customers/hooks/useCustomers';
import { sendNotification } from './notifications';
import { NotificationType } from '../types';
import { logActivity, text, type WorkflowRecord } from './workflow';
import { caseEngine } from '../engines/CaseEngine';
import { normalizeDocuments } from '../features/leads/components/workspace/LeadWorkspaceDocumentsSection';
import { resolveBusinessMode } from './companyBusinessMode';
import { isCustomerTypeAllowedForBusinessMode } from './customerClassification';
import { resolveCurrentPartnerDocId } from './partnerOwnership';

export async function convertLeadToCustomer(lead: any, customerType: 'B2B' | 'B2C') {
  const state = useAppStore.getState();
  const companyId = state.activeCompanyId && state.activeCompanyId !== 'all'
    ? state.activeCompanyId
    : state.company?.id || state.user?.companyId || '';
  if (!companyId) throw new Error('Active company is required');

  // Phase 5 (§9.3): a linked Channel Partner may only convert a lead they
  // own. The canonical partner id derives from the authenticated user; a
  // lead attributed to a DIFFERENT partner (or a tampered payload that
  // changed the lead's partnerId) is rejected outright — a partner can
  // never claim another partner's lead by calling the conversion service
  // directly. Non-partner actors (internal Sales/Admin converting an
  // unpartnered lead) have no resolved link and are unaffected.
  const authenticatedPartnerId = await resolveCurrentPartnerDocId();
  const leadPartnerId = String(lead?.partnerId || '').trim();
  if (authenticatedPartnerId && leadPartnerId && authenticatedPartnerId !== leadPartnerId) {
    throw new Error('Cannot convert a lead owned by another partner.');
  }

  // Phase 2: system-invariant guard — the single real enforcement point,
  // regardless of which UI (desktop conversion flow, mobile lead workspace,
  // or any future caller) invoked this function. The company's Business Mode
  // must actually allow the requested classification.
  const businessMode = resolveBusinessMode(state.company);
  if (!isCustomerTypeAllowedForBusinessMode(customerType, businessMode)) {
    throw new Error(`This company operates in ${businessMode} mode and cannot create ${customerType} customers`);
  }

  const { db } = await import('./firebase');
  const { doc, runTransaction } = await import('firebase/firestore');
  const cid = genId.customer();
  let customerId = cid;
  let convertedUserId = '';
  let assignedLeadUserId = '';

  if (!firebaseEnv.isConfigured) {
    await createDocWithId(COLLECTIONS.CUSTOMERS, cid, sanitizeFirestoreData({
      id: cid,
      name: text(lead.name) || 'Unknown',
      phone: text(lead.phone),
      email: text(lead.email),
      company: text(lead.company) || (customerType === 'B2B' ? text(lead.name) : ''),
      city: text(lead.city),
      gst: text(lead.gst),
      type: customerType,
      sourceLeadId: lead.id,
      // Phase 3 (§9.2 rule 2): partner ownership survives conversion.
      partnerId: text(lead.partnerId),
      partnerName: text(lead.partnerName),
      convertedAt: new Date().toISOString(),
      convertedBy: state.user?.id || 'system',
      companyId,
      createdBy: state.user?.id || 'system',
      updatedBy: state.user?.id || 'system',
      isDeleted: false,
      assignedToId: text(lead.assignedToId) || state.user?.id || 'system',
      assignedToName: text(lead.assignedToName) || state.user?.name || 'System',
      // Left Panel/Tabs/Documents/Footer UI standardization mission: carry the
      // lead's already-normalized document list forward as the SAME document
      // references (same Storage URLs) — not a re-upload — so a document
      // uploaded once in the Lead Workspace stays available in the Customer
      // Workspace without creating a duplicate.
      documents: normalizeDocuments(lead),
    }));
    await updateDocById(COLLECTIONS.LEADS, lead.id, {
      status: 'Converted',
      convertedCustomerId: cid,
      conversionStatus: 'Completed',
      updatedBy: state.user?.id || 'system',
    });
    // Assignment must never be left undefined — default to the current
    // operator when nobody was explicitly assigned during conversion.
    assignedLeadUserId = text(lead.assignedToId) || state.user?.id || 'system';
  } else {
  await runTransaction(db, async (transaction) => {
    const leadRef = doc(db, COLLECTIONS.LEADS, lead.id);
    const leadSnap = await transaction.get(leadRef);
    if (!leadSnap.exists()) {
      throw new Error(`Lead ${lead.id} not found`);
    }

    const currentLead = leadSnap.data() as WorkflowRecord;
    if (currentLead.convertedCustomerId) {
      customerId = text(currentLead.convertedCustomerId);
      convertedUserId = text(currentLead.userId);
      assignedLeadUserId = text(currentLead.assignedToId);
      return;
    }
    if (currentLead.companyId !== companyId) {
      throw new Error(`Lead ${lead.id} does not belong to the active company`);
    }

    // Assignment must never be left undefined: use whatever was explicitly
    // chosen in the conversion form (lead.assignedToId/Name, set by the
    // operator or manager there), and only fall back to the current
    // operator if nothing was assigned at all.
    const resolvedAssignedToId = text(lead.assignedToId) || text(currentLead.assignedToId) || state.user?.id || 'system';
    const resolvedAssignedToName = text(lead.assignedToName) || text(currentLead.assignedToName) || state.user?.name || 'System';

    const customerResult = await createCustomerProjectionInTransaction(transaction, customerId, {
      id: cid,
      name: text(currentLead.name) || lead.name || 'Unknown',
      phone: text(currentLead.phone) || lead.phone || '',
      email: text(currentLead.email) || lead.email || '',
      company: text(currentLead.company) || lead.company || (customerType === 'B2B' ? text(currentLead.name) || lead.name : ''),
      city: text(currentLead.city) || lead.city || '',
      gst: text(currentLead.gst) || lead.gst || '',
      type: customerType,
      sourceLeadId: lead.id,
      // Phase 3 (§9.2 rule 2): partner ownership survives conversion.
      partnerId: text(currentLead.partnerId) || text(lead.partnerId),
      partnerName: text(currentLead.partnerName) || text(lead.partnerName),
      convertedAt: new Date().toISOString(),
      convertedBy: state.user?.id || 'system',
      companyId,
      createdBy: state.user?.id || 'system',
      updatedBy: state.user?.id || 'system',
      isDeleted: false,
      assignedToId: resolvedAssignedToId,
      assignedToName: resolvedAssignedToName,
      // Same-reference document carry-forward as the demo-mode branch above —
      // prefer the freshly-read transactional lead, falling back to the
      // caller's in-memory copy for any field the snapshot lacks.
      documents: normalizeDocuments({ ...lead, ...currentLead }),
    });
    convertedUserId = customerResult.userId;
    assignedLeadUserId = resolvedAssignedToId;

    transaction.set(leadRef, sanitizeFirestoreData({
      status: 'Converted',
      convertedCustomerId: cid,
      userId: convertedUserId,
      conversionStatus: 'Completed',
      updatedBy: state.user?.id || 'system'
    }), { merge: true });
  });
  }

  if (convertedUserId) {
    try {
      await attachUserRole(convertedUserId, 'Customer', state.user?.id || 'system');
      await updateCustomerProjection(customerId, { updatedBy: state.user?.id || 'system' });
    } catch (error) {
      console.warn('Post-conversion identity propagation failed', error);
    }
  }

  // Phase 3B: Propagate caseId from Lead to Customer; create Case if missing
  const leadCaseId = text(lead.caseId);
  if (leadCaseId) {
    await updateDocById(COLLECTIONS.CUSTOMERS, customerId, { caseId: leadCaseId });
  } else {
    // No existing Case — create one for this lead+customer pair
    try {
      const newCase = await caseEngine.createCase(lead.id, companyId, customerId);
      const caseId = newCase.caseId;
      await updateDocById(COLLECTIONS.LEADS, lead.id, { caseId });
      await updateDocById(COLLECTIONS.CUSTOMERS, customerId, { caseId });
    } catch (err: any) {
      console.warn('[CasePropagation] Could not create Case during conversion:', err?.message);
    }
  }

  await logActivity('Leads', 'Converted to Customer', lead.id, {
    customerId,
    customerType,
    entityName: lead.name || lead.company || lead.phone || lead.id,
    actionLabel: 'Converted lead to customer',
  });
  void sendNotification(
    assignedLeadUserId,
    NotificationType.LEAD_ASSIGNED,
    'Lead converted to customer',
    `${lead.name || lead.company || 'Lead'} was converted to a customer.`,
    'lead',
    lead.id,
    companyId
  );

  return customerId;
}
