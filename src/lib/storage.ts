/**
 * storage — Firebase Storage helpers
 *
 * Provides reusable upload functions for Firebase Storage.
 * - uploadFile: Uploads any file and returns download URL
 * - uploadImage: Uploads an image with optional compression
 *
 * Reuses existing:
 *   - Firebase Storage instance from firebase.ts
 *   - imageUtils.ts compressImageBase64 for image compression
 */

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, firebaseEnv } from './firebase';
import { compressImageBase64 } from './imageUtils';
import { genId } from './firestore';

/**
 * Upload a file to Firebase Storage and return its download URL.
 *
 * @param path - Storage path (e.g., 'commissioning-signatures/company-123')
 * @param file - File to upload
 * @param compress - Whether to compress image files before upload
 * @returns Download URL string
 */
export async function uploadFile(
  path: string,
  file: File,
  compress = true,
): Promise<string> {
  if (!firebaseEnv.isConfigured) {
    throw new Error('Firebase is not configured. Cannot upload files.');
  }

  let uploadData: Blob | Uint8Array | ArrayBuffer;

  if (compress && file.type.startsWith('image/')) {
    // Compress image to base64, then convert to blob for upload
    const compressedBase64 = await compressImageBase64(file, 800, 800, 0.85);
    const response = await fetch(compressedBase64);
    uploadData = await response.blob();
  } else {
    uploadData = file;
  }

  const fileName = `${genId.generic('SIG')}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const fullPath = `${path}/${fileName}`;
  const storageRef = ref(storage, fullPath);

  await uploadBytes(storageRef, uploadData, {
    contentType: compress && file.type.startsWith('image/') ? 'image/jpeg' : file.type,
  });

  const downloadUrl = await getDownloadURL(storageRef);
  return downloadUrl;
}

/**
 * Upload an image specifically for commissioning signature.
 * Uses a well-known path pattern for organization.
 */
export async function uploadCommissioningSignature(
  companyId: string,
  file: File,
): Promise<string> {
  const path = `companies/${companyId}/commissioning-signatures`;
  return uploadFile(path, file, true);
}

export default {
  uploadFile,
  uploadCommissioningSignature,
};
