/**
 * GroupAdminRoute — Route guard for Group Admin surfaces (Phase 5, Master
 * Plan §7).
 *
 * Client-side UX guard only — the Firestore rules are the real security
 * boundary (groupAdminCanRead()/sameGroup()/groupIsActive() gate every read
 * and write a Group Admin can reach; cross-Group and platform-tier access is
 * denied at the rules layer regardless of this guard). A non-GroupAdmin user
 * is redirected to /unauthorized with no indication the surface exists.
 *
 * The guard requires the store's booted ERP identity to carry the GroupAdmin
 * role and an authoritative groupId. Group suspension is enforced at the
 * rules layer (§9.6: every Group-scoped read/write fails closed while the
 * Group is Suspended), so this guard deliberately does NOT duplicate the
 * group-status read.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

export function useGroupAdminAccess(): boolean {
  const user = useAppStore((s) => s.user);
  return !!user && user.role === 'GroupAdmin' && !!user.groupId;
}

export function GroupAdminRoute({ children }: { children: ReactNode }) {
  const isGroupAdmin = useGroupAdminAccess();
  if (!isGroupAdmin) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}

export default GroupAdminRoute;
