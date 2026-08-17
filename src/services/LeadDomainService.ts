import { getOne, updateDocById } from '../lib/firestore';
import { COLLECTIONS } from '../lib/firebase';
import { CustomerDomainService } from './CustomerDomainService';

type LeadDelta = Record<string, unknown>;

const LEAD_TO_CUSTOMER_FIELDS = ['name', 'phone', 'email', 'city'] as const;

function pickDefined(delta: LeadDelta, fields: readonly string[]) {
  return Object.fromEntries(
    Object.entries(delta).filter(([key, value]) => fields.includes(key) && value !== undefined && value !== null)
  );
}

export class LeadDomainService {
  static async update(leadId: string, delta: LeadDelta): Promise<void> {
    const lead = await getOne<Record<string, unknown>>(COLLECTIONS.LEADS, leadId);
    await updateDocById(COLLECTIONS.LEADS, leadId, delta);

    const convertedCustomerId = typeof lead?.convertedCustomerId === 'string' ? lead.convertedCustomerId : '';
    const propagatable = pickDefined(delta, LEAD_TO_CUSTOMER_FIELDS);
    if (convertedCustomerId && Object.keys(propagatable).length > 0) {
      await CustomerDomainService.updateProjection(convertedCustomerId, propagatable);
    }
  }
}
