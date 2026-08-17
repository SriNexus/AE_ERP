import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { firebaseEnv, storage } from '../../../lib/firebase';
import type { SurveyPhoto } from '../types';
import { assertTenantSafeUploadPath } from '../../../lib/demoUploadPolicy';
import { useAppStore } from '../../../store/useAppStore';

export async function uploadSurveyPhotos(surveyId: string, files: File[]): Promise<SurveyPhoto[]> {
  if (!files.length) return [];
  if (!firebaseEnv.isConfigured) {
    return files.map((file, index) => ({
      id: `demo-${Date.now()}-${index}`,
      name: file.name,
      url: URL.createObjectURL(file),
      storagePath: `demo/surveys/${surveyId}/${file.name}`,
      contentType: file.type || 'image/jpeg',
      size: file.size,
      capturedAt: new Date().toISOString(),
    }));
  }

  return Promise.all(files.map(async (file, index) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const companyId=useAppStore.getState().user?.companyId||useAppStore.getState().activeCompanyId;
    if(!companyId)throw new Error('Your company identity is unavailable. Please sign in again.');
    const storagePath = `companies/${companyId}/surveys/${surveyId}/${Date.now()}-${index}-${safeName}`;
    assertTenantSafeUploadPath(storagePath);
    const objectRef = ref(storage, storagePath);
    await uploadBytes(objectRef, file, { contentType: file.type || 'image/jpeg' });
    return {
      id: `${Date.now()}-${index}`,
      name: file.name,
      url: await getDownloadURL(objectRef),
      storagePath,
      contentType: file.type || 'image/jpeg',
      size: file.size,
      capturedAt: new Date().toISOString(),
    };
  }));
}
