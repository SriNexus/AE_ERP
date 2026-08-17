/** Dry-run-first My Profile migration.
 *
 * Usage:
 *   node --experimental-strip-types scripts/migrate-my-profile-to-users.ts [--apply]
 *
 * Migrates legacy `{userId}_settings_my-profile` documents into the canonical
 * `users/{userId}` profile and uploads legacy base64 avatar/signature images to
 * Firebase Storage when needed. Existing canonical values are never overwritten.
 * Legacy settings docs are only marked deprecated after a successful apply.
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

type LegacyProfileDoc = Record<string, unknown> & {
  displayName?: string;
  name?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  signature?: string;
  avatarUrl?: string;
  signatureUrl?: string;
};

const apply = process.argv.includes('--apply');
const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function isDataUrl(value: string): boolean {
  return value.startsWith('data:') && value.includes('base64,');
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL');
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

async function uploadLegacyAsset(userId: string, kind: 'avatar' | 'signature', value: string): Promise<string> {
  if (!value) return '';
  if (!isDataUrl(value)) return value;
  const { buffer, contentType } = dataUrlToBuffer(value);
  const file = bucket.file(`users/${userId}/profile/${kind}/${Date.now()}.${extensionFor(contentType)}`);
  await file.save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'public,max-age=31536000,immutable',
    },
  });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: '03-01-2500',
  });
  return url;
}

async function migrateLegacyProfile(userId: string, legacy: LegacyProfileDoc) {
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  const userData = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;

  const nextDisplayName = text(userData.displayName) || text(userData.name) || text(legacy.displayName) || text(legacy.name);
  const nextEmail = text(userData.email) || text(legacy.email);
  const nextPhone = text(userData.phone) || text(legacy.phone);
  const nextAvatar = text(userData.avatarUrl) || text(userData.avatar) || text(legacy.avatarUrl) || text(legacy.avatar);
  const nextSignature = text(userData.signatureUrl) || text(userData.signature) || text(legacy.signatureUrl) || text(legacy.signature);

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'scripts/migrate-my-profile-to-users.ts',
  };

  if (!text(userData.displayName) && nextDisplayName) {
    patch.displayName = nextDisplayName;
    patch.name = text(userData.name) || nextDisplayName;
  }
  if (!text(userData.email) && nextEmail) patch.email = nextEmail;
  if (!text(userData.phone) && nextPhone) patch.phone = nextPhone;

  if (!text(userData.avatarUrl) && nextAvatar) {
    patch.avatarUrl = await uploadLegacyAsset(userId, 'avatar', nextAvatar);
  }
  if (!text(userData.signatureUrl) && nextSignature) {
    patch.signatureUrl = await uploadLegacyAsset(userId, 'signature', nextSignature);
  }

  const settingsRef = db.collection('settings').doc(`${userId}_settings_my-profile`);

  if (apply) {
    await userRef.set(patch, { merge: true });
    await settingsRef.set({
      _deprecated: true,
      deprecatedAt: FieldValue.serverTimestamp(),
      deprecatedBy: 'scripts/migrate-my-profile-to-users.ts',
    }, { merge: true });
  }

  return { userId, patchKeys: Object.keys(patch).filter((key) => key !== 'updatedAt' && key !== 'updatedBy') };
}

async function main() {
  const usersSnap = await db.collection('users').get();
  let examined = 0;
  let migrated = 0;
  let avatarUploads = 0;
  let signatureUploads = 0;
  const skipped: string[] = [];

  for (const userDoc of usersSnap.docs) {
    examined += 1;
    const legacySnap = await db.collection('settings').doc(`${userDoc.id}_settings_my-profile`).get();
    if (!legacySnap.exists) continue;
    const legacy = legacySnap.data() as LegacyProfileDoc;
    const current = userDoc.data() as Record<string, unknown>;
    const hasAnythingToMigrate = Boolean(
      (!text(current.displayName) && (text(legacy.displayName) || text(legacy.name)))
      || (!text(current.email) && text(legacy.email))
      || (!text(current.phone) && text(legacy.phone))
      || (!text(current.avatarUrl) && (text(legacy.avatarUrl) || text(legacy.avatar)))
      || (!text(current.signatureUrl) && (text(legacy.signatureUrl) || text(legacy.signature)))
    );

    if (!hasAnythingToMigrate) {
      skipped.push(userDoc.id);
      continue;
    }

    if (!apply) {
      migrated += 1;
      if (!text(current.avatarUrl) && (text(legacy.avatarUrl) || text(legacy.avatar))) avatarUploads += 1;
      if (!text(current.signatureUrl) && (text(legacy.signatureUrl) || text(legacy.signature))) signatureUploads += 1;
      continue;
    }

    const result = await migrateLegacyProfile(userDoc.id, legacy);
    migrated += 1;
    if (result.patchKeys.includes('avatarUrl')) avatarUploads += 1;
    if (result.patchKeys.includes('signatureUrl')) signatureUploads += 1;
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    usersExamined: examined,
    profilesMigrated: migrated,
    avatarUploads,
    signatureUploads,
    skipped,
  }, null, 2));

  if (!apply) {
    console.log('No writes performed. Re-run with --apply after reviewing the dry-run output.');
  }
}

main().catch((error) => {
  console.error('Profile migration failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
