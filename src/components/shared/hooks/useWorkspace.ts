/**
 * useWorkspace — Shared state management hook for workspace pages
 *
 * Phase 0A (Section 2.6):
 * - Manages the active tab state
 * - Syncs the active tab to URL query parameter (?tab=tabname)
 * - Provides permission gating helpers
 * - Tracks Case ID for Case-participating entities
 *
 * Usage:
 *   const { activeTab, setActiveTab, tabFromUrl, permissions } = useWorkspace('leads', entityId);
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { WorkspaceTabId } from '../../../types';

// ── Types ──────────────────────────────────────────────────

export interface WorkspaceState {
  /** Currently active tab ID */
  activeTab: WorkspaceTabId;
  /** Set active tab (syncs to URL) */
  setActiveTab: (tab: WorkspaceTabId) => void;
  /** Tab ID derived from URL param (or default) */
  tabFromUrl: WorkspaceTabId | null;
  /** Entity ID being viewed */
  entityId: string;
  /** Module key */
  moduleKey: string;
  /** Case ID if this entity is Case-participating */
  caseId?: string;
  /** Set Case ID */
  setCaseId: (caseId: string) => void;
  /** Create mode flag (?create=1) */
  isCreateMode: boolean;
}

// ── Query parameter constants ──────────────────────────────

const TAB_PARAM = 'tab';
const DEFAULT_TAB: WorkspaceTabId = 'overview';
const CREATE_PARAM = 'create';

// ── Valid tab ID guard ─────────────────────────────────────

const VALID_TABS: Set<string> = new Set([
  'overview', 'notes', 'activity', 'documents', 'history',
  'communication', 'tasks', 'attachments', 'linked_records', 'permissions', 'disposable',
  // Central Panel Refinement mission — see the matching comment on
  // WorkspaceTabId in types/index.ts for why these were missing.
  'orders-tab', 'invoices-tab',
]);

function isValidTab(value: string | null): value is WorkspaceTabId {
  return value !== null && VALID_TABS.has(value);
}

// ── Hook ───────────────────────────────────────────────────

export function useWorkspace(
  moduleKey: string,
  entityId?: string,
  defaultTab: WorkspaceTabId = DEFAULT_TAB,
): WorkspaceState {
  const [searchParams, setSearchParams] = useSearchParams();
  const [internalCaseId, setInternalCaseId] = useState<string | undefined>();

  // Derive active tab from URL, falling back to default
  const tabFromUrl = useMemo(() => {
    const raw = searchParams.get(TAB_PARAM);
    return isValidTab(raw) ? (raw as WorkspaceTabId) : null;
  }, [searchParams]);

  const activeTab = tabFromUrl ?? defaultTab;

  // Is create mode active?
  const isCreateMode = searchParams.get(CREATE_PARAM) === '1';

  // Set active tab and sync to URL
  const setActiveTab = useCallback(
    (tab: WorkspaceTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (tab === DEFAULT_TAB) {
          next.delete(TAB_PARAM);
        } else {
          next.set(TAB_PARAM, tab);
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setCaseId = useCallback((caseId: string) => {
    setInternalCaseId(caseId);
  }, []);

  return {
    activeTab,
    setActiveTab,
    tabFromUrl,
    entityId: entityId ?? '',
    moduleKey,
    caseId: internalCaseId,
    setCaseId,
    isCreateMode,
  };
}

export default useWorkspace;
