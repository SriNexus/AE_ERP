import { createDocWithId, getOne, updateDocById, genId, resolveWriteCompanyId } from './firestore';
import { getNextDocumentNumber, resolveDocumentDefaults } from './documentNumbering';
import { COLLECTIONS } from './firebase';
import { useAppStore } from '../store/useAppStore';
import { NotificationType } from '../types';
import { logActivity, notifyUsers, usersByRole } from './workflow';
import { canDo } from './permissions';
import { propagateCaseIdFromChain } from './casePropagation';
import { resolveCustomerType, type ClassifiableCustomer } from './customerClassification';
import type { EngineeringDesignRecord } from '../features/engineering/types';
import type { ProjectRecord } from '../features/projects/types';
import { buildProjectStageAdvancePatch, isProjectStageAtOrPast } from './projectLifecycle';

export function quotationItemsFromEngineering(design: EngineeringDesignRecord) {
  return [
    {
      productId: '', product: 'Solar PV Modules',
      description: `${design.panelCount} × ${design.panelWattage} W modules from approved design ${design.designId}`,
      hsn: '', specs: `${design.panelWattage} W; ${design.systemCapacityKw} kW system`, warranty: '',
      qty: design.panelCount, unit: 'Nos', price: 0, tax: 0, discount: 0,
    },
    {
      productId: '', product: 'Solar Inverter', description: design.inverterSpec,
      hsn: '', specs: `${design.systemCapacityKw} kW system`, warranty: '',
      qty: 1, unit: 'Nos', price: 0, tax: 0, discount: 0,
    },
  ];
}

export function projectQuotationPatch(project: ProjectRecord, quotationId: string, changedBy: string) {
  const linkedQuotationIds = Array.from(new Set([...(project.linkedQuotationIds || []), quotationId]));
  if (isProjectStageAtOrPast(project.currentStage, 'Quotation')) return { linkedQuotationIds };
  return {
    linkedQuotationIds,
    ...buildProjectStageAdvancePatch(project, 'Quotation', changedBy, `Quotation ${quotationId} linked`),
  };
}

export function projectOrderPatch(project: ProjectRecord, orderId: string, changedBy: string) {
  const linkedOrderIds = Array.from(new Set([...(project.linkedOrderIds || []), orderId]));
  if (isProjectStageAtOrPast(project.currentStage, 'Order')) return { linkedOrderIds };
  return {
    linkedOrderIds,
    ...buildProjectStageAdvancePatch(project, 'Order', changedBy, `Order ${orderId} created from approved quotation`),
  };
}
/**
 * Single source of truth for the quotation lock: a quotation is locked the
 * moment an Order has been generated from it (convertQuotationToOrder writes
 * status 'Converted to Order' + convertedOrderId). Being converted is the
 * ONLY thing that locks a quotation — every other status (Draft/Sent/
 * Accepted/Rejected/Expired) remains editable under the existing rules.
 */
export function isQuotationLocked(quote: any): boolean {
  return quote?.status === 'Converted to Order' || Boolean(quote?.convertedOrderId);
}

/**
 * Lock-guarded quotation update. The quotation's content (items/prices/
 * totals/status) may be edited while the quotation is still editable under
 * the existing business rules, but NEVER after an Order has been generated
 * from it — the update path itself enforces this, so even a caller that
 * reaches the edit functionality through another route/component cannot
 * mutate a converted quotation. UI should additionally hide/disable Edit via
 * isQuotationLocked(), but the guard here is the enforcement, not the UI.
 */
export async function updateQuotation(quotationId: string, payload: Record<string, unknown>) {
  // Permission parity with synchronizeQuotationProjectLink: the edit rule is
  // enforced at the service layer, not only by whatever UI reached it.
  if (!canDo('edit', 'quotations')) throw new Error('You do not have permission to edit quotations');
  const existing = await getOne<any>(COLLECTIONS.QUOTATIONS, quotationId);
  if (!existing) throw new Error('Quotation not found');
  if (isQuotationLocked(existing)) {
    throw new Error('This quotation has been converted to an Order and can no longer be edited');
  }
  // Read-then-write, matching the codebase's other workflow services — the
  // lock is best-effort here; a concurrent conversion completing between the
  // read and this write is the same race convertQuotationToOrder itself has.
  await updateDocById(COLLECTIONS.QUOTATIONS, quotationId, payload);
  return { ...existing, ...payload, id: quotationId };
}

