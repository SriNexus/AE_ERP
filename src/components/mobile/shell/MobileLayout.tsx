/**
 * MobileLayout — Protected mobile layout wrapper
 *
 * This is the mobile equivalent of the desktop Layout component.
 * It wraps protected routes in the MobileShell instead of the
 * desktop AppShell + Sidebar + TopBar.
 *
 * Future batches will add ContextResolver, boot logic, etc.
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import MobileShell from './MobileShell';

export function MobileLayout() {
  return (
    <MobileShell>
      <Outlet />
    </MobileShell>
  );
}

export default MobileLayout;
