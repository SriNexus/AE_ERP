import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { isOwnerFirebaseUser } from '../../lib/ownerAccess';

export function useOwnerAccess(): boolean {
  const [allowed, setAllowed] = useState(() => isOwnerFirebaseUser(auth.currentUser));
  useEffect(() => onAuthStateChanged(auth, (user) => setAllowed(isOwnerFirebaseUser(user))), []);
  return allowed;
}

export function OwnerRoute({ children }: { children: ReactNode }) {
  return useOwnerAccess() ? <>{children}</> : <Navigate to="/dashboard" replace />;
}