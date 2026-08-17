/** Dry-run-first Auth UID -> ERP user mapping migration.
 * Usage: npx tsx scripts/migrate-user-auth-maps.ts [--apply]
 * Uses Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC).
 * Never prints tokens, passwords, or credentials. Conflicts and duplicate emails are never overwritten.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);
const auth = getAuth(app);
const normalized = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';

async function main() {
  const users = await db.collection('users').get();
  const byEmail = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const item of users.docs) {
    const email = normalized(item.data().email);
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), item]);
  }
  let examined = 0, planned = 0, ambiguous = 0, conflicts = 0;
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const account of page.users) {
      examined++;
      const email = normalized(account.email);
      const matches = email ? byEmail.get(email) || [] : [];
      if (matches.length !== 1) { if (matches.length > 1) ambiguous++; continue; }
      const erp = matches[0];
      const ref = db.collection('user_auth_maps').doc(account.uid);
      const existing = await ref.get();
      if (existing.exists && existing.data()?.userId !== erp.id) { conflicts++; continue; }
      if (existing.exists) continue;
      planned++;
      if (apply) await ref.create({ authUid: account.uid, userId: erp.id, companyId: erp.data().companyId, email, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', authUsersExamined: examined, mappingsPlannedOrCreated: planned, ambiguousEmails: ambiguous, conflictingMappings: conflicts }));
  if (!apply) console.log('No writes performed. Re-run with --apply after reviewing counts.');
}
main().catch((error) => { console.error('Auth mapping migration failed:', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
