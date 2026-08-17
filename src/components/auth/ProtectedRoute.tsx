import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAppStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
