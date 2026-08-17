/**
 * useWorkspaceSearch — React Query wrapper for WorkspaceSearchEngine (Phase 0F)
 *
 * Provides a debounced, React Query cached, keyboard-navigable search hook
 * that wraps WorkspaceSearchEngine for automatic caching, deduplication,
 * and stale-time management.
 *
 * Usage:
 *   const { groups, isLoading, query, setQuery } = useWorkspaceSearch();
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../store/useAppStore';
import { workspaceSearchEngine } from './WorkspaceSearchEngine';
import { resolveWriteCompanyId } from '../lib/firestore';
import { usePermissions } from '../lib/permissions';
import type { WorkspaceSearchGroup, WorkspaceSearchResult, WorkspaceSearchCategory } from './WorkspaceSearchEngine';

const DEBOUNCE_MS = 280;

export function useWorkspaceSearch(
  options?: {
    categoryFilter?: WorkspaceSearchCategory[];
    debounceMs?: number;
  },
) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const perms = usePermissions();
  const activeCompanyId = useAppStore((state) => state.activeCompanyId);

  const debounceMs = options?.debounceMs ?? DEBOUNCE_MS;

  // Debounce input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(-1); }, [debouncedQuery]);

  // Build permissions object for the engine
  const permissions = useMemo(() => ({
    canView: (module: string) => perms.canView(module as any),
  }), [perms]);

  // Fetch search results via WorkspaceSearchEngine
  const searchQuery = useQuery({
    queryKey: ['workspace-search', activeCompanyId, debouncedQuery, options?.categoryFilter],
    queryFn: () => workspaceSearchEngine.search(
      debouncedQuery,
      // Canonical tenant resolution — never the neutral 'default' placeholder.
      resolveWriteCompanyId(),
      permissions,
      options?.categoryFilter,
    ),
    enabled: Boolean(activeCompanyId) && debouncedQuery.length >= 2,
    staleTime: 30 * 1000,
  });

  const groups: WorkspaceSearchGroup[] = searchQuery.data ?? [];

  // Flat list for keyboard navigation
  const flatResults: WorkspaceSearchResult[] = useMemo(
    () => groups.flatMap((g) => g.results),
    [groups],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, onSelectResult: (r: WorkspaceSearchResult) => void) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        const r = flatResults[selectedIndex];
        if (r) onSelectResult(r);
      }
    },
    [flatResults, selectedIndex],
  );

  return {
    query,
    setQuery,
    groups,
    flatResults,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    isLoading: searchQuery.isFetching,
    hasResults: flatResults.length > 0,
    isEmpty: debouncedQuery.length >= 2 && !searchQuery.isFetching && flatResults.length === 0,
  } as const;
}

export default useWorkspaceSearch;
