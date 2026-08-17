import { updateDocById } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';

type CustomerDelta = Record<string, unknown>;

const CUSTOMER_PROJECTION_FIELDS = ['name', 'phone', 'email', 'city'] as const;

function compactDelta(delta: CustomerDelta, allowedFields?: readonly string[]) {
  return Object.fromEntries(
    Object.entries(delta).filter(([key, value]) => (
      value !== undefined
      && value !== null
      && (!allowedFields || allowedFields.includes(key))
    ))
  );
}

export class CustomerDomainService {
  static update(customerId: string, delta: CustomerDelta): Promise<void> {
    return updateDocById(COLLECTIONS.CUSTOMERS, customerId, compactDelta(delta));
  }

  static updateProjection(customerId: string, delta: CustomerDelta): Promise<void> {
    const projection = compactDelta(delta, CUSTOMER_PROJECTION_FIELDS);
    if (Object.keys(projection).length === 0) return Promise.resolve();
    return updateDocById(COLLECTIONS.CUSTOMERS, customerId, projection);
  }
}
