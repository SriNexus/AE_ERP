/**
 * mobile/index.ts — Barrel export for all mobile components
 *
 * Import mobile components from this barrel:
 *   import { MobileShell, MobileLayout, useMobileDetect, useMobileNavigation } from '../mobile';
 */

// Shell
export { MobileShell } from './shell/MobileShell';
export { MobileLayout } from './shell/MobileLayout';
export { MobileTopBar } from './shell/MobileTopBar';
export { MobileBottomNav } from './shell/MobileBottomNav';
export { MobileNotificationSheet } from './shell/MobileNotificationSheet';
export { useMobileDetect } from './shell/useMobileDetect';

// Navigation
export { useMobileNavigation } from './hooks/useMobileNavigation';

// Context
export { ContextResolverProvider, useContextResolver } from './context/ContextResolver';

// App Workspace
export { AppWorkspace } from './app/AppWorkspace';
export { ModuleGrid } from './app/ModuleGrid';
export { ModuleCard } from './app/ModuleCard';

// Home
export { HomeWorkspace } from './home/HomeWorkspace';

// Routing
export { MobileRoutes } from './routing/MobileRoutes';

// Sheet/Page components
export { ModuleNavDrawer } from './shell/ModuleNavDrawer';

// Types
export type { MobileTab, MobileModule, RecentActionType, RecentEntry, SyncStatus } from './types';
export { MOBILE_BREAKPOINT, MOBILE_SHELL } from './types';

// Utils
export { getCurrentModule, setCurrentModule, clearCurrentModule, clearAll } from './utils/contextResolver';
