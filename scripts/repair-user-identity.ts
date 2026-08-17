/**
 * Non-destructive ERP identity repair — dry-run first.
 *
 * Usage: TOKEN=<gcloud-adc-token> node --experimental-strip-types scripts/repair-user-identity.ts [--apply]
 *
 * Root cause context (docs/project-workspace-final-production-gate-report.md):
 *   Before the entityProjection fix, createProjectionWithUserId(USERS, authId, …)
 *   stripped `companyId` from the auth-keyed account doc (users/{authUid}). The same
 *   projection flow ALSO created a parallel MUSR-{company}-{phone} master doc
 *   carrying the same email. On login, no user_auth_maps/{uid} mapping existed, so
 *   the email fallback saw both docs -> ambiguous-identity ("Multiple ERP users
 *   match this authenticated email").
 *
 * THIS SCRIPT ONLY:
 *   1. finds auth-keyed users docs (id NOT MUSR- prefixed) that have an email but
 *      are MISSING companyId, and whose same-email MUSR sibling carries a companyId;
 *   2. plans (and with --apply, performs) an ADDITIVE set of companyId only.
 *   3. NEVER deletes, NEVER merges, NEVER changes role/status/email/phone,
 *      NEVER creates user_auth_maps (the login resolver creates those lazily and
 *      Firestore rules only permit the owner's own session to do so).
 *
 * Prints identity metadata only — never passwords, tokens, or credentials.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

async function main() {
  const users = await db.collection('users').get();
  const byEmail = new Map<string, Array<FirebaseFirestore.QueryDocumentSnapshot>>();
  for (const doc of users.docs) {
    const email = text(doc.data().email).toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), doc]);
  }

  const plans: Array<{ accountDocId: string; email: string; companyId: string; source: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const [email, docs] of byEmail) {
    const accountDocs = docs.filter((d) => !d.id.startsWith('MUSR-'));
    const musrDocs = docs.filter((d) => d.id.startsWith('MUSR-'));
    for (const account of accountDocs) {
      const data = account.data() as Record<string, unknown>;
      if (text(data.companyId)) continue; // already has a tenant
      if (data.isDeleted === true) continue; // deleted docs are not login identities

      // Derive the tenant from the same-human MUSR sibling. Prefer a live
      // sibling; fall back to a soft-deleted sibling only if it is the sole
      // evidence (matching phone or name strengthens the same-human proof).
      const live = musrDocs.filter((m) => (m.data() as Record<string, unknown>).isDeleted !== true);
      const candidates = live.length > 0 ? live : musrDocs;
      if (candidates.length === 0) {
        skipped.push({ id: account.id, reason: 'no MUSR sibling to derive companyId' });
        continue;
      }
      const companyIds = [...new Set(candidates.map((m) => text(m.data().companyId)).filter(Boolean))];
      if (companyIds.length !== 1) {
        skipped.push({ id: account.id, reason: `ambiguous sibling companyIds: ${companyIds.join(', ')}` });
        continue;
      }
      const sameName = candidates.some((m) => text(m.data().name).toLowerCase() === text(data.name).toLowerCase());
      const samePhone = candidates.some((m) => text(m.data().phone) === text(data.phone));
      if (!sameName && !samePhone) {
        skipped.push({ id: account.id, reason: 'sibling evidence weak (no matching name or phone)' });
        continue;
      }
      plans.push({ accountDocId: account.id, email, companyId: companyIds[0], source: candidates.length === 1 ? 'sole sibling' : 'matching sibling' });
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', plans, skipped }, null, 2));

  if (apply) {
    for (const plan of plans) {
      await db.collection('users').doc(plan.accountDocId).set(
        { companyId: plan.companyId, updatedBy: 'scripts/repair-user-identity.ts', updatedAt: new Date() },
        { merge: true },
      );
    }
    console.log(`APPLIED: ${plans.length} additive companyId backfills.`);
  } else {
    console.log(`No writes performed. Review the plan, then re-run with --apply.`);
  }
}

main().catch((error) => {
  console.error('Repair script failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
