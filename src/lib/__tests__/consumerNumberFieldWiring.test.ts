/**
 * consumerNumberFieldWiring.test.ts
 *
 * Product change — optional Consumer Number field for B2C.
 *
 * Reused the existing "Consumer Number" naming convention already
 * established for net-metering applications (ProjectOverview.tsx's
 * `app.consumerNumber` / "Consumer No." label) rather than inventing a
 * differently-named field, per the explicit instruction to check for and
 * reuse an existing convention. No formal `consumerNumber` field existed on
 * Lead or Customer before this change (confirmed by a repo-wide search) —
 * created here, following the existing B2B/B2C field patterns exactly.
 *
 * Source-text verification (this repo's established convention for
 * page/component-local, non-exported form logic — see
 * rolesPermissionMatrixCompleteness.test.ts / customerWorkspacePhase5.test.ts
 * for the precedent this mirrors) proving the field is wired everywhere the
 * requirement names, and is optional everywhere it appears.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const customerEditorSrc = readFileSync(resolve(__dirname, '../../features/customers/components/workspace/CustomerWorkspaceEditor.tsx'), 'utf-8');
const customerDialogsSrc = readFileSync(resolve(__dirname, '../../features/customers/components/CustomerWorkspaceDialogs.tsx'), 'utf-8');
const customersWorkspaceSrc = readFileSync(resolve(__dirname, '../../pages/CustomersWorkspace.tsx'), 'utf-8');
const leadConversionSrc = readFileSync(resolve(__dirname, '../../features/leads/components/workspace/LeadWorkspaceConversionFlow.tsx'), 'utf-8');
const leadWorkflowSrc = readFileSync(resolve(__dirname, '../leadWorkflow.ts'), 'utf-8');
const projectOverviewSrc = readFileSync(resolve(__dirname, '../../features/projects/components/ProjectOverview.tsx'), 'utf-8');

describe('Customer Workspace Editor (edit an existing Customer) — Consumer Number is B2C-only and optional', () => {
  it('renders the Consumer Number input only under the B2C (!isB2B) branch — never for B2B', () => {
    expect(customerEditorSrc).toContain("{!isB2B && <Input label=\"Consumer Number\"");
  });

  it('is never marked required (no `required` prop on this input)', () => {
    const match = customerEditorSrc.match(/<Input label="Consumer Number"[^/]*\/>/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toContain('required');
  });

  it('is bound through the same generic val()/set() draft mechanism every other field uses — no special-case persistence path', () => {
    expect(customerEditorSrc).toContain("value={val('consumerNumber')} onChange={set('consumerNumber')}");
  });
});

describe('Customer Workspace Dialogs (direct Customer creation) — Consumer Number in the B2C form', () => {
  it('renders an optional Consumer Number input in the Solar/Electricity Details section', () => {
    expect(customerDialogsSrc).toContain('Consumer Number (Optional)');
    expect(customerDialogsSrc).toContain('value={b2cForm.consumerNumber}');
  });

  it('is not present anywhere in a required/B2B-only context', () => {
    const line = customerDialogsSrc.split('\n').find((l) => l.includes('Consumer Number (Optional)'));
    expect(line).toBeDefined();
    expect(line).not.toContain('required');
  });
});

describe('CustomersWorkspace.tsx (list-page direct create) — Consumer Number flows through the existing spread, no special-case write path', () => {
  it('b2cForm initial state includes consumerNumber', () => {
    expect(customersWorkspaceSrc).toContain("consumerNumber: ''");
  });
});

describe('Lead Workspace Conversion Flow — Consumer Number is available when converting a Lead to a B2C Customer', () => {
  it('b2cForm state includes consumerNumber', () => {
    expect(leadConversionSrc).toContain("consumerNumber: '',");
  });

  it('renders a Consumer Number input in the B2C section, explicitly marked optional', () => {
    expect(leadConversionSrc).toContain('Consumer Number');
    expect(leadConversionSrc).toContain('Electricity connection consumer number (optional)');
  });

  it('is not part of the required-field validation (only address is validated for B2C)', () => {
    expect(leadConversionSrc).toContain("if (!b2cForm.address.trim()) return toast.error('Address is required');");
    expect(leadConversionSrc).not.toContain("if (!b2cForm.consumerNumber");
  });

  it('is included in the extra payload passed to convertLeadToCustomer for B2C', () => {
    expect(leadConversionSrc).toContain('consumerNumber: b2cForm.consumerNumber,');
  });

  it('the B2B branch of the submit payload does not reference consumerNumber at all — B2B is completely unaffected', () => {
    const b2bExtraBlock = leadConversionSrc.match(/customerType === 'b2b'\s*\?\s*\{[\s\S]*?\}\s*:/);
    expect(b2bExtraBlock).not.toBeNull();
    expect(b2bExtraBlock![0]).not.toContain('consumerNumber');
  });
});

describe('leadWorkflow.ts — consumerNumber survives Lead -> Customer conversion in BOTH write paths (demo mode and the real transaction)', () => {
  it('the demo-mode Customer creation carries consumerNumber from the lead', () => {
    expect(leadWorkflowSrc).toContain('consumerNumber: text(lead.consumerNumber),');
  });

  it('the transactional Customer creation carries consumerNumber, preferring the freshly-read lead over the caller\'s in-memory copy — same fallback pattern every sibling field here already uses', () => {
    expect(leadWorkflowSrc).toContain("consumerNumber: text(currentLead.consumerNumber) || lead.consumerNumber || '',");
  });
});

describe('ProjectOverview.tsx — Consumer Number is not lost from view in the Project workflow', () => {
  it('falls back to the linked Customer\'s own consumerNumber when the net-metering application has not recorded one yet', () => {
    expect(projectOverviewSrc).toContain("customerValue(customer, ['consumerNumber'])");
  });
});