/** Coordinates the optional quotation link without moving quotation business logic into UI. */
export async function synchronizeQuotationProjectLink(quotationId: string, projectId?: string, engineeringDesignId?: string) {
  if (!canDo('edit', 'quotations')) throw new Error('You do not have permission to link quotations');
  const state = useAppStore.getState();
  const quotation = await getOne<any>(COLLECTIONS.QUOTATIONS, quotationId);
  if (!quotation) throw new Error('Quotation not found');
  const previousProjectId = String(quotation.projectId || '');
  const nextProjectId = String(projectId || '');

  if (engineeringDesignId) {
    const design = await getOne<EngineeringDesignRecord>(COLLECTIONS.ENGINEERING_DESIGNS, engineeringDesignId);
    if (!design || design.status !== 'Approved') throw new Error('Only an approved engineering design can be linked');
    if (design.projectId !== nextProjectId) throw new Error('Engineering design does not belong to the selected project');
  }

  if (previousProjectId && previousProjectId !== nextProjectId) {
    const previous = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, previousProjectId);
    if (previous) await updateDocById(COLLECTIONS.PROJECTS, previousProjectId, {
      linkedQuotationIds: (previous.linkedQuotationIds || []).filter((id) => id !== quotationId),
    });
  }

  if (nextProjectId) {
    const project = await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, nextProjectId);
    if (!project) throw new Error('Project not found');
    if (project.customerId && quotation.customerId && project.customerId !== quotation.customerId) {
      throw new Error('Quotation customer must match the selected project customer');
    }
    await updateDocById(COLLECTIONS.PROJECTS, nextProjectId, projectQuotationPatch(project, quotationId, state.user?.id || 'system'));
  }

  await updateDocById(COLLECTIONS.QUOTATIONS, quotationId, {
    projectId: nextProjectId,
    engineeringDesignId: engineeringDesignId || '',
  });
  await logActivity('Quotations', nextProjectId ? 'Linked to Project' : 'Unlinked from Project', quotationId, {
    projectId: nextProjectId,
    engineeringDesignId: engineeringDesignId || '',
    entityName: quotation.customer || quotationId,
    actionLabel: nextProjectId ? `Linked quotation to project ${nextProjectId}` : 'Removed quotation project link',
  });
  if (nextProjectId) notifyUsers(
    await usersByRole('Sales'), NotificationType.TASK_STATUS_CHANGED,
    'Quotation linked to project', `Quotation ${quotationId} is now linked to project ${nextProjectId}.`,
    'quotation', quotationId, resolveWriteCompanyId() || quotation.companyId || '',
  );
}

export interface CreateQuotationInput {
  /** Raw form values (may include projectId/engineeringDesignId). */
  form: any;
  items: any[];
  subtotal: number;
  taxTotal: number;
  totalDiscount: number;
  grandTotal: number;
  companyId: string;
  quotationPrefix?: string;
  createdBy: string;
}

/** Creates a new Quotation document. Extracted verbatim from the create branch of
 * `Quotations.tsx`'s own `save` mutation (PRE-EXISTING BEHAVIOR, unchanged) so a
 * second caller (Customer Workspace) can create a quotation without duplicating
 * this logic. Editing an existing quotation is intentionally NOT covered here —
 * `Quotations.tsx` keeps that branch inline, since only creation is embedded
 * elsewhere. */
export async function createQuotation(input: CreateQuotationInput) {
  const { projectId, engineeringDesignId, ...quotationFields } = input.form;
  const payload = {
    ...quotationFields, items: input.items, subtotal: input.subtotal, taxTotal: input.taxTotal,
    installationCharges: Number(input.form.installationCharges) || 0,
    transportCharges: Number(input.form.transportCharges) || 0,
    specialDiscount: Number(input.form.specialDiscount) || 0,
    discount: input.totalDiscount,
    total: input.grandTotal,
    createdBy: input.createdBy,
  };
  const documentDefaults = await resolveDocumentDefaults(input.companyId);
  const id = genId.quotation(input.quotationPrefix);
  const { documentNumber } = await getNextDocumentNumber(input.companyId, 'quotation');
  const validUntil = input.form.validUntil || new Date(Date.now() + documentDefaults.settings.piValidityDays * 86400000).toISOString().split('T')[0];
  const createdQuotation = {
    ...payload, id, quotationNumber: documentNumber, quoteNumber: documentNumber, refNo: documentNumber,
    terms: input.form.terms || documentDefaults.settings.defaultTerms,
    notes: input.form.notes || documentDefaults.settings.defaultNotes,
    validUntil,
  };
  await createDocWithId(COLLECTIONS.QUOTATIONS, id, createdQuotation);
  await synchronizeQuotationProjectLink(id, projectId, engineeringDesignId);
  return { ...createdQuotation, projectId, engineeringDesignId };
}

