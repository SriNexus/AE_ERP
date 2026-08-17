import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { firebaseEnv, storage } from '../../../lib/firebase';
import type { EngineeringDocument } from '../types';
import { assertTenantSafeUploadPath } from '../../../lib/demoUploadPolicy';
import { useAppStore } from '../../../store/useAppStore';

export async function uploadEngineeringDocument(
  designId: string,
  file: File,
  category: EngineeringDocument['category'],
): Promise<EngineeringDocument> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const companyId=useAppStore.getState().user?.companyId||useAppStore.getState().activeCompanyId;
  if(!companyId)throw new Error('Your company identity is unavailable. Please sign in again.');
  const storagePath = `companies/${companyId}/engineering-designs/${designId}/${category}/${Date.now()}-${safeName}`;
  if (!firebaseEnv.isConfigured) {
    return { id: `${category}-${Date.now()}`, name: file.name, url: URL.createObjectURL(file), storagePath: `demo/${storagePath}`, contentType: file.type || 'application/octet-stream', size: file.size, uploadedAt: new Date().toISOString(), category };
  }
  assertTenantSafeUploadPath(storagePath);
  const objectRef = ref(storage, storagePath);
  await uploadBytes(objectRef, file, { contentType: file.type || 'application/octet-stream' });
  return { id: `${category}-${Date.now()}`, name: file.name, url: await getDownloadURL(objectRef), storagePath, contentType: file.type || 'application/octet-stream', size: file.size, uploadedAt: new Date().toISOString(), category };
}
