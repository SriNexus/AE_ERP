/**
 * CustomerWorkspacePersistence — maps the workspace draft into a customer's
 * Firestore delta. Mirrors LeadWorkspacePersistence.ts's role exactly:
 * reuses the EXISTING persistence primitives, does not implement a second
 * customer-update engine.
 *
 *   - updateCustomerProjectionWithPhoneLock  (the real Edit form's own save
 *     function — phone-lock transaction, master-identity resolution,
 *     updatedBy/updatedAt auto-stamping all happen inside it, unchanged)
 *   - sendNotification                       (same CUSTOMER_UPDATED notification
 *     the list page's Edit form sends)
 *   - logActivity                            (audit trail, same shape as every
 *     other module's "X Updated" entry)
 *
 * CUSTOMER_DRAFT_FIELDS is the exact, real field set the Edit Customer form
 * (CustomerWorkspaceEditor.tsx) supports — not the Master Plan's broader
 * aspirational list. Most B2C-specific fields (roofType, sanctionLoad,
 * monthlyBillAmount, propertyType/projectType, aadhaar) still have no
 * existing edit path today — Phase 5 did not invent one; see the Phase 5
 * report §5 for this scoping decision. `altName`/`altMobile` (Alternate Name/
 * Number) are the one exception, added by the Customer + Leads Workspace
 * Completion Pass mission — plain string fields, same additive
 * array-driven staging/delta/validation every other field here already uses,
 * not a new storage structure or save path.
 *
 * `type` (B2B/B2C) IS included, deliberately reversing Phase 5's original
 * exclusion: the legacy list-page structural-edit form (the one exception
 * that could change it) has been retired — Customer Type is now changed
 * through this same deferred-commit editor like every other field. The
 * "flip Center/Right panels mid-edit" concern that originally motivated the
 * exclusion doesn't actually apply: those panels read `customer.type` (the
 * saved value), not the draft, so they correctly stay on the current type
 * until Save completes and refetches — only the editor's OWN conditional
 * fields (GST/Company/Credit Limit/Payment Terms) need to react live to the
 * draft's pending type, which CustomerWorkspaceEditor.tsx now does.
 */
import { updateCustomerProjectionWithPhoneLock } from '../../hooks/useCustomers';
import { resolveNotificationCompanyId, sendNotification } from '../../../../lib/notifications';
import { logActivity } from '../../../../lib/workflow';
import { genId } from '../../../../lib/firestore';
import { NotificationType } from '../../../../types';

export const CUSTOMER_DRAFT_FIELDS = [
  'name', 'phone', 'altName', 'altMobile', 'email', 'type', 'company', 'gst', 'pan',
  'address', 'city', 'state', 'pincode',
  'creditLimit', 'paymentTerms', 'notes',
  'assignedToId', 'assignedToName',
] as const;

export type CustomerDraftField = typeof CUSTOMER_DRAFT_FIELDS[number];
export type CustomerDraft = Partial<Record<CustomerDraftField, string>>;

/**
 * Build the Firestore delta from the current draft. Only includes fields
 * that actually differ from the loaded customer, so a Save with a
 * since-reverted field is a no-op for that field (idempotent, matches
 * buildWorkspaceLeadDelta's same discipline).
 *
 * Identity-lock enforcement: when `customer.sourceLeadId` is set, `name`
 * and `phone` are stripped from the delta unconditionally — a defensive
 * second check, not trusting the editor UI alone to have kept them
 * unwritable (the UI already disables those inputs; this is the same
 * "don't trust the caller" discipline `updateCustomerProjectionWithPhoneLock`
 * itself already applies to the phone-lock transaction).
 */
export function buildCustomerDraftDelta(customer: any, draft: CustomerDraft): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  const locksIdentity = Boolean(customer?.sourceLeadId);

  for (const field of CUSTOMER_DRAFT_FIELDS) {
    if (!(field in draft)) continue;
    if (locksIdentity && (field === 'name' || field === 'phone')) continue;

    const draftValue = draft[field];
    // Stringify uniformly for comparison, matching CustomerWorkspaceEditor's
    // own fieldValue() display logic exactly (Phase 5.1 fix) — a field
    // stored as a non-string type in Firestore (e.g. a legacy numeric
    // pincode) previously compared unequal to its own unchanged value,
    // silently including it in every save's delta.
    const rawCurrent = customer?.[field];
    const currentValue = rawCurrent === undefined || rawCurrent === null ? '' : String(rawCurrent);

    if (draftValue === undefined) continue;
    if (draftValue === currentValue) continue;

    delta[field] = field === 'creditLimit' ? (Number(draftValue) || 0)
      : field === 'paymentTerms' ? (Number(draftValue) || 30)
      : draftValue;
  }

  return delta;
}

/**
 * Multi-user conflict check — identical mechanism to Lead's own
 * (`currentUpdatedAt !== loadedUpdatedAtRef.current`), extracted as a pure
 * function so the comparison itself is unit-testable without a component.
 * `loadedUpdatedAt === null` means "no baseline captured yet" (e.g. the
 * customer hasn't finished loading) — never a conflict in that state.
 */
export function hasConflict(loadedUpdatedAt: string | null, currentUpdatedAt: unknown): boolean {
  if (loadedUpdatedAt === null) return false;
  const current = currentUpdatedAt ? String(currentUpdatedAt) : '';
  return current !== loadedUpdatedAt;
}