export async function convertQuotationToOrder(quote: any) {
  const state = useAppStore.getState();
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId() || quote.companyId || '';
  const changedBy = state.user?.id || 'system';
  const oid = genId.order(state.company.orderPrefix);
  const { documentNumber } = await getNextDocumentNumber(companyId, 'order');
  const projectId = String(quote.projectId || '');
  const project = projectId ? await getOne<ProjectRecord>(COLLECTIONS.PROJECTS, projectId) : null;
  if (projectId && !project) throw new Error('Linked project not found');

  // Phase 3: orderType must reflect the real customer classification, never a
  // hardcoded default. Quotation does not denormalize customer type, so resolve
  // it from the linked Customer record — the same canonical resolver Phase 2
  // introduced for every other customer-type decision in the ERP. A quotation
  // with no resolvable, validly-typed customer cannot be converted — this is a
  // clear, actionable failure instead of silently corrupting the Order's
  // business classification (previously: always hardcoded to 'B2C').
  const customerId = String(quote.customerId || '');
  if (!customerId) throw new Error('This quotation is not linked to a Customer record — link a Customer before converting it to an Order');
  const customer = await getOne<ClassifiableCustomer>(COLLECTIONS.CUSTOMERS, customerId);
  const orderType = resolveCustomerType(customer);
  if (!orderType) throw new Error(`Customer ${customerId} does not have a valid B2B/B2C classification — cannot convert quotation to order`);

  // Map items to include dispatch tracking properties
  const orderItems = (quote.items || []).map((it: any) => ({
    ...it,
    dispatchedQty: 0,
    pendingQty: Number(it.qty) || 0
  }));

  // 1. Create Order
  await createDocWithId(COLLECTIONS.ORDERS, oid, {
    id: oid,
    orderNumber: documentNumber,
    orderNo: documentNumber,
    customerId: quote.customerId,
    customer: quote.customer,
    orderType,
    date: new Date().toISOString().split('T')[0],
    status: 'Pending',
    paymentStatus: 'Pending',
    subtotal: quote.subtotal,
    total: quote.total,
    discount: Number(quote.discount || quote.specialDiscount || 0),
    specialDiscount: Number(quote.specialDiscount || quote.discount || 0),
    installationCharges: Number(quote.installationCharges || 0),
    transportCharges: Number(quote.transportCharges || 0),
    items: orderItems,
    sourceQuotationId: quote.id,
    quotationId: quote.id,
    projectId,
    engineeringDesignId: String(quote.engineeringDesignId || ''),
    // Financial Tracking
    taxAmount: Number(quote.taxAmount ?? quote.taxTotal ?? 0),
    taxTotal: Number(quote.taxTotal ?? quote.taxAmount ?? 0),
    totalInvoiced: 0,
    pendingBilling: quote.total
  });

  if (project) {
    await updateDocById(COLLECTIONS.PROJECTS, project.id, projectOrderPatch(project, oid, changedBy));
  }

  // 2. Update Quotation
  await updateDocById(COLLECTIONS.QUOTATIONS, quote.id, {
    status: 'Converted to Order',
    convertedOrderId: oid,
    convertedAt: new Date().toISOString()
  });

  // 3. Log Audit
  await logActivity('Quotations', 'Converted to Order', quote.id, {
    orderId: oid,
    orderNumber: documentNumber,
    entityName: quote.customer || quote.customerName || quote.id,
    actionLabel: 'Converted quotation to order',
  });
  notifyUsers(
    await usersByRole('Accounts'),
    NotificationType.ORDER_PLACED,
    'Order placed',
    `Quotation ${quote.id} was converted to order ${documentNumber}.`,
    'order',
    oid,
    companyId
  );

  // Phase 3B: Propagate caseId from quotation chain to order
  void propagateCaseIdFromChain('orders', oid);

  return oid;
}
