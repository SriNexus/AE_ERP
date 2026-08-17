import { collection, getDocs, query, where, updateDocById } from '../lib/firestore';
import { COLLECTIONS, db } from '../lib/firebase';

const COMPANY_NAME_COLLECTIONS = [
  COLLECTIONS.ORDERS,
  COLLECTIONS.QUOTATIONS,
  COLLECTIONS.DISPATCH,
] as const;

export class CompanyDomainService {
  static async onNameChange(companyId: string, newName: string): Promise<void> {
    for (const collectionName of COMPANY_NAME_COLLECTIONS) {
      const snap = await getDocs(query(collection(db, collectionName), where('companyId', '==', companyId)));
      for (const row of snap.docs) {
        await updateDocById(collectionName, row.id, { companyName: newName });
      }
    }
  }
}
