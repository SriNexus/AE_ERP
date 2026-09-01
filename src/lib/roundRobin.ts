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
import { isSalesEligibleRole } from './salesTeam';

type Assignee = {
  userId: string;
  name: string;
};

export async function getNextAssignee(companyId: string): Promise<Assignee> {
  // Fetch every company user once and filter client-side via
  // isSalesEligibleRole(), the same pattern Leads.tsx's own `salesUsers`
  // dropdown already uses — a single Firestore `where('role','==','Sales')`
  // query can't recognize a data-driven role like "Sales Executive" (see
  // lib/salesTeam.ts for why a fixed role-name filter silently excludes real
  // Sales teams whenever the role isn't named exactly the seeded default).
  const usersSnap = await getDocs(query(
    collection(db, COLLECTIONS.USERS),
    where('companyId', '==', companyId),
  ));

  const users = usersSnap.docs
    .map((snap) => ({ id: snap.id, ...snap.data() } as Record<string, any>))
    .filter((user) => isSalesEligibleRole(user.role, user.department) && !isHiddenOwnerRecord(user) && user.isDeleted !== true && user.status !== 'Inactive')
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
