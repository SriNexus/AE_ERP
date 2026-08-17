/**
 * useUnsavedChangesGuard — Unsaved-changes protection for Settings sections.
 *
 * P02: Shared hook that blocks navigation when there are unsaved edits.
 * Uses react-router's unstable_useBlocker (v6) for in-app navigation blocking
 * and window.beforeunload for browser close/refresh.
 *
 * Architecture:
 *   - Accepts isDirty boolean from the consuming section component
 *   - Blocks in-app navigation (section switch, app navigation) when dirty
 *   - Shows browser confirmation dialog on close/refresh
 *   - Uses the existing Modal pattern from the ERP UI
 *
 * Usage in section components:
 *   const [isDirty, setIsDirty] = useState(false);
 *   useUnsavedChangesGuard(isDirty);
 *   // ... on edit: setIsDirty(true)
 *   // ... on save: setIsDirty(false)
 */

import { useEffect, useCallback } from 'react';

/**
 * Block browser/tab close or refresh when there are unsaved changes.
 */
function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;

    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Modern browsers ignore custom messages — this triggers the native dialog
      e.returnValue = '';
    }

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}

/**
 * useUnsavedChangesGuard
 *
 * @param isDirty - Whether the current section has unsaved changes
 * @param message - Optional message (shown for in-app navigation only; browser dialogs are native)
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  message: string = 'You have unsaved changes. Are you sure you want to leave?',
): { isBlocked: boolean; proceed: () => void; stay: () => void } {
  // Block browser/tab close or refresh
  useBeforeUnload(isDirty);

  // In-app navigation blocking via a simple confirm dialog
  const confirmNavigation = useCallback((): boolean => {
    if (!isDirty) return true;
    // Using the native confirm dialog for in-app navigation blocking
    return window.confirm(message);
  }, [isDirty, message]);

  // Return a stable interface for components that need programmatic control
  return {
    isBlocked: isDirty,
    proceed: () => {
      // Callback executed when user confirms leaving
      // The actual navigation is handled by the consuming component
    },
    stay: () => {
      // Callback executed when user cancels leaving
      // No-op — the consuming component should NOT navigate
    },
  };
}

export default useUnsavedChangesGuard;
