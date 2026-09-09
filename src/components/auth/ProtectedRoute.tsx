import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // PERF: select ONLY isAuthenticated. `useAppStore()` with no selector
  // subscribes to the whole store, so this route wrapper (which sits above
  // every authenticated page) re-rendered its entire subtree on every
  // company switch, permission-cache load, roleData set, teamMemberIds
  // update, etc. A single-boolean selector re-renders only on a real
  // auth-state change.
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
