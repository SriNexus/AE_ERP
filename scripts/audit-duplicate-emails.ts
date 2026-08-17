/**
 * Read-only duplicate-email audit for the live Firestore users collection.
 *
 * Usage: TOKEN=<access-token> node scripts/audit-duplicate-emails.ts
 *
 * Prints ONLY identity/authorization metadata (no passwords, no credentials).
 * Performs zero writes.
 */
import https from 'https';

const PROJECT = process.env.FIRESTORE_PROJECT || 'ae-erp-d933d';
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('TOKEN env var required (gcloud auth application-default print-access-token)');
  process.exit(2);
}

function request(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
        headers: { Authorization: `Bearer ${TOKEN}` },
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve(body));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function stringValue(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function toISO(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function extractFields(doc: { name: string; fields?: Record<string, unknown> }): Record<string, unknown> & { id: string } {
  const id = (doc.name || '').split('/').pop() || '';
  const f = doc.fields || {};
  const value = (field: unknown): unknown => {
    if (!field || typeof field !== 'object') return undefined;
    const obj = field as Record<string, unknown>;
    if ('stringValue' in obj) return obj.stringValue;
    if ('booleanValue' in obj) return obj.booleanValue;
    if ('integerValue' in obj) return obj.integerValue;
    if ('doubleValue' in obj) return obj.doubleValue;
    if ('timestampValue' in obj) return obj.timestampValue;
    if ('nullValue' in obj) return null;
    if ('arrayValue' in obj) {
      const arr = (obj.arrayValue as { values?: unknown[] })?.values || [];
      return arr.map((x) => value(x));
    }
    if ('mapValue' in obj) {
      const map = (obj.mapValue as { fields?: Record<string, unknown> })?.fields || {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(map)) out[k] = value(v);
      return out;
    }
    return undefined;
  };
  const row: Record<string, unknown> & { id: string } = { id };
  for (const [key, field] of Object.entries(f)) {
    const v = value(field);
    if (v !== undefined) row[key] = v;
  }
  return row;
}

async function main() {
  const docs: Array<Record<string, unknown> & { id: string }> = [];
  let pageToken = '';
  let pages = 0;
  do {
    pages += 1;
    const path = `users?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const body = await request(path);
    let parsed: { documents?: unknown[]; nextPageToken?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      console.error('PARSE ERROR (first 400 chars):', body.slice(0, 400));
      process.exit(1);
    }
    if (!parsed.documents && !Array.isArray(parsed.documents)) {
      // If the response is an error object, print it.
      if ((parsed as { error?: unknown }).error) {
        console.error('API ERROR:', JSON.stringify((parsed as { error?: unknown }).error).slice(0, 400));
        process.exit(1);
      }
    }
    for (const doc of (parsed.documents || []) as Array<{ name: string; fields?: Record<string, unknown> }>) {
      docs.push(extractFields(doc));
    }
    pageToken = parsed.nextPageToken || '';
  } while (pageToken && pages < 60);

  console.log(`TOTAL_USERS:${docs.length} PAGES:${pages}`);

  const byEmail = new Map<string, Array<Record<string, unknown> & { id: string }>>();
  for (const doc of docs) {
    const email = stringValue(doc.email).toLowerCase();
    if (!email) continue;
    byEmail.set(email, [...(byEmail.get(email) || []), doc]);
  }

  const duplicates = [...byEmail.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`DUPLICATE_EMAILS:${duplicates.length}`);
  console.log('');

  for (const [email, rows] of duplicates.sort()) {
    console.log(`=== EMAIL: ${email} (${rows.length} records) ===`);
    for (const row of rows) {
      console.log(
        [
          `  id=${row.id}`,
          `companyId=${stringValue(row.companyId)}`,
          `role=${stringValue(row.role)}`,
          `status=${stringValue(row.status) || '?'}`,
          `isDeleted=${row.isDeleted === true ? 'true' : 'false'}`,
          `name=${stringValue(row.name) || stringValue(row.displayName)}`,
          `createdBy=${stringValue(row.createdBy)}`,
          `createdAt=${toISO(row.createdAt)}`,
          `authUid=${stringValue(row.authUid) || stringValue(row.firebaseUid) || 'none'}`,
          `demoSeedId=${stringValue(row.demoSeedId) || 'none'}`,
          `userId=${stringValue(row.userId)}`,
        ].join(' ')
      );
    }
    console.log('');
  }

  const musrDocs = docs.filter((d) => d.id.startsWith('MUSR-'));
  const authKeyed = docs.filter((d) => !d.id.startsWith('MUSR-') && !d.id.startsWith('owner:'));
  console.log(`AUTH_KEYED_USER_DOCS:${authKeyed.length} MUSR_DOCS:${musrDocs.length}`);
}

main().catch((error) => {
  console.error('AUDIT FAILED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
