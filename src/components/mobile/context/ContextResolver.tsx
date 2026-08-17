/**
 * ContextResolver — Mobile context provider for active module/entity tracking
 *
 * This is the central navigation layer for the mobile ERP.
 * It maintains the currently active module, entity, and workspace state,
 * persists to sessionStorage, and provides APIs for context changes.
 *
 * Every future mobile module plugs into this:
 * - ModuleGrid → setModule() to select a workspace
 * - Search/Recent/Notifications → openEntity() to navigate to a specific record
 * - Detail sheets → setEntityId() to track open records
 * - Back/close → navigateBack() or resetModule()
 * - Logout → resetAll() clears all sessionStorage context
 *
 * Architecture rules:
 * - State is RESTORED from sessionStorage on mount (survives refresh)
 * - State is PERSISTED to sessionStorage on every change (survives tab switch)
 * - null module = App tab shows ModuleGrid (default state)
 * - null entityId = list view within the module
 * - Back navigation restores previous state
 */

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import {
  getCurrentModule,
  setCurrentModule as persistModule,
  clearCurrentModule,
  getCurrentEntityId,
  setCurrentEntityId as persistEntityId,
  clearCurrentEntityId,
  clearAll as clearAllStorage,
} from '../utils/contextResolver';

// ── Types ────────────────────────────────────────────────────

export type Workspace = 'list' | 'detail' | 'form';

export interface ContextState {
  /** The active App workspace module (null = ModuleGrid default state) */
  currentModule: string | null;
  /** Active entity ID within the module (null = list view) */
  currentEntityId: string | null;
  /** Current view within the module */
  currentWorkspace: Workspace;
  /** Previous module for smart back navigation */
  previousModule: string | null;
}

export interface ContextActions {
  /** Switch to a different module workspace (or null for ModuleGrid) */
  setModule: (module: string | null) => void;
  /** Open a specific entity within the current module */
  setEntityId: (entityId: string | null) => void;
  /** Set the workspace view state */
  setWorkspace: (workspace: Workspace) => void;
  /** Navigate to a specific entity (sets module + entityId + detail workspace) */
  openEntity: (module: string, entityId: string) => void;
  /** Clear the current module back to null (ModuleGrid) */
  resetModule: () => void;
  /** Clear all context state and sessionStorage */
  resetAll: () => void;
  /** Smart back: detail → list list → previous module or ModuleGrid */
  navigateBack: () => void;
}

export type ContextValue = ContextState & ContextActions;

/** Default state when no module has been selected */
const DEFAULT_STATE: ContextState = {
  currentModule: null,
  currentEntityId: null,
  currentWorkspace: 'list',
  previousModule: null,
};

// ── Context ──────────────────────────────────────────────────

const ContextResolverContext = createContext<ContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────

interface ContextResolverProviderProps {
  children: ReactNode;
}

export function ContextResolverProvider({ children }: ContextResolverProviderProps) {
  // Initialize from sessionStorage on mount
  const [state, setState] = useState<ContextState>(() => {
    const restoredModule = getCurrentModule();
    const restoredEntity = getCurrentEntityId();
    return {
      currentModule: restoredModule,
      currentEntityId: restoredEntity,
      currentWorkspace: restoredEntity ? 'detail' : 'list',
      previousModule: null,
    };
  });

  // Persist module changes to sessionStorage
  useEffect(() => {
    if (state.currentModule) {
      persistModule(state.currentModule);
    } else {
      clearCurrentModule();
    }
  }, [state.currentModule]);

  // Persist entity changes to sessionStorage
  useEffect(() => {
    if (state.currentEntityId) {
      persistEntityId(state.currentEntityId);
    } else {
      clearCurrentEntityId();
    }
  }, [state.currentEntityId]);

  // ── Actions ──────────────────────────────────────────────

  const setModule = useCallback((module: string | null) => {
    setState((prev) => {
      // Defensive: no-op if switching to the same module (preserves entity/workspace)
      if (prev.currentModule === module) return prev;
      return {
        ...prev,
        previousModule: prev.currentModule,
        currentModule: module,
        currentEntityId: null,
        currentWorkspace: 'list',
      };
    });
  }, []);

  const setEntityId = useCallback((entityId: string | null) => {
    setState((prev) => ({
      ...prev,
      currentEntityId: entityId,
      currentWorkspace: entityId ? 'detail' : 'list',
    }));
  }, []);

  const setWorkspace = useCallback((workspace: Workspace) => {
    setState((prev) => ({ ...prev, currentWorkspace: workspace }));
  }, []);

  const openEntity = useCallback((module: string, entityId: string) => {
    setState((prev) => ({
      ...prev,
      previousModule: prev.currentModule !== module ? prev.currentModule : prev.previousModule,
      currentModule: module,
      currentEntityId: entityId,
      currentWorkspace: 'detail',
    }));
  }, []);

  const resetModule = useCallback(() => {
    setState((prev) => ({
      ...prev,
      previousModule: prev.currentModule,
      currentModule: null,
      currentEntityId: null,
      currentWorkspace: 'list',
    }));
  }, []);

  const resetAll = useCallback(() => {
    setState({ ...DEFAULT_STATE });
    clearAllStorage();
  }, []);

  const navigateBack = useCallback(() => {
    setState((prev) => {
      // If in detail view, go back to list view
      if (prev.currentEntityId) {
        return {
          ...prev,
          currentEntityId: null,
          currentWorkspace: 'list',
        };
      }
      // If in list view, go back to previous module or ModuleGrid
      if (prev.previousModule) {
        return {
          currentModule: prev.previousModule,
          currentEntityId: null,
          currentWorkspace: 'list',
          previousModule: prev.currentModule !== prev.previousModule ? prev.currentModule : null,
        };
      }
      // No previous state — reset to ModuleGrid
      return {
        ...prev,
        currentModule: null,
        currentEntityId: null,
        currentWorkspace: 'list',
        previousModule: null,
      };
    });
  }, []);

  const value: ContextValue = {
    ...state,
    setModule,
    setEntityId,
    setWorkspace,
    openEntity,
    resetModule,
    resetAll,
    navigateBack,
  };

  return (
    <ContextResolverContext.Provider value={value}>
      {children}
    </ContextResolverContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────

/**
 * useContextResolver — Read and update the current mobile context.
 *
 * Use in any mobile component that needs to know the current
 * module, entity, or workspace. Returns { currentModule, currentEntityId,
 * currentWorkspace, setModule, setEntityId, setWorkspace, openEntity,
 * resetModule, resetAll, navigateBack }.
 *
 * @throws if used outside of ContextResolverProvider
 */
export function useContextResolver(): ContextValue {
  const ctx = useContext(ContextResolverContext);
  if (!ctx) {
    throw new Error(
      'useContextResolver must be used within a <ContextResolverProvider>. ' +
      'Wrap your component tree with ContextResolverProvider.',
    );
  }
  return ctx;
}

export default ContextResolverProvider;
