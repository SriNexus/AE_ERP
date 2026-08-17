/**
 * PermissionGate — Centralized UI permission gating
 *
 * Wraps any UI element and hides or disables it based on RBAC permissions.
 * Calls usePermissions() internally — pages do NOT need to import it separately.
 *
 * Hide mode (default):   renders null when permission fails
 * Fallback mode:         renders fallback node when permission fails
 *
 * Usage:
 *   <PermissionGate module="products" action="create">
 *     <Button>Add Product</Button>
 *   </PermissionGate>
 *
 *   <PermissionGate module="leads" action="delete" fallback={<span />}>
 *     <Button danger>Delete</Button>
 *   </PermissionGate>
 *
 * Super-admin bypass: handled transparently by usePermissions() — no
 * special logic needed here. The gate just calls hasPerm and renders.
 *
 * NOTE: This is a UI convenience wrapper only.
 * Server-side / Firestore security rules are the true enforcement boundary.
 */

import React from 'react';
import { usePermissions } from '../../lib/permissions';
import type { Module, Permission } from '../../lib/permissions';

interface PermissionGateProps {
  module:     Module;
  action:     Permission;
  children:   React.ReactNode;
  /** Rendered when permission fails. Defaults to null (hidden). */
  fallback?:  React.ReactNode;
}

export function PermissionGate({
  module,
  action,
  children,
  fallback = null,
}: PermissionGateProps) {
  const perms = usePermissions();

  const allowed = perms.can(module, action);

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export default PermissionGate;
