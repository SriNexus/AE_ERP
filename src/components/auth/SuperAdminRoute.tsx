/**
 * SuperAdminRoute — Route guard for Super Admin exclusive pages
 *
 * Phase 9D-A: Only the ERP Owner (shreeniwas.tripathi0@gmail.com)
 * can access AI Intelligence features.
 *
 * Non-owner users are redirected to /unauthorized with no indication
 * that the AI feature exists.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { isOwnerFirebaseUser } from '../../lib/ownerAccess';

export function useSuperAdminAccess(): boolean {
  const [allowed, setAllowed] = useState(() => isOwnerFirebaseUser(auth.currentUser));
  useEffect(() => onAuthStateChanged(auth, (user) => setAllowed(isOwnerFirebaseUser(user))), []);
  return allowed;
}

export function SuperAdminRoute({ children }: { children: ReactNode }) {
  const isSuperAdmin = useSuperAdminAccess();
  if (!isSuperAdmin) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}

export default SuperAdminRoute;
