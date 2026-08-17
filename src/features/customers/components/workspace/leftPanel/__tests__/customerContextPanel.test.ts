import { describe, expect, it } from 'vitest';
import { resolveCustomerContextFields } from '../CustomerContextPanel';

describe('resolveCustomerContextFields — B2B', () => {
  const b2b = {
    type: 'B2B', company: 'Acme Co', companyName: 'Acme Corporation',
    contactPerson: 'Ravi Kumar', businessPhone: '9876543210', businessEmail: 'ravi@acme.com',
    gst: '27AAAAA0000A1Z5', industryType: 'Manufacturing',
    address: '221B Baker St', city: 'Mumbai', state: 'Maharashtra',
    status: 'Active', assignedToName: 'Priya Singh',
    caseId: 'CASE-001', leadId: 'LEAD-001', tags: ['vip', 'priority'],
  };

  it('resolves isB2B true and prefers contactPerson for name', () => {
    const f = resolveCustomerContextFields(b2b);
    expect(f.isB2B).toBe(true);
    expect(f.name).toBe('Ravi Kumar');
  });

  it('prefers businessPhone/businessEmail over generic phone/email for B2B', () => {
    const f = resolveCustomerContextFields(b2b);
    expect(f.phone).toBe('9876543210');
    expect(f.email).toBe('ravi@acme.com');
  });

  it('builds a combined address line from address/city/state', () => {
    const f = resolveCustomerContextFields(b2b);
    expect(f.addressLine).toBe('221B Baker St, Mumbai, Maharashtra');
  });

  it('surfaces caseId and sourceLeadId when present', () => {
    const f = resolveCustomerContextFields(b2b);
    expect(f.caseId).toBe('CASE-001');
    expect(f.sourceLeadId).toBe('LEAD-001');
  });

  it('defaults status to Active and assignedToName to Unassigned when absent', () => {
    const f = resolveCustomerContextFields({ type: 'B2B' });
    expect(f.status).toBe('Active');
    expect(f.assignedToName).toBe('Unassigned');
  });
});

describe('resolveCustomerContextFields — B2C', () => {
  const b2c = {
    type: 'B2C', fullName: 'Sunita Devi', mobile: '9123456780', altMobile: '9988776655',
    email: 'sunita@example.com', address: 'Village Road', city: 'Patna', state: 'Bihar',
    roofType: 'RCC', sanctionLoad: '5kW', monthlyBillAmount: '3500',
    propertyType: 'Residential', projectType: 'On-grid',
    status: 'Active', assignedToName: 'Amit Sharma',
  };

  it('resolves isB2B false and prefers fullName for name', () => {
    const f = resolveCustomerContextFields(b2c);
    expect(f.isB2B).toBe(false);
    expect(f.name).toBe('Sunita Devi');
  });

  it('prefers mobile/email for B2C (no businessPhone field)', () => {
    const f = resolveCustomerContextFields(b2c);
    expect(f.phone).toBe('9123456780');
    expect(f.email).toBe('sunita@example.com');
  });

  it('has no caseId/sourceLeadId when the customer has none — undefined, not invented', () => {
    const f = resolveCustomerContextFields(b2c);
    expect(f.caseId).toBeUndefined();
    expect(f.sourceLeadId).toBeUndefined();
  });

  it('falls back to city/state alone when address line1 is missing', () => {
    const f = resolveCustomerContextFields({ type: 'B2C', city: 'Patna', state: 'Bihar' });
    expect(f.addressLine).toBe('Patna, Bihar');
  });

  it('defaults type to B2B when customer.type is missing entirely', () => {
    const f = resolveCustomerContextFields({});
    expect(f.isB2B).toBe(true);
    expect(f.name).toBe('—');
  });
});
