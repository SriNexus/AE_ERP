import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  runGlobalSearch,
  loadRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
} from '../utils/searchIndex';
import {
  type SearchResult,
  type SearchCategory,
  type SearchGroup,
  CATEGORY_LABELS,
} from '../types';
import { useAppStore } from '../../../store/useAppStore';
import { resolveWriteCompanyId } from '../../../lib/firestore';

// ═══════════════════════════════════════════════════════════
//  useGlobalSearch
//  Debounced, React Query cached, keyboard-navigable
// ═══════════════════════════════════════════════════════════

const DEBOUNCE_MS = 280;

export function useGlobalSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>(
    () => loadRecentSearches()
  );

  const qc = useQueryClient();
  const activeCompanyId = useAppStore(s => s.activeCompanyId);
  // Canonical tenant resolution — never the neutral 'default' placeholder.
  const companyId = resolveWriteCompanyId();

  // ── Debounce input ─────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // ── Reset selection when results change ───────────────────
  useEffect(() => { setSelectedIndex(-1); }, [debouncedQuery]);

  // ── Fetch search results ──────────────────────────────────
  const searchQuery = useQuery({
    queryKey: ['global-search', companyId, debouncedQuery],
    queryFn:  () => runGlobalSearch(debouncedQuery, companyId),
    enabled:  !!companyId && debouncedQuery.length >= 2,
    staleTime: 30 * 1000,
  });

  // ── Group results ─────────────────────────────────────────
  const groups: SearchGroup[] = Object.entries(searchQuery.data ?? {})
    .filter(([, results]) => (results as SearchResult[]).length > 0)
    .map(([category, results]) => ({
      category: category as SearchCategory,
      label:    CATEGORY_LABELS[category as SearchCategory],
      results:  results as SearchResult[],
    }));

  // Flat list for keyboard navigation
  const flatResults: SearchResult[] = groups.flatMap((g) => g.results);

  // ── Handle result selection ───────────────────────────────
  const handleSelect = useCallback(
    (result: SearchResult, onNavigate: (link: string) => void) => {
      saveRecentSearch(query);
      setRecentSearches(loadRecentSearches());
      onNavigate(result.link);
      setQuery('');
    },
    [query]
  );

  // ── Keyboard navigation ────────────────────────────────────
  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      onSelectResult: (r: SearchResult) => void
    ) => {
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
    [flatResults, selectedIndex]
  );

  const handleClearRecent = useCallback(() => {
    clearRecentSearches();
    setRecentSearches([]);
  }, []);

  return {
    query,
    setQuery,
    isLoading:     searchQuery.isFetching,
    groups,
    flatResults,
    selectedIndex,
    setSelectedIndex,
    handleSelect,
    handleKeyDown,
    recentSearches,
    handleClearRecent,
    hasResults:    flatResults.length > 0,
    isEmpty:       debouncedQuery.length >= 2 && !searchQuery.isFetching && flatResults.length === 0,
  } as const;
}
