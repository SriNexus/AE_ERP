/**
 * purge-settings-secrets — P01 Migration: inspect & purge secret-shaped fields
 * from existing Firestore `settings` documents.
 *
 * ⚠️ READ FIRST ⚠️
 * This script is INTENDED to run against a live Firestore database.
 * It does NOT print or log secret values — it only reports whether
 * they exist and removes them.
 *
 * SECURITY: This script NEVER outputs the actual values of secret fields.
 * It only reports: field name, document ID, and whether the value was present.
 *
 * === WHAT THIS DOES ===
 *
 * Since P01 removes secret field definitions from the client-bound TypeScript
 * interfaces, any existing Firestore settings documents created during
 * development/testing may still contain the old secret-shaped fields
 * (smtpPass, sendgridApiKey, apiKey, webhookSecret, apiSecret,
 *  razorpayKeySecret, stripeSecretKey, customWebhooks[].secret).
 *
 * This script:
 * 1. Scans all documents in the `settings` collection
 * 2. Identifies any documents containing the old secret fields
 * 3. Reports what was found (without exposing values)
 * 4. On --purge flag, removes those fields from the documents
 *
 * === USAGE ===
 *
 * # Dry-run: inspect only (safe to run anywhere)
 * npx tsx scripts/purge-settings-secrets.ts
 *
 * # Actual purge: removes secret fields from documents
 * # ⚠️ Requires FIRESTORE_EMULATOR or production Firestore credentials
 * npx tsx scripts/purge-settings-secrets.ts --purge
 *
 * === ENVIRONMENT VARIABLES ===
 *
 * Uses same Firebase config as the main app (VITE_FIREBASE_*)
 * or falls back to emulator if VITE_USE_FIREBASE_EMULATOR=true
 */

// The exact field names that were removed from client types
const SECRET_FIELD_NAMES = [
  'smtpPass',
  'sendgridApiKey',
  'apiKey',         // WhatsApp & SMS
  'apiSecret',
  'webhookSecret',
  'razorpayKeySecret',
  'stripeSecretKey',
] as const;

type SecretField = typeof SECRET_FIELD_NAMES[number];

interface SettingsDoc {
  id: string;
  section: string;
  companyId: string;
  data: Record<string, unknown>;
}

interface ScanResult {
  documentId: string;
  section: string;
  companyId: string;
  foundSecrets: SecretField[];
  hasWebhookSecrets: boolean;
}

