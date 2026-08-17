import { DEMO_COMPANY_ID, isOfficialDemoCompany } from '../config/demo';
import { useAppStore } from '../store/useAppStore';

export function assertTenantSafeUploadPath(path: string, companyId?: string): void {
  const state = useAppStore.getState();
  const resolvedCompanyId = companyId || state.user?.companyId || state.activeCompanyId;
  if (!isOfficialDemoCompany(resolvedCompanyId)) return;

  const normalized = path.replace(/^\/+/, '');
  const ownProfilePrefix = state.user?.id ? `users/${state.user.id}/profile/` : '';
  const companyPrefix = `companies/${DEMO_COMPANY_ID}/`;
  if ((ownProfilePrefix && normalized.startsWith(ownProfilePrefix)) || normalized.startsWith(companyPrefix)) return;

  throw new Error('This upload is unavailable in the public demo until the storage path is company-scoped.');
}
