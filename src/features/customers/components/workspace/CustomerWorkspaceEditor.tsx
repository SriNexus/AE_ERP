/**
 * CustomerWorkspaceEditor — Left Panel's editable form for Customer-owned
 * fields (Phase 5, Tier A of the two-tier save model).
 *
 * Renders exactly the fields the existing Edit form already supports
 * (CUSTOMER_DRAFT_FIELDS, see CustomerWorkspacePersistence.ts) — no more,
 * no less. Every keystroke calls `onFieldChange`, which stages the value
 * into the CustomerWorkspaceEngine's `draft` — this component never writes
 * Firestore directly, never imports a mutation, never calls
 * updateCustomerProjectionWithPhoneLock itself. Save/Save & Next (the
 * Footer) own persistence.
 *
 * Identity lock: when `customer.sourceLeadId` is set, Name and Phone render
 * disabled — the same `editLocksIdentity` rule the list page's Edit form
 * already enforces (`Boolean(editingCustomer?.sourceLeadId)` in
 * CustomersWorkspace.tsx), reproduced here rather than reused directly
 * since that boolean lives in page-local state there, not an exported
 * function — trivial enough (`Boolean(customer?.sourceLeadId)`) that
 * extracting a one-line helper would be overhead, not reuse.
 *
 * Sits alongside (not replacing) CustomerContextPanel — a View/Edit toggle
 * in CustomerWorkspaceLeftPanel switches between the two; CustomerContextPanel
 * itself is completely unmodified by Phase 5.
 */
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Textarea } from '../../../../components/ui/Input';
import { getAll } from '../../../../lib/firestore';
import { COLLECTIONS } from '../../../../lib/firebase';
import { useAppStore } from '../../../../store/useAppStore';
import { resolveBusinessMode } from '../../../../lib/companyBusinessMode';
import { getAllowedCustomerTypesForBusinessMode } from '../../../../lib/customerClassification';
import type { CustomerDraft, CustomerDraftField } from './CustomerWorkspacePersistence';

interface Props {
  customer: any;
  draft: CustomerDraft;
  onFieldChange: (field: CustomerDraftField, value: string) => void;
  canEdit: boolean;
}

const SALES_ROLES = ['Sales', 'Executive', 'BDE', 'BDM', 'Manager', 'TL'];

function fieldValue(customer: any, draft: CustomerDraft, field: CustomerDraftField): string {
  if (field in draft) return draft[field] ?? '';
  const raw = customer?.[field];
  return raw === undefined || raw === null ? '' : String(raw);
}