/**
 * Validate the resulting (customer + delta) state before writing — mirrors
 * the existing Edit form's own validation exactly (`if (!editForm.name)
 * return toast.error('Name required'); if (!editForm.phone) ...`).
 * Returns an error message, or null when valid. Checks the RESULTING value
 * (draft override, falling back to the customer's current value) since a
 * field not present in the delta might already be non-empty on the
 * customer — only a field genuinely being cleared should fail validation.
 */
export function validateCustomerDraft(customer: any, delta: Record<string, unknown>): string | null {
  const resultingName = 'name' in delta ? String(delta.name || '') : String(customer?.name || '');
  const resultingPhone = 'phone' in delta ? String(delta.phone || '') : String(customer?.phone || '');
  if (!resultingName.trim()) return 'Name required';
  if (!resultingPhone.trim()) return 'Phone required';
  return null;
}

const FIELD_LABELS: Record<CustomerDraftField, string> = {
  name: 'Name', phone: 'Phone', altName: 'Alternate Name', altMobile: 'Alternate Number', email: 'Email', type: 'Customer Type', company: 'Company', gst: 'GST', pan: 'PAN',
  address: 'Address', city: 'City', state: 'State', pincode: 'Pincode',
  creditLimit: 'Credit Limit', paymentTerms: 'Payment Terms', notes: 'Notes',
  assignedToId: 'Assigned Salesperson', assignedToName: 'Assigned Salesperson',
};

/**
 * Human-readable summary of which fields changed, for the manually-appended
 * activityLog entry (Phase 5.1 fix — see below). `assignedToId`/
 * `assignedToName` always change together (§ the Editor's paired select) —
 * collapsed to one "Assigned Salesperson" mention, not two.
 */
function describeChangedFields(delta: Record<string, unknown>): string {
  const labels = new Set<string>();
  for (const field of Object.keys(delta) as CustomerDraftField[]) {
    if (FIELD_LABELS[field]) labels.add(FIELD_LABELS[field]);
  }
  return Array.from(labels).join(', ') || 'customer details';
}

export interface SaveCustomerWorkspaceResult {
  changed: boolean;
}

/**
 * Persist the draft to the customer. Returns { changed: false } when there
 * is nothing to write (no-op save is never pretended to have happened).
 * Reuses updateCustomerProjectionWithPhoneLock unchanged — phone-lock,
 * master-identity, updatedBy/updatedAt are all handled inside it exactly as
 * the list page's own Edit form already relies on. Throws (surfaced by the
 * caller's existing try/catch → toast, same as every other error here) when
 * validateCustomerDraft finds the resulting state invalid.
 *
 * Phase 5.1 fix: `logActivity()` alone writes to the separate
 * COLLECTIONS.AUDIT_LOGS collection — neither the Right Panel's Recent
 * Activity widget nor the Activity tab read from there; both read
 * `customer.activityLog[]` directly (confirmed via RecordContextPanels.tsx /
 * CustomerRecentActivity.tsx). A Save's activity was therefore invisible
 * anywhere in the workspace UI despite logActivity() succeeding. Fixed by
 * also appending a manual entry to `customer.activityLog[]` in the SAME
 * write, mirroring LeadWorkspacePersistence.ts's buildWorkspaceLeadDelta,
 * which does exactly this for Lead's own equivalent Save.
 */
export async function saveCustomerWorkspace(
  customer: any,
  draft: CustomerDraft,
  user: { id?: string; name?: string },
  companyId: string,
): Promise<SaveCustomerWorkspaceResult> {
  if (!customer?.id) return { changed: false };

  const delta = buildCustomerDraftDelta(customer, draft);
  if (Object.keys(delta).length === 0) return { changed: false };

  const validationError = validateCustomerDraft(customer, delta);
  if (validationError) throw new Error(validationError);

  const logEntry = {
    id: genId.generic('LOG'), type: 'Update',
    desc: `Updated: ${describeChangedFields(delta)}`,
    date: new Date().toISOString(), userName: user?.name || 'System',
  };
  const existingActivityLog = Array.isArray(customer.activityLog) ? customer.activityLog : [];
  const deltaWithActivity = { ...delta, activityLog: [...existingActivityLog, logEntry] };

  await updateCustomerProjectionWithPhoneLock(customer.id, deltaWithActivity);

  // Same CUSTOMER_UPDATED notification the list page's Edit form sends —
  // fires only when assignedToId is actually part of this delta (i.e. the
  // assignment genuinely changed this save), which is a more precise
  // trigger than the list-page form's own "fires whenever the full-payload
  // submit happens to include a truthy assignedToId" — documented in the
  // Phase 5 report §11 as a deliberate refinement, not an accidental change.
  if (delta.assignedToId) {
    await sendNotification(
      String(delta.assignedToId), NotificationType.CUSTOMER_UPDATED, 'Customer updated',
      `Customer ${(delta.name as string) || customer.name || customer.id} was updated.`,
      'customer', customer.id, resolveNotificationCompanyId(companyId),
    );
  }

  // Kept alongside the manual activityLog append (not a replacement for it —
  // see the fix note above): logActivity() still writes the company-wide
  // audit trail entry, which is a real, separate consumer (an admin Audit
  // Log surface elsewhere in the ERP), independent of what the Customer
  // Workspace's own UI displays.
  await logActivity('Customers', 'Customer Updated', customer.id, {
    entityName: customer.name || customer.fullName || customer.id,
    actionLabel: 'Customer updated in workspace',
  });

  return { changed: true };
}
