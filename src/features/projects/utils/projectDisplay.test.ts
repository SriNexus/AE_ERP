import { describe, expect, it } from 'vitest';
import { resolveProjectCustomerName } from './projectDisplay';

describe('resolveProjectCustomerName', () => {
  it('resolves the canonical customer using the project customerId', () => {
    expect(resolveProjectCustomerName(
      { id: 'PRJ-1', customerId: 'CU-1' },
      [{ id: 'CU-1', name: 'Fictional Solar Customer' }],
    )).toBe('Fictional Solar Customer');
  });

  it('supports a legacy denormalized project customer name when the canonical record is unavailable', () => {
    expect(resolveProjectCustomerName(
      { id: 'PRJ-1', customerId: 'CU-1', customerName: 'Legacy Fictional Customer' },
      [],
    )).toBe('Legacy Fictional Customer');
  });

  it('does not substitute a customer id as a customer name', () => {
    expect(resolveProjectCustomerName({ id: 'PRJ-1', customerId: 'CU-1' }, [])).toBe('');
  });
});