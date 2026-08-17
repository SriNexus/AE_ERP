import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { COLLECTIONS, db } from './firebase';
import { updateDocById } from './firestore';
import { isHiddenOwnerRecord } from './ownerAccess';

type Assignee = {
  userId: string;
  name: string;
};

export async function getNextAssignee(companyId: string, roleFilter = 'Sales'): Promise<Assignee> {
  const usersSnap = await getDocs(query(
    collection(db, COLLECTIONS.USERS),
    where('companyId', '==', companyId),
    where('role', '==', roleFilter)
  ));

  const users = usersSnap.docs
    .map((snap) => ({ id: snap.id, ...snap.data() } as Record<string, any>))
    .filter((user) => !isHiddenOwnerRecord(user) && user.isDeleted !== true && user.status !== 'Inactive')
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  if (users.length === 0) {
    throw new Error('No sales team members available');
  }

  const companySnap = await getDoc(doc(db, COLLECTIONS.COMPANIES, companyId));
  const pointer = Number(companySnap.data()?.roundRobinPointer || 0);
  const index = Math.abs(pointer) % users.length;
  const nextPointer = (index + 1) % users.length;
  const selected = users[index];

  await updateDocById(COLLECTIONS.COMPANIES, companyId, { roundRobinPointer: nextPointer });

  return {
    userId: String(selected.id),
    name: String(selected.name || selected.displayName || selected.email || selected.id),
  };
}