export default function CustomerWorkspaceEditor({ customer, draft, onFieldChange, canEdit }: Props) {
  const locksIdentity = Boolean(customer?.sourceLeadId);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAll<any>(COLLECTIONS.USERS),
    staleTime: 300000,
  });
  const salesUsers = users
    .filter((u: any) => SALES_ROLES.includes(u.role) && u.status !== 'Inactive' && !u.isDeleted)
    .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

  // Phase 4: cross-entity validation before Customer reclassification —
  // "B2B customers must NEVER have a Project" is a locked business rule, so a
  // B2C customer that already has a linked Project cannot be re-typed to B2B.
  // The actual enforcing guard lives in useCustomers.ts's phone-lock update
  // path (the Footer Save's write function); this query only drives the
  // immediate, pre-Save UI feedback (removing the option rather than letting
  // Save fail) and never writes anything itself.
  const { data: projects = [] } = useQuery({
    queryKey: ['customer-linked-projects', customer?.id],
    queryFn: () => getAll<any>(COLLECTIONS.PROJECTS),
    enabled: Boolean(customer?.id),
    staleTime: 60000,
  });
  const hasLinkedProject = projects.some((project: any) => project.customerId === customer?.id && project.isDeleted !== true);

  const val = (field: CustomerDraftField) => fieldValue(customer, draft, field);
  const set = (field: CustomerDraftField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onFieldChange(field, e.target.value);

  // Phase 2: stops a company from re-typing a customer into a type its own
  // Business Mode doesn't support. The linked-Project case Phase 2 flagged as
  // unresolved is now handled above (Phase 4: hasLinkedProject removes B2B
  // from the option list once a Project already exists).
  const businessMode = resolveBusinessMode(useAppStore((state) => state.company));
  const allowedTypeOptions = getAllowedCustomerTypesForBusinessMode(businessMode)
    .filter((type) => type !== 'B2B' || (val('type') || 'B2B') === 'B2B' || !hasLinkedProject)
    .map((type) => ({ label: type, value: type }));

  // Reacts to the staged draft, not just the saved customer.type — so
  // switching the Customer Type dropdown below immediately shows/hides the
  // B2B-only fields in this same edit session, before Save. The Center/Right
  // panels deliberately do NOT react to this — they read customer.type (the
  // saved value) and only flip once Save completes and refetches.
  const isB2B = (val('type') || 'B2B') === 'B2B';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        <Input label="Name" required disabled={locksIdentity || !canEdit} value={val('name')} onChange={set('name')} />
        <Input label="Phone" required disabled={locksIdentity || !canEdit} value={val('phone')} onChange={set('phone')} />
        <Input label="Email" type="email" disabled={!canEdit} value={val('email')} onChange={set('email')} />
        {/* Alternate Name/Number — secondary contact info, deliberately not
            required and placed right after the primary Name/Phone/Email so
            it reads as "also reachable via" rather than competing with them. */}
        <div className="grid grid-cols-2 gap-2">
          <Input label="Alternate Name" disabled={!canEdit} value={val('altName')} onChange={set('altName')} placeholder="Optional" />
          <Input label="Alternate Number" disabled={!canEdit} value={val('altMobile')} onChange={set('altMobile')} placeholder="Optional" />
        </div>
        <Select
          label="Customer Type"
          disabled={!canEdit}
          value={val('type') || 'B2B'}
          onChange={(e) => onFieldChange('type', e.target.value)}
          options={allowedTypeOptions}
        />
        {!isB2B && hasLinkedProject && (
          <p className="text-[10px] text-[var(--color-text-muted)] px-1 -mt-2">
            This customer has a linked Project, so it cannot be reclassified as B2B — B2B customers can never have a Project.
          </p>
        )}
        {isB2B && <Input label="Company" disabled={!canEdit} value={val('company')} onChange={set('company')} />}
        {isB2B && <Input label="GST" disabled={!canEdit} value={val('gst')} onChange={(e) => onFieldChange('gst', e.target.value.toUpperCase())} />}
        <Input label="PAN" disabled={!canEdit} value={val('pan')} onChange={(e) => onFieldChange('pan', e.target.value.toUpperCase())} />
        <Textarea label="Address" disabled={!canEdit} value={val('address')} onChange={set('address')} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="City" disabled={!canEdit} value={val('city')} onChange={set('city')} />
          <Input label="State" disabled={!canEdit} value={val('state')} onChange={set('state')} />
        </div>
        <Input label="Pincode" disabled={!canEdit} value={val('pincode')} onChange={set('pincode')} />
        {isB2B && (
          <div className="grid grid-cols-2 gap-2">
            <Input label="Credit Limit" type="number" min="0" disabled={!canEdit} value={val('creditLimit')} onChange={set('creditLimit')} />
            <Input label="Payment Terms (days)" type="number" min="0" disabled={!canEdit} value={val('paymentTerms')} onChange={set('paymentTerms')} />
          </div>
        )}
        <Select
          label="Assigned Salesperson"
          disabled={!canEdit}
          value={val('assignedToId')}
          onChange={(e) => {
            const u = salesUsers.find((x: any) => x.id === e.target.value);
            onFieldChange('assignedToId', e.target.value);
            onFieldChange('assignedToName', u ? u.name : '');
          }}
          options={[{ label: 'Unassigned', value: '' }, ...salesUsers.map((u: any) => ({ label: u.name, value: u.id }))]}
        />
        <Textarea label="Notes" disabled={!canEdit} value={val('notes')} onChange={set('notes')} />
      </div>
      {locksIdentity && (
        <p className="text-[10px] text-[var(--color-text-muted)] px-1">
          Name and Phone are locked — this customer was converted from a Lead and must keep its original identity.
        </p>
      )}
    </div>
  );
}