async function main() {
  const shouldPurge = process.argv.includes('--purge');

  console.log('=== Settings Secrets Purge Script (P01 Migration) ===');
  console.log(`Mode: ${shouldPurge ? 'PURGE (destructive)' : 'DRY-RUN (inspect only)'}`);
  console.log('');

  // Initialize Firebase
  const firebase = await import('firebase/app');
  const { getFirestore, collection, getDocs, doc, updateDoc, deleteField, getFirestore: getDb } = await import('firebase/firestore');

  // Read Firebase config from environment (same pattern as the app)
  function readEnv(name: string): string | undefined {
    const value = (process.env as Record<string, string | undefined>)[name]?.trim();
    return value && !/^(your_.+_here|REPLACE_WITH_.+)$/i.test(value) ? value : undefined;
  }

  const firebaseConfig = {
    apiKey: readEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readEnv('VITE_FIREBASE_APP_ID'),
  };

  const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
  if (!isConfigured) {
    console.log('ℹ️  No Firebase configuration found. Running in local-only mode.');
    console.log('   To scan a real Firestore instance, set VITE_FIREBASE_* env vars.');
    console.log('');
    console.log('   Expected documents to scan for secret fields:');
    console.log('   - {companyId}_settings_email');
    console.log('   - {companyId}_settings_whatsapp');
    console.log('   - {companyId}_settings_sms');
    console.log('   - {companyId}_settings_integrations');
    console.log('');
    console.log('   Secret fields to check:');
    for (const field of SECRET_FIELD_NAMES) {
      console.log(`   - ${field}`);
    }
    console.log('');
    console.log('   To run against a real database, create .env.local with Firebase config');
    console.log('   and run: npx tsx scripts/purge-settings-secrets.ts [--purge]');
    return;
  }

  const app = firebase.initializeApp(firebaseConfig);
  const db = getDb(app);

  console.log(`Connected to Firebase project: ${firebaseConfig.projectId}`);

  // Scan settings collection
  const settingsCollection = collection(db, 'settings');
  const snapshot = await getDocs(settingsCollection);

  const results: ScanResult[] = [];
  let totalDocsWithSecrets = 0;

  for (const docSnap of snapshot.docs) {
    const docData = docSnap.data() as SettingsDoc;
    const data = docData?.data ?? {};
    const foundSecrets: SecretField[] = [];
    let hasWebhookSecrets = false;

    for (const field of SECRET_FIELD_NAMES) {
      if (field in data && data[field] !== '' && data[field] !== undefined && data[field] !== null) {
        foundSecrets.push(field);
      }
    }

    // Check for webhook secrets inside customWebhooks array
    if (Array.isArray(data.customWebhooks)) {
      for (const webhook of data.customWebhooks) {
        if (typeof webhook === 'object' && webhook !== null && 'secret' in webhook) {
          hasWebhookSecrets = true;
          break;
        }
      }
    }

    if (foundSecrets.length > 0 || hasWebhookSecrets) {
      totalDocsWithSecrets++;
      results.push({
        documentId: docSnap.id,
        section: docData?.section || 'unknown',
        companyId: docData?.companyId || 'unknown',
        foundSecrets,
        hasWebhookSecrets,
      });
    }
  }

  // Report findings
  console.log(`\nScanned ${snapshot.docs.length} settings documents.`);
  if (totalDocsWithSecrets === 0) {
    console.log('✅ No secret-shaped fields found in any settings document.');
    console.log('   No purge action needed.');
    return;
  }

  console.log(`⚠️  Found ${totalDocsWithSecrets} document(s) containing old secret fields:`);
  for (const result of results) {
    console.log(`\n  📄 ${result.documentId}`);
    console.log(`     Section: ${result.section}`);
    console.log(`     Company: ${result.companyId}`);
    console.log(`     Fields:  ${result.foundSecrets.join(', ')}${result.hasWebhookSecrets ? ', customWebhooks[].secret' : ''}`);
    console.log(`     (values NOT displayed — security)`);
  }

  if (shouldPurge) {
    console.log('\n=== PURGING SECRET FIELDS ===');
    let purged = 0;
    for (const result of results) {
      const docRef = doc(db, 'settings', result.documentId);
      const updates: Record<string, unknown> = {};

      for (const field of result.foundSecrets) {
        updates[`data.${field}`] = deleteField();
      }

      if (result.hasWebhookSecrets) {
        // Read current data, remove .secret from each webhook, write back
        const currentSnap = await (await import('firebase/firestore')).getDoc(docRef);
        const currentData = currentSnap.data() as SettingsDoc | undefined;
        if (currentData?.data?.customWebhooks && Array.isArray(currentData.data.customWebhooks)) {
          const cleanedWebhooks = currentData.data.customWebhooks.map((wh: Record<string, unknown>) => {
            const { secret, ...rest } = wh;
            return rest;
          });
          updates['data.customWebhooks'] = cleanedWebhooks;
        }
      }

      if (Object.keys(updates).length > 0) {
        await updateDoc(docRef, updates);
        purged++;
      }
    }
    console.log(`\n✅ Purged secret fields from ${purged} document(s).`);
    console.log('   No secret values were logged or exposed.');
  } else {
    console.log(`\n🚫 Dry-run complete. No documents were modified.`);
    console.log(`   To purge these fields, re-run with --purge flag.`);
    console.log(`   ⚠️  Ensure you have a Firestore backup before purging.`);
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
